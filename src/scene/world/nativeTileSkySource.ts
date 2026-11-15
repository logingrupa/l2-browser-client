import { fetchVerifiedNativeResource } from "../../assets/native/fetchVerifiedNativeResource";
import { decodeNativeJsonResource } from "./loadNativeSection";
import { isPlainRecord, nativeTileSha256Pattern } from "./nativeManifestRecordGuards";
import { readNativeTileManifest } from "./nativeTileManifest";
import { selectedNativeTileIdentity } from "./selectedNativeTile";

export interface NativeTileSkyResource {
  readonly status: "resource";
  readonly tileId: string;
  readonly sourceId: string;
  readonly manifestSha256: string;
  readonly glb: { readonly resource: string; readonly sha256: string; readonly bytes: number };
  readonly materialRoots: number;
  readonly gapReason: string | null;
}

export interface NativeTileSkyGap {
  readonly status: "gap";
  readonly tileId: string;
  readonly reason: string;
}

export interface NativeTileSkyAbsent {
  readonly status: "absent";
  readonly tileId: string;
}

export type NativeTileSkySource = NativeTileSkyResource | NativeTileSkyGap | NativeTileSkyAbsent;

const skyBundleKind = "native-sky-source-bundle";
const skyStep = "sky";
const maximumSkyGlbBytes = 64 * 1024 * 1024;
const maximumSkyMaterialRoots = 64;

function parseSkyBundleManifest(input: unknown, tileId: string, manifestResource: string, manifestSha256: string, gapReason: string | null): NativeTileSkyResource {
  const label = `Native tile ${tileId} sky manifest`;
  if (!isPlainRecord(input) || input.kind !== skyBundleKind || input.schemaVersion !== 1 || input.tileId !== tileId ||
    typeof input.id !== "string" || !input.id.startsWith(`interlude:${tileId}.`)) {
    throw new Error(`${label} kind, schema version, tile or source id is invalid.`);
  }
  const counts = input.counts, files = input.files;
  const materialRoots = isPlainRecord(counts) ? counts.materialRoots : undefined;
  if (typeof materialRoots !== "number" || !Number.isSafeInteger(materialRoots) || materialRoots < 1 || materialRoots > maximumSkyMaterialRoots) {
    throw new Error(`${label} must count 1 to ${maximumSkyMaterialRoots} material roots.`);
  }
  const glb = isPlainRecord(files) ? files["sky.glb"] : undefined;
  if (!isPlainRecord(glb) || typeof glb.sha256 !== "string" || !nativeTileSha256Pattern.test(glb.sha256) || typeof glb.bytes !== "number" ||
    !Number.isSafeInteger(glb.bytes) || glb.bytes < 1 || glb.bytes > maximumSkyGlbBytes) {
    throw new Error(`${label} must pin sky.glb with its SHA-256 and 1 to ${maximumSkyGlbBytes} bytes.`);
  }
  return { status: "resource", tileId, sourceId: input.id, manifestSha256, materialRoots, gapReason,
    glb: { resource: manifestResource.replace(/manifest\.json$/, "sky.glb"), sha256: glb.sha256, bytes: glb.bytes } };
}

export async function readSelectedTileSkySource(location: Pick<Location, "search"> | undefined, signal: AbortSignal): Promise<NativeTileSkySource | null> {
  const tileId = selectedNativeTileIdentity(location);
  if (tileId === null) return null;
  const pinnedManifest = await readNativeTileManifest(tileId, signal);
  if (!pinnedManifest) return null;
  const manifest = pinnedManifest.manifest;
  const resource = manifest.resources.find(entry => entry.kind === "sky");
  const gap = manifest.gaps.find(row => row.step === skyStep && row.status !== "pass");
  const gapReason = gap ? gap.reason ?? gap.status : null;
  if (!resource) return gapReason === null ? { status: "absent", tileId } : { status: "gap", tileId, reason: gapReason };
  const bytes = await fetchVerifiedNativeResource(resource.manifest, resource.manifestSha256, signal, resource.manifestBytes);
  return parseSkyBundleManifest(decodeNativeJsonResource(bytes, `Native tile ${tileId} sky manifest`), tileId, resource.manifest, resource.manifestSha256,
    gapReason);
}
