import { readWindowCatalogRecord } from "../../assets/native/nativeCatalogRecords";
import { windowCatalogKey } from "../../assets/native/nativeCatalogIndex";
import { readNativeCatalog, type NativeCatalog } from "../../assets/native/readNativeCatalog";
import { fetchCatalogPinnedBytes } from "../fetchCatalogPinnedBytes";
import { parseNativeWindowManifest, type NativeWindowManifest } from "./nativeWindowLayoutTree";

export type NativeWindowManifestLoad =
  | { readonly status: "loaded"; readonly key: string; readonly manifest: NativeWindowManifest; readonly catalog: NativeCatalog }
  | { readonly status: "not-in-catalog"; readonly key: string; readonly reason: string };

export type NativeWindowTextureResolution =
  | { readonly status: "resolved"; readonly url: string }
  | { readonly status: "gap"; readonly reason: string };

interface UiTextureCatalogRecord { readonly image: string; readonly imageBytes: number; readonly imageSha256: string }

const uiTextureIdPrefix = "ui-texture:";
const textureNotInCatalogReason = "texture-not-in-catalog";
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
  const bytes = await fetchCatalogPinnedBytes(record.manifest, record.manifestBytes, record.manifestSha256, signal, "Native window manifest");
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
      const bytes = await fetchCatalogPinnedBytes(record.image, record.imageBytes, record.imageSha256, signal, "Native UI texture");
      resolutions.set(reference, { status: "resolved", url: URL.createObjectURL(new Blob([bytes], { type: "image/png" })) });
    }
  } catch (error) {
    revokeNativeWindowTextures(resolutions);
    throw error;
  }
  return resolutions;
}

export function revokeNativeWindowTextures(resolutions: ReadonlyMap<string, NativeWindowTextureResolution>): void {
  for (const resolution of resolutions.values()) if (resolution.status === "resolved") URL.revokeObjectURL(resolution.url);
}
