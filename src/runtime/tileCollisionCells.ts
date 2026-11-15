import { readTileChunkManifests } from "../scene/world/nativeTileChunkContents";
import { readNativeTileManifest } from "../scene/world/nativeTileManifest";
import type { CollisionWorld } from "../scene/world/movement/core/collisionWorld";
import { loadChunkCollisionCell, loadTileBspTree } from "../scene/world/movement/loadCollisionCells";
import { collisionCellTerrainFootprint } from "../scene/world/nativeTileChunkFootprints";

export interface TileCollisionChunkGap {
  readonly chunkId: string;
  readonly reason: string;
}

export interface TileCollisionLoad {
  readonly tileId: string;
  readonly residentCellIds: readonly string[];
  readonly chunkGaps: readonly TileCollisionChunkGap[];
}

const collisionResourceKind = "native-tile-collision";
const chunkCollisionAbsentReason = "chunk-collision-resource-absent";
const cellTerrainAbsentReason = "collision-cell-terrain-absent";

class TileCollisionLoadError extends Error {
  constructor(tileId: string, message: string) {
    super(`Tile ${tileId} collision: ${message}`);
    this.name = "TileCollisionLoadError";
  }
}

export async function loadTileCollisionCells(world: CollisionWorld, tileId: string, signal: AbortSignal): Promise<TileCollisionLoad> {
  const pinned = await readNativeTileManifest(tileId, signal);
  if (pinned === null) throw new TileCollisionLoadError(tileId, "the served catalog lists no tile record.");
  const tileCollision = pinned.manifest.resources.find(resource => resource.kind === collisionResourceKind);
  if (tileCollision === undefined) throw new TileCollisionLoadError(tileId, `the tile manifest pins no ${collisionResourceKind} resource.`);
  const chunks = await readTileChunkManifests(pinned.manifest, signal);
  const chunkGaps: TileCollisionChunkGap[] = chunks.filter(chunk => chunk.collision === null).map(chunk => ({ chunkId: chunk.chunkId, reason: chunkCollisionAbsentReason }));
  const [tree, decodedChunks] = await Promise.all([loadTileBspTree(tileId, tileCollision, signal),
    Promise.all(chunks.flatMap(chunk => chunk.collision === null ? [] : [loadChunkCollisionCell(chunk, signal).then(cell => ({ chunkId: chunk.chunkId, cell }))]))]);
  signal.throwIfAborted();
  const footprintedCells = decodedChunks.flatMap(({ chunkId, cell }) => {
    const footprint = collisionCellTerrainFootprint(cell);
    if (footprint === null) { chunkGaps.push({ chunkId, reason: cellTerrainAbsentReason }); return []; }
    return [{ cell, footprint }];
  });
  for (const { cell, footprint } of footprintedCells) world.requireCell(cell.cellId, footprint);
  for (const { cell } of footprintedCells) world.addCell(cell.cellId, cell);
  if (footprintedCells.length > 0) world.setTileBspTree(tileId, tree);
  return { tileId, residentCellIds: footprintedCells.map(({ cell }) => cell.cellId), chunkGaps };
}
