import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { AssetContainer, InstantiatedEntries } from "@babylonjs/core/assetContainer";
import type { Scene } from "@babylonjs/core/scene";
import type { NativeMoverRecord } from "./nativeMoverManifest";
import { NativeMover } from "./nativeMovers";

export type MarkMoverCollisionMeshes = (meshes: readonly Mesh[], mover: NativeMoverRecord) => void;

export interface NativeMoverTargets {
  readonly targets: readonly NativeMover[];
  dispose(): void;
}

export function createNativeMoverTargets(scene: Scene, templates: ReadonlyMap<string, AssetContainer>, movers: readonly NativeMoverRecord[],
  markMoverCollisionMeshes: MarkMoverCollisionMeshes): NativeMoverTargets {
  const copies: InstantiatedEntries[] = [], roots: TransformNode[] = [], targets: NativeMover[] = [];
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const copy of copies.reverse()) copy.dispose();
    for (const root of roots) root.dispose();
  };
  try {
    for (const source of movers) {
      const template = templates.get(source.modelId);
      if (!template) throw new Error(`Native mover ${source.id} names model ${source.modelId}, which was not loaded.`);
      const root = new TransformNode(source.id, scene); roots.push(root); root.doNotSerialize = true;
      root.metadata = { nativeMover: { id: source.id, serverObject: source.serverObject }, runtimeOnly: true };
      const before = new Set([...scene.meshes, ...scene.transformNodes]);
      let copy: InstantiatedEntries;
      try { copy = template.instantiateModelsToScene(name => `${source.id}:${name}`, false, { doNotInstantiate: true }); }
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
        mesh.metadata = { ...mesh.metadata, nativeMoverId: source.id };
      }
      markMoverCollisionMeshes(meshes, source);
      targets.push(new NativeMover(source, root, meshes));
    }
  } catch (error) { dispose(); throw error; }
  return { targets, dispose };
}
