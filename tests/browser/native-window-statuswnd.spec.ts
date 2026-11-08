import { expect, test, type Browser, type BrowserContextOptions, type Page } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { formatRigaTimestamp } from "../../scripts/check-machine-schedule.mjs";
import { desktopViewport, landscapePhone } from "./browserViewports";
import { hashServedLaneCatalog, writeLoadCheckRecord } from "./support/loadCheckRecordFile";

const laneName = "data-ui";
const laneStoreRoot = resolve("artifacts/lane-store", laneName);
const laneCatalogPath = resolve(laneStoreRoot, "l2/catalog.json");
const evidenceDirectory = resolve("artifacts/ui-evidence");
const statusWindowId = "StatusWnd";
const harnessUrl = `/tests/browser/harness/native-window.html?window=${statusWindowId}`;
const lowerHealth = 37;
const portraitPhoneViewport = { width: 430, height: 932 };

interface LaneWindowRecord { readonly id: string; readonly manifest: string }
interface DecodedRoot { readonly width: number; readonly height: number }
interface FieldBindingRow { readonly windowId: string; readonly controlName: string; readonly worldField: string | null; readonly gapReason: string | null }

function laneStatusWindowRecord(): LaneWindowRecord | undefined {
  if (!existsSync(laneCatalogPath)) return undefined;
  const catalog = JSON.parse(readFileSync(laneCatalogPath, "utf8")) as { windows?: LaneWindowRecord[] };
  return catalog.windows?.find(record => record.id === statusWindowId);
}

function decodedStatusRoot(record: LaneWindowRecord): DecodedRoot {
  return (JSON.parse(readFileSync(resolve(laneStoreRoot, `.${record.manifest}`), "utf8")) as { root: DecodedRoot }).root;
}

function statusBindings(): readonly FieldBindingRow[] {
  const recipe = JSON.parse(readFileSync("recipes/data/window-field-bindings.json", "utf8")) as { bindings: FieldBindingRow[] };
  return recipe.bindings.filter(binding => binding.windowId === statusWindowId);
}

const statusRecord = laneStatusWindowRecord();
const failures: string[] = [];

test.skip(process.env.NATIVE_STORE_ROOT !== laneName, "run with NATIVE_STORE_ROOT=data-ui");
test.skip(statusRecord === undefined, "window:StatusWnd not converted in the data-ui lane store");

async function openStatusWindow(page: Page): Promise<void> {
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.goto(harnessUrl);
  await expect(page.locator("#native-window-harness")).toHaveAttribute("data-status", /^(opened|not-in-catalog|failed)$/, { timeout: 30_000 });
  expect(await page.evaluate(() => window.__nativeWindowHarness?.result.reason ?? null)).toBeNull();
  expect(pageErrors).toEqual([]);
  await expect(page.locator(`[data-native-window="${statusWindowId}"]`)).toBeVisible();
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
  const root = decodedStatusRoot(statusRecord!);
  const bindings = statusBindings();
  const boundGauge = bindings.find(binding => binding.worldField === "health")!;
  const absentReasons = bindings.flatMap(binding => binding.gapReason === null ? [] : [binding.gapReason]);
  const context = await browser.newContext(contextOptions);
  try {
    const page = await context.newPage();
    await openStatusWindow(page);
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
    writeLoadCheckRecord(laneName, await hashServedLaneCatalog(baseUrl), {
      key: `window:${statusWindowId}`, status: failures.length === 0 ? "pass" : "failed", reason: failures.length === 0 ? null : failures.join("; "),
      atRiga: formatRigaTimestamp(new Date()), assetManifestSchemaVersion: 2,
    });
  });

  test("opens StatusWnd from its decoded manifest with HP bound to the adapter local player at 1440 x 900", async ({ browser }) => {
    await withRecordedFailure(() => checkStatusWindowAt(browser, { viewport: desktopViewport }, "statuswnd-1440x900.png"));
  });

  test("opens StatusWnd at 932 x 430 on a landscape touch phone", async ({ browser }) => {
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
