import { sha256 } from "../../assets/package/readAssetPackage";
import { nativeResourceUrl } from "../../assets/native/nativeResourceUrl";
import { fetchVerifiedNativeResource } from "../../assets/native/fetchVerifiedNativeResource";
import { parseNativeTimeTables, type NativeTimeTablesExport } from "../../environment/parseNativeTimeTables";

export const nativeEnvironmentSource = {
  conversionManifestSha256: "e10827c4e98daeed18062c9e85117a1f862a3e6dfcaad08638798f887081183d",
} as const;

const recordOrEmpty = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const isNonNegativeInteger = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const isSha256Hex = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

function requireTimeTablesSource(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const environmentTimeTablesUnstagedReason = "environment-time-tables-unstaged";
const environmentTimeTablesIncompleteReason = "environment-time-tables-incomplete";
const environmentTimeTablesInvalidReason = "environment-time-tables-invalid";
const timeTablesProduct = "time-tables.json";
const httpNotFound = 404;

export type NativeTimeTablesLoad =
  | { readonly status: "loaded"; readonly timeTables: NativeTimeTablesExport }
  | { readonly status: "gap"; readonly reason: string; readonly detail: string };

function timeTablesGap(reason: string, detail: string): NativeTimeTablesLoad {
  return { status: "gap", reason, detail };
}

function timeTablesProductPin(manifest: unknown): { readonly bytes: number; readonly sha256: string } | null {
  const products = recordOrEmpty(recordOrEmpty(manifest).products);
  if (!Object.hasOwn(products, timeTablesProduct)) return null;
  const pin = recordOrEmpty(products[timeTablesProduct]);
  requireTimeTablesSource(isNonNegativeInteger(pin.bytes) && pin.bytes > 0 && isSha256Hex(pin.sha256), `The conversion manifest pins ${timeTablesProduct} without bytes and sha256.`);
  return { bytes: pin.bytes, sha256: pin.sha256 };
}

async function readNativeTimeTables(conversionManifestSha256: string, signal: AbortSignal): Promise<NativeTimeTablesLoad> {
  const directory = `/l2/environments/${conversionManifestSha256}`;
  const response = await fetch(nativeResourceUrl(`${directory}/conversion-manifest.json`), { signal });
  if (response.status === httpNotFound) return timeTablesGap(environmentTimeTablesUnstagedReason, `${directory} is not staged.`);
  requireTimeTablesSource(response.ok, `The conversion manifest returned HTTP ${response.status}.`);
  const manifestBytes = new Uint8Array(await response.arrayBuffer());
  signal.throwIfAborted();
  requireTimeTablesSource(await sha256(manifestBytes) === conversionManifestSha256, "The conversion manifest differs from its pin.");
  const pin = timeTablesProductPin(JSON.parse(new TextDecoder().decode(manifestBytes)));
  if (pin === null) return timeTablesGap(environmentTimeTablesUnstagedReason, `${directory} is an older export without ${timeTablesProduct}.`);
  const tableBytes = await fetchVerifiedNativeResource(`${directory}/${timeTablesProduct}`, pin.sha256, signal, pin.bytes);
  const parsed = parseNativeTimeTables(JSON.parse(new TextDecoder().decode(tableBytes)));
  if (parsed.status === "incomplete") return timeTablesGap(environmentTimeTablesIncompleteReason, parsed.unresolved.join(", "));
  return { status: "loaded", timeTables: parsed.timeTables };
}

export async function loadNativeTimeTables(signal: AbortSignal,
  conversionManifestSha256: string = nativeEnvironmentSource.conversionManifestSha256): Promise<NativeTimeTablesLoad> {
  signal.throwIfAborted();
  try {
    return await readNativeTimeTables(conversionManifestSha256, signal);
  } catch (error) {
    signal.throwIfAborted();
    return timeTablesGap(environmentTimeTablesInvalidReason, error instanceof Error ? error.message : String(error));
  }
}
