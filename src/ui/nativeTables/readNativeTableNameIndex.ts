import { readTableCatalogRecord, tableIdPattern, type NativeTableCatalogRecord } from "../../assets/native/nativeCatalogRecords";
import { tableCatalogKey } from "../../assets/native/nativeCatalogIndex";
import { readNativeCatalog } from "../../assets/native/readNativeCatalog";
import { fetchVerifiedNativeResource } from "../../assets/native/fetchVerifiedNativeResource";

export interface NativeTableNameEntry {
  readonly identifiers: readonly number[];
  readonly name: string;
  readonly sourceOrder: number;
}

export type NativeTableNameIndexRead =
  | { readonly status: "converted"; readonly key: string; readonly manifest: string; readonly identifierFields: readonly string[];
    readonly entries: readonly NativeTableNameEntry[] }
  | { readonly status: "not-in-catalog"; readonly key: string; readonly reason: string };

const nameIndexManifestKind = "native-table-name-index";
const nameIndexManifestSchemaVersion = 1;
const nameIndexRecordIdSuffix = "_names";
const maximumIdentifierFieldCount = 2;
const nameIndexReadsBySignal = new WeakMap<AbortSignal, Map<string, Promise<NativeTableNameIndexRead>>>();

export function nameIndexRecordId(tableId: string): string {
  if (!tableIdPattern.test(tableId)) throw new RangeError("Name index table must be a lower-case inventory table name.");
  return `${tableId.replace(/-/g, "_")}${nameIndexRecordIdSuffix}`;
}

function invalidNameIndex(manifest: string, problem: string): Error {
  return new Error(`Native table name index ${manifest} is invalid: ${problem}.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLineageIdentifierValue(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function decodeNameIndexJson(bytes: Uint8Array, manifest: string): unknown {
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw invalidNameIndex(manifest, "not UTF-8 JSON"); }
}

function readIdentifierFields(value: unknown, manifest: string): readonly string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > maximumIdentifierFieldCount ||
    !value.every(field => typeof field === "string" && field.length > 0)) {
    throw invalidNameIndex(manifest, "identifierFields must list one or two field names");
  }
  return value as string[];
}

function readNameEntries(value: unknown, identifierFields: readonly string[], nameField: string, manifest: string): NativeTableNameEntry[] {
  if (!Array.isArray(value)) throw invalidNameIndex(manifest, "entries must be a list");
  return value.map((entry: unknown, sourceOrder) => {
    if (!isRecord(entry)) throw invalidNameIndex(manifest, `entry ${sourceOrder} is not an object`);
    const identifiers = identifierFields.map(field => entry[field]);
    if (!identifiers.every(isLineageIdentifierValue)) throw invalidNameIndex(manifest, `entry ${sourceOrder} has an identifier that is not a safe non-negative integer`);
    const name = entry[nameField];
    if (typeof name !== "string") throw invalidNameIndex(manifest, `entry ${sourceOrder} has no string ${nameField}`);
    return Object.freeze({ identifiers: Object.freeze(identifiers), name, sourceOrder });
  });
}

function parseNameIndexManifest(input: unknown, tableId: string, record: NativeTableCatalogRecord) {
  const manifest = record.manifest;
  if (!isRecord(input)) throw invalidNameIndex(manifest, "not an object");
  if (input.kind !== nameIndexManifestKind || input.schemaVersion !== nameIndexManifestSchemaVersion) {
    throw invalidNameIndex(manifest, `kind must be ${nameIndexManifestKind} version ${nameIndexManifestSchemaVersion}`);
  }
  if (input.table !== tableId) throw invalidNameIndex(manifest, `table must be ${tableId}`);
  const identifierFields = readIdentifierFields(input.identifierFields, manifest);
  const nameField = input.nameField;
  if (typeof nameField !== "string" || nameField.length === 0) throw invalidNameIndex(manifest, "nameField must be a field name");
  const entries = readNameEntries(input.entries, identifierFields, nameField, manifest);
  if (input.entryCount !== entries.length || record.recordCount !== entries.length) {
    throw invalidNameIndex(manifest, "entryCount must equal the entry list length and the catalog recordCount");
  }
  return { identifierFields, entries: Object.freeze(entries) };
}

async function fetchNativeTableNameIndex(tableId: string, signal: AbortSignal): Promise<NativeTableNameIndexRead> {
  const recordId = nameIndexRecordId(tableId), key = tableCatalogKey(recordId);
  const catalog = await readNativeCatalog(signal);
  const record = catalog.tables.map(readTableCatalogRecord).find(tableRecord => tableRecord.table === recordId);
  if (record === undefined) return { status: "not-in-catalog", key, reason: `${recordId} has no tables record in the served catalog` };
  const bytes = await fetchVerifiedNativeResource(record.manifest, record.manifestSha256, signal, record.manifestBytes);
  const { identifierFields, entries } = parseNameIndexManifest(decodeNameIndexJson(bytes, record.manifest), tableId, record);
  signal.throwIfAborted();
  return { status: "converted", key, manifest: record.manifest, identifierFields, entries };
}

export function readNativeTableNameIndex(tableId: string, signal: AbortSignal): Promise<NativeTableNameIndexRead> {
  const readsByTable = nameIndexReadsBySignal.get(signal) ?? new Map<string, Promise<NativeTableNameIndexRead>>();
  nameIndexReadsBySignal.set(signal, readsByTable);
  const pendingRead = readsByTable.get(tableId);
  if (pendingRead) return pendingRead;
  const nameIndexRead = fetchNativeTableNameIndex(tableId, signal);
  readsByTable.set(tableId, nameIndexRead);
  nameIndexRead.catch(() => {
    if (readsByTable.get(tableId) === nameIndexRead) readsByTable.delete(tableId);
  });
  return nameIndexRead;
}
