import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AssetContainer } from "@babylonjs/core/assetContainer";
import { findCharacterClips, type CharacterClips } from "../animation/ModelAnimator";
import type { CharacterModelProfile } from "./characterProfiles";

export interface CharacterBounds {
  readonly minimum: Vector3;
  readonly maximum: Vector3;
  readonly labelHeight: number;
  readonly selectionRadius: number;
  readonly pickingHeight: number;
}

export interface PreparedCharacterModel {
  readonly clips: CharacterClips;
  readonly bounds: CharacterBounds;
  readonly root: TransformNode;
  dispose(): void;
}

/** Owns failure cleanup; successful assets remain owned by CharacterVisual. */
export function prepareCharacterModel(
  container: AssetContainer, parent: TransformNode, entityId: string, profile?: CharacterModelProfile,
): PreparedCharacterModel {
  let modelRoot: TransformNode | undefined;
  let isDisposed = false;
  const dispose = (): void => {
    if (isDisposed) return;
    isDisposed = true;
    container.dispose();
    modelRoot?.dispose();
  };
  try {
    const clips = findCharacterClips(container.animationGroups, profile?.animations);
    if (!clips) throw new Error(`Model needs idle, run and attack clips matching ${profile?.id ?? "its animation profile"}.`);
    const scale = profile?.metresPerUnit ?? 1;
    if (!Number.isFinite(scale) || scale <= 0) throw new Error("Model unit conversion must be positive and finite.");
    modelRoot = new TransformNode(`${entityId}:model`, parent.getScene());
    modelRoot.scaling.setAll(scale);
    modelRoot.rotation.y = profile?.facingYawRadians ?? 0;
    for (const node of [...container.meshes, ...container.transformNodes]) {
      if (!node.parent) node.parent = modelRoot;
    }
    for (const mesh of container.meshes) {
      mesh.isPickable = mesh.getTotalVertices() > 0;
      const metadata: unknown = mesh.metadata;
      mesh.metadata = {
        ...(typeof metadata === "object" && metadata !== null ? metadata : { sourceMetadata: metadata }),
        clientEntityId: entityId,
      };
      mesh.computeWorldMatrix(true);
    }
    // Bounds inform UI anchors only; preserve the authored origin and proportions.
    // Measure before parenting: the entity may already have moved while loading.
    const bounds = modelRoot.getHierarchyBoundingVectors(true);
    const size = bounds.max.subtract(bounds.min);
    if (![...bounds.min.asArray(), ...bounds.max.asArray()].every(Number.isFinite) || size.y <= 0.001) throw new Error("Model has no usable geometry.");
    const presentationBounds: CharacterBounds = {
      minimum: bounds.min.clone(), maximum: bounds.max.clone(),
      labelHeight: bounds.max.y + Math.max(0.2, size.y * 0.12),
      selectionRadius: Math.max(0.35, size.x / 2, size.z / 2) + 0.12,
      pickingHeight: bounds.min.y + size.y * 0.55,
    };
    modelRoot.parent = parent;
    container.addAllToScene();
    return { clips, root: modelRoot, bounds: presentationBounds, dispose };
  } catch (error: unknown) {
    dispose();
    throw error;
  }
}
