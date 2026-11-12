import type { Scene } from "@babylonjs/core/scene";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { NativeTileBspChunk } from "../loadNativeTileChunks";
import type { NativeModelInstance } from "../nativeModelPlacements";
import type { NativeTileChunkPlacement } from "../nativeTileChunkManifest";
import type { NativeTileManifest } from "../nativeTileManifest";
import { chunkVisibilityTargets, sceneTileViewSource } from "./babylonTileVisibilityTargets";
import { committedBspVisibilityRules } from "./bspVisibilityRules";
import { bindTileVisibility, type BoundTileVisibilityInspection, type TileVisibilityBinding, type TileVisibilityGapInspection } from "./bindTileVisibility";
import type { BspVisibilityModel } from "./core/decodeBspVisibility";
import { createTileVisibilityFrameSource } from "./core/tileVisibilityFrame";
import { loadBspVisibility } from "./loadBspVisibility";

export interface UnmappedVisibilityChunk {
  readonly chunkId: string;
  readonly reason: string;
}

export interface BoundTileVisibilityRuntimeInspection extends BoundTileVisibilityInspection {
  readonly unmappedChunks: readonly UnmappedVisibilityChunk[];
}

export type TileVisibilityRuntimeInspection = BoundTileVisibilityRuntimeInspection | TileVisibilityGapInspection;

export interface TileVisibilityChunkContents {
  readonly chunkId: string;
  readonly bspChunk: NativeTileBspChunk | null;
  readonly placements: readonly NativeModelInstance<NativeTileChunkPlacement>[];
  readonly terrainMeshes: readonly AbstractMesh[];
}

export interface AttachedTileVisibility {
  readonly binding: TileVisibilityBinding | null;
  addChunk(contents: TileVisibilityChunkContents): void;
  removeChunk(chunkId: string): void;
  inspection(): TileVisibilityRuntimeInspection;
  dispose(): void;
}

const bspVisibilityStep = "bsp-visibility";
const resourceUnlistedReason = "bsp-visibility-resource-unlisted";
const payloadInvalidReasonPrefix = "bsp-visibility-payload-invalid:";

function unboundTileVisibility(tileId: string, gap: string): AttachedTileVisibility {
  return { binding: null, addChunk() {}, removeChunk() {}, inspection: () => ({ tileId, gap, culling: false, cameraZone: -1 }), dispose() {} };
}

function unlistedResourceReason(manifest: NativeTileManifest): string {
  const row = manifest.gaps.find(gapRow => gapRow.step === bspVisibilityStep && gapRow.status !== "pass");
  return row?.reason ?? resourceUnlistedReason;
}

export async function attachTileVisibility(scene: Scene, manifest: NativeTileManifest, signal: AbortSignal): Promise<AttachedTileVisibility> {
  const resource = manifest.resources.find(entry => entry.kind === bspVisibilityStep);
  if (resource === undefined) return unboundTileVisibility(manifest.tileId, unlistedResourceReason(manifest));
  let model: BspVisibilityModel;
  try {
    model = await loadBspVisibility(resource, signal);
  } catch (error) {
    signal.throwIfAborted();
    const name = error instanceof Error ? error.name : "Error", message = error instanceof Error ? error.message : String(error);
    return unboundTileVisibility(manifest.tileId, `${payloadInvalidReasonPrefix}${name}: ${message}`);
  }
  const chunkOrdinalById = new Map(manifest.chunks.map((record, ordinal) => [record.chunkId, ordinal]));
  const binding = bindTileVisibility({ tileId: manifest.tileId, model, view: sceneTileViewSource(scene),
    frameSource: createTileVisibilityFrameSource(model, committedBspVisibilityRules.limits), limitRules: committedBspVisibilityRules.limitRules });
  const unmappedReasonByChunkId = new Map<string, string>();
  return {
    binding,
    addChunk(contents) {
      const chunkOrdinal = chunkOrdinalById.get(contents.chunkId);
      if (chunkOrdinal === undefined) throw new Error(`Native tile ${manifest.tileId} lists no chunk ${contents.chunkId}.`);
      const mapped = chunkVisibilityTargets(model, { chunkOrdinal, bspChunk: contents.bspChunk, placements: contents.placements, terrainMeshes: contents.terrainMeshes });
      if (mapped.kind === "gap") { unmappedReasonByChunkId.set(contents.chunkId, mapped.reason); return; }
      unmappedReasonByChunkId.delete(contents.chunkId);
      binding.addChunkTargets(contents.chunkId, mapped.targets);
    },
    removeChunk(chunkId) {
      unmappedReasonByChunkId.delete(chunkId);
      binding.removeChunkTargets(chunkId);
    },
    inspection: () => ({ ...binding.inspection(),
      unmappedChunks: [...unmappedReasonByChunkId].map(([chunkId, reason]) => ({ chunkId, reason })).sort((left, right) => left.chunkId < right.chunkId ? -1 : 1) }),
    dispose: () => binding.dispose(),
  };
}
