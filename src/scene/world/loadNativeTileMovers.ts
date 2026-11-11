import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { AssetContainer } from "@babylonjs/core/assetContainer";
import type { Scene } from "@babylonjs/core/scene";
import { fetchVerifiedNativeResource } from "../../assets/native/fetchVerifiedNativeResource";
import { decodeNativeJsonResource, loadNativeGlbContainer } from "./loadNativeSection";
import type { NativeMovers } from "./loadNativeMovers";
import { parseNativeTileMoverManifest, type NativeTileMoverManifest } from "./nativeMoverManifest";
import { createNativeMoverTargets, type NativeMoverTargets } from "./nativeMoverTargets";
import type { NativeTileResource } from "./nativeTileManifest";

export interface NativeTileMovers extends NativeMovers {
  readonly manifest: NativeTileMoverManifest;
}

function leaveTileMoverMeshesOutOfCollision(meshes: readonly Mesh[]): void {
  for (const mesh of meshes) mesh.metadata = { ...mesh.metadata, worldSupportsWalking: false };
}

export async function loadNativeTileMovers(scene: Scene, moverResource: NativeTileResource, signal: AbortSignal): Promise<NativeTileMovers> {
  if (moverResource.kind !== "movers") throw new Error(`Native tile resource ${moverResource.manifest} is not a movers resource.`);
  const templates = new Map<string, AssetContainer>();
  let moverTargets: NativeMoverTargets | null = null;
  const dispose = () => {
    moverTargets?.dispose(); moverTargets = null;
    for (const template of templates.values()) template.dispose();
    templates.clear();
  };
  try {
    const manifest = parseNativeTileMoverManifest(decodeNativeJsonResource(
      await fetchVerifiedNativeResource(moverResource.manifest, moverResource.manifestSha256, signal, moverResource.manifestBytes), "Native tile mover manifest"));
    for (const model of manifest.models) {
      const glb = await fetchVerifiedNativeResource(model.model.resource, model.model.sha256, signal, model.model.bytes);
      const container = await loadNativeGlbContainer(scene, model.model.resource, glb);
      templates.set(model.id, container);
      signal.throwIfAborted();
      if (container.skeletons.length || container.animationGroups.length) throw new Error(`Native tile mover model ${model.id} must be rigid source geometry.`);
    }
    moverTargets = createNativeMoverTargets(scene, templates, manifest.movers, leaveTileMoverMeshesOutOfCollision);
    return { manifest, manifestSha256: moverResource.manifestSha256, targets: moverTargets.targets, dispose };
  } catch (error) { dispose(); throw error; }
}
