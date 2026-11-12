import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { Scene } from "@babylonjs/core/scene";
import { attachNativeTileSystems, type NativeTileChunkSystemContents } from "../../src/scene/world/attachNativeTileSystems";
import type { BoundTileVisibilityRuntimeInspection } from "../../src/scene/world/bspVisibility/attachTileVisibility";
import type { TileLightingRuntimeInspection } from "../../src/scene/world/lighting/attachTileLighting";
import type { NativeModelInstance } from "../../src/scene/world/nativeModelPlacements";
import type { NativeTileChunkPlacement } from "../../src/scene/world/nativeTileChunkManifest";
import { parseNativeTileManifest } from "../../src/scene/world/nativeTileManifest";

vi.mock("../../src/scene/world/bspVisibility/loadBspVisibility", async () => {
  const { threeRoomVisibilityModel } = await import("../support/bspVisibilityFixture");
  return { loadBspVisibility: async () => threeRoomVisibilityModel() };
});
vi.mock("../../src/scene/world/lighting/loadTileLighting", async () => {
  const { tileLightingModel } = await import("../support/tileLightingFixture");
  return { loadTileLighting: async () => tileLightingModel() };
});

const visibilitySha256 = "c".repeat(64), lightingSha256 = "d".repeat(64);

function systemsTileManifest() {
  return parseNativeTileManifest({
    kind: "native-tile-runtime", schemaVersion: 1, tileId: "20_21", sourceMap: "maps/20_21.unr", sourceSha256: "e".repeat(64),
    frame: { terrainInfo: "20_21.TerrainInfo0", location: [0, 0, 0], terrainScale: [1, 1, 1] }, anchor: { playerStart: "20_21.PlayerStart0", location: [0, 0, 0] },
    chunks: ["chunk-0-0", "chunk-1-0"].map((chunkId, ordinal) => ({ chunkId, manifest: `/l2/maps/${String(ordinal + 1).repeat(64)}/native-tile-chunk-runtime/manifest.json`,
      manifestSha256: String(ordinal + 1).repeat(64), manifestBytes: 100 })),
    resources: [
      { kind: "bsp-visibility", manifest: `/l2/maps/${visibilitySha256}/native-tile-bsp-visibility/asset.json`, manifestSha256: visibilitySha256, manifestBytes: 100 },
      { kind: "lighting", manifest: `/l2/maps/${lightingSha256}/native-tile-lighting/asset.json`, manifestSha256: lightingSha256, manifestBytes: 100 },
    ],
    gaps: [],
  });
}

describe("attachNativeTileSystems", () => {
  let engine: NullEngine, scene: Scene;
  beforeEach(() => { engine = new NullEngine(); scene = new Scene(engine); scene.useRightHandedSystem = true; });
  afterEach(() => { scene.dispose(); engine.dispose(); });

  function wallsChunk(instances: readonly NativeModelInstance<NativeTileChunkPlacement>[] = []): NativeTileChunkSystemContents {
    const walls = new Mesh("walls", scene), data = new VertexData();
    data.positions = Array.from({ length: 18 }, (_, index) => index);
    data.indices = [0, 1, 2, 3, 4, 5];
    data.applyToMesh(walls, false);
    return { chunkId: "chunk-0-0", instances, terrainMeshes: [],
      bspChunk: { chunkId: "chunk-0-0", resource: "/l2/bsp/walls", meshes: [walls],
        sections: [{ primitive: 0, material: "fixture", unlit: false, lightmap: null, outdoor: false, translucent: true }],
        nodeRanges: [{ node: 2, primitive: 0, firstIndex: 0, indexCount: 3 }, { node: 3, primitive: 0, firstIndex: 3, indexCount: 3 }] } };
  }

  it("adds a chunk to the visibility walk and the lighting at once and takes it out of both on remove", async () => {
    const systems = await attachNativeTileSystems(scene, systemsTileManifest(), { initialChunks: [], drawLimitRules: [] }, new AbortController().signal, () => false);
    expect(systems.boundChunkIds()).toEqual([]);
    await systems.addChunk(wallsChunk());
    expect(systems.boundChunkIds()).toEqual(["chunk-0-0"]);
    expect((systems.visibility.inspection() as BoundTileVisibilityRuntimeInspection).targetChunkIds).toEqual(["chunk-0-0"]);
    expect((systems.lighting.inspection() as TileLightingRuntimeInspection).sections.map(section => section.chunkId)).toEqual(["chunk-0-0"]);
    systems.removeChunk("chunk-0-0");
    expect(systems.boundChunkIds()).toEqual([]);
    expect((systems.visibility.inspection() as BoundTileVisibilityRuntimeInspection).targetChunkIds).toEqual([]);
    expect((systems.lighting.inspection() as TileLightingRuntimeInspection).sections).toEqual([]);
    systems.dispose();
  });

  it("takes a chunk whose lighting refuses it back out of the visibility walk", async () => {
    const systems = await attachNativeTileSystems(scene, systemsTileManifest(), { initialChunks: [], drawLimitRules: [] }, new AbortController().signal, () => false);
    const placedMesh = new Mesh("placed static mesh", scene), data = new VertexData();
    data.positions = [0, 0, 0, 1, 0, 0, 0, 1, 0];
    data.indices = [0, 1, 2];
    data.applyToMesh(placedMesh, false);
    placedMesh.material = new StandardMaterial("malformed-pin", scene);
    placedMesh.material.metadata = { gltf: { extras: { nativeMaterialProgram: { directory: "native-materials/not-a-digest", programSha256: "not-a-digest" } } } };
    const root = new Mesh("placement root", scene);
    placedMesh.parent = root;
    const instance = { root, source: { exportIndex: 200 } } as unknown as NativeModelInstance<NativeTileChunkPlacement>;
    await expect(systems.addChunk(wallsChunk([instance]))).rejects.toThrow(/is not a native-materials program pin/);
    expect(systems.boundChunkIds()).toEqual([]);
    expect((systems.visibility.inspection() as BoundTileVisibilityRuntimeInspection).targetChunkIds).toEqual([]);
    systems.dispose();
  });
});
