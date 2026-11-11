import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import { GLTFLoaderAnimationStartMode } from "@babylonjs/loaders/glTF/glTFFileLoader";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { AssetContainer } from "@babylonjs/core/assetContainer";
import type { Scene } from "@babylonjs/core/scene";
import "@babylonjs/loaders/glTF";
import { sha256 } from "../../assets/package/readAssetPackage";
import { nativeResourceUrl } from "../../assets/native/nativeResourceUrl";
import { readNativeCatalogUnlessNotStaged } from "../../assets/native/readNativeCatalog";
import { validateSectionGlb } from "./loadNativeSection";
import { moverObject, nativeMoverMapSha256, parseNativeMoverManifest, type MoverResource } from "./nativeMoverManifest";
import { createNativeMoverTargets, type NativeMoverTargets } from "./nativeMoverTargets";
import type { NativeMover } from "./nativeMovers";

export interface NativeMovers {
  readonly targets: readonly NativeMover[];
  readonly manifestSha256: string;
  dispose(): void;
}
function markCatalogMoverCollisionMeshes(meshes: readonly Mesh[]): void {
  for (const mesh of meshes) mesh.metadata = { ...mesh.metadata, worldCollision: true, worldSupportsWalking: false };
}
export async function loadNativeMovers(scene: Scene, terrainSha256: string, signal: AbortSignal): Promise<NativeMovers | null> {
  const lifetime = new AbortController(), templates: AssetContainer[] = [];
  let moverTargets: NativeMoverTargets | null = null;
  let disposed = false;
  const dispose = () => {
    if (disposed) return; disposed = true; lifetime.abort(); signal.removeEventListener("abort", dispose);
    scene.onDisposeObservable.remove(observer);
    moverTargets?.dispose();
    for (const template of templates.reverse()) template.dispose();
  };
  const observer = scene.onDisposeObservable.addOnce(dispose);
  signal.addEventListener("abort", dispose, { once: true });
  async function verified(path: string, record: Pick<MoverResource, "sha256"> & { bytes?: number }): Promise<Uint8Array<ArrayBuffer>> {
    const response = await fetch(nativeResourceUrl(path), { signal: lifetime.signal });
    if (!response.ok) throw new Error(`Native mover resource returned HTTP ${response.status}.`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if ((record.bytes !== undefined && bytes.length !== record.bytes) || bytes.length > 128 * 1024 * 1024 || await sha256(bytes) !== record.sha256) {
      throw new Error("Native mover resource identity differs from its manifest.");
    }
    lifetime.signal.throwIfAborted(); return bytes;
  }
  try {
    signal.throwIfAborted();
    const catalog = await readNativeCatalogUnlessNotStaged(lifetime.signal);
    if (!catalog || !catalog.movers.length) { dispose(); return null; }
    if (catalog.movers.length > 32) throw new Error("Native mover catalog scope is invalid.");
    const ids = new Set<string>();
    const matching = catalog.movers.filter(record => {
      if (!moverObject(record) || typeof record.id !== "string" || !/^[a-z0-9-]{1,80}$/.test(record.id) || ids.has(record.id) ||
        typeof record.manifestSha256 !== "string" || !/^[a-f0-9]{64}$/.test(record.manifestSha256) ||
        record.manifest !== `/l2/movers/${record.manifestSha256}/movers.json` ||
        typeof record.terrainSha256 !== "string" || !/^[a-f0-9]{64}$/.test(record.terrainSha256) || record.sourceMapSha256 !== nativeMoverMapSha256) {
        throw new Error("Native mover catalog identity is invalid.");
      }
      ids.add(record.id); return record.terrainSha256 === terrainSha256;
    });
    if (!matching.length) { dispose(); return null; }
    if (matching.length !== 1) throw new Error("Native mover catalog has ambiguous terrain bindings.");
    const record = matching[0] as { manifest: string; manifestSha256: string };
    const manifest = parseNativeMoverManifest(JSON.parse(new TextDecoder().decode(await verified(record.manifest, { sha256: record.manifestSha256 }))));
    const base = `/l2/movers/${record.manifestSha256}/`, models = new Map<string, AssetContainer>();
    for (const model of manifest.models) {
      const bytes = await verified(base + model.model.file, model.model); validateSectionGlb(bytes);
      const container = await LoadAssetContainerAsync(bytes, scene, { pluginExtension: ".glb", name: "native-mover.glb",
        pluginOptions: { gltf: { animationStartMode: GLTFLoaderAnimationStartMode.NONE } } });
      if (lifetime.signal.aborted) { container.dispose(); lifetime.signal.throwIfAborted(); }
      templates.push(container);
      if (container.skeletons.length || container.animationGroups.length) throw new Error("Native mover model must be rigid source geometry.");
      models.set(model.id, container);
    }
    moverTargets = createNativeMoverTargets(scene, models, manifest.movers, markCatalogMoverCollisionMeshes);
    const targets = moverTargets.targets;
    lifetime.signal.throwIfAborted();
    return { targets, manifestSha256: record.manifestSha256, dispose };
  } catch (error) { dispose(); throw error; }
}
