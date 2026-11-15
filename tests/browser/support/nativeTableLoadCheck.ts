import { tableIdPattern, type NativeTableCatalogRecord } from "../../../src/assets/native/nativeCatalogRecords";
import { nameIndexRecordId } from "../../../src/ui/nativeTables/readNativeTableNameIndex";

const tableManifestKind = "native-table";
const tableNameIndexManifestKind = "native-table-name-index";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function tableManifestMismatch(manifest: Record<string, unknown>, record: NativeTableCatalogRecord): string | null {
  if (manifest.table !== record.table) return `table ${JSON.stringify(manifest.table)} is not the catalog id ${record.table}`;
  if (manifest.recordCount !== record.recordCount) return `recordCount ${JSON.stringify(manifest.recordCount)} is not the catalog recordCount ${record.recordCount}`;
  return null;
}

function tableNameIndexManifestMismatch(manifest: Record<string, unknown>, record: NativeTableCatalogRecord): string | null {
  const sourceTable = manifest.table;
  if (typeof sourceTable !== "string" || !tableIdPattern.test(sourceTable) || nameIndexRecordId(sourceTable) !== record.table) {
    return `name index table ${JSON.stringify(sourceTable)} does not name the catalog id ${record.table}`;
  }
  if (manifest.entryCount !== record.recordCount) return `entryCount ${JSON.stringify(manifest.entryCount)} is not the catalog recordCount ${record.recordCount}`;
  return null;
}

export function nativeTableManifestMismatch(manifest: unknown, record: NativeTableCatalogRecord): string | null {
  if (!isPlainObject(manifest)) return "the manifest is not a JSON object";
  if (manifest.kind === tableManifestKind) return tableManifestMismatch(manifest, record);
  if (manifest.kind === tableNameIndexManifestKind) return tableNameIndexManifestMismatch(manifest, record);
  return `kind ${JSON.stringify(manifest.kind)} is not ${tableManifestKind} or ${tableNameIndexManifestKind}`;
}
