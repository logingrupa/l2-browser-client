import { readTypedPayload } from "../shared/typedPayload";
import { fetchNativeTypedPayloadFiles } from "../scene/world/fetchNativeTypedPayload";
import { decodeNativeJsonResource, fetchVerifiedNativeResource } from "../scene/world/loadNativeSection";
import { parseNativeTileChunkManifest, type NativeTileChunkCollision, type NativeTileChunkManifest } from "../scene/world/nativeTileChunkManifest";
import { readNativeTileManifest } from "../scene/world/nativeTileManifest";
import type { CollisionCell } from "../scene/world/movement/core/collisionCell";
import type { CollisionCellFootprint, CollisionWorld } from "../scene/world/movement/core/collisionWorld";
import { decodeNativeTileCollisionCell } from "../scene/world/movement/core/decodeNativeTileCollision";
import { loadTileBspTree, nativeTileCollisionCellId } from "../scene/world/movement/loadCollisionCells";

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
const collisionResourceLabel = "Collision resource";
const chunkCollisionAbsentReason = "chunk-collision-resource-absent";
const cellTerrainAbsentReason = "collision-cell-terrain-absent";

export class TileCollisionLoadError extends Error {
  constructor(tileId: string, message: string) {
    super(`Tile ${tileId} collision: ${message}`);
    this.name = "TileCollisionLoadError";
  }
}

export function collisionCellTerrainFootprint(cell: CollisionCell): CollisionCellFootprint | null {
  const terrain = cell.terrain;
  if (terrain === null) return null;
  const [locationX, locationY] = terrain.location, [scaleX, scaleY] = terrain.terrainScale;
  const sourceX = (column: number) => locationX + (column - Math.floor(terrain.heightmapWidth / 2)) * scaleX;
  const sourceY = (row: number) => locationY + (row - Math.floor(terrain.heightmapHeight / 2)) * scaleY;
  return {
    minimumX: sourceX(terrain.firstColumn), minimumY: sourceY(terrain.firstRow),
    maximumX: sourceX(terrain.firstColumn + terrain.columns - 1), maximumY: sourceY(terrain.firstRow + terrain.rows - 1),
  };
}

async function readChunkManifest(tileId: string, chunkId: string, manifest: string, sha256: string, bytes: number, signal: AbortSignal): Promise<NativeTileChunkManifest> {
  const chunk = parseNativeTileChunkManifest(decodeNativeJsonResource(await fetchVerifiedNativeResource(manifest, sha256, signal, bytes), "Native tile chunk manifest"));
  if (chunk.tileId !== tileId || chunk.chunkId !== chunkId) throw new TileCollisionLoadError(tileId, `chunk manifest ${manifest} differs from its record ${chunkId}.`);
  return chunk;
}

interface DecodedChunkCollision {
  readonly chunkId: string;
  readonly cell: CollisionCell;
}

async function decodeChunkCollisionCell(chunk: NativeTileChunkManifest, collision: NativeTileChunkCollision, signal: AbortSignal): Promise<DecodedChunkCollision> {
  const { assetJson, payloadBytes } = await fetchNativeTypedPayloadFiles(collision.resource, collision.sha256, signal, collisionResourceLabel);
  const cell = decodeNativeTileCollisionCell(readTypedPayload(assetJson, payloadBytes), { cellId: nativeTileCollisionCellId(chunk.tileId, chunk.chunkId), tileId: chunk.tileId });
  return { chunkId: chunk.chunkId, cell };
}

export async function loadTileCollisionCells(world: CollisionWorld, tileId: string, signal: AbortSignal): Promise<TileCollisionLoad> {
  const pinned = await readNativeTileManifest(tileId, signal);
  if (pinned === null) throw new TileCollisionLoadError(tileId, "the served catalog lists no tile record.");
  const tileCollision = pinned.manifest.resources.find(resource => resource.kind === collisionResourceKind);
  if (tileCollision === undefined) throw new TileCollisionLoadError(tileId, `the tile manifest pins no ${collisionResourceKind} resource.`);
  const chunks = await Promise.all(pinned.manifest.chunks.map(record =>
    readChunkManifest(tileId, record.chunkId, record.manifest, record.manifestSha256, record.manifestBytes, signal)));
  const chunkGaps: TileCollisionChunkGap[] = chunks.filter(chunk => chunk.collision === null).map(chunk => ({ chunkId: chunk.chunkId, reason: chunkCollisionAbsentReason }));
  const [tree, decodedChunks] = await Promise.all([loadTileBspTree(tileId, tileCollision, signal),
    Promise.all(chunks.flatMap(chunk => chunk.collision === null ? [] : [decodeChunkCollisionCell(chunk, chunk.collision, signal)]))]);
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
