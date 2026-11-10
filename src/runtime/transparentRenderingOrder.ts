import type { Scene } from "@babylonjs/core/scene";
import type { SubMesh } from "@babylonjs/core/Meshes/subMesh";
import { RenderingManager } from "@babylonjs/core/Rendering/renderingManager";
import type { NativeEmitterMeshMetadata } from "../effects/particles/render/particleMaterialBinding";

const installedScenes = new WeakSet<Scene>();

function emitterOrdinalOf(subMesh: SubMesh): number | null {
  const metadata: unknown = subMesh.getMesh().metadata;
  if (typeof metadata !== "object" || metadata === null || !("nativeEmitterOrdinal" in metadata)) return null;
  const ordinal = (metadata as NativeEmitterMeshMetadata).nativeEmitterOrdinal;
  return Number.isSafeInteger(ordinal) ? ordinal : null;
}

export function compareTransparentSubMeshes(first: SubMesh, second: SubMesh): number {
  if (first._distanceToCamera !== second._distanceToCamera) return first._distanceToCamera > second._distanceToCamera ? -1 : 1;
  const firstOrdinal = emitterOrdinalOf(first), secondOrdinal = emitterOrdinalOf(second);
  if (firstOrdinal === null || secondOrdinal === null || firstOrdinal === secondOrdinal) return 0;
  return firstOrdinal < secondOrdinal ? -1 : 1;
}

export function installTransparentRenderingOrder(scene: Scene): () => void {
  if (installedScenes.has(scene)) throw new Error("This scene already has the transparent rendering order installed.");
  installedScenes.add(scene);
  const renderingGroupIds = Array.from({ length: RenderingManager.MAX_RENDERINGGROUPS - RenderingManager.MIN_RENDERINGGROUPS },
    (_, offset) => RenderingManager.MIN_RENDERINGGROUPS + offset);
  for (const renderingGroupId of renderingGroupIds) scene.setRenderingOrder(renderingGroupId, null, null, compareTransparentSubMeshes);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    installedScenes.delete(scene);
    if (scene.isDisposed) return;
    for (const renderingGroupId of renderingGroupIds) scene.setRenderingOrder(renderingGroupId, null, null, null);
  };
}
