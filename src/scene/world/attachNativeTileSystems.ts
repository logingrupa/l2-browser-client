import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Scene } from "@babylonjs/core/scene";
import { attachTileVisibility, type AttachedTileVisibility } from "./bspVisibility/attachTileVisibility";
import { attachTileLighting, type AttachedTileLighting, type TileLightingChunkSurfaces } from "./lighting/attachTileLighting";
import type { NativeTileBspChunk } from "./loadNativeTileChunks";
import { loadNativeTileMovers, type NativeTileMovers } from "./loadNativeTileMovers";
import type { NativeModelInstance } from "./nativeModelPlacements";
import type { NativeTileChunkPlacement } from "./nativeTileChunkManifest";
import type { NativeTileManifest } from "./nativeTileManifest";
import { loadTileMapEmitterPlacements } from "./tileMapEmitterPlacements";
import type { ResidencyDrawLimitRule } from "./worldResidencyRing";

export interface NativeTileChunkSystemContents {
  readonly chunkId: string;
  readonly bspChunk: NativeTileBspChunk | null;
  readonly instances: readonly NativeModelInstance<NativeTileChunkPlacement>[];
  readonly terrainMeshes: readonly AbstractMesh[];
}

export interface NativeTileSystemsContents {
  readonly initialChunks: readonly NativeTileChunkSystemContents[];
  readonly drawLimitRules: readonly ResidencyDrawLimitRule[];
}

export interface AttachedNativeTileSystems {
  readonly visibility: AttachedTileVisibility;
  readonly lighting: AttachedTileLighting;
  readonly mapEmitterPlacements: Awaited<ReturnType<typeof loadTileMapEmitterPlacements>>;
  readonly movers: NativeTileMovers | null;
  readonly moverGap: string | null;
  addChunk(contents: NativeTileChunkSystemContents): Promise<void>;
  removeChunk(chunkId: string): void;
  boundChunkIds(): readonly string[];
  dispose(): void;
}

const disposedDuringLoading = () => new Error("Native tile was disposed during loading.");
const moverResourceInvalidReasonPrefix = "movers-invalid:";

function staticMeshesOf(instances: readonly NativeModelInstance<NativeTileChunkPlacement>[]): AbstractMesh[] {
  return instances.flatMap(instance => instance.root.getChildMeshes().filter(mesh => mesh.getTotalVertices() > 0));
}

export async function attachNativeTileSystems(scene: Scene, manifest: NativeTileManifest, contents: NativeTileSystemsContents, signal: AbortSignal,
  isDisposed: () => boolean): Promise<AttachedNativeTileSystems> {
  const { initialChunks, drawLimitRules } = contents;
  let visibility: AttachedTileVisibility | null = null, lighting: AttachedTileLighting | null = null, movers: NativeTileMovers | null = null;
  const dispose = () => { movers?.dispose(); visibility?.dispose(); lighting?.dispose(); };
  try {
    const attachedVisibility = await attachTileVisibility(scene, manifest, drawLimitRules, signal);
    visibility = attachedVisibility;
    if (isDisposed()) throw disposedDuringLoading();
    const chunkOrdinalById = new Map(manifest.chunks.map((record, ordinal) => [record.chunkId, ordinal]));
    const visibilityBinding = attachedVisibility.binding;
    const attachedLighting = await attachTileLighting(scene, manifest, () => visibilityBinding?.frame() ?? null, signal);
    lighting = attachedLighting;
    if (isDisposed()) throw disposedDuringLoading();
    const mapEmitterPlacements = await loadTileMapEmitterPlacements(manifest, signal);
    if (isDisposed()) throw disposedDuringLoading();
    const moverResource = manifest.resources.find(resource => resource.kind === "movers");
    let moverGap: string | null = null;
    if (moverResource) {
      try {
        movers = await loadNativeTileMovers(scene, moverResource, signal);
        if (movers.manifest.tileId !== manifest.tileId) throw new Error(`Native tile mover manifest names tile ${movers.manifest.tileId}, not ${manifest.tileId}.`);
      } catch (error) {
        signal.throwIfAborted();
        movers?.dispose(); movers = null;
        moverGap = `${moverResourceInvalidReasonPrefix}${error instanceof Error ? error.message : String(error)}`;
      }
      if (isDisposed()) throw disposedDuringLoading();
    }
    const bindingsByChunkId = new Map<string, object>();
    const lightingSurfacesOf = (contents: NativeTileChunkSystemContents): TileLightingChunkSurfaces => ({ chunkId: contents.chunkId,
      bspChunk: contents.bspChunk === null ? null : { ...contents.bspChunk, chunkOrdinal: chunkOrdinalById.get(contents.chunkId)! },
      staticMeshes: staticMeshesOf(contents.instances), terrainMeshes: contents.terrainMeshes });
    const addChunk = async (contents: NativeTileChunkSystemContents) => {
      if (bindingsByChunkId.has(contents.chunkId)) return;
      const chunkBinding = {};
      bindingsByChunkId.set(contents.chunkId, chunkBinding);
      try {
        attachedVisibility.addChunk({ chunkId: contents.chunkId, bspChunk: contents.bspChunk, placements: contents.instances, terrainMeshes: contents.terrainMeshes });
        await attachedLighting.addChunk(lightingSurfacesOf(contents));
      } catch (error) {
        if (bindingsByChunkId.get(contents.chunkId) === chunkBinding) { bindingsByChunkId.delete(contents.chunkId); attachedVisibility.removeChunk(contents.chunkId); }
        throw error;
      }
    };
    for (const contents of initialChunks) await addChunk(contents);
    if (isDisposed()) throw disposedDuringLoading();
    return { visibility: attachedVisibility, lighting: attachedLighting, mapEmitterPlacements, movers, moverGap, addChunk,
      removeChunk(chunkId) {
        if (!bindingsByChunkId.delete(chunkId)) return;
        attachedVisibility.removeChunk(chunkId);
        attachedLighting.removeChunk(chunkId);
      },
      boundChunkIds: () => [...bindingsByChunkId.keys()].sort(),
      dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}
