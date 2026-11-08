import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import { GLTFLoaderAnimationStartMode } from "@babylonjs/loaders/glTF/glTFFileLoader";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { AssetContainer, InstantiatedEntries } from "@babylonjs/core/assetContainer";
import type { Scene } from "@babylonjs/core/scene";
import "@babylonjs/loaders/glTF";
import { sha256 } from "../../assets/package/readAssetPackage";
import { nativeResourceUrl } from "../../assets/native/nativeResourceUrl";
import { readNativeCatalogUnlessNotStaged } from "../../assets/native/readNativeCatalog";
import { validateSectionGlb } from "./loadNativeSection";
import { moverObject, nativeMoverMapSha256, parseNativeMoverManifest, type MoverResource } from "./nativeMoverManifest";
import { NativeMover } from "./nativeMovers";

export interface NativeMovers {
  readonly targets: readonly NativeMover[];
  readonly collisionMeshes: readonly AbstractMesh[];
  readonly manifestSha256: string;
  dispose(): void;
}
export async function loadNativeMovers(scene: Scene, terrainSha256: string, signal: AbortSignal): Promise<NativeMovers | null> {
  const lifetime = new AbortController(), templates: AssetContainer[] = [], copies: InstantiatedEntries[] = [];
  const roots: TransformNode[] = [];
  let disposed = false;
  const dispose = () => {
    if (disposed) return; disposed = true; lifetime.abort(); signal.removeEventListener("abort", dispose);
    scene.onDisposeObservable.remove(observer);
    for (const copy of copies.reverse()) copy.dispose();
    for (const root of roots) root.dispose();
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
    const targets: NativeMover[] = [];
    for (const source of manifest.movers) {
      const root = new TransformNode(source.id, scene); roots.push(root); root.doNotSerialize = true;
      root.metadata = { nativeMover: { id: source.id, serverObject: source.serverObject }, runtimeOnly: true };
      const before = new Set([...scene.meshes, ...scene.transformNodes]);
      let copy: InstantiatedEntries;
      try { copy = models.get(source.modelId)!.instantiateModelsToScene(name => `${source.id}:${name}`, false, { doNotInstantiate: true }); }
      catch (error) {
        for (const node of [...scene.meshes, ...scene.transformNodes]) if (!before.has(node)) node.dispose();
        throw error;
      }
      copies.push(copy);
      for (const node of copy.rootNodes) node.parent = root;
      const meshes = root.getChildMeshes().filter((mesh): mesh is Mesh => mesh instanceof Mesh && mesh.getTotalVertices() > 0);
      if (!meshes.length) throw new Error("Native mover model has no geometry.");
      for (const mesh of meshes) {
        mesh.doNotSerialize = true; mesh.isPickable = true;
        mesh.metadata = { ...mesh.metadata, nativeMoverId: source.id, worldCollision: true, worldSupportsWalking: false };
      }
      targets.push(new NativeMover(source, root, meshes));
    }
    lifetime.signal.throwIfAborted();
    return { targets, collisionMeshes: targets.flatMap(target => [...target.meshes]), manifestSha256: record.manifestSha256, dispose };
  } catch (error) { dispose(); throw error; }
}
