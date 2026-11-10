import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { formatRigaTimestamp } from "../../scripts/check-machine-schedule.mjs";
import { desktopViewport, expectNoHorizontalScrollOnPortraitPhone, landscapePhone } from "./browserViewports";
import { servedLaneCatalogSha256, writeLoadCheckRecord } from "./support/loadCheckRecordFile";

interface TileCatalogRecord { readonly id: string; readonly manifest: string; readonly manifestSha256: string }
interface TileResource { readonly kind: string; readonly manifest: string; readonly manifestSha256: string }
interface SkyBundleManifest { readonly id: string; readonly counts: { readonly materialRoots: number } }

const laneName = "world";
const tileId = "20_21";
const tileKey = `tile:${tileId}`;
const laneFolder = resolve("artifacts/lane-store", laneName);
const laneStoreFile = (manifest: string) => resolve(laneFolder, "l2", manifest.replace(/^\/l2\//, ""));
const readJson = <Value>(path: string): Value => JSON.parse(readFileSync(path, "utf8")) as Value;
const laneCatalogPath = resolve(laneFolder, "l2/catalog.json");
const laneCatalog: { tiles?: TileCatalogRecord[] } | null = existsSync(laneCatalogPath) ? readJson(laneCatalogPath) : null;
const tileRecord = laneCatalog?.tiles?.find(record => record.id === tileId) ?? null;
const skyResource = tileRecord ? readJson<{ resources: readonly TileResource[] }>(laneStoreFile(tileRecord.manifest)).resources.find(resource => resource.kind === "sky") ?? null : null;
const tileLoadTimeout = 300_000;
const terminalColourCodes = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

test.skip(process.env.NATIVE_STORE_ROOT !== laneName, "run with NATIVE_STORE_ROOT=world");
test.skip(skyResource === null, "the world lane catalog has no tile 20_21 with a sky resource; run convert_tile.py --map 20_21 --step sky, then --step manifest");

let laneCatalogSha256: string | null = null;
let firstFailureReason: string | null = null;

test.beforeEach(async ({ baseURL }) => {
  if (baseURL === undefined) throw new Error("the Playwright project has no baseURL");
  laneCatalogSha256 = await servedLaneCatalogSha256(baseURL);
});

test.afterEach(async ({}, testInfo: TestInfo) => {
  if (testInfo.status === "skipped" || laneCatalogSha256 === null) return;
  if (testInfo.status !== "passed") {
    const message = (testInfo.errors[0]?.message ?? "").replace(terminalColourCodes, "").split("\n")[0]!.trim();
    firstFailureReason ??= message || `tile sky check ${testInfo.status}`;
  }
  writeLoadCheckRecord(laneName, laneCatalogSha256, {
    key: tileKey, status: firstFailureReason === null ? "pass" : "failed", reason: firstFailureReason,
    atRiga: formatRigaTimestamp(new Date()), assetManifestSchemaVersion: null,
  });
});

const skySnapshot = (page: Page) => page.evaluate(() => {
  const snapshot = window.__nativeSlice!.snapshot();
  return { sky: snapshot.nativeSky ?? null, failure: snapshot.skyFailure ?? null };
});

async function openTileSky(page: Page, screenshotName: string) {
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.goto(`/?map=${tileId}`);
  const startup = () => page.evaluate(() => {
    const loading = document.querySelector<HTMLElement>("#loading");
    if (!loading) return window.__nativeSlice ? "ready" : "loading";
    return loading.dataset.state === "error" ? `error: ${(loading.textContent ?? "").replace(/\s+/g, " ").trim()}` : "loading";
  });
  await expect.poll(startup, { timeout: tileLoadTimeout, intervals: [1_000] }).toMatch(/^(ready|error)/);
  const state = await startup();
  if (state !== "ready") throw new Error(`${tileKey} did not start on the native route: ${state}`);
  await expect.poll(async () => {
    const { sky, failure } = await skySnapshot(page);
    return failure ?? (sky?.texturesReady === true ? "ready" : "loading");
  }, { timeout: tileLoadTimeout, intervals: [1_000] }).not.toBe("loading");
  const bundle = readJson<SkyBundleManifest>(laneStoreFile(skyResource!.manifest));
  const { sky, failure } = await skySnapshot(page);
  expect(failure).toBeNull();
  expect(sky).toMatchObject({ status: "source-snapshot", authored: false, tileId, sourceId: bundle.id, manifestSha256: skyResource!.manifestSha256,
    meshes: bundle.counts.materialRoots, tileSkyGap: null });
  await page.screenshot({ path: `test-results/${screenshotName}` });
  expect(pageErrors).toEqual([]);
}

test.describe("desktop", () => {
  test.use({ viewport: desktopViewport });
  test("presents the converted sky of tile 20_21 at 1440 x 900", async ({ page }) => {
    test.setTimeout(2 * tileLoadTimeout + 60_000);
    await openTileSky(page, "world-tile-sky-20_21-desktop.png");
  });
});

test.describe("phone", () => {
  test.use(landscapePhone);
  test("presents the sky of tile 20_21 at 932 x 430 landscape with touch and has no horizontal scroll in portrait", async ({ page, hasTouch, isMobile }) => {
    test.setTimeout(2 * tileLoadTimeout + 60_000);
    expect({ hasTouch, isMobile }).toEqual({ hasTouch: true, isMobile: true });
    await openTileSky(page, "world-tile-sky-20_21-phone-landscape.png");
    await expectNoHorizontalScrollOnPortraitPhone(page);
  });
});
