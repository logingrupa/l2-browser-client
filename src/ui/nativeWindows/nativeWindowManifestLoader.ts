import { readTileCatalogRecord, readWindowCatalogRecord } from "../../assets/native/nativeCatalogRecords";
import { windowCatalogKey } from "../../assets/native/nativeCatalogIndex";
import { readNativeCatalog, type NativeCatalog } from "../../assets/native/readNativeCatalog";
import { readAssetPackage } from "../../assets/package/readAssetPackage";
import { decodeNativeJsonResource } from "../../scene/world/loadNativeSection";
import { loadNativeTileMinimap, type NativeTileMinimap, type NativeTileMinimapRoutePin, type NativeTileMinimapZoneKeyTexture } from "../../scene/world/minimapJoin";
import { readNativeTileManifest } from "../../scene/world/nativeTileManifest";
import { fetchVerifiedNativeResource } from "../../assets/native/fetchVerifiedNativeResource";
import { parseNativeMinimapRoute, type NativeMinimapRoute, type NativeTextureArchivePin } from "./nativeMinimapRoute";
import { parseNativeWindowManifest, type NativeWindowManifest } from "./nativeWindowLayoutTree";
import { zoneKeyMipFromTexturePackage, type ZoneKeyMipLoad } from "./radarZoneName";

export type NativeWindowManifestLoad =
  | { readonly status: "loaded"; readonly key: string; readonly manifest: NativeWindowManifest; readonly catalog: NativeCatalog }
  | { readonly status: "not-in-catalog"; readonly key: string; readonly reason: string };

export type NativeWindowTextureResolution =
  | { readonly status: "resolved"; readonly url: string }
  | { readonly status: "gap"; readonly reason: string };

export interface NativeWindowMinimapSource {
  readonly tileIds: readonly string[];
  loadTileMinimap(tileId: string): Promise<NativeTileMinimap | null>;
  loadMinimapRoute(routePin: NativeTileMinimapRoutePin): Promise<NativeMinimapRoute>;
  loadTextureImage(texture: NativeTextureArchivePin): Promise<NativeWindowTextureResolution>;
  loadZoneKeyMip(zoneKeyTexture: NativeTileMinimapZoneKeyTexture): Promise<ZoneKeyMipLoad>;
}

interface UiTextureCatalogRecord { readonly image: string; readonly imageBytes: number; readonly imageSha256: string }

const uiTextureIdPrefix = "ui-texture:";
const textureNotInCatalogReason = "texture-not-in-catalog";
const textureArchiveImageNotPngReason = "texture-archive-image-not-png";
const pngMimeType = "image/png";
const maximumImageBytes = 32 * 1024 * 1024;
const sha256Pattern = /^[a-f0-9]{64}$/;

function decodeManifestText(bytes: Uint8Array): unknown {
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new Error("Native window manifest is not UTF-8 JSON."); }
}

export async function loadNativeWindowManifest(windowId: string, signal: AbortSignal): Promise<NativeWindowManifestLoad> {
  const key = windowCatalogKey(windowId);
  const catalog = await readNativeCatalog(signal);
  const record = catalog.windows.map(readWindowCatalogRecord).find(windowRecord => windowRecord.window === windowId);
  if (record === undefined) return { status: "not-in-catalog", key, reason: `${key} has no windows record in the served catalog` };
  const bytes = await fetchVerifiedNativeResource(record.manifest, record.manifestSha256, signal, record.manifestBytes);
  const manifest = parseNativeWindowManifest(decodeManifestText(bytes));
  if (manifest.windowId !== windowId) throw new Error(`Native window manifest ${record.manifest} holds ${manifest.windowId}, not ${windowId}.`);
  return { status: "loaded", key, manifest, catalog };
}

function readUiTextureRecord(value: unknown, reference: string): UiTextureCatalogRecord {
  const record = value as Record<string, unknown>;
  const { archiveSha256, image, imageBytes, imageSha256 } = record;
  if (typeof archiveSha256 !== "string" || !sha256Pattern.test(archiveSha256) || typeof imageSha256 !== "string" || !sha256Pattern.test(imageSha256) ||
    typeof image !== "string" || !new RegExp(`^/l2/${archiveSha256}/[A-Za-z0-9._-]+\\.png$`).test(image) ||
    typeof imageBytes !== "number" || !Number.isSafeInteger(imageBytes) || imageBytes < 1 || imageBytes > maximumImageBytes) {
    throw new Error(`Native catalog textures record ${uiTextureIdPrefix}${reference} is invalid.`);
  }
  return { image, imageBytes, imageSha256 };
}

