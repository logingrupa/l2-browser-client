import { createWebGPUEngine } from "../engine/createWebGPUEngine";
import { Scene } from "@babylonjs/core/scene";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import "@babylonjs/core/Materials/standardMaterial";
import { SceneSerializer } from "@babylonjs/core/Misc/sceneSerializer";
import { loadNativeSection } from "../scene/world/loadNativeSection";
import { sha256 } from "../assets/package/readAssetPackage";
import { readNativeCatalog } from "../assets/native/readNativeCatalog";

type JsonObject = Record<string, unknown>;
interface EncodedTexture { path: string; base64: string; sha256: string; bytes: number; }
interface TextureInput { manifestSha256: string; name: string; kind: "png" | "rgba"; base64: string; width: number; height: number; }
export type NativeEditorTextureEncoder = (input: TextureInput) => Promise<EncodedTexture>;
const object = (value: unknown): value is JsonObject => value !== null && typeof value === "object" && !Array.isArray(value);
function record(value: unknown): JsonObject {
  if (!object(value)) throw new Error("Babylon returned an invalid serialized resource.");
  return value;
}
function plain(value: unknown): unknown {
  if (ArrayBuffer.isView(value)) {
    if (value instanceof DataView) throw new Error("Unexpected serialized DataView.");
    return Array.from(value as Float32Array);
  }
  if (Array.isArray(value)) return value.map(plain);
  if (object(value)) return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, plain(child)]));
  return value;
}
function base64(bytes: Uint8Array): string {
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 16384) chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 16384)));
  return btoa(chunks.join(""));
}

function reflectWrapperForLeftHandedEditorAuthoring(wrapper: TransformNode, meshes: readonly AbstractMesh[]): void {
  wrapper.scaling.z = -1;
  for (const mesh of meshes) if (mesh instanceof Mesh) {
    mesh.metadata = { ...mesh.metadata, nativeEditorSource: { ...mesh.metadata?.nativeEditorSource, sideOrientation: mesh.sideOrientation } };
    mesh.sideOrientation = mesh.sideOrientation === 0 ? 1 : 0;
  }
}

