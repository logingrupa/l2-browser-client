import { fetchVerifiedNativeResource } from "../../assets/native/fetchVerifiedNativeResource";
import { readEnvironmentCatalogRecord, type NativeEnvironmentCatalogRecord } from "../../assets/native/nativeCatalogRecords";
import { readNativeCatalogUnlessNotStaged } from "../../assets/native/readNativeCatalog";
import { parseNativeTimeTables, type NativeTimeTablesExport } from "../../environment/parseNativeTimeTables";

export const nativeEnvironmentRecordId = "interlude";

const recordOrEmpty = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const isPositiveInteger = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const isSha256Hex = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

function requireTimeTablesSource(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const environmentTimeTablesUnstagedReason = "environment-time-tables-unstaged";
const environmentTimeTablesIncompleteReason = "environment-time-tables-incomplete";
const environmentTimeTablesInvalidReason = "environment-time-tables-invalid";
const browserManifestKind = "native-environment-browser-source";
const timeTablesProduct = "time-tables.json";

export type NativeTimeTablesLoad =
  | { readonly status: "loaded"; readonly timeTables: NativeTimeTablesExport }
  | { readonly status: "gap"; readonly reason: string; readonly detail: string };

function timeTablesGap(reason: string, detail: string): NativeTimeTablesLoad {
  return { status: "gap", reason, detail };
}

function browserManifestTimeTablesPin(manifest: unknown, manifestPath: string): { readonly bytes: number; readonly sha256: string } {
  const document = recordOrEmpty(manifest);
  requireTimeTablesSource(document.schemaVersion === 1 && document.kind === browserManifestKind, `${manifestPath} is not a ${browserManifestKind} schema 1 manifest.`);
  const pin = recordOrEmpty(document.tables);
  requireTimeTablesSource(pin.file === timeTablesProduct && isPositiveInteger(pin.bytes) && isSha256Hex(pin.sha256),
    `${manifestPath} pins no ${timeTablesProduct} with bytes and sha256.`);
  return { bytes: pin.bytes, sha256: pin.sha256 };
}

function servedEnvironmentRecord(environments: readonly unknown[]): NativeEnvironmentCatalogRecord | undefined {
  return environments.map(readEnvironmentCatalogRecord).find(record => record.environment === nativeEnvironmentRecordId);
}

async function readNativeTimeTables(signal: AbortSignal): Promise<NativeTimeTablesLoad> {
  const catalog = await readNativeCatalogUnlessNotStaged(signal);
  if (catalog === null) return timeTablesGap(environmentTimeTablesUnstagedReason, "/l2/catalog.json is not staged.");
  const record = servedEnvironmentRecord(catalog.environments);
  if (record === undefined) return timeTablesGap(environmentTimeTablesUnstagedReason, `The served catalog has no environments record ${nativeEnvironmentRecordId}.`);
  const manifestBytes = await fetchVerifiedNativeResource(record.manifest, record.manifestSha256, signal, record.manifestBytes);
  const pin = browserManifestTimeTablesPin(JSON.parse(new TextDecoder().decode(manifestBytes)), record.manifest);
  const tablesPath = `${record.manifest.slice(0, record.manifest.lastIndexOf("/"))}/${timeTablesProduct}`;
  const tableBytes = await fetchVerifiedNativeResource(tablesPath, pin.sha256, signal, pin.bytes);
  const parsed = parseNativeTimeTables(JSON.parse(new TextDecoder().decode(tableBytes)));
  if (parsed.status === "incomplete") return timeTablesGap(environmentTimeTablesIncompleteReason, parsed.unresolved.join(", "));
  return { status: "loaded", timeTables: parsed.timeTables };
}

export async function loadNativeTimeTables(signal: AbortSignal): Promise<NativeTimeTablesLoad> {
  signal.throwIfAborted();
  try {
    return await readNativeTimeTables(signal);
  } catch (error) {
    signal.throwIfAborted();
    return timeTablesGap(environmentTimeTablesInvalidReason, error instanceof Error ? error.message : String(error));
  }
}
