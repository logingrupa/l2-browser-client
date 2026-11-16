import { expect, test, type Page } from "@playwright/test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { bspLightmapSlot } from "../../src/environment/model/bspLightmapSelection";
import { fixtureNumber, fixtureNumbers, readHourlyLightingFixtures, type HourlyLightingFixtureRow } from "../support/hourlyLightingFixtures";
import { desktopViewport, expectNoHorizontalScrollOnPortraitPhone, landscapePhone } from "./browserViewports";
import { environmentTimeTablesRequirement, environmentTimeTablesStaged } from "./stagedEnvironmentTimeTables";

interface PinnedManifestRecord { readonly manifest: string; readonly manifestSha256: string }
interface TileCatalogRecord extends PinnedManifestRecord { readonly id: string }
interface TileManifest {
  readonly chunks: readonly PinnedManifestRecord[];
  readonly resources: readonly { readonly kind: string; readonly manifest: string }[];
}
interface ChunkManifest { readonly bsp: { readonly resource: string } | null }
interface LightingSection {
  readonly lighting: string;
  readonly sunAffect: boolean | null;
  readonly page: number | null;
  readonly hourPages: readonly number[];
  readonly status: string;
  readonly reasons: readonly string[];
}
interface LightingInspection {
  readonly gap: string | null;
  readonly environment?: { readonly hour: number; readonly hourSource: string; readonly targetType: number };
  readonly sectionCount?: number;
  readonly lightmappedSectionCount?: number;
  readonly statusCounts?: Record<string, number>;
  readonly sections?: readonly LightingSection[];
  readonly textureSlots?: readonly { readonly texture: number; readonly childCount: number; readonly sunAffectedSlot: number | null }[];
  readonly hourly?: HourlyLightingReading;
  readonly cameraEnvironment?: { readonly cameraZone: number; readonly fog: { readonly enabled: boolean; readonly source: string; readonly fogEnd: number | null };
    readonly gaps: readonly string[] };
}
interface AmbientReading { readonly status: string; readonly value?: readonly number[] }
interface HourlyLightingReading {
  readonly terms: { readonly hour: number; readonly staticMesh: { readonly ambient: AmbientReading }; readonly actor: { readonly ambient: AmbientReading } };
  readonly terrain: { readonly gap: string | null; readonly lastRebuildHour: number | null; readonly heldReason: string | null;
    readonly probe: { readonly intensity: number; readonly bgra: readonly number[] } | null };
  readonly staticMeshVisibility: { readonly gap: string | null; readonly placements: readonly { readonly sourceActor: string; readonly vertexZeroVisibility: number }[] };
}
interface WorldInspection {
  readonly lighting: LightingInspection | null;
  readonly bspVisibility: { readonly cameraZone: number } | null;
  readonly mapEmitterPlacements: { readonly gap: string | null; readonly placements: readonly { readonly memberVisible: boolean; readonly playing: boolean;
    readonly reasons: readonly string[] }[] } | null;
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
const fixtureHours = [0, 6, 12, 18];
const minutesPerHour = 60;
const staticMeshVisibilityProbeActor = "20_21.StaticMeshActor1905";
const lightingArrayNames = lightingResource ? readJson<{ arrays: readonly { readonly name: string }[] }>(laneStoreFile(lightingResource.manifest)).arrays
  .map(array => array.name) : [];
const hourlyInputsStaged = ["LMSC.sunAffect", "LMPG.compressedRevision", "TINT.time", "SMEN.bits"].every(name => lightingArrayNames.includes(name));

function servedBspSectionCount(): number {
  return tileManifest!.chunks.map(chunk => readJson<ChunkManifest>(laneStoreFile(chunk.manifest))).reduce((sum, chunk) => {
    if (!chunk.bsp) return sum;
    const glb = readFileSync(laneStoreFile(chunk.bsp.resource));
    const document = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString("utf8")) as { extras: { nativeBspSections: unknown[] } };
    return sum + document.extras.nativeBspSections.length;
  }, 0);
}

