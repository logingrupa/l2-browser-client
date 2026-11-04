import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { AssetContainer } from "@babylonjs/core/assetContainer";
import { findCharacterClips, type CharacterClips } from "../animation/ModelAnimator";

/** Owns failure cleanup; successful assets remain owned by CharacterVisual. */
export function prepareCharacterModel(
  container: AssetContainer, parent: TransformNode, entityId: string,
): CharacterClips {
  let modelRoot: TransformNode | undefined;
  try {
    const clips = findCharacterClips(container.animationGroups);
    if (!clips) throw new Error("Model needs idle, run and attack clips.");
    modelRoot = new TransformNode(`${entityId}:model`, parent.getScene());
    for (const node of [...container.meshes, ...container.transformNodes]) {
      if (!node.parent) node.parent = modelRoot;
    }
    for (const mesh of container.meshes) {
      mesh.isPickable = true;
      mesh.metadata = { entityId };
      mesh.computeWorldMatrix(true);
    }
    // Measure before parenting: the entity may already have moved while loading.
    const bounds = modelRoot.getHierarchyBoundingVectors(true);
    const height = bounds.max.y - bounds.min.y;
    if (!Number.isFinite(height) || height <= 0.001) throw new Error("Model has no usable geometry.");
    const scale = 1.8 / height;
    modelRoot.scaling.setAll(scale);
    modelRoot.position.set(
      -(bounds.min.x + bounds.max.x) * scale / 2,
      -bounds.min.y * scale,
      -(bounds.min.z + bounds.max.z) * scale / 2,
    );
    modelRoot.parent = parent;
    container.addAllToScene();
    return clips;
  } catch (error: unknown) {
    container.dispose();
    modelRoot?.dispose();
    throw error;
  }
}
