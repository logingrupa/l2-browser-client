import { expect, test, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { environmentTimeTablesRequirement, environmentTimeTablesStaged } from "./stagedEnvironmentTimeTables";

interface PinnedRecord { readonly id: string; readonly manifest: string }
interface LightingAssetManifest { readonly arrays: readonly { readonly name: string; readonly byteOffset: number; readonly byteLength: number }[] }
interface LightingRecordsDocument { readonly zones: readonly { readonly distanceFog: readonly { readonly field: string }[] }[] }
interface LevelFogReading {
  readonly enabled: boolean;
  readonly source: string;
  readonly colour: readonly number[];
  readonly startSourceUnits: number;
  readonly endSourceUnits: number;
}
interface FogInspection {
  readonly lightingGap: string | null;
  readonly levelFog: LevelFogReading | null;
  readonly skyRoute: string | null | undefined;
  readonly farPlaneSource: string | null;
}

interface Rm1EnabledFogCall {
  readonly tileId: "15_22" | "20_21";
  readonly referenceCapture: string;
  readonly referencePawnSourcePosition: { readonly x: number; readonly y: number; readonly z: number };
  readonly referencePawnHeadingUnits: number;
  readonly gameMinutes: number;
  readonly source: string;
  readonly colourBytes: readonly [number, number, number];
  readonly startSourceUnits: number;
  readonly endSourceUnits: number;
  readonly needsTerrainZoneFlag: boolean;
}

const laneName = "world";
const laneStore = resolve("artifacts/lane-store", laneName, "l2");
const recordsArrayName = "RECS.canonicalJson";
const terrainZoneField = "bTerrainZone";
const tileLoadTimeout = 300_000;
const fogSettleTimeout = 60_000;

const rm1EnabledFogCalls: readonly Rm1EnabledFogCall[] = [
  { tileId: "20_21", referenceCapture: "RM-1 reference-map-captures-rm1.json 20_21 shots[0] playerLocation, playerRotation and gameHour 12.30 in whole minutes",
    referencePawnSourcePosition: { x: 9181.810546875, y: 119378.65625, z: -3673.308349609375 }, referencePawnHeadingUnits: 0,
    gameMinutes: 738, source: "local-fog-list", colourBytes: [107, 114, 97], startSourceUnits: 0, endSourceUnits: 10000, needsTerrainZoneFlag: false },
  { tileId: "15_22", referenceCapture: "RM-1 reference-map-captures-rm1.json 15_22 shots[0] playerLocation, playerRotation and gameHour 12.078 in whole minutes",
    referencePawnSourcePosition: { x: -144885.09375, y: 137792.125, z: -3300 }, referencePawnHeadingUnits: 2675,
    gameMinutes: 725, source: "terrain-zone-environment", colourBytes: [188, 203, 224], startSourceUnits: 8192, endSourceUnits: 20480, needsTerrainZoneFlag: true },
];

const readJson = <Value>(path: string): Value => JSON.parse(readFileSync(path, "utf8")) as Value;
const laneStoreFile = (manifest: string) => resolve(laneStore, manifest.replace(/^\/l2\//, ""));

function laneLightingRecords(tileId: string): LightingRecordsDocument | null {
  const catalogPath = resolve(laneStore, "catalog.json");
  if (!existsSync(catalogPath)) return null;
  const tile = readJson<{ tiles?: PinnedRecord[] }>(catalogPath).tiles?.find(record => record.id === tileId);
  if (tile === undefined) return null;
  const lighting = readJson<{ resources: readonly { kind: string; manifest: string }[] }>(laneStoreFile(tile.manifest)).resources
    .find(resource => resource.kind === "lighting");
  if (lighting === undefined) return null;
  const assetPath = laneStoreFile(lighting.manifest);
  const records = readJson<LightingAssetManifest>(assetPath).arrays.find(array => array.name === recordsArrayName);
  if (records === undefined) return null;
  const payload = readFileSync(resolve(assetPath, "..", "payload.bin"));
  return JSON.parse(payload.subarray(records.byteOffset, records.byteOffset + records.byteLength).toString("utf8")) as LightingRecordsDocument;
}

function laneStoreGap(call: Rm1EnabledFogCall): string | null {
  const records = laneLightingRecords(call.tileId);
  if (records === null) return `the world lane store has no tile ${call.tileId} lighting records; run convert_tile_batch.py --eligible, then write_lane_catalog.py`;
  const carriesTerrainFlag = records.zones.some(zone => zone.distanceFog.some(field => field.field === terrainZoneField));
  if (call.needsTerrainZoneFlag && !carriesTerrainFlag) return `the tile ${call.tileId} lighting records predate ${terrainZoneField}; reconvert the lighting units, then write_lane_catalog.py`;
  return null;
}

const fogInspection = (page: Page) => page.evaluate((): FogInspection => {
  const snapshot = window.__nativeSlice?.snapshot();
  const lighting = snapshot?.world?.lighting as { gap?: string | null; cameraEnvironment?: { fog: LevelFogReading; skyFog: { route: string | null } } } | undefined;
  const farPlane = (snapshot?.environment as { farPlane?: { source: string } } | undefined)?.farPlane;
  return { lightingGap: lighting?.gap ?? null, levelFog: lighting?.cameraEnvironment?.fog ?? null, skyRoute: lighting?.cameraEnvironment?.skyFog.route,
    farPlaneSource: farPlane?.source ?? null };
});

test.skip(process.env.NATIVE_STORE_ROOT !== laneName, "run with NATIVE_STORE_ROOT=world");
test.skip(!environmentTimeTablesStaged(laneName), environmentTimeTablesRequirement);

for (const call of rm1EnabledFogCalls) {
  test(`${call.tileId} level fog at the RM-1 reference pawn and hour equals the RM-1 enabled call`, async ({ page }) => {
    const gap = laneStoreGap(call);
    test.skip(gap !== null, gap ?? "");
    test.setTimeout(tileLoadTimeout + 2 * fogSettleTimeout);
    const pageErrors: string[] = [];
    page.on("pageerror", error => pageErrors.push(error.message));
    await page.goto(`/?map=${call.tileId}`);
    await expect.poll(() => page.evaluate(() => document.body.dataset.worldState ?? "loading"), { timeout: tileLoadTimeout, intervals: [1_000] }).toBe("ready");
    await page.evaluate(({ position, heading, gameMinutes }) => {
      window.__nativeSlice!.dispatch({ type: "teleport-local", position, heading });
      window.__nativeSlice!.dispatch({ type: "set-server-time", gameMinutes });
    }, { position: call.referencePawnSourcePosition, heading: call.referencePawnHeadingUnits, gameMinutes: call.gameMinutes });
    const levelFogReading = async () => {
      const levelFog = (await fogInspection(page)).levelFog;
      return levelFog === null ? null : { enabled: levelFog.enabled, source: levelFog.source, startSourceUnits: levelFog.startSourceUnits,
        endSourceUnits: levelFog.endSourceUnits, colourBytes: levelFog.colour.map(channel => Math.round(channel * 255)) };
    };
    await expect.poll(levelFogReading, { message: call.referenceCapture, timeout: fogSettleTimeout, intervals: [500] }).toEqual({ enabled: true, source: call.source,
      startSourceUnits: call.startSourceUnits, endSourceUnits: call.endSourceUnits, colourBytes: call.colourBytes });
    const inspection = await fogInspection(page);
    expect(inspection.lightingGap).toBeNull();
    expect(inspection.skyRoute).toBe("inherit-level");
    expect(inspection.farPlaneSource).toBe("far-plane-source-unresolved");
    expect(pageErrors).toEqual([]);
  });
}
