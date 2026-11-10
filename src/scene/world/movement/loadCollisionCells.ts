import { readTypedPayload } from "../../../shared/typedPayload";
import { fetchNativeTypedPayloadFiles } from "../fetchNativeTypedPayload";
import type { NativeTileChunkManifest } from "../nativeTileChunkManifest";
import type { NativeTileResource } from "../nativeTileManifest";
import type { CollisionBspTree, CollisionCell } from "./core/collisionCell";
import { decodeNativeTileBspTree, decodeNativeTileCollisionCell } from "./core/decodeNativeTileCollision";

const collisionResourceLabel = "Collision resource";

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

export async function loadChunkCollisionCell(chunk: NativeTileChunkManifest, signal: AbortSignal): Promise<CollisionCell> {
  if (chunk.collision === null) throw new Error(`Native tile chunk ${chunk.tileId}/${chunk.chunkId} has no collision resource; its gap row names why.`);
  const payload = await fetchCollisionPayload(chunk.collision.resource, chunk.collision.sha256, signal);
  return decodeNativeTileCollisionCell(payload, { cellId: nativeTileCollisionCellId(chunk.tileId, chunk.chunkId), tileId: chunk.tileId });
}
