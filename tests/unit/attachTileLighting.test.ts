import { describe, expect, it, vi } from "vitest";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Scene } from "@babylonjs/core/scene";
import { attachTileLighting } from "../../src/scene/world/lighting/attachTileLighting";
import { parseNativeTileManifest } from "../../src/scene/world/nativeTileManifest";

vi.mock("../../src/scene/world/lighting/loadTileLighting", async () => {
  const { tileLightingModel } = await import("../support/tileLightingFixture");
  return { loadTileLighting: async () => tileLightingModel() };
});

const lightingSha256 = "d".repeat(64);

function lightingTileManifest() {
  return parseNativeTileManifest({
    kind: "native-tile-runtime", schemaVersion: 1, tileId: "20_21", sourceMap: "maps/20_21.unr", sourceSha256: "e".repeat(64),
    frame: { terrainInfo: "20_21.TerrainInfo0", location: [0, 0, 0], terrainScale: [1, 1, 1] },
    anchor: { playerStart: "20_21.PlayerStart0", location: [0, 0, 0] },
    chunks: [{ chunkId: "chunk-0-0", manifest: `/l2/maps/${"1".repeat(64)}/native-tile-chunk-runtime/manifest.json`, manifestSha256: "1".repeat(64),
      manifestBytes: 100 }],
    resources: [{ kind: "lighting", manifest: `/l2/maps/${lightingSha256}/native-tile-lighting/asset.json`, manifestSha256: lightingSha256,
      manifestBytes: 100 }],
    gaps: [],
  });
}

describe("attachTileLighting", () => {
  it("leaves no per-frame observer on the scene when a static mesh holds a malformed material program pin", async () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    scene.activeCamera = new FreeCamera("camera", Vector3.Zero(), scene);
    const malformedPinMaterial = new StandardMaterial("malformed-pin", scene);
    malformedPinMaterial.metadata = { gltf: { extras: { nativeMaterialProgram: { directory: "native-materials/not-a-digest", programSha256: "not-a-digest" } } } };
    const staticMesh = new Mesh("static-mesh", scene);
    staticMesh.material = malformedPinMaterial;
    const observersBefore = scene.onBeforeRenderObservable.observers.length;
    await expect(attachTileLighting(scene, lightingTileManifest(),
      { bspChunks: [], staticMeshes: [staticMesh], terrainMeshes: [], cameraFrame: () => null }, new AbortController().signal))
      .rejects.toThrow(/is not a native-materials program pin/);
    expect(scene.onBeforeRenderObservable.observers.length).toBe(observersBefore);
    scene.dispose();
    engine.dispose();
  });
});
