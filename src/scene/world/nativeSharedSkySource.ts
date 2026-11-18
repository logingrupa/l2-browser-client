import { fetchVerifiedNativeResource } from "../../assets/native/fetchVerifiedNativeResource";
import { readSkyCatalogRecord } from "../../assets/native/nativeCatalogRecords";
import { readNativeCatalogUnlessNotStaged } from "../../assets/native/readNativeCatalog";
import { decodeNativeJsonResource } from "./loadNativeSection";
import { isPlainRecord, nativeTileSha256Pattern } from "./nativeManifestRecordGuards";

export interface NativeSkyBundleFile {
  readonly resource: string;
  readonly sha256: string;
  readonly bytes: number;
}

export interface NativeSharedSkySource {
  readonly sourceId: string;
  readonly manifestSha256: string;
  readonly glb: NativeSkyBundleFile;
  readonly snapshot: NativeSkyBundleFile;
  readonly materialRoots: number;
}

export const sharedSkyRecordId = "skylevel";
const sharedSkyBundleKind = "native-shared-sky-bundle";
const maximumSkyBundleFileBytes = 64 * 1024 * 1024;
const maximumSkyMaterialRoots = 64;
const skyGlbFileName = "sky.glb";
const skySnapshotFileName = "sky.json";
const sharedSkyManifestLabel = "Native shared sky manifest";

function pinnedSkyBundleFile(files: unknown, fileName: string, manifestResource: string): NativeSkyBundleFile {
  const file = isPlainRecord(files) ? files[fileName] : undefined;
  if (!isPlainRecord(file) || typeof file.sha256 !== "string" || !nativeTileSha256Pattern.test(file.sha256) || typeof file.bytes !== "number" ||
    !Number.isSafeInteger(file.bytes) || file.bytes < 1 || file.bytes > maximumSkyBundleFileBytes) {
    throw new Error(`${sharedSkyManifestLabel} must pin ${fileName} with its SHA-256 and 1 to ${maximumSkyBundleFileBytes} bytes.`);
  }
  return { resource: manifestResource.replace(/manifest\.json$/, fileName), sha256: file.sha256, bytes: file.bytes };
}

export function parseSharedSkyBundleManifest(input: unknown, manifestResource: string, manifestSha256: string): NativeSharedSkySource {
  if (!isPlainRecord(input) || input.kind !== sharedSkyBundleKind || input.schemaVersion !== 1 || input.map !== sharedSkyRecordId ||
    typeof input.id !== "string" || !input.id.startsWith(`interlude:${sharedSkyRecordId}.`)) {
    throw new Error(`${sharedSkyManifestLabel} kind, schema version, map or source id is invalid.`);
  }
  const materialRoots = isPlainRecord(input.counts) ? input.counts.materialRoots : undefined;
  if (typeof materialRoots !== "number" || !Number.isSafeInteger(materialRoots) || materialRoots < 1 || materialRoots > maximumSkyMaterialRoots) {
    throw new Error(`${sharedSkyManifestLabel} must count 1 to ${maximumSkyMaterialRoots} material roots.`);
  }
  return { sourceId: input.id, manifestSha256, materialRoots, glb: pinnedSkyBundleFile(input.files, skyGlbFileName, manifestResource),
    snapshot: pinnedSkyBundleFile(input.files, skySnapshotFileName, manifestResource) };
}

export async function readSharedSkySource(signal: AbortSignal): Promise<NativeSharedSkySource | null> {
  const catalog = await readNativeCatalogUnlessNotStaged(signal);
  if (catalog === null) return null;
  const record = catalog.skies.map(readSkyCatalogRecord).find(entry => entry.sky === sharedSkyRecordId);
  if (record === undefined) return null;
  const bytes = await fetchVerifiedNativeResource(record.manifest, record.manifestSha256, signal, record.manifestBytes);
  return parseSharedSkyBundleManifest(decodeNativeJsonResource(bytes, sharedSkyManifestLabel), record.manifest, record.manifestSha256);
}
