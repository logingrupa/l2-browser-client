import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { formatRigaTimestamp } from "../../scripts/check-machine-schedule.mjs";
import { desktopViewport, expectNoHorizontalScrollOnPortraitPhone, landscapePhone } from "./browserViewports";
import { servedLaneCatalogSha256, writeLoadCheckRecord } from "./support/loadCheckRecordFile";

interface TileCatalogRecord { readonly id: string; readonly manifest: string; readonly manifestSha256: string }
interface TileResource { readonly kind: string; readonly manifest: string }
interface ServedTileMover { readonly id: string; readonly closedMatrix: readonly number[] }

const laneName = "world";
const tileId = "20_20";
const tileKey = `tile:${tileId}`;
const laneFolder = resolve("artifacts/lane-store", laneName);
const laneStoreFile = (manifest: string) => resolve(laneFolder, "l2", manifest.replace(/^\/l2\//, ""));
const readJson = <Value>(path: string): Value => JSON.parse(readFileSync(path, "utf8")) as Value;
const laneCatalogPath = resolve(laneFolder, "l2/catalog.json");
const laneCatalog: { tiles?: TileCatalogRecord[] } | null = existsSync(laneCatalogPath) ? readJson(laneCatalogPath) : null;
const tileRecord = laneCatalog?.tiles?.find(record => record.id === tileId) ?? null;
const moverResource = tileRecord ? readJson<{ resources: readonly TileResource[] }>(laneStoreFile(tileRecord.manifest)).resources.find(resource => resource.kind === "movers") ?? null : null;
const tileLoadTimeout = 300_000;
const matrixTolerance = 1e-4;
const terminalColourCodes = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

function servedMovers(): readonly ServedTileMover[] {
  return readJson<{ movers: readonly ServedTileMover[] }>(laneStoreFile(moverResource!.manifest)).movers;
}

test.skip(process.env.NATIVE_STORE_ROOT !== laneName, "run with NATIVE_STORE_ROOT=world");
test.skip(moverResource === null,
  "the world lane catalog has no tile 20_20 with a movers resource; run convert_tile.py --map 20_20 --step movers, then --step manifest");

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
    firstFailureReason ??= message || `tile mover check ${testInfo.status}`;
  }
  writeLoadCheckRecord(laneName, laneCatalogSha256, {
    key: tileKey, status: firstFailureReason === null ? "pass" : "failed", reason: firstFailureReason,
    atRiga: formatRigaTimestamp(new Date()), assetManifestSchemaVersion: null,
  });
});

const worldSnapshot = (page: Page) => page.evaluate(() => window.__nativeSlice!.snapshot().world);

async function openTileWithClosedMovers(page: Page, screenshotName: string) {
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
  await expect.poll(async () => (await worldSnapshot(page))?.texturesReady, { timeout: tileLoadTimeout }).toBe(true);
  const world = await worldSnapshot(page);
  if (!world) throw new Error(`the native route loaded no world section for ${tileKey}`);
  expect(world.manifestSha256).toBe(tileRecord!.manifestSha256);
  const served = servedMovers();
  expect(world.moverCount).toBe(served.length);
  expect(world.moverCollisionMeshCount).toBe(0);
  const rendered = new Map((world.movers ?? []).map(mover => [mover.id, mover]));
  expect([...rendered.keys()].sort()).toEqual(served.map(mover => mover.id).sort());
  for (const mover of served) {
    const inspection = rendered.get(mover.id)!;
    expect(inspection.state).toBe("closed");
    inspection.matrix.forEach((value, index) => expect(Math.abs(value - mover.closedMatrix[index]!)).toBeLessThan(matrixTolerance));
  }
  await page.screenshot({ path: `test-results/${screenshotName}` });
  expect(pageErrors).toEqual([]);
}

test.describe("desktop", () => {
  test.use({ viewport: desktopViewport });
  test("places the converted movers of tile 20_20 closed at 1440 x 900", async ({ page }) => {
    test.setTimeout(2 * tileLoadTimeout + 60_000);
    await openTileWithClosedMovers(page, "world-tile-movers-20_20-desktop.png");
  });
});

test.describe("phone", () => {
  test.use(landscapePhone);
  test("places the movers of tile 20_20 closed at 932 x 430 landscape with touch and has no horizontal scroll in portrait", async ({ page, hasTouch, isMobile }) => {
    test.setTimeout(2 * tileLoadTimeout + 60_000);
    expect({ hasTouch, isMobile }).toEqual({ hasTouch: true, isMobile: true });
    await openTileWithClosedMovers(page, "world-tile-movers-20_20-phone-landscape.png");
    await expectNoHorizontalScrollOnPortraitPhone(page);
  });
});
