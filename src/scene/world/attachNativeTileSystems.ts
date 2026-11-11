import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Scene } from "@babylonjs/core/scene";
import { attachTileVisibility, type AttachedTileVisibility } from "./bspVisibility/attachTileVisibility";
import { attachTileLighting, type AttachedTileLighting } from "./lighting/attachTileLighting";
import type { NativeTileBspChunk } from "./loadNativeTileChunks";
import { loadNativeTileMovers, type NativeTileMovers } from "./loadNativeTileMovers";
import type { NativeModelInstance } from "./nativeModelPlacements";
import type { NativeTileChunkPlacement } from "./nativeTileChunkManifest";
import type { NativeTileManifest } from "./nativeTileManifest";
import { loadTileMapEmitterPlacements } from "./tileMapEmitterPlacements";

export interface NativeTileSystemContents {
  readonly bspChunks: readonly NativeTileBspChunk[];
  readonly instances: readonly NativeModelInstance<NativeTileChunkPlacement>[];
  readonly terrainMeshes: readonly AbstractMesh[];
}

export interface AttachedNativeTileSystems {
  readonly visibility: AttachedTileVisibility;
  readonly lighting: AttachedTileLighting;
  readonly mapEmitterPlacements: Awaited<ReturnType<typeof loadTileMapEmitterPlacements>>;
  readonly movers: NativeTileMovers | null;
  readonly moverGap: string | null;
  dispose(): void;
}

const disposedDuringLoading = () => new Error("Native tile was disposed during loading.");
const moverResourceInvalidReasonPrefix = "movers-invalid:";

export async function attachNativeTileSystems(scene: Scene, manifest: NativeTileManifest, contents: NativeTileSystemContents, signal: AbortSignal,
  isDisposed: () => boolean): Promise<AttachedNativeTileSystems> {
  let visibility: AttachedTileVisibility | null = null, lighting: AttachedTileLighting | null = null, movers: NativeTileMovers | null = null;
  const dispose = () => { movers?.dispose(); visibility?.dispose(); lighting?.dispose(); };
  try {
    visibility = await attachTileVisibility(scene, manifest, { bspChunks: contents.bspChunks, placements: contents.instances, terrainMeshes: contents.terrainMeshes }, signal);
    if (isDisposed()) throw disposedDuringLoading();
    const chunkOrdinalById = new Map(manifest.chunks.map((record, ordinal) => [record.chunkId, ordinal]));
    const visibilityBinding = visibility.binding;
    lighting = await attachTileLighting(scene, manifest, { bspChunks: contents.bspChunks.map(chunk => ({ ...chunk, chunkOrdinal: chunkOrdinalById.get(chunk.chunkId)! })),
      staticMeshes: contents.instances.flatMap(instance => instance.root.getChildMeshes().filter(mesh => mesh.getTotalVertices() > 0)),
      terrainMeshes: contents.terrainMeshes, cameraFrame: () => visibilityBinding?.frame() ?? null }, signal);
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
    return { visibility, lighting, mapEmitterPlacements, movers, moverGap, dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}
