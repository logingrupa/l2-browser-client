import { expect, test, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { desktopViewport, expectNoHorizontalScrollOnPortraitPhone, landscapePhone } from "./browserViewports";

interface PinnedManifestRecord { readonly manifest: string; readonly manifestSha256: string }
interface TileCatalogRecord extends PinnedManifestRecord { readonly id: string }
interface TileManifest {
  readonly chunks: readonly PinnedManifestRecord[];
  readonly resources: readonly { readonly kind: string; readonly manifest: string }[];
}
interface ChunkManifest { readonly bsp: { readonly resource: string } | null }
interface ServedBspSection { readonly translucent: boolean }

const laneName = "world";
const tileId = "20_21";
const laneFolder = resolve("artifacts/lane-store", laneName);
const laneStoreFile = (manifest: string) => resolve(laneFolder, "l2", manifest.replace(/^\/l2\//, ""));
const readJson = <Value>(path: string): Value => JSON.parse(readFileSync(path, "utf8")) as Value;
const laneCatalogPath = resolve(laneFolder, "l2/catalog.json");
const laneCatalog: { tiles?: TileCatalogRecord[] } | null = existsSync(laneCatalogPath) ? readJson(laneCatalogPath) : null;
const tileRecord = laneCatalog?.tiles?.find(record => record.id === tileId) ?? null;
const tileManifest = tileRecord ? readJson<TileManifest>(laneStoreFile(tileRecord.manifest)) : null;
const visibilityResource = tileManifest?.resources.find(resource => resource.kind === "bsp-visibility") ?? null;
const tileLoadTimeout = 300_000;

function servedBspSections(): readonly ServedBspSection[] {
  return tileManifest!.chunks.map(chunk => readJson<ChunkManifest>(laneStoreFile(chunk.manifest))).flatMap(chunk => {
    if (!chunk.bsp) return [];
    const glb = readFileSync(laneStoreFile(chunk.bsp.resource));
    const document = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString("utf8")) as { extras: { nativeBspSections: ServedBspSection[] } };
    return document.extras.nativeBspSections;
  });
}

test.skip(process.env.NATIVE_STORE_ROOT !== laneName, "run with NATIVE_STORE_ROOT=world");
test.skip(visibilityResource === null,
  "the world lane store has no tile 20_21 with a bsp-visibility resource; run convert_tile.py --map 20_21 --step bsp-visibility, then --step manifest");

const visibilityInspection = (page: Page) => page.evaluate(() => window.__nativeSlice?.snapshot().world?.bspVisibility ?? null);

async function openTileAndReadVisibility(page: Page, screenshotName: string) {
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.goto(`/?map=${tileId}`);
  await expect.poll(async () => (await visibilityInspection(page))?.cameraZone ?? -1, { timeout: tileLoadTimeout, intervals: [1_000] })
    .toBeGreaterThanOrEqual(0);
  const inspection = await visibilityInspection(page);
  if (inspection === null || inspection.gap !== null) throw new Error(`tile ${tileId} has no bound BSP visibility: ${inspection?.gap ?? "no inspection"}`);
  const sections = servedBspSections();
  expect(inspection).toMatchObject({ tileId, culling: false, sectionCount: sections.length, visibleSectionCount: sections.length,
    translucentSectionCount: sections.filter(section => section.translucent).length, translucentOrderErrors: [] });
  expect(inspection.cameraZone).toBeLessThan(inspection.zoneCount);
  expect(inspection.visibleZoneCount).toBe(inspection.zoneCount);
  expect(inspection.computedFrameCount).toBeGreaterThan(0);
  await page.screenshot({ path: `test-results/${screenshotName}` });
  expect(pageErrors).toEqual([]);
}

test.describe("desktop", () => {
  test.use({ viewport: desktopViewport });
  test("reports the camera zone of tile 20_21 with culling off at 1440 x 900", async ({ page }) => {
    test.setTimeout(tileLoadTimeout + 60_000);
    await openTileAndReadVisibility(page, "world-bsp-visibility-20_21-desktop.png");
  });
});

test.describe("phone", () => {
  test.use(landscapePhone);
  test("reports the camera zone of tile 20_21 at 932 x 430 landscape with touch and has no horizontal scroll in portrait", async ({ page, hasTouch, isMobile }) => {
    test.setTimeout(tileLoadTimeout + 60_000);
    expect({ hasTouch, isMobile }).toEqual({ hasTouch: true, isMobile: true });
    await openTileAndReadVisibility(page, "world-bsp-visibility-20_21-phone-landscape.png");
    await expectNoHorizontalScrollOnPortraitPhone(page);
  });
});
