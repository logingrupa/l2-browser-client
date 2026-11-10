import type { Scene } from "@babylonjs/core/scene";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { NativeTileBspChunk } from "../loadNativeTileChunks";
import type { NativeModelInstance } from "../nativeModelPlacements";
import type { NativeTileChunkPlacement } from "../nativeTileChunkManifest";
import type { NativeTileManifest } from "../nativeTileManifest";
import { sceneTileViewSource, tileVisibilityTargets } from "./babylonTileVisibilityTargets";
import { committedBspVisibilityRules } from "./bspVisibilityRules";
import { bindTileVisibility, type TileVisibilityBinding, type TileVisibilityInspection } from "./bindTileVisibility";
import type { BspVisibilityModel } from "./core/decodeBspVisibility";
import { createTileVisibilityFrameSource } from "./core/tileVisibilityFrame";
import { loadBspVisibility } from "./loadBspVisibility";

export interface AttachedTileVisibility {
  readonly binding: TileVisibilityBinding | null;
  inspection(): TileVisibilityInspection;
  dispose(): void;
}

const bspVisibilityStep = "bsp-visibility";
const resourceUnlistedReason = "bsp-visibility-resource-unlisted";
const payloadInvalidReasonPrefix = "bsp-visibility-payload-invalid:";

function unboundTileVisibility(tileId: string, gap: string): AttachedTileVisibility {
  return { binding: null, inspection: () => ({ tileId, gap, culling: false, cameraZone: -1 }), dispose() {} };
}

function unlistedResourceReason(manifest: NativeTileManifest): string {
  const row = manifest.gaps.find(gapRow => gapRow.step === bspVisibilityStep && gapRow.status !== "pass");
  return row?.reason ?? resourceUnlistedReason;
}

export interface TileVisibilityContents {
  readonly bspChunks: readonly NativeTileBspChunk[];
  readonly placements: readonly NativeModelInstance<NativeTileChunkPlacement>[];
  readonly terrainMeshes: readonly AbstractMesh[];
}

export async function attachTileVisibility(scene: Scene, manifest: NativeTileManifest, contents: TileVisibilityContents, signal: AbortSignal):
  Promise<AttachedTileVisibility> {
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
  const mapped = tileVisibilityTargets(model, { placements: contents.placements, terrainMeshes: contents.terrainMeshes,
    bspChunks: contents.bspChunks.map(chunk => ({ ...chunk, chunkOrdinal: chunkOrdinalById.get(chunk.chunkId)! })) });
  if (mapped.kind === "gap") return unboundTileVisibility(manifest.tileId, mapped.reason);
  const binding = bindTileVisibility({ tileId: manifest.tileId, model, view: sceneTileViewSource(scene), targets: mapped.targets,
    frameSource: createTileVisibilityFrameSource(model, mapped.translucentSections, committedBspVisibilityRules.limits),
    limitRules: committedBspVisibilityRules.limitRules });
  return { binding, inspection: () => binding.inspection(), dispose: () => binding.dispose() };
}
