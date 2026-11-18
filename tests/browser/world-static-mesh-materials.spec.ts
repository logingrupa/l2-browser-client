import { expect, test, type Page } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { desktopViewport } from "./browserViewports";
import { environmentTimeTablesRequirement, environmentTimeTablesStaged } from "./stagedEnvironmentTimeTables";

interface TileCatalogRecord { readonly id: string; readonly manifest: string }
interface TileManifest { readonly resources: readonly { readonly kind: string; readonly manifest: string }[] }
interface StaticMeshSlot {
  readonly sourceObject: string | null;
  readonly status: string;
  readonly programMaterialId: string | null;
  readonly reasons: readonly string[];
  readonly meshes: number;
}
interface StaticMeshPlacementLighting {
  readonly litPlacements: number;
  readonly litMeshes: number;
  readonly unlitPlacementReasons: Record<string, number>;
  readonly rebuildTrigger: { readonly status: string; readonly reason: string };
}
interface StaticMeshSlotsInspection {
  readonly gap: string | null;
  readonly lighting: StaticMeshPlacementLighting;
  readonly meshCount: number;
  readonly statusCounts: Record<string, number>;
  readonly slots: readonly StaticMeshSlot[];
}
interface TerrainLayersInspection {
  readonly gap: string | null;
  readonly lighting: string;
  readonly lightingReasons: readonly string[];
  readonly drawnLayers: readonly number[];
  readonly layerReasons: readonly { readonly index: number; readonly reasons: readonly string[] }[];
  readonly samplerCount: number;
  readonly meshCount: number;
  readonly statusCounts: Record<string, number>;
}
interface CameraEnvironmentInspection { readonly fog: { readonly source: string; readonly enabled: boolean }; readonly gaps: readonly string[] }
interface LightingInspection {
  readonly gap: string | null;
  readonly staticMeshSlots?: StaticMeshSlotsInspection;
  readonly terrainLayers?: TerrainLayersInspection;
  readonly cameraEnvironment?: CameraEnvironmentInspection;
}
interface TerrainMaterialsListing { readonly layers: readonly { readonly index: number; readonly rootsPorted: boolean }[] }

