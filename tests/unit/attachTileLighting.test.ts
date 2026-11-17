import { describe, expect, it, vi } from "vitest";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { Scene } from "@babylonjs/core/scene";
import { attachTileLighting, type TileLightingRuntimeInspection } from "../../src/scene/world/lighting/attachTileLighting";
import { terrainLightingUnportedReason } from "../../src/scene/world/lighting/bindTerrainLayerMaterials";
import type { TileLightingBspChunk } from "../../src/scene/world/lighting/bindTileLighting";
import type { NativeBspSection } from "../../src/scene/world/nativeBspResources";
import { parseNativeTileManifest } from "../../src/scene/world/nativeTileManifest";
import { staticMeshMaterialsResourceAbsentReason } from "../../src/scene/world/staticMeshLibraryMaterials";
import { terrainMaterialsResourceAbsentReason } from "../../src/scene/world/terrainLayerMaterials";
import { provideWorldTimeOfDay } from "../../src/scene/world/worldTimeOfDay";
import { provideDayNightTimeOfDay } from "../support/worldTimeOfDayFixture";

vi.mock("../../src/scene/world/lighting/loadTileLighting", async () => {
  const { tileLightingModel } = await import("../support/tileLightingFixture");
  return { loadTileLighting: async () => tileLightingModel() };
});

const lightingSha256 = "d".repeat(64);
const lateChunkId = "chunk-0-0";

function lightingTileManifest() {
  return parseNativeTileManifest({
    kind: "native-tile-runtime", schemaVersion: 1, tileId: "20_21", sourceMap: "maps/20_21.unr", sourceSha256: "e".repeat(64),
    frame: { terrainInfo: "20_21.TerrainInfo0", location: [0, 0, 0], terrainScale: [1, 1, 1] },
    anchor: { playerStart: "20_21.PlayerStart0", location: [0, 0, 0] },
    chunks: [{ chunkId: lateChunkId, manifest: `/l2/maps/${"1".repeat(64)}/native-tile-chunk-runtime/manifest.json`, manifestSha256: "1".repeat(64),
      manifestBytes: 100 }],
    resources: [{ kind: "lighting", manifest: `/l2/maps/${lightingSha256}/native-tile-lighting/asset.json`, manifestSha256: lightingSha256,
      manifestBytes: 100 }],
    gaps: [],
  });
}

function lateBspChunk(scene: Scene): TileLightingBspChunk {
  const sections: NativeBspSection[] = [
    { primitive: 0, material: "Synthetic.Lit", unlit: false, lightmap: 0, nativeRenderSection: 0, translucent: false },
    { primitive: 1, material: "Synthetic.Indoor", unlit: false, lightmap: 1, nativeRenderSection: 1, translucent: false },
  ];
  const primitiveIndices = [[0, 1, 2, 0, 2, 3], [0, 1, 2]];
  const meshes = primitiveIndices.map((indices, primitive) => {
    const mesh = new Mesh(`late chunk primitive ${primitive}`, scene);
    Object.assign(new VertexData(), { positions: Array.from({ length: (Math.max(...indices) + 1) * 3 }, (_, index) => index), indices }).applyToMesh(mesh);
    return mesh;
  });
  return { chunkId: lateChunkId, chunkOrdinal: 0, sections, meshes,
    nodeRanges: [{ node: 10, primitive: 0, firstIndex: 0, indexCount: 6 }, { node: 11, primitive: 1, firstIndex: 0, indexCount: 3 }] };
}

function lightmappedSectionsOf(inspection: ReturnType<Awaited<ReturnType<typeof attachTileLighting>>["inspection"]>, chunkId: string) {
  return (inspection as TileLightingRuntimeInspection).sections.filter(section => section.chunkId === chunkId && section.lighting === "lightmapped").length;
}

