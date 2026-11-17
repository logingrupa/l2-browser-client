import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AssetContainer } from "@babylonjs/core/assetContainer";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { GLTFLoaderAnimationStartMode } from "@babylonjs/loaders/glTF/glTFFileLoader";
import "@babylonjs/loaders/glTF";

const meshTransformColumnMajor = [-1.8920793046826606e-16, 0, -1.03, 0, 0, 1.03, 0, 0, 1.03, 0, -1.8920793046826606e-16, 0, 0, -0.25956, 0, 1];
const headBindTranslation = [0, 0.4, 0] as const;
const keyTimesSeconds = [0, 1, 2, 3, 4, 5].map(key => key / 3);
const keyRotationRadians = (key: number) => 0.1 * key;
const framesPerSecond = 60;
const faceVertex = [0.02, 0.43, 0.01] as const, hairVertex = [0.01, 0.45, 0.02] as const;

function rotationAboutZ(radians: number): [number, number, number, number] {
  return [0, 0, Math.sin(radians / 2), Math.cos(radians / 2)];
}

function rigidHeadGlb(): Uint8Array<ArrayBuffer> {
  const bytes: number[] = [], bufferViews: Record<string, unknown>[] = [], accessors: Record<string, unknown>[] = [];
  function accessor(values: Float32Array | Uint8Array, type: string, width: number, extra: Record<string, unknown> = {}) {
    while (bytes.length % 4) bytes.push(0);
    bufferViews.push({ buffer: 0, byteOffset: bytes.length, byteLength: values.byteLength });
    bytes.push(...new Uint8Array(values.buffer, values.byteOffset, values.byteLength));
    accessors.push({ bufferView: bufferViews.length - 1, componentType: values instanceof Float32Array ? 5126 : 5121, count: values.length / width, type, ...extra });
    return accessors.length - 1;
  }
  const triangle = (vertex: readonly number[]) => accessor(new Float32Array([...vertex, vertex[0]! + 0.01, vertex[1]!, vertex[2]!, vertex[0]!, vertex[1]! + 0.01, vertex[2]!]),
    "VEC3", 3, { min: [vertex[0], vertex[1], vertex[2]], max: [vertex[0]! + 0.01, vertex[1]! + 0.01, vertex[2]] });
  const facePositions = triangle(faceVertex), hairPositions = triangle(hairVertex);
  const joints = accessor(new Uint8Array(12), "VEC4", 4);
  const weights = accessor(new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]), "VEC4", 4);
  const headInverseBind = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -headBindTranslation[0], -headBindTranslation[1], -headBindTranslation[2], 1];
  const selectedRootInverseBind = accessor(new Float32Array(headInverseBind), "MAT4", 16);
  const times = accessor(new Float32Array(keyTimesSeconds), "SCALAR", 1, { min: [0], max: [keyTimesSeconds.at(-1)] });
  const rotations = accessor(new Float32Array(keyTimesSeconds.flatMap((_, key) => rotationAboutZ(keyRotationRadians(key)))), "VEC4", 4);
  const doc = {
    asset: { version: "2.0" }, scene: 0, scenes: [{ nodes: [0, 1, 2] }], buffers: [{ byteLength: bytes.length }], bufferViews, accessors,
    nodes: [{ name: "Face", mesh: 0, skin: 0 }, { name: "Hair", mesh: 1, skin: 1 },
      { name: "NativeMeshOriginRotationScale", matrix: meshTransformColumnMajor, children: [3] },
      { name: "Bip01", children: [4] }, { name: "Bip01_head", translation: [...headBindTranslation] }],
    meshes: [{ name: "Face", primitives: [{ attributes: { POSITION: facePositions, JOINTS_0: joints, WEIGHTS_0: weights } }] },
      { name: "Hair", primitives: [{ attributes: { POSITION: hairPositions, JOINTS_0: joints, WEIGHTS_0: weights } }] }],
    skins: [{ joints: [4], inverseBindMatrices: selectedRootInverseBind }, { joints: [4], inverseBindMatrices: selectedRootInverseBind }],
    animations: [{ name: "Wait", samplers: [{ input: times, output: rotations, interpolation: "LINEAR" }], channels: [{ sampler: 0, target: { node: 4, path: "rotation" } }] }],
  };
  const json = new TextEncoder().encode(JSON.stringify(doc)), padded = Math.ceil(json.length / 4) * 4;
  while (bytes.length % 4) bytes.push(0);
  const glb = new Uint8Array(28 + padded + bytes.length), header = new DataView(glb.buffer);
  header.setUint32(0, 0x46546c67, true); header.setUint32(4, 2, true); header.setUint32(8, glb.length, true);
  header.setUint32(12, padded, true); header.setUint32(16, 0x4e4f534a, true);
  glb.fill(32, 20, 20 + padded); glb.set(json, 20);
  header.setUint32(20 + padded, bytes.length, true); header.setUint32(24 + padded, 0x004e4942, true); glb.set(bytes, 28 + padded);
  return glb;
}

function pipelineWorldVertex(vertex: readonly number[], key: number): Vector3 {
  const meshTransform = Matrix.FromArray(meshTransformColumnMajor);
  const headWorld = Matrix.Compose(Vector3.One(), Quaternion.FromArray(rotationAboutZ(keyRotationRadians(key))), Vector3.FromArray([...headBindTranslation]));
  const inverseBind = Matrix.Translation(-headBindTranslation[0], -headBindTranslation[1], -headBindTranslation[2]);
  return Vector3.TransformCoordinates(Vector3.FromArray([...vertex]), inverseBind.multiply(headWorld).multiply(meshTransform));
}

function skinnedWorldVertex(container: AssetContainer, meshName: string): Vector3 {
  const mesh = container.meshes.find(candidate => candidate.name === meshName) as Mesh;
  container.transformNodes.forEach(node => node.computeWorldMatrix(true));
  mesh.skeleton!.prepare(true);
  const world = mesh.computeWorldMatrix(true);
  const positions = mesh.getPositionData(true)!;
  return Vector3.TransformCoordinates(Vector3.FromArray(positions, 0), world);
}

describe("a rigid hair skin whose single joint lives in the root face hierarchy", () => {
  let engine: NullEngine, scene: Scene;
  beforeEach(() => { engine = new NullEngine(); scene = new Scene(engine); scene.useRightHandedSystem = true; });
  afterEach(() => { scene.dispose(); engine.dispose(); });

  it("lands each vertex on the root head joint world x root inverse bind at keys 0 and 5", async () => {
    const container = await LoadAssetContainerAsync(rigidHeadGlb(), scene, { pluginExtension: ".glb",
      pluginOptions: { gltf: { animationStartMode: GLTFLoaderAnimationStartMode.NONE } } });
    container.addAllToScene();
    const [wait] = container.animationGroups;
    for (const key of [0, 5]) {
      wait!.start(false); wait!.goToFrame(keyTimesSeconds[key]! * framesPerSecond); wait!.pause();
      for (const [meshName, vertex] of [["Face", faceVertex], ["Hair", hairVertex]] as const) {
        const landed = skinnedWorldVertex(container, meshName), expected = pipelineWorldVertex(vertex, key);
        expect(Vector3.Distance(landed, expected), `${meshName} key ${key}`).toBeLessThan(1e-6);
      }
    }
    expect(Vector3.Distance(pipelineWorldVertex(hairVertex, 5), pipelineWorldVertex(hairVertex, 0))).toBeGreaterThan(1e-3);
  });
});
