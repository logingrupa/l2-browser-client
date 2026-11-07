import { describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import "@babylonjs/loaders/glTF";
import "../../src/assets/package/nativeSkinWeights";

function fixture(invalidJoint = false): { glb: Uint8Array; weights: Float32Array; joints: Float32Array } {
  const values: number[] = [], views: { buffer: number; byteOffset: number; byteLength: number }[] = [];
  const accessors: { bufferView: number; componentType: number; count: number; type: string; min?: number[]; max?: number[] }[] = [];
  function accessor(data: Float32Array, type: string, width: number) {
    const bufferView = views.length;
    views.push({ buffer: 0, byteOffset: values.length, byteLength: data.byteLength });
    values.push(...new Uint8Array(data.buffer));
    accessors.push({ bufferView, componentType: 5126, count: data.length / width, type });
    return accessors.length - 1;
  }
  const position = accessor(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), "VEC3", 3);
  accessors[position]!.min = [0, 0, 0]; accessors[position]!.max = [1, 1, 0];
  const weights = new Float32Array([.510001, .48997, 0, 0, .2, .3, .5, 0, 1, 0, 0, 0]);
  const joints = new Float32Array([0, 1, 0, 0, 0, 0, 1, 0, invalidJoint ? 7 : 1, 0, 0, 0]);
  const portableJoints = accessor(new Float32Array([0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0]), "VEC4", 4);
  const portableWeights = accessor(new Float32Array([.51, .49, 0, 0, .5, .5, 0, 0, 1, 0, 0, 0]), "VEC4", 4);
  const nativeWeights = accessor(weights, "VEC4", 4), nativeJoints = accessor(joints, "VEC4", 4);
  const doc = { asset: { version: "2.0" }, buffers: [{ byteLength: values.length }], bufferViews: views, accessors,
    meshes: [{ name: "Native skin", primitives: [{ attributes: { POSITION: position, JOINTS_0: portableJoints, WEIGHTS_0: portableWeights,
      _L2_NATIVE_WEIGHTS: nativeWeights, _L2_NATIVE_JOINTS: nativeJoints } }] }],
    nodes: [{ mesh: 0, skin: 0 }, { name: "NativeRoot", children: [2] }, { name: "NativeBone" }],
    skins: [{ joints: [1, 2], skeleton: 1 }], scenes: [{ nodes: [0, 1] }], scene: 0 };
  const json = new TextEncoder().encode(JSON.stringify(doc)), jsonSize = Math.ceil(json.length / 4) * 4;
  const glb = new Uint8Array(28 + jsonSize + values.length), header = new DataView(glb.buffer);
  header.setUint32(0, 0x46546c67, true); header.setUint32(4, 2, true); header.setUint32(8, glb.length, true);
  header.setUint32(12, jsonSize, true); header.setUint32(16, 0x4e4f534a, true);
  glb.fill(32, 20, 20 + jsonSize); glb.set(json, 20);
  header.setUint32(20 + jsonSize, values.length, true); header.setUint32(24 + jsonSize, 0x004e4942, true);
  glb.set(values, 28 + jsonSize);
  return { glb, weights, joints };
}

describe("native source float skin loading", () => {
  it("replaces portable weights with exact original floats and duplicate influences before the container resolves", async () => {
    const engine = new NullEngine(), scene = new Scene(engine);
    try {
      const source = fixture();
      const container = await LoadAssetContainerAsync(source.glb, scene, { pluginExtension: ".glb" });
      const mesh = container.meshes.find(mesh => mesh.getTotalVertices() === 3)!;
      expect(Array.from(mesh.getVerticesData(VertexBuffer.MatricesWeightsKind)!)).toEqual(Array.from(source.weights));
      expect(Array.from(mesh.getVerticesData(VertexBuffer.MatricesIndicesKind)!)).toEqual(Array.from(source.joints));
      expect(mesh.metadata.l2NativeSkinWeights.normalized).toBe(false);
      expect(mesh.metadata.l2NativeSkinWeights.minSum).toBeLessThan(1 - .00002);
      container.dispose();
    } finally { scene.dispose(); engine.dispose(); }
  });
  it("rejects a source palette index outside the native skin", async () => {
    const engine = new NullEngine(), scene = new Scene(engine);
    try {
      await expect(LoadAssetContainerAsync(fixture(true).glb, scene, { pluginExtension: ".glb" })).rejects.toThrow("invalid weight or joint");
    } finally { scene.dispose(); engine.dispose(); }
  });
});