describe("attachTileLighting", () => {
  it("keeps a terrain chunk's material and names the absent terrain-materials resource, and leaves no per-frame observer after dispose", async () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    provideDayNightTimeOfDay(scene);
    scene.activeCamera = new FreeCamera("camera", Vector3.Zero(), scene);
    const terrainMesh = new Mesh("terrain-mesh", scene);
    const observersBefore = scene.onBeforeRenderObservable.observers.length;
    const attached = await attachTileLighting(scene, lightingTileManifest(), null, new AbortController().signal);
    await attached.addChunk({ chunkId: lateChunkId, bspChunk: null, staticMeshes: [], staticMeshPlacements: [], terrainMeshes: [terrainMesh] });
    expect(terrainMesh.material).toBeNull();
    const inspection = attached.inspection() as TileLightingRuntimeInspection;
    expect(inspection.terrainLayers)
      .toMatchObject({ gap: terrainMaterialsResourceAbsentReason, meshCount: 1, statusCounts: { "library-terrain-layers": 0, "terrain-layer-gap": 1 } });
    expect(inspection.hourly.terrain.drawn).toEqual({ value: false, reason: terrainLightingUnportedReason });
    attached.dispose();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(scene.onBeforeRenderObservable.observers.length).toBe(observersBefore);
    scene.dispose();
    engine.dispose();
  });

  it("attaches lighting on a scene that has no camera yet", async () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    provideDayNightTimeOfDay(scene);
    const attached = await attachTileLighting(scene, lightingTileManifest(), null, new AbortController().signal);
    expect(attached.inspection()).toHaveProperty("cameraEnvironment");
    attached.dispose();
    scene.dispose();
    engine.dispose();
  });

  it("plans the lightmaps of a chunk added after attach, drops them when it is removed and plans them again when it returns", async () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const timeOfDay = provideDayNightTimeOfDay(scene);
    const attached = await attachTileLighting(scene, lightingTileManifest(), null, new AbortController().signal);
    expect(lightmappedSectionsOf(attached.inspection(), lateChunkId)).toBe(0);
    const staticMesh = new Mesh("late static mesh", scene);
    await attached.addChunk({ chunkId: lateChunkId, bspChunk: lateBspChunk(scene), staticMeshes: [staticMesh], staticMeshPlacements: [], terrainMeshes: [] });
    expect(lightmappedSectionsOf(attached.inspection(), lateChunkId)).toBe(2);
    expect((attached.inspection() as TileLightingRuntimeInspection).environment).toEqual(timeOfDay.sample());
    expect(attached.materialUniforms!()).toMatchObject({ hour: 12, environmentType: 0 });
    expect((attached.inspection() as TileLightingRuntimeInspection).staticMeshSlots).toMatchObject({ gap: staticMeshMaterialsResourceAbsentReason, meshCount: 1,
      statusCounts: { "library-compiled": 0, "library-diagnostic": 0, "program-gap": 1 } });
    attached.removeChunk(lateChunkId);
    expect(lightmappedSectionsOf(attached.inspection(), lateChunkId)).toBe(0);
    expect((attached.inspection() as TileLightingRuntimeInspection).staticMeshSlots.meshCount).toBe(0);
    await attached.addChunk({ chunkId: lateChunkId, bspChunk: lateBspChunk(scene), staticMeshes: [staticMesh], staticMeshPlacements: [], terrainMeshes: [] });
    expect(lightmappedSectionsOf(attached.inspection(), lateChunkId)).toBe(2);
    attached.dispose();
    scene.dispose();
    engine.dispose();
  });

  it("reports the hourly lighting gaps of a payload converted before DB-7 and adds no Babylon light or scene ambient", async () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    provideDayNightTimeOfDay(scene);
    const ambientBefore = scene.ambientColor.asArray();
    const attached = await attachTileLighting(scene, lightingTileManifest(), null, new AbortController().signal);
    const staticMesh = new Mesh("late static mesh", scene);
    await attached.addChunk({ chunkId: lateChunkId, bspChunk: lateBspChunk(scene), staticMeshes: [staticMesh],
      staticMeshPlacements: [{ sourceActor: "20_21.StaticMeshActor1905", exportIndex: 7706 }], terrainMeshes: [] });
    scene.onBeforeRenderObservable.notifyObservers(scene);
    const { hourly } = attached.inspection() as TileLightingRuntimeInspection;
    expect(hourly.terrain).toMatchObject({ gap: "hourly-lighting-input-unstaged:TINT.time", rebuildCount: 0 });
    expect(hourly.staticMeshVisibility).toMatchObject({ gap: "hourly-lighting-input-unstaged:SMLL.actorExportIndex", placementCount: 1 });
    expect(hourly.terms).toMatchObject({ hour: 12, actor: { ambient: { status: "resolved" } }, dynamicLights: { applied: false } });
    expect(scene.lights).toHaveLength(0);
    expect(scene.ambientColor.asArray()).toEqual(ambientBefore);
    attached.dispose();
    scene.dispose();
    engine.dispose();
  });

  it("reports the world time-of-day gap instead of lighting the tile when no hour exists", async () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const observersBefore = scene.onBeforeRenderObservable.observers.length;
    const unprovided = await attachTileLighting(scene, lightingTileManifest(), null, new AbortController().signal);
    expect(unprovided.inspection()).toEqual({ gap: "environment-time-of-day-unprovided" });
    expect(unprovided.materialUniforms).toBeNull();
    provideWorldTimeOfDay(scene, { status: "gap", reason: "environment-time-tables-unstaged", detail: "not staged" });
    const unstaged = await attachTileLighting(scene, lightingTileManifest(), null, new AbortController().signal);
    expect(unstaged.inspection()).toEqual({ gap: "environment-time-tables-unstaged" });
    expect(scene.onBeforeRenderObservable.observers.length).toBe(observersBefore);
    scene.dispose();
    engine.dispose();
  });
});
