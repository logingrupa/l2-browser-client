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
interface LightingSection {
  readonly lighting: string;
  readonly outdoor: boolean | null;
  readonly page: number | null;
  readonly hourPages: readonly number[];
  readonly status: string;
  readonly reasons: readonly string[];
}
interface LightingInspection {
  readonly gap: string | null;
  readonly environment?: { readonly hour: number; readonly environmentType: number; readonly source: string };
  readonly sectionCount?: number;
  readonly lightmappedSectionCount?: number;
  readonly statusCounts?: Record<string, number>;
  readonly sections?: readonly LightingSection[];
}

const laneName = "world";
const tileId = "20_21";
const hoursPerDay = 24;
const laneFolder = resolve("artifacts/lane-store", laneName);
const laneStoreFile = (manifest: string) => resolve(laneFolder, "l2", manifest.replace(/^\/l2\//, ""));
const readJson = <Value>(path: string): Value => JSON.parse(readFileSync(path, "utf8")) as Value;
const laneCatalogPath = resolve(laneFolder, "l2/catalog.json");
const laneCatalog: { tiles?: TileCatalogRecord[] } | null = existsSync(laneCatalogPath) ? readJson(laneCatalogPath) : null;
const tileRecord = laneCatalog?.tiles?.find(record => record.id === tileId) ?? null;
const tileManifest = tileRecord ? readJson<TileManifest>(laneStoreFile(tileRecord.manifest)) : null;
const lightingResource = tileManifest?.resources.find(resource => resource.kind === "lighting") ?? null;
const tileLoadTimeout = 300_000;

function servedBspSectionCount(): number {
  return tileManifest!.chunks.map(chunk => readJson<ChunkManifest>(laneStoreFile(chunk.manifest))).reduce((sum, chunk) => {
    if (!chunk.bsp) return sum;
    const glb = readFileSync(laneStoreFile(chunk.bsp.resource));
    const document = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString("utf8")) as { extras: { nativeBspSections: unknown[] } };
    return sum + document.extras.nativeBspSections.length;
  }, 0);
}

function slotAtHour(hour: number, slotCount: number, outdoor: boolean): number {
  return outdoor ? Math.trunc(Math.fround(Math.fround(Math.fround(hour) * slotCount) / hoursPerDay)) % slotCount : 0;
}

test.skip(process.env.NATIVE_STORE_ROOT !== laneName, "run with NATIVE_STORE_ROOT=world");
test.skip(lightingResource === null, "the world lane store has no tile 20_21 with a lighting resource; run convert_tile.py --map 20_21 --step lighting, then --step manifest");

const lightingInspection = (page: Page) => page.evaluate(() => (window.__nativeSlice?.snapshot().world?.lighting ?? null) as unknown);

async function openTileAndReadLighting(page: Page, screenshotName: string) {
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.goto(`/?map=${tileId}`);
  await expect.poll(async () => (await lightingInspection(page)) !== null, { timeout: tileLoadTimeout, intervals: [1_000] }).toBe(true);
  const inspection = await lightingInspection(page) as LightingInspection;
  if (inspection.gap !== null) throw new Error(`tile ${tileId} has no bound lighting: ${inspection.gap}`);
  const sections = inspection.sections!, hour = inspection.environment!.hour;
  expect(inspection.environment).toMatchObject({ environmentType: 0, source: "environment-program-fallback" });
  expect(hour).toBeGreaterThanOrEqual(12);
  expect(inspection.sectionCount).toBe(servedBspSectionCount());
  expect(Object.values(inspection.statusCounts!).reduce((sum, count) => sum + count, 0)).toBe(sections.length);
  const lightmapped = sections.filter(section => section.lighting === "lightmapped");
  expect(lightmapped.length).toBe(inspection.lightmappedSectionCount);
  for (const section of lightmapped) {
    expect(section.page).toBe(section.hourPages[slotAtHour(hour, section.hourPages.length, section.outdoor!)]);
  }
  const hourSetSection = lightmapped.find(section => section.outdoor && section.hourPages.length > 1);
  expect(hourSetSection, "an outdoor section of tile 20_21 has a lightmap hour set").toBeDefined();
  const laterHour = (hour + hoursPerDay / hourSetSection!.hourPages.length) % hoursPerDay;
  expect(hourSetSection!.hourPages[slotAtHour(laterHour, hourSetSection!.hourPages.length, true)]).not.toBe(hourSetSection!.page);
  await page.screenshot({ path: `test-results/${screenshotName}` });
  expect(pageErrors).toEqual([]);
  return inspection;
}

test.describe("desktop", () => {
  test.use({ viewport: desktopViewport });
  test("binds the tile 20_21 lightmap pages by hour from the environment program fallback at 1440 x 900", async ({ page }) => {
    test.setTimeout(tileLoadTimeout + 60_000);
    const inspection = await openTileAndReadLighting(page, "world-tile-lighting-20_21-desktop.png");
    test.info().annotations.push({ type: "lighting-status-counts", description: JSON.stringify(inspection.statusCounts) });
  });
});

test.describe("phone", () => {
  test.use(landscapePhone);
  test("binds the tile 20_21 lightmap pages at 932 x 430 landscape with touch and has no horizontal scroll in portrait", async ({ page, hasTouch, isMobile }) => {
    test.setTimeout(tileLoadTimeout + 60_000);
    expect({ hasTouch, isMobile }).toEqual({ hasTouch: true, isMobile: true });
    await openTileAndReadLighting(page, "world-tile-lighting-20_21-phone-landscape.png");
    await expectNoHorizontalScrollOnPortraitPhone(page);
  });
});
