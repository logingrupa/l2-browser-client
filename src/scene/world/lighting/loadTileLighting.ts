import { fetchNativeTypedPayloadFiles } from "../fetchNativeTypedPayload";
import type { NativeTileResource } from "../nativeTileManifest";
import { decodeTileLighting, type TileLightingModel } from "./decodeTileLighting";

const tileLightingResourceLabel = "Tile lighting resource";

export async function loadTileLighting(resource: NativeTileResource, signal: AbortSignal): Promise<TileLightingModel> {
  if (resource.kind !== "lighting") throw new Error(`Native tile resource ${resource.manifest} is not a lighting resource.`);
  const { assetJson, payloadBytes } = await fetchNativeTypedPayloadFiles(resource.manifest, resource.manifestSha256, signal, tileLightingResourceLabel,
    resource.manifestBytes);
  return decodeTileLighting(assetJson, payloadBytes);
}