function uiTextureRecordsById(catalog: NativeCatalog): ReadonlyMap<string, unknown> {
  const records = new Map<string, unknown>();
  for (const record of catalog.textures) {
    if (typeof record !== "object" || record === null || Array.isArray(record)) throw new Error("Native catalog textures entry is invalid.");
    const id = (record as Record<string, unknown>).id;
    if (typeof id !== "string" || !id.startsWith(uiTextureIdPrefix)) continue;
    if (records.has(id)) throw new Error(`Native catalog lists ${id} twice.`);
    records.set(id, record);
  }
  return records;
}

export async function resolveNativeWindowTextures(catalog: NativeCatalog, references: readonly string[],
  signal: AbortSignal): Promise<ReadonlyMap<string, NativeWindowTextureResolution>> {
  const recordsById = uiTextureRecordsById(catalog);
  const resolutions = new Map<string, NativeWindowTextureResolution>();
  try {
    for (const reference of new Set(references)) {
      const value = recordsById.get(uiTextureIdPrefix + reference);
      if (value === undefined) {
        resolutions.set(reference, { status: "gap", reason: textureNotInCatalogReason });
        continue;
      }
      const record = readUiTextureRecord(value, reference);
      const bytes = await fetchVerifiedNativeResource(record.image, record.imageSha256, signal, record.imageBytes);
      resolutions.set(reference, { status: "resolved", url: URL.createObjectURL(new Blob([bytes], { type: pngMimeType })) });
    }
  } catch (error) {
    revokeNativeWindowTextures(resolutions);
    throw error;
  }
  return resolutions;
}

async function resolveTextureArchiveImage(texture: NativeTextureArchivePin, signal: AbortSignal): Promise<NativeWindowTextureResolution> {
  const archiveBytes = await fetchVerifiedNativeResource(texture.archive, texture.archiveSha256, signal, texture.archiveBytes);
  const texturePackage = await readAssetPackage(archiveBytes);
  const imageFile = texturePackage.manifest.kind === "texture" ? texturePackage.manifest.image?.file : undefined;
  const inventory = texturePackage.manifest.files.find(file => file.path === imageFile);
  const imageBytes = imageFile === undefined ? undefined : texturePackage.files.get(imageFile);
  if (inventory?.mime !== pngMimeType || imageBytes === undefined) return { status: "gap", reason: textureArchiveImageNotPngReason };
  return { status: "resolved", url: URL.createObjectURL(new Blob([imageBytes.slice()], { type: pngMimeType })) };
}

async function loadNativeMinimapRoute(routePin: NativeTileMinimapRoutePin, signal: AbortSignal): Promise<NativeMinimapRoute> {
  const bytes = await fetchVerifiedNativeResource(routePin.manifest, routePin.manifestSha256, signal, routePin.manifestBytes);
  return parseNativeMinimapRoute(decodeNativeJsonResource(bytes, "Native minimap route manifest"));
}

async function loadZoneKeyMip(zoneKeyTexture: NativeTileMinimapZoneKeyTexture, signal: AbortSignal): Promise<ZoneKeyMipLoad> {
  const archiveBytes = await fetchVerifiedNativeResource(zoneKeyTexture.archive, zoneKeyTexture.archiveSha256, signal, zoneKeyTexture.archiveBytes);
  return zoneKeyMipFromTexturePackage((await readAssetPackage(archiveBytes)).files);
}

export function nativeWindowMinimapSource(catalog: NativeCatalog, signal: AbortSignal): NativeWindowMinimapSource {
  return {
    tileIds: catalog.tiles.map(record => readTileCatalogRecord(record).tile),
    loadTileMinimap: async tileId => {
      const pinnedTileManifest = await readNativeTileManifest(tileId, signal);
      return pinnedTileManifest === null ? null : loadNativeTileMinimap(pinnedTileManifest.manifest, signal);
    },
    loadMinimapRoute: routePin => loadNativeMinimapRoute(routePin, signal),
    loadTextureImage: texture => resolveTextureArchiveImage(texture, signal),
    loadZoneKeyMip: zoneKeyTexture => loadZoneKeyMip(zoneKeyTexture, signal),
  };
}

export function revokeNativeWindowTextures(resolutions: ReadonlyMap<string, NativeWindowTextureResolution>): void {
  for (const resolution of resolutions.values()) if (resolution.status === "resolved") URL.revokeObjectURL(resolution.url);
}