test.skip(process.env.NATIVE_STORE_ROOT !== laneName, "run with NATIVE_STORE_ROOT=world");
test.skip(!environmentTimeTablesStaged(laneName), environmentTimeTablesRequirement);
test.skip(lightingResource === null, "the world lane store has no tile 20_21 with a lighting resource; run convert_tile.py --map 20_21 --step lighting, then --step manifest");
test.skip(!hourlyInputsStaged, "the tile 20_21 lighting resource predates the DB-7 converter; restage --step bsp, --step lighting, --step terrain, --step meshes and --step manifest");

const worldInspection = (page: Page) => page.evaluate(() => {
  const world = window.__nativeSlice?.snapshot().world;
  return (world ? { lighting: world.lighting ?? null, bspVisibility: world.bspVisibility ?? null, mapEmitterPlacements: world.mapEmitterPlacements ?? null } : null) as unknown;
});

async function openTileAndReadLighting(page: Page, screenshotName: string) {
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.goto(`/?map=${tileId}`);
  await expect.poll(async () => ((await worldInspection(page)) as WorldInspection | null)?.bspVisibility?.cameraZone ?? -1,
    { timeout: tileLoadTimeout, intervals: [1_000] }).toBeGreaterThanOrEqual(0);
  const world = await worldInspection(page) as WorldInspection, inspection = world.lighting!;
  if (inspection.gap !== null) throw new Error(`tile ${tileId} has no bound lighting: ${inspection.gap}`);
  expect(inspection.cameraEnvironment!.cameraZone).toBe(world.bspVisibility!.cameraZone);
  expect(inspection.cameraEnvironment!.fog.fogEnd === null).toBe(!inspection.cameraEnvironment!.fog.enabled);
  expect(world.mapEmitterPlacements!.gap).toBeNull();
  expect(world.mapEmitterPlacements!.placements.length).toBeGreaterThan(0);
  for (const placement of world.mapEmitterPlacements!.placements) {
    expect(placement).toMatchObject({ memberVisible: true, playing: false });
    expect(placement.reasons).toContain("map-emitter-class-defaults-unmerged");
  }
  const sections = inspection.sections!, hour = inspection.environment!.hour;
  expect(inspection.environment).toMatchObject({ targetType: 0, hourSource: "start-time" });
  expect(hour).toBeGreaterThanOrEqual(12);
  expect(inspection.sectionCount).toBe(servedBspSectionCount());
  expect(Object.values(inspection.statusCounts!).reduce((sum, count) => sum + count, 0)).toBe(sections.length);
  expect(inspection.statusCounts!["library-compiled"], "a 20_21 BSP section draws through the UE2 material library").toBeGreaterThan(0);
  const lightmapped = sections.filter(section => section.lighting === "lightmapped");
  expect(lightmapped.length).toBe(inspection.lightmappedSectionCount);
  for (const section of lightmapped) {
    expect(section.page).toBe(section.hourPages[bspLightmapSlot(hour, section.hourPages.length, section.sunAffect!)]);
  }
  const hourSetSection = lightmapped.find(section => section.sunAffect && section.hourPages.length > 1);
  expect(hourSetSection, "a sun-affected section of tile 20_21 has a lightmap hour set").toBeDefined();
  const laterHour = (hour + hoursPerDay / hourSetSection!.hourPages.length) % hoursPerDay;
  expect(hourSetSection!.hourPages[bspLightmapSlot(laterHour, hourSetSection!.hourPages.length, true)]).not.toBe(hourSetSection!.page);
  await page.screenshot({ path: `test-results/${screenshotName}` });
  expect(pageErrors).toEqual([]);
  return { ...inspection, sections: undefined, mapEmitterPlacements: world.mapEmitterPlacements };
}

function fixtureRowAt(hour: number, predicate: (row: HourlyLightingFixtureRow) => boolean): HourlyLightingFixtureRow {
  const row = readHourlyLightingFixtures().fixtures.find(candidate => candidate.hour === hour && predicate(candidate));
  if (row === undefined) throw new Error(`No DB-7 fixture row at hour ${hour}.`);
  return row;
}

const fixtureAmbient = (row: HourlyLightingFixtureRow) => [...fixtureNumbers(row.output, "ambientRGB"), fixtureNumber(row.output, "alpha")];

