import { describe, expect, it, vi } from "vitest";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { Scene } from "@babylonjs/core/scene";
import { attachTileLighting, type TileLightingRuntimeInspection } from "../../src/scene/world/lighting/attachTileLighting";
import type { TileLightingBspChunk } from "../../src/scene/world/lighting/bindTileLighting";
import type { NativeBspSection } from "../../src/scene/world/nativeBspResources";
import { parseNativeTileManifest } from "../../src/scene/world/nativeTileManifest";

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
    { primitive: 0, material: "Synthetic.Lit", unlit: false, lightmap: 0, outdoor: true, translucent: false },
    { primitive: 1, material: "Synthetic.Indoor", unlit: false, lightmap: 1, outdoor: false, translucent: false },
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
  it("refuses a chunk whose static mesh holds a malformed material program pin and leaves no per-frame observer after dispose", async () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    scene.activeCamera = new FreeCamera("camera", Vector3.Zero(), scene);
    const malformedPinMaterial = new StandardMaterial("malformed-pin", scene);
    malformedPinMaterial.metadata = { gltf: { extras: { nativeMaterialProgram: { directory: "native-materials/not-a-digest", programSha256: "not-a-digest" } } } };
    const staticMesh = new Mesh("static-mesh", scene);
    staticMesh.material = malformedPinMaterial;
    const observersBefore = scene.onBeforeRenderObservable.observers.length;
    const attached = await attachTileLighting(scene, lightingTileManifest(), () => null, new AbortController().signal);
    await expect(attached.addChunk({ chunkId: lateChunkId, bspChunk: null, staticMeshes: [staticMesh], terrainMeshes: [] }))
      .rejects.toThrow(/is not a native-materials program pin/);
    expect((attached.inspection() as TileLightingRuntimeInspection).staticMeshSlots).toEqual({});
    attached.dispose();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(scene.onBeforeRenderObservable.observers.length).toBe(observersBefore);
    scene.dispose();
    engine.dispose();
  });

  it("attaches lighting on a scene that has no camera yet", async () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const attached = await attachTileLighting(scene, lightingTileManifest(), () => null, new AbortController().signal);
    expect(attached.inspection()).toHaveProperty("cameraEnvironment");
    attached.dispose();
    scene.dispose();
    engine.dispose();
  });

  it("plans the lightmaps of a chunk added after attach, drops them when it is removed and plans them again when it returns", async () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const attached = await attachTileLighting(scene, lightingTileManifest(), () => null, new AbortController().signal);
    expect(lightmappedSectionsOf(attached.inspection(), lateChunkId)).toBe(0);
    const staticMesh = new Mesh("late static mesh", scene);
    await attached.addChunk({ chunkId: lateChunkId, bspChunk: lateBspChunk(scene), staticMeshes: [staticMesh], terrainMeshes: [] });
    expect(lightmappedSectionsOf(attached.inspection(), lateChunkId)).toBe(2);
    expect((attached.inspection() as TileLightingRuntimeInspection).staticMeshSlots).toEqual({ "program-unconverted": 1 });
    attached.removeChunk(lateChunkId);
    expect(lightmappedSectionsOf(attached.inspection(), lateChunkId)).toBe(0);
    expect((attached.inspection() as TileLightingRuntimeInspection).staticMeshSlots).toEqual({});
    await attached.addChunk({ chunkId: lateChunkId, bspChunk: lateBspChunk(scene), staticMeshes: [staticMesh], terrainMeshes: [] });
    expect(lightmappedSectionsOf(attached.inspection(), lateChunkId)).toBe(2);
    attached.dispose();
    scene.dispose();
    engine.dispose();
  });
});
