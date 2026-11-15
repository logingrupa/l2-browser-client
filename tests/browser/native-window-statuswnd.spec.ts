import { expect, test, type Browser, type BrowserContextOptions, type Page } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { formatRigaTimestamp } from "../../scripts/check-machine-schedule.mjs";
import { desktopViewport, landscapePhone } from "./browserViewports";
import { servedLaneCatalogSha256, writeLoadCheckRecord } from "./support/loadCheckRecordFile";

const laneName = "data-ui";
const laneStoreRoot = resolve("artifacts/lane-store", laneName);
const laneCatalogPath = resolve(laneStoreRoot, "l2/catalog.json");
const evidenceDirectory = resolve("artifacts/ui-evidence");
const statusWindowId = "StatusWnd";
const harnessUrl = `/tests/browser/harness/native-window.html?window=${statusWindowId}`;
const lowerHealth = 37;
const portraitPhoneViewport = { width: 430, height: 932 };

interface LaneWindowRecord { readonly id: string; readonly manifest: string }
interface LaneTextureRecord { readonly id: string; readonly image: string }
interface LaneCatalog { readonly windows?: LaneWindowRecord[]; readonly textures?: LaneTextureRecord[] }
interface DecodedRoot { readonly width: number; readonly height: number }
interface DecodedStatusManifest { readonly root: DecodedRoot; readonly textureRefs: readonly string[] }
interface FieldBindingRow { readonly windowId: string; readonly controlName: string; readonly worldField: string | null; readonly gapReason: string | null }

const uiTextureIdPrefix = "ui-texture:";

function laneCatalog(): LaneCatalog | undefined {
  return existsSync(laneCatalogPath) ? JSON.parse(readFileSync(laneCatalogPath, "utf8")) as LaneCatalog : undefined;
}

function decodedStatusManifest(record: LaneWindowRecord): DecodedStatusManifest {
  return JSON.parse(readFileSync(resolve(laneStoreRoot, `.${record.manifest}`), "utf8")) as DecodedStatusManifest;
}

function statusTextureImagePaths(catalog: LaneCatalog, manifest: DecodedStatusManifest): ReadonlySet<string> {
  const references = new Set(manifest.textureRefs.map(reference => uiTextureIdPrefix + reference));
  return new Set((catalog.textures ?? []).filter(record => references.has(record.id)).map(record => record.image));
}

function statusBindings(): readonly FieldBindingRow[] {
  const recipe = JSON.parse(readFileSync("recipes/data/window-field-bindings.json", "utf8")) as { bindings: FieldBindingRow[] };
  return recipe.bindings.filter(binding => binding.windowId === statusWindowId);
}

const servedCatalog = laneCatalog();
const statusRecord = servedCatalog?.windows?.find(record => record.id === statusWindowId);
const failures: string[] = [];

test.skip(process.env.NATIVE_STORE_ROOT !== laneName, "run with NATIVE_STORE_ROOT=data-ui");
test.skip(statusRecord === undefined, "window:StatusWnd not converted in the data-ui lane store");

async function openStatusWindow(page: Page): Promise<ReadonlySet<string>> {
  const pageErrors: string[] = [];
  const fetchedImagePaths = new Set<string>();
  page.on("pageerror", error => pageErrors.push(error.message));
  page.on("response", response => {
    const path = new URL(response.url()).pathname;
    if (response.ok() && path.startsWith("/l2/") && path.endsWith(".png")) fetchedImagePaths.add(path);
  });
  await page.goto(harnessUrl);
  await expect(page.locator("#native-window-harness")).toHaveAttribute("data-status", /^(opened|not-in-catalog|failed)$/, { timeout: 30_000 });
  expect(await page.evaluate(() => window.__nativeWindowHarness?.result.reason ?? null)).toBeNull();
  expect(pageErrors).toEqual([]);
  await expect(page.locator(`[data-native-window="${statusWindowId}"]`)).toBeVisible();
  return fetchedImagePaths;
}

async function decodedControlImageCount(page: Page): Promise<number> {
  return page.locator(`[data-native-window="${statusWindowId}"] img`).evaluateAll(images =>
    images.filter(image => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0 && image.naturalHeight > 0).length);
}

