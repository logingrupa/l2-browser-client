import { Matrix } from "@babylonjs/core/Maths/math.vector";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { AssetContainer, InstantiatedEntries } from "@babylonjs/core/assetContainer";
import type { Scene } from "@babylonjs/core/scene";

export interface NativeModelPlacement {
  readonly id: string;
  readonly modelId: string;
  readonly sourceMesh: string;
  readonly matrix: readonly number[];
}

export interface NativeModelInstance<Placement extends NativeModelPlacement = NativeModelPlacement> {
  readonly source: Placement;
  readonly root: TransformNode;
  readonly copy: InstantiatedEntries;
}

function sceneNodes(scene: Scene): ReadonlySet<unknown> {
  return new Set<unknown>([...scene.meshes, ...scene.transformNodes, ...scene.skeletons, ...scene.animationGroups]);
}

function disposeSceneNodesCreatedAfter(scene: Scene, existingNodes: ReadonlySet<unknown>): void {
  for (const created of [...scene.meshes, ...scene.transformNodes, ...scene.skeletons, ...scene.animationGroups]) {
    if (!existingNodes.has(created)) created.dispose();
  }
}

export function disposeNativeModelInstances(instances: readonly NativeModelInstance[]): void {
  for (const instance of instances) { instance.copy.dispose(); instance.root.dispose(); }
}

export function instantiateNativeModelPlacements<Placement extends NativeModelPlacement>(
  scene: Scene, templates: ReadonlyMap<string, AssetContainer>, placements: readonly Placement[],
): NativeModelInstance<Placement>[] {
  const nodesBeforeInstancing = sceneNodes(scene);
  const instances: NativeModelInstance<Placement>[] = [];
  try {
    for (const placement of placements) {
      const template = templates.get(placement.modelId);
      if (!template) throw new Error(`Native placement ${placement.id} names model ${placement.modelId}, which is not loaded.`);
      const root = new TransformNode(placement.id, scene);
      const copy = template.instantiateModelsToScene(name => name, false, { doNotInstantiate: true });
      instances.push({ source: placement, root, copy });
      root.metadata = { nativePlacement: placement };
      root.setPreTransformMatrix(Matrix.FromArray(placement.matrix));
      for (const node of copy.rootNodes) node.parent = root;
      root.computeWorldMatrix(true); root.freezeWorldMatrix();
    }
  } catch (error) {
    disposeNativeModelInstances(instances);
    disposeSceneNodesCreatedAfter(scene, nodesBeforeInstancing);
    throw error;
  }
  return instances;
}