const laneName = "world";
const tileId = "20_21";
const laneFolder = resolve("artifacts/lane-store", laneName);
const laneStoreFile = (manifest: string) => resolve(laneFolder, "l2", manifest.replace(/^\/l2\//, ""));
const readJson = <Value>(path: string): Value => JSON.parse(readFileSync(path, "utf8")) as Value;
const laneCatalogPath = resolve(laneFolder, "l2/catalog.json");
const laneCatalog: { tiles?: TileCatalogRecord[] } | null = existsSync(laneCatalogPath) ? readJson(laneCatalogPath) : null;
const tileManifestOf = (id: string) => {
  const record = laneCatalog?.tiles?.find(entry => entry.id === id) ?? null;
  return record ? readJson<TileManifest>(laneStoreFile(record.manifest)) : null;
};
const tileResource = (id: string, kind: string) => tileManifestOf(id)?.resources.find(resource => resource.kind === kind) ?? null;
const staticMeshMaterialsResource = tileResource(tileId, "static-mesh-materials");
const terrainTileIds = ["20_21", "15_22"] as const;
const fogInfoUnresolvedGaps = ["fog-info-terrain-clip-range-unresolved", "fog-info-reference-position-unresolved", "fog-info-list-producer-unresolved"];
const lightingRecordsArrayName = "RECS.canonicalJson";
const horizonDragPixels = -320;

function lightingFogInfoCount(id: string): number {
  const resource = tileResource(id, "lighting")!;
  const asset = readJson<{ arrays: readonly { name: string; byteOffset: number; byteLength: number }[] }>(laneStoreFile(resource.manifest));
  const records = asset.arrays.find(array => array.name === lightingRecordsArrayName)!;
  const payload = readFileSync(laneStoreFile(resource.manifest).replace(/asset\.json$/, "payload.bin"));
  const document = JSON.parse(payload.subarray(records.byteOffset, records.byteOffset + records.byteLength).toString("utf8")) as { fogInfos: unknown[] };
  return document.fogInfos.length;
}
const evidenceFolder = resolve("artifacts/ui-evidence");
const tileLoadTimeout = 300_000;

test.skip(process.env.NATIVE_STORE_ROOT !== laneName, "run with NATIVE_STORE_ROOT=world");
test.skip(!environmentTimeTablesStaged(laneName), environmentTimeTablesRequirement);

const staticMeshSlots = (page: Page) => page.evaluate(() => {
  const lighting = window.__nativeSlice?.snapshot().world?.lighting as LightingInspection | undefined;
  return lighting === undefined ? null : lighting;
});

test.describe("desktop", () => {
  test.use({ viewport: desktopViewport });
  test("draws tile 20_21 static mesh slots through the UE2 material library and lists every other slot with its reasons at 1440 x 900", async ({ page }) => {
    test.skip(staticMeshMaterialsResource === null,
      "the world lane store has no tile 20_21 with a static-mesh-materials resource; run convert_tile.py --map 20_21 --step static-mesh-materials, then --step manifest");
    test.setTimeout(tileLoadTimeout + 60_000);
    const pageErrors: string[] = [];
    page.on("pageerror", error => pageErrors.push(error.message));
    await page.goto(`/?map=${tileId}`);
    await expect.poll(async () => (await staticMeshSlots(page))?.staticMeshSlots?.meshCount ?? 0, { timeout: tileLoadTimeout, intervals: [1_000] })
      .toBeGreaterThan(0);
    const lighting = (await staticMeshSlots(page))!;
    expect(lighting.gap).toBeNull();
    const slots = lighting.staticMeshSlots!;
    expect(slots.gap).toBeNull();
    expect(slots.lighting.rebuildTrigger).toEqual({ status: "unresolved", reason: "static-mesh-hourly-rebuild-trigger-unresolved" });
    const unlitPlacements = Object.values(slots.lighting.unlitPlacementReasons).reduce((sum, count) => sum + count, 0);
    expect(slots.lighting.litPlacements + unlitPlacements, "every placement is lit or names why it is not").toBeGreaterThan(0);
    for (const reason of Object.keys(slots.lighting.unlitPlacementReasons)) expect(reason).toMatch(/^[a-z0-9][a-z0-9:._-]+$/);
    expect(Object.values(slots.statusCounts).reduce((sum, count) => sum + count, 0)).toBe(slots.meshCount);
    expect(slots.slots.reduce((sum, slot) => sum + slot.meshes, 0)).toBe(slots.meshCount);
    expect(slots.statusCounts["library-compiled"], "a 20_21 static mesh slot draws through the UE2 material library").toBeGreaterThan(0);
    for (const slot of slots.slots) {
      if (slot.status === "library-compiled") expect(slot.programMaterialId).toMatch(/^[a-f0-9]{64}$/);
      else expect(slot.reasons.length, `${slot.sourceObject} names why it keeps its texture material`).toBeGreaterThan(0);
    }
    mkdirSync(evidenceFolder, { recursive: true });
    await page.screenshot({ path: resolve(evidenceFolder, "world-static-mesh-materials-20_21-desktop.png") });
    writeFileSync(resolve(evidenceFolder, "world-static-mesh-materials-20_21-inspection.json"), JSON.stringify(slots, null, 2));
    expect(pageErrors).toEqual([]);
  });

  for (const terrainTileId of terrainTileIds) {
    test(`draws tile ${terrainTileId} terrain layers through the UE2 library and names the open L2FogInfo inputs at 1440 x 900`, async ({ page }) => {
      const resource = tileResource(terrainTileId, "terrain-materials");
      test.skip(resource === null, `the world lane store has no tile ${terrainTileId} with a terrain-materials resource; run the tile batch`);
      test.setTimeout(tileLoadTimeout + 60_000);
      const listing = readJson<TerrainMaterialsListing>(laneStoreFile(resource!.manifest));
      const pageErrors: string[] = [];
      page.on("pageerror", error => pageErrors.push(error.message));
      await page.goto(`/?map=${terrainTileId}`);
      await expect.poll(async () => (await staticMeshSlots(page))?.terrainLayers?.meshCount ?? 0, { timeout: tileLoadTimeout, intervals: [1_000] })
        .toBeGreaterThan(0);
      const lighting = (await staticMeshSlots(page))!;
      const terrain = lighting.terrainLayers!;
      expect(terrain.gap).toBeNull();
      expect(terrain.lighting).toBe("unlit");
      expect(terrain.lightingReasons).toEqual(["library-terrain-lighting-unported"]);
      expect(terrain.drawnLayers[0]).toBe(listing.layers[0]!.index);
      expect(terrain.drawnLayers.length + terrain.layerReasons.filter(layer => !terrain.drawnLayers.includes(layer.index)).length).toBe(listing.layers.length);
      expect(terrain.statusCounts["library-terrain-layers"]).toBe(terrain.meshCount);
      const environment = lighting.cameraEnvironment!;
      if (lightingFogInfoCount(terrainTileId) > 0) expect(environment.gaps).toEqual(expect.arrayContaining(fogInfoUnresolvedGaps));
      else expect(environment.gaps.filter(gap => fogInfoUnresolvedGaps.includes(gap))).toEqual([]);
      expect(["camera-zone", "zone-without-fog", "none"]).toContain(environment.fog.source);
      mkdirSync(evidenceFolder, { recursive: true });
      await page.screenshot({ path: resolve(evidenceFolder, `world-terrain-layers-${terrainTileId}-desktop.png`) });
      writeFileSync(resolve(evidenceFolder, `world-terrain-layers-${terrainTileId}-inspection.json`), JSON.stringify({ terrainLayers: terrain, cameraEnvironment: environment }, null, 2));
      const centre = { x: desktopViewport.width * 0.25, y: desktopViewport.height * 0.5 };
      await page.mouse.move(centre.x, centre.y);
      await page.mouse.down({ button: "right" });
      await page.mouse.move(centre.x, centre.y + horizonDragPixels, { steps: 12 });
      await page.mouse.up({ button: "right" });
      await page.screenshot({ path: resolve(evidenceFolder, `world-terrain-layers-${terrainTileId}-horizon-desktop.png`) });
      expect(pageErrors).toEqual([]);
    });
  }
});
