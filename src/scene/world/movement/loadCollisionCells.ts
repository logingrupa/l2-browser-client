import { readTypedPayload } from "../../../shared/typedPayload";
import { decodeNativeJsonResource, fetchVerifiedNativeResource } from "../loadNativeSection";
import type { NativeTileChunkManifest } from "../nativeTileChunkManifest";
import type { NativeTileResource } from "../nativeTileManifest";
import type { CollisionBspTree, CollisionCell } from "./core/collisionCell";
import type { CollisionWorld } from "./core/collisionWorld";
import { decodeNativeTileBspTree, decodeNativeTileCollisionCell } from "./core/decodeNativeTileCollision";

export interface CollisionCellLoadRequest {
  readonly chunk: NativeTileChunkManifest;
  readonly tileCollision: NativeTileResource;
}

interface CollisionPayloadPin {
  readonly sha256: string;
  readonly bytes: number;
}

const typedPayloadAssetName = "asset.json";
const typedPayloadFileName = "payload.bin";
const sha256Pattern = /^[a-f0-9]{64}$/;
const maximumCollisionPayloadBytes = 128 * 1024 * 1024;
const pendingTileBspTreeLoadsByWorld = new WeakMap<CollisionWorld, Map<string, Promise<CollisionBspTree>>>();

export function nativeTileCollisionCellId(tileId: string, chunkId: string): string {
  return `${tileId}/${chunkId}`;
}

function readCollisionPayloadPin(assetJson: unknown, resource: string): CollisionPayloadPin {
  const pin = typeof assetJson === "object" && assetJson !== null ? (assetJson as Record<string, unknown>).payload : undefined;
  if (typeof pin !== "object" || pin === null) throw new Error(`Collision resource ${resource} has no payload pin.`);
  const { file, sha256, bytes } = pin as Record<string, unknown>;
  if (file !== typedPayloadFileName || typeof sha256 !== "string" || !sha256Pattern.test(sha256) || typeof bytes !== "number" ||
    !Number.isSafeInteger(bytes) || bytes < 0 || bytes > maximumCollisionPayloadBytes) {
    throw new Error(`Collision resource ${resource} payload pin must name ${typedPayloadFileName} with its SHA-256 and a byte count.`);
  }
  return { sha256, bytes };
}

async function fetchCollisionPayload(resource: string, sha256: string, signal: AbortSignal, bytes?: number) {
  if (!resource.endsWith(`/${typedPayloadAssetName}`)) throw new Error(`Collision resource ${resource} is not a typed payload ${typedPayloadAssetName}.`);
  const assetJson = decodeNativeJsonResource(await fetchVerifiedNativeResource(resource, sha256, signal, bytes), `Collision resource ${resource}`);
  const pin = readCollisionPayloadPin(assetJson, resource);
  const payloadPath = `${resource.slice(0, -typedPayloadAssetName.length)}${typedPayloadFileName}`;
  const payloadBytes = await fetchVerifiedNativeResource(payloadPath, pin.sha256, signal, pin.bytes);
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