export async function captureNativeWorld(canvas: HTMLCanvasElement, encodeTexture: NativeEditorTextureEncoder) {
  const engine = await createWebGPUEngine(canvas);
  const scene = new Scene(engine); scene.useRightHandedSystem = true;
  const controller = new AbortController();
  try {
    const section = await loadNativeSection(scene, controller.signal);
    if (!section) throw new Error("Stage the native section before importing an Editor world.");
    await scene.whenReadyAsync();
    const before = section.inspection();
    if (before.materialFailure || !before.texturesReady || !before.finiteBounds) throw new Error("Native world is not ready for authoring export.");
    const wrapper = new TransformNode("Native world · source coordinate wrapper", scene);
    wrapper.metadata = { nativeWorldRoot: { schemaVersion: 1, manifestSha256: section.manifestSha256, manifest: section.manifest } };
    const nodes = [...scene.transformNodes, ...scene.meshes];
    for (const node of nodes) if (node !== wrapper && !node.parent) node.parent = wrapper;
    for (const node of nodes) node.unfreezeWorldMatrix();
    const ids = new Map<number, string>();
    async function identity(key: string) {
      const digest = await sha256(new TextEncoder().encode(`native-editor-v1:${section!.manifestSha256}:${key}`));
      const numeric = 2 ** 48 + Number.parseInt(digest.slice(0, 12), 16);
      if (ids.has(numeric) && ids.get(numeric) !== key) throw new Error("Stable Editor identity collision.");
      ids.set(numeric, key); return { id: `native-${digest.slice(0, 24)}`, uniqueId: numeric };
    }
    const paths = new Map<TransformNode, string>();
    function nodePath(node: TransformNode): string {
      const prior = paths.get(node); if (prior) return prior;
      const parent = node.parent instanceof TransformNode ? node.parent : null;
      const siblings = nodes.filter(other => other.parent === node.parent && other.name === node.name);
      const path = `${parent ? nodePath(parent) : ""}/${node.name}[${siblings.indexOf(node)}]`;
      paths.set(node, path); return path;
    }
    for (const node of nodes) {
      const originalId = node.id;
      Object.assign(node, await identity(`node:${nodePath(node)}`));
      node.metadata = { ...node.metadata, nativeEditorSource: { originalId, originalName: node.name } };
    }
    for (const node of nodes) if (node.parent) node.metadata = { ...node.metadata, parentId: node.parent.uniqueId };
    const materials = [...new Set(scene.meshes.map(mesh => mesh.material ?? scene.defaultMaterial))];
    const textures = [...new Set(materials.flatMap(material => material.getActiveTextures()))];
    const exportedTextures = new Map<string, EncodedTexture>();
    const texturePaths = new Set<string>();
    const catalogTextures = (await readNativeCatalog(controller.signal)).textures.filter(object);
    for (const texture of textures) {
      if (!(texture instanceof Texture) || texture.isCube || texture.isRenderTarget) throw new Error(`Unsupported authored texture: ${texture.name}`);
      const name = texture.name, size = texture.getSize();
      let kind: TextureInput["kind"], encoded: string;
      if (texture instanceof RawTexture) {
        const source = catalogTextures.find(item => typeof item.assetId === "string" && item.assetId.toLowerCase() === `interlude:${name}`.toLowerCase());
        if (source) {
          if (typeof source.image !== "string" || typeof source.imageSha256 !== "string") throw new Error("Native texture provenance is incomplete.");
          const response = await fetch(source.image, { signal: controller.signal });
          if (!response.ok) throw new Error(`Native authoring texture fetch failed: ${name}`);
          const bytes = new Uint8Array(await response.arrayBuffer());
          if (bytes.length !== source.imageBytes || await sha256(bytes) !== source.imageSha256) throw new Error("Native authoring texture hash mismatch.");
          kind = "png"; encoded = base64(bytes);
        } else {
          const loaderRetainedMaskPixels = texture.getInternalTexture()?._bufferView;
          if (!(loaderRetainedMaskPixels instanceof Uint8Array) || loaderRetainedMaskPixels.length !== size.width * size.height * 4) throw new Error(`Unpreserved raw texture: ${name}`);
          kind = "rgba"; encoded = base64(loaderRetainedMaskPixels);
        }
      } else {
        const serialized = record(texture.serialize() as unknown);
        const source: unknown = serialized.base64String;
        if (typeof source !== "string" || !source.startsWith("data:image/png;base64,")) throw new Error(`Expected retained embedded PNG: ${name}`);
        kind = "png"; encoded = source.slice("data:image/png;base64,".length);
      }
      const exported = await encodeTexture({ manifestSha256: section.manifestSha256, name, kind, base64: encoded, ...size });
      exportedTextures.set(exported.path, exported); texturePaths.add(exported.path);
      texture.name = exported.path;
      texture.metadata = { ...texture.metadata, nativeEditorSourceName: name };
    }
    for (const [index, material] of materials.entries()) {
      material.metadata = { ...material.metadata, nativeEditorSource: { originalId: material.id, originalName: material.name } };
      Object.assign(material, await identity(`material:${material.name}:${index}`));
    }
    const geometryKeys = new Map<object, string>();
    for (const mesh of scene.meshes) if (mesh instanceof Mesh && mesh.geometry && !geometryKeys.has(mesh.geometry)) {
      const key = `geometry:${nodePath(mesh)}`;
      geometryKeys.set(mesh.geometry, key); Object.assign(mesh.geometry, await identity(key));
    }
    function normalizeTextureReferences(value: unknown): void {
      if (Array.isArray(value)) { value.forEach(normalizeTextureReferences); return; }
      if (!object(value)) return;
      if (typeof value.name === "string" && texturePaths.has(value.name) && "samplingMode" in value) {
        value.url = value.name; delete value.base64String; delete value.internalTextureUniqueId;
      }
      Object.values(value).forEach(normalizeTextureReferences);
    }
    reflectWrapperForLeftHandedEditorAuthoring(wrapper, scene.meshes);
    const center = section.minimum.add(section.maximum).scale(.5); center.z *= -1;
    const radius = section.maximum.subtract(section.minimum).length() * .8;
    const free = new FreeCamera("Export camera calculation", center.add(new Vector3(radius * .55, radius * .55, radius * .55)), scene);
    scene.useRightHandedSystem = false; free.setTarget(center);
    const worldTarget = section.spawnCandidate!.add(new Vector3(.6, .35, 0)); worldTarget.z *= -1;
    const alpha = 1.8, beta = 1.15, worldRadius = 4.25;
    const authoringCamera = {
      editor: { position: free.position.asArray(), rotation: free.rotation.asArray(), minZ: .05, maxZ: 4000 },
      world: { target: worldTarget.asArray(), alpha, beta, radius: worldRadius, minZ: .03, maxZ: 4000,
        position: worldTarget.add(new Vector3(Math.cos(alpha) * Math.sin(beta), Math.cos(beta), Math.sin(alpha) * Math.sin(beta)).scale(worldRadius)).asArray() },
    };
    free.dispose(); scene.useRightHandedSystem = true;
    const serializeBuffers = Texture.SerializeBuffers;
    Texture.SerializeBuffers = false;
    try {
      const meshes = scene.meshes.map(mesh => {
        if (!(mesh instanceof Mesh)) throw new Error("Native authoring requires explicit mesh resources.");
        SceneSerializer.ClearCache();
        const data = record(plain(SceneSerializer.SerializeMesh(mesh, false, false) as unknown));
        data.basePoseMatrix = Array.from(mesh.getPoseMatrix().asArray());
        normalizeTextureReferences(data); return data;
      });
      const serializedNodes = scene.transformNodes.map(node => record(plain(node.serialize() as unknown)));
      return { schemaVersion: 1 as const, kind: "native-editor-world-snapshot" as const,
        manifestSha256: section.manifestSha256, manifest: section.manifest, nodes: serializedNodes, meshes,
        textures: [...exportedTextures.values()], inspection: before, authoringCamera,
        stableIds: [...ids].map(([uniqueId, key]) => ({ uniqueId, key })),
        bounds: { minimum: section.minimum.asArray(), maximum: section.maximum.asArray() },
        spawn: section.spawnCandidate?.asArray() ?? null };
    } finally { Texture.SerializeBuffers = serializeBuffers; }
  } finally { controller.abort(); scene.dispose(); engine.dispose(); }
}
