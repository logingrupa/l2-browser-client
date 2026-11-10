import { readTypedPayload } from "../../../shared/typedPayload";
import { fetchNativeTypedPayloadFiles } from "../fetchNativeTypedPayload";
import type { NativeTileChunkManifest } from "../nativeTileChunkManifest";
import type { NativeTileResource } from "../nativeTileManifest";
import type { CollisionBspTree, CollisionCell } from "./core/collisionCell";
import type { CollisionWorld } from "./core/collisionWorld";
import { decodeNativeTileBspTree, decodeNativeTileCollisionCell } from "./core/decodeNativeTileCollision";

export interface CollisionCellLoadRequest {
  readonly chunk: NativeTileChunkManifest;
  readonly tileCollision: NativeTileResource;
}

const collisionResourceLabel = "Collision resource";
const pendingTileBspTreeLoadsByWorld = new WeakMap<CollisionWorld, Map<string, Promise<CollisionBspTree>>>();

export function nativeTileCollisionCellId(tileId: string, chunkId: string): string {
  return `${tileId}/${chunkId}`;
}

async function fetchCollisionPayload(resource: string, sha256: string, signal: AbortSignal, bytes?: number) {
  const { assetJson, payloadBytes } = await fetchNativeTypedPayloadFiles(resource, sha256, signal, collisionResourceLabel, bytes);
  return readTypedPayload(assetJson, payloadBytes);
}

export async function loadTileBspTree(tileId: string, tileCollision: NativeTileResource, signal: AbortSignal): Promise<CollisionBspTree> {
  if (tileCollision.kind !== "native-tile-collision") throw new Error(`Native tile resource ${tileCollision.manifest} is not a native-tile-collision resource.`);
  const payload = await fetchCollisionPayload(tileCollision.manifest, tileCollision.manifestSha256, signal, tileCollision.manifestBytes);
  return decodeNativeTileBspTree(payload, tileId);
}

async function loadChunkCollisionCell(chunk: NativeTileChunkManifest, signal: AbortSignal): Promise<CollisionCell> {
  if (chunk.collision === null) throw new Error(`Native tile chunk ${chunk.tileId}/${chunk.chunkId} has no collision resource; its gap row names why.`);
  const payload = await fetchCollisionPayload(chunk.collision.resource, chunk.collision.sha256, signal);
  return decodeNativeTileCollisionCell(payload, { cellId: nativeTileCollisionCellId(chunk.tileId, chunk.chunkId), tileId: chunk.tileId });
}

function sharedTileBspTreeLoad(world: CollisionWorld, tileId: string, tileCollision: NativeTileResource, signal: AbortSignal): Promise<CollisionBspTree> {
  const residentTree = world.tileBspTree(tileId);
  if (residentTree !== null) return Promise.resolve(residentTree);
  let pendingLoads = pendingTileBspTreeLoadsByWorld.get(world);
  if (pendingLoads === undefined) {
    pendingLoads = new Map();
    pendingTileBspTreeLoadsByWorld.set(world, pendingLoads);
  }
  const pendingLoad = pendingLoads.get(tileId);
  if (pendingLoad !== undefined) return pendingLoad;
  const tileLoads = pendingLoads;
  const load = loadTileBspTree(tileId, tileCollision, signal).finally(() => tileLoads.delete(tileId));
  tileLoads.set(tileId, load);
  return load;
}

export async function loadCollisionCell(world: CollisionWorld, request: CollisionCellLoadRequest, signal: AbortSignal): Promise<CollisionCell> {
  const { chunk, tileCollision } = request;
  const [cell, tree] = await Promise.all([loadChunkCollisionCell(chunk, signal), sharedTileBspTreeLoad(world, chunk.tileId, tileCollision, signal)]);
  signal.throwIfAborted();
  world.addCell(cell.cellId, cell);
  if (world.tileBspTree(chunk.tileId) === null) world.setTileBspTree(chunk.tileId, tree);
  return cell;
}
