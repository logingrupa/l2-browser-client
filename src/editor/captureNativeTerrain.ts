import { Scene } from "@babylonjs/core/scene";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import { SceneSerializer } from "@babylonjs/core/Misc/sceneSerializer";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { GLTFLoaderAnimationStartMode } from "@babylonjs/loaders/glTF/glTFFileLoader";
import "@babylonjs/loaders/glTF";
import { createWebGPUEngine } from "../engine/createWebGPUEngine";
import { sha256 } from "../assets/package/readAssetPackage";
import { validateSectionGlb } from "../scene/world/loadNativeSection";
import { parseNativeTerrainPatches, validateSourceTerrainPatch, type NativeTerrainPatch } from "../scene/world/nativeTerrainPatch";

type Json = Record<string, unknown>;
const object = (value: unknown): value is Json => value !== null && typeof value === "object" && !Array.isArray(value);
function record(value: unknown): Json { if (!object(value)) throw Error("Invalid serialized terrain data."); return value; }
function plain(value: unknown): unknown {
  if (ArrayBuffer.isView(value)) {
    if (value instanceof DataView) throw Error("Unexpected serialized DataView.");
    return Array.from(value as Float32Array);
  }
  if (Array.isArray(value)) return value.map(plain);
  return object(value) ? Object.fromEntries(Object.entries(value).map(([key, child]) => [key, plain(child)])) : value;
}
function base64(data: Uint8Array): string {
  const chunks: string[] = [];
  for (let i = 0; i < data.length; i += 16384) chunks.push(String.fromCharCode(...data.subarray(i, i + 16384)));
  return btoa(chunks.join(""));
}
interface Input { baseManifestSha256: string; nativeTerrainPatch: NativeTerrainPatch; modelBase64: string; }

/** Capture only the qualified added mesh. The appender preserves the current
 * saved material rather than importing this inspection material into Editor. */
export async function captureNativeTerrain(canvas: HTMLCanvasElement, input: Input) {
  if (!/^[a-f0-9]{64}$/.test(input.baseManifestSha256)) throw Error("Invalid base manifest identity.");
  const descriptor = parseNativeTerrainPatches([input.nativeTerrainPatch])[0]!;
  const bytes = Uint8Array.from(atob(input.modelBase64), value => value.charCodeAt(0));
  if (bytes.length !== descriptor.model.bytes || await sha256(bytes) !== descriptor.model.sha256) throw Error("Terrain source bytes differ.");
  const gltf = validateSectionGlb(bytes);
  const engine = await createWebGPUEngine(canvas), scene = new Scene(engine);
  scene.useRightHandedSystem = true;
  try {
    const container = await LoadAssetContainerAsync(new File([bytes], "terrain247.glb"), scene,
      { pluginOptions: { gltf: { animationStartMode: GLTFLoaderAnimationStartMode.NONE } } });
    container.addAllToScene();
    if (container.skeletons.length || container.animationGroups.length) throw Error("Terrain patch cannot contain animation or skeletons.");
    const meshes = container.meshes.filter(mesh => mesh.getTotalVertices() > 0);
    if (meshes.length !== 1 || !(meshes[0] instanceof Mesh)) throw Error("Expected one terrain Mesh.");
    const mesh = meshes[0];
    const sourceMesh = Array.isArray(gltf.meshes) ? gltf.meshes[0] : undefined;
    if (!object(sourceMesh) || !object(sourceMesh.extras) || !Array.isArray(sourceMesh.extras.nativeLayers)) throw Error("Terrain source extras missing.");
    mesh.metadata = { ...mesh.metadata, gltf: { ...mesh.metadata?.gltf, extras: structuredClone(sourceMesh.extras) } };
    validateSourceTerrainPatch([mesh], descriptor);
    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    for (let parent = mesh.parent; parent; parent = parent.parent) {
      if (!parent.getWorldMatrix().asArray().every((value, i) => value === identity[i])) throw Error("Nonidentity terrain ancestor.");
    }
    mesh.parent = null;
    await scene.whenReadyAsync();
    SceneSerializer.ClearCache();
    const serialized = record(plain(SceneSerializer.SerializeMesh(mesh, false, false)));
    const records = serialized.meshes;
    const geometry = record(serialized.geometries).vertexData;
    if (!Array.isArray(records) || records.length !== 1 || !Array.isArray(geometry) || geometry.length !== 1) {
      throw Error("Terrain serialization did not preserve one inline geometry.");
    }
    const channels = record(geometry[0]), channelBytes: Record<string, string> = {};
    for (const name of ["positions", "normals", "uvs", "uvs2", "indices"]) {
      const values = channels[name];
      if (!Array.isArray(values) || values.some(value => typeof value !== "number" || !Number.isFinite(value))) throw Error("Missing terrain channel: " + name);
      const raw = name === "indices" ? new Int32Array(values as number[]) : new Float32Array(values as number[]);
      channelBytes[name] = base64(new Uint8Array(raw.buffer));
    }
    channels.channelBytes = channelBytes;
    delete serialized.materials;
    delete serialized.multiMaterials;
    return { schemaVersion: 1, kind: "native-editor-terrain-snapshot", baseManifestSha256: input.baseManifestSha256,
      nativeTerrainPatch: descriptor, mesh: serialized,
      capture: { babylon: "9.27.1", engine: engine.name, isWebGPU: engine.isWebGPU,
        renderer: engine.getInfo(), sourceModelSha256: descriptor.model.sha256,
        savedMaterialPolicy: "Bind the existing authored material only in the guarded appender." } };
  } finally { scene.dispose(); engine.dispose(); }
}
