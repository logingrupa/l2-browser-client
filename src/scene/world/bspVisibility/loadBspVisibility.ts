import { fetchNativeTypedPayloadFiles } from "../fetchNativeTypedPayload";
import type { NativeTileResource } from "../nativeTileManifest";
import { decodeBspVisibility, type BspVisibilityModel } from "./core/decodeBspVisibility";

const bspVisibilityResourceLabel = "BSP visibility resource";

export async function loadBspVisibility(resource: NativeTileResource, signal: AbortSignal): Promise<BspVisibilityModel> {
  if (resource.kind !== "bsp-visibility") throw new Error(`Native tile resource ${resource.manifest} is not a bsp-visibility resource.`);
  const { assetJson, payloadBytes } = await fetchNativeTypedPayloadFiles(resource.manifest, resource.manifestSha256, signal, bspVisibilityResourceLabel,
    resource.manifestBytes);
  return decodeBspVisibility(assetJson, payloadBytes);
}