async function expectConvertedSkinDrawn(page: Page, fetchedImagePaths: ReadonlySet<string>): Promise<void> {
  const expectedImagePaths = statusTextureImagePaths(servedCatalog!, decodedStatusManifest(statusRecord!));
  expect(expectedImagePaths.size).toBeGreaterThan(0);
  expect([...fetchedImagePaths].filter(path => expectedImagePaths.has(path)).length).toBeGreaterThan(0);
  await expect.poll(() => decodedControlImageCount(page)).toBeGreaterThan(0);
}

async function boxWidth(page: Page, selector: string): Promise<number> {
  const box = await page.locator(selector).boundingBox();
  if (box === null) throw new Error(`${selector} has no layout box`);
  return box.width;
}

async function withRecordedFailure(check: () => Promise<void>): Promise<void> {
  try { await check(); }
  catch (error) {
    failures.push(error instanceof Error ? error.message.split("\n")[0]! : String(error));
    throw error;
  }
}

async function checkStatusWindowAt(browser: Browser, contextOptions: BrowserContextOptions, screenshotName: string): Promise<void> {
  const root = decodedStatusManifest(statusRecord!).root;
  const bindings = statusBindings();
  const boundGauge = bindings.find(binding => binding.worldField === "health")!;
  const absentReasons = bindings.flatMap(binding => binding.gapReason === null ? [] : [binding.gapReason]);
  const context = await browser.newContext(contextOptions);
  try {
    const page = await context.newPage();
    const fetchedImagePaths = await openStatusWindow(page);
    await expectConvertedSkinDrawn(page, fetchedImagePaths);
    const rootBox = await page.locator(`[data-native-window="${statusWindowId}"]`).boundingBox();
    expect([rootBox?.width, rootBox?.height]).toEqual([root.width, root.height]);
    const gaugeSelector = `[data-native-control="${boundGauge.controlName}"]`;
    const fillSelector = `${gaugeSelector} > [data-native-gauge-fill]`;
    const gaugeWidth = await boxWidth(page, gaugeSelector);
    expect(await boxWidth(page, fillSelector)).toBe(Math.trunc(gaugeWidth * 100 / 100));
    await page.evaluate(health => window.__nativeWindowHarness!.setHealth(health), lowerHealth);
    await expect.poll(() => boxWidth(page, fillSelector)).toBe(Math.trunc(gaugeWidth * lowerHealth / 100));
    expect(absentReasons).toHaveLength(2);
    for (const reason of absentReasons) await expect(page.locator(`[data-native-gap~="${reason}"]`)).toHaveCount(1);
    mkdirSync(evidenceDirectory, { recursive: true });
    await page.screenshot({ path: resolve(evidenceDirectory, screenshotName) });
  } finally {
    await context.close();
  }
}

test.describe.serial("window:StatusWnd on the harness page", () => {
  test.afterAll(async ({}, testInfo) => {
    const baseUrl = testInfo.project.use.baseURL;
    if (baseUrl === undefined) throw new Error("the Playwright project has no baseURL");
    writeLoadCheckRecord(laneName, await servedLaneCatalogSha256(baseUrl), {
      key: `window:${statusWindowId}`, status: failures.length === 0 ? "pass" : "failed", reason: failures.length === 0 ? null : failures.join("; "),
      atRiga: formatRigaTimestamp(new Date()), assetManifestSchemaVersion: 2,
    });
  });

  test("opens StatusWnd from its decoded manifest with its converted skin and HP bound to the adapter local player at 1440 x 900", async ({ browser }) => {
    await withRecordedFailure(() => checkStatusWindowAt(browser, { viewport: desktopViewport }, "statuswnd-1440x900.png"));
  });

  test("opens StatusWnd with its converted skin at 932 x 430 on a landscape touch phone", async ({ browser }) => {
    await withRecordedFailure(() => checkStatusWindowAt(browser, landscapePhone, "statuswnd-932x430.png"));
  });

  test("has no horizontal scroll at 430 x 932 portrait", async ({ browser }) => {
    await withRecordedFailure(async () => {
      const context = await browser.newContext({ viewport: portraitPhoneViewport });
      try {
        const page = await context.newPage();
        await openStatusWindow(page);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      } finally {
        await context.close();
      }
    });
  });
});
