import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { formatRigaTimestamp } from "../../scripts/check-machine-schedule.mjs";
import { desktopViewport, expectNoHorizontalScrollOnPortraitPhone, landscapePhone } from "./browserViewports";
import { servedLaneCatalogSha256, writeLoadCheckRecord } from "./support/loadCheckRecordFile";

interface PinnedManifestRecord { readonly manifest: string; readonly manifestSha256: string }
interface TileCatalogRecord extends PinnedManifestRecord { readonly id: string }
interface ChunkModelPlacement { readonly id: string }
interface ChunkManifest { readonly models: readonly { readonly placements: readonly ChunkModelPlacement[] }[] }
interface StaticMeshGapRow { readonly sourceIdentity: { readonly object?: string } }

const laneName = "world";
const tileId = "20_21";
const tileKey = `tile:${tileId}`;
const laneFolder = resolve("artifacts/lane-store", laneName);
const laneStoreFile = (manifest: string) => resolve(laneFolder, "l2", manifest.replace(/^\/l2\//, ""));
const readJson = <Value>(path: string): Value => JSON.parse(readFileSync(path, "utf8")) as Value;
const laneCatalogPath = resolve(laneFolder, "l2/catalog.json");
const laneCatalog: { tiles?: TileCatalogRecord[] } | null = existsSync(laneCatalogPath) ? readJson(laneCatalogPath) : null;
const tileRecord = laneCatalog?.tiles?.find(record => record.id === tileId) ?? null;
const staticMeshReceiptPath = resolve(laneFolder, `work/tile__${tileId}/meshes/receipt.json`);
const tileLoadTimeout = 300_000;
const terminalColourCodes = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

function servedPlacementIds(): ReadonlySet<string> {
  const tile = readJson<{ chunks: readonly PinnedManifestRecord[] }>(laneStoreFile(tileRecord!.manifest));
  return new Set(tile.chunks.flatMap(chunk => readJson<ChunkManifest>(laneStoreFile(chunk.manifest)).models
    .flatMap(model => model.placements.map(placement => placement.id))));
}

function gappedPlacementIds(): ReadonlySet<string> {
  const receipt = readJson<{ gapRows: readonly StaticMeshGapRow[] }>(staticMeshReceiptPath);
  return new Set(receipt.gapRows.flatMap(row => row.sourceIdentity.object ? [`interlude:${row.sourceIdentity.object}`] : []));
}

test.skip(process.env.NATIVE_STORE_ROOT !== laneName, "run with NATIVE_STORE_ROOT=world");
test.skip(tileRecord === null || !existsSync(staticMeshReceiptPath),
  "the world lane store has no tile 20_21 with sealed static meshes; run convert_tile.py --map 20_21 --step meshes, then --step manifest");

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
    firstFailureReason ??= message || `static mesh check ${testInfo.status}`;
  }
  writeLoadCheckRecord(laneName, laneCatalogSha256, {
    key: tileKey, status: firstFailureReason === null ? "pass" : "failed", reason: firstFailureReason,
    atRiga: formatRigaTimestamp(new Date()), assetManifestSchemaVersion: null,
  });
});

const worldSnapshot = (page: Page) => page.evaluate(() => window.__nativeSlice!.snapshot().world);

async function openTileWithStaticMeshes(page: Page, screenshotName: string) {
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
  const served = servedPlacementIds(), gapped = gappedPlacementIds();
  const rendered = world.placements.map(placement => placement.id);
  expect(world.placementCount).toBeGreaterThan(0);
  expect(new Set(rendered)).toEqual(served);
  expect(rendered.filter(id => gapped.has(id))).toEqual([]);
  expect(world.modelCount).toBeGreaterThan(0);
  expect(world.textureCount).toBeGreaterThan(0);
  expect(world.finiteBounds).toBe(true);
  expect(world).toMatchObject({ bspMeshes: 0, collisionVerified: false, visualParity: "unverified" });
  await page.screenshot({ path: `test-results/${screenshotName}` });
  expect(pageErrors).toEqual([]);
}

test.describe("desktop", () => {
  test.use({ viewport: desktopViewport });
  test("renders the converted static placements of tile 20_21 at 1440 x 900", async ({ page }) => {
    test.setTimeout(2 * tileLoadTimeout + 60_000);
    await openTileWithStaticMeshes(page, "world-tile-meshes-20_21-desktop.png");
  });
});

test.describe("phone", () => {
  test.use(landscapePhone);
  test("renders the static placements of tile 20_21 at 932 x 430 landscape with touch and has no horizontal scroll in portrait", async ({ page, hasTouch, isMobile }) => {
    test.setTimeout(2 * tileLoadTimeout + 60_000);
    expect({ hasTouch, isMobile }).toEqual({ hasTouch: true, isMobile: true });
    await openTileWithStaticMeshes(page, "world-tile-meshes-20_21-phone-landscape.png");
    await expectNoHorizontalScrollOnPortraitPhone(page);
  });
});
