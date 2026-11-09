import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { formatRigaTimestamp } from "../../scripts/check-machine-schedule.mjs";
import { desktopViewport, landscapePhone } from "./browserViewports";
import { servedLaneCatalogSha256, writeLoadCheckRecord } from "./support/loadCheckRecordFile";

interface TileCatalogRecord { readonly id: string; readonly manifest: string; readonly manifestSha256: string; readonly manifestBytes: number }

const laneName = "world";
const tileId = "20_21";
const tileKey = `tile:${tileId}`;
const laneCatalogPath = resolve("artifacts/lane-store", laneName, "l2/catalog.json");
const laneCatalog: { tiles?: TileCatalogRecord[] } | null = existsSync(laneCatalogPath) ? JSON.parse(readFileSync(laneCatalogPath, "utf8")) : null;
const tileRecord = laneCatalog?.tiles?.find(record => record.id === tileId) ?? null;
const tileLoadTimeout = 180_000;
const walkTimeout = 90_000;
const walkDistanceMetres = 4;
const minimumWalkedMetres = 1;
const portraitPhoneViewport = { width: 430, height: 932 };
const terminalColourCodes = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

test.skip(process.env.NATIVE_STORE_ROOT !== laneName, "run with NATIVE_STORE_ROOT=world");
test.skip(tileRecord === null, "the world lane catalog has no tiles record 20_21; run convert_tile.py --map 20_21 --step manifest first");

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
    firstFailureReason ??= message || `walk ${testInfo.status}`;
  }
  writeLoadCheckRecord(laneName, laneCatalogSha256, {
    key: tileKey, status: firstFailureReason === null ? "pass" : "failed", reason: firstFailureReason,
    atRiga: formatRigaTimestamp(new Date()), assetManifestSchemaVersion: null,
  });
});

const localPlayer = (page: Page) => page.evaluate(() => window.__nativeSlice!.snapshot().entities.find(entity => entity.id === "local-player")!);
const worldSnapshot = (page: Page) => page.evaluate(() => window.__nativeSlice!.snapshot().world);

async function openTile(page: Page, pageErrors: string[]) {
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
  const world = await worldSnapshot(page);
  if (!world) throw new Error(`the native route loaded no world section for ${tileKey}`);
  expect(world.manifestSha256).toBe(tileRecord!.manifestSha256);
  expect(world.terrainTriangles).toBeGreaterThan(0);
  expect(world).toMatchObject({ modelCount: 0, placementCount: 0, bspMeshes: 0, collisionVerified: false });
  expect(world.sectionWindow).toEqual({ basis: "terrain-info-chunk-plan", status: "source-derived" });
  await expect(page.locator(".world-location h1")).toHaveText(`${tileId} · native world tile`);
  return world;
}

async function walkAlongX(page: Page) {
  const start = await localPlayer(page);
  expect(start.modelId).not.toBeNull();
  expect(start.missingAssetDiagnostic).toBeNull();
  const origin = start.authoritativePosition;
  await page.evaluate(position => window.__nativeSlice!.dispatch({ type: "move-local", position }),
    { x: origin.x + walkDistanceMetres, y: origin.y, z: origin.z });
  const walkedMetres = async () => {
    const player = await localPlayer(page);
    const distance = Math.hypot(player.authoritativePosition.x - origin.x, player.authoritativePosition.z - origin.z);
    return player.animation === "idle" ? distance : 0;
  };
  await expect.poll(walkedMetres, { timeout: walkTimeout }).toBeGreaterThan(minimumWalkedMetres);
  const end = await localPlayer(page);
  expect(end.modelId).not.toBeNull();
  expect(end.missingAssetDiagnostic).toBeNull();
  return end.authoritativePosition;
}

async function walkTheTile(page: Page, screenshotName: string) {
  const pageErrors: string[] = [];
  const world = await openTile(page, pageErrors);
  const end = await walkAlongX(page);
  expect(end.y).toBeGreaterThanOrEqual(world.terrainBounds!.minimum[1]!);
  expect(end.y).toBeLessThanOrEqual(world.terrainBounds!.maximum[1]!);
  await page.screenshot({ path: `test-results/${screenshotName}` });
  expect(pageErrors).toEqual([]);
}

test.describe("desktop", () => {
  test.use({ viewport: desktopViewport });
  test("walks tile 20_21 from the world lane store on terrain collision at 1440 x 900", async ({ page }) => {
    test.setTimeout(tileLoadTimeout + walkTimeout + 60_000);
    await walkTheTile(page, "world-tile-walk-20_21-desktop.png");
  });
});

test.describe("phone", () => {
  test.use(landscapePhone);
  test("walks tile 20_21 at 932 x 430 landscape with touch and has no horizontal scroll in portrait", async ({ page }) => {
    test.setTimeout(tileLoadTimeout + walkTimeout + 60_000);
    await walkTheTile(page, "world-tile-walk-20_21-phone-landscape.png");
    await page.setViewportSize(portraitPhoneViewport);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
});