async function sendServerTimeAndReadLighting(page: Page, hour: number): Promise<LightingInspection> {
  return page.evaluate(async gameMinutes => {
    const slice = window.__nativeSlice!;
    slice.dispatch({ type: "set-server-time", gameMinutes });
    for (let frame = 0; frame < 3; frame += 1) await new Promise(resolveFrame => requestAnimationFrame(resolveFrame));
    const lighting = slice.snapshot().world?.lighting as Record<string, unknown> | undefined;
    return { ...lighting, sections: undefined } as unknown;
  }, hour * minutesPerHour) as Promise<LightingInspection>;
}

async function readHourlyLightingInputs(page: Page) {
  const readings = [];
  const { atlasChildCounts } = readHourlyLightingFixtures().context;
  for (const hour of fixtureHours) {
    const inspection = await sendServerTimeAndReadLighting(page, hour), hourly = inspection.hourly!;
    expect(inspection.environment).toMatchObject({ hourSource: "server-time", targetType: 0 });
    expect(inspection.textureSlots!.map(slot => slot.childCount)).toEqual(atlasChildCounts);
    const bspRow = fixtureRowAt(hour, row => row.surfaceType === "BSP");
    for (const slot of inspection.textureSlots!.filter(entry => entry.childCount === fixtureNumber(bspRow.input, "atlasCount"))) {
      expect(slot.sunAffectedSlot, `texture ${slot.texture} at hour ${hour}`).toBe(fixtureNumber(bspRow.output, "selectedAtlasChild"));
    }
    const terrainRow = fixtureRowAt(hour, row => row.surfaceType === "terrain" && row.controlWord === "0x7f");
    expect(hourly.terrain).toMatchObject({ gap: null, heldReason: null });
    expect(hourly.terrain.lastRebuildHour).toBeGreaterThanOrEqual(hour);
    expect(hourly.terrain.probe).toEqual({ column: 134, row: 129, intensity: fixtureNumber(terrainRow.input, "truncatedIntensity"),
      bgra: fixtureNumbers(terrainRow.output, "vertexBGRA") });
    const visibilityRow = fixtureRowAt(hour, row => row.surfaceType === "staticMesh" && row.status === "conditional-authored-input-fixture");
    expect(hourly.staticMeshVisibility.placements.find(placement => placement.sourceActor === staticMeshVisibilityProbeActor)?.vertexZeroVisibility)
      .toBe(fixtureNumber(visibilityRow.output, "shaderVisibilityFloat"));
    const staticMeshRow = fixtureRowAt(hour, row => row.surfaceType === "staticMesh" && row.status === "conditional-input-fixture");
    expect(hourly.terms.staticMesh.ambient.value).toEqual(fixtureAmbient(staticMeshRow));
    expect(hourly.terms.actor.ambient.value).toEqual(fixtureAmbient(fixtureRowAt(hour, row => row.surfaceType === "actor")));
    readings.push({ hour, textureSlots: inspection.textureSlots, hourly });
  }
  return readings;
}

test.describe("desktop", () => {
  test.use({ viewport: desktopViewport });
  test("binds the tile 20_21 lightmap pages by hour from the world time of day at 1440 x 900", async ({ page }) => {
    test.setTimeout(tileLoadTimeout + 60_000);
    const inspection = await openTileAndReadLighting(page, "world-tile-lighting-20_21-desktop.png");
    writeFileSync("test-results/world-tile-lighting-20_21-inspection.json", JSON.stringify(inspection, null, 2));
  });

  test("reads the DB-7 hourly lighting inputs of tile 20_21 at hours 0, 6, 12 and 18 at 1440 x 900", async ({ page }) => {
    test.setTimeout(tileLoadTimeout + 60_000);
    await openTileAndReadLighting(page, "world-tile-lighting-20_21-hourly-desktop.png");
    const readings = await readHourlyLightingInputs(page);
    await page.screenshot({ path: "test-results/world-tile-lighting-20_21-hour-18-desktop.png" });
    writeFileSync("test-results/world-tile-lighting-20_21-hourly-inputs.json", JSON.stringify(readings, null, 2));
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
