export interface NativeTileManifestCatalogRecord {
  readonly tile: string; readonly tileCatalogId: string;
  readonly manifest: string; readonly manifestSha256: string; readonly manifestBytes: number;
}
export interface NativeTableCatalogRecord {
  readonly table: string; readonly manifest: string; readonly manifestSha256: string; readonly manifestBytes: number;
  readonly recordCount: number; readonly sourceSha256: string;
}
export interface NativeWindowCatalogRecord {
  readonly window: string; readonly manifest: string; readonly manifestSha256: string; readonly manifestBytes: number;
}

type PinnedManifestSliceName = "tiles" | "tables" | "windows";

interface PinnedManifestRecordShape {
  readonly fields: readonly string[];
  readonly idPattern: RegExp;
  readonly manifestPathPattern: RegExp;
  readonly maximumManifestBytes: number;
}

interface PinnedManifestFields { readonly id: string; readonly manifest: string; readonly manifestSha256: string; readonly manifestBytes: number }

const sha256Pattern = /^[a-f0-9]{64}$/;
const pinnedManifestRecordFields = ["id", "manifest", "manifestSha256", "manifestBytes"];
const pinnedManifestRecordShapes: Readonly<Record<PinnedManifestSliceName, PinnedManifestRecordShape>> = {
  tiles: { fields: pinnedManifestRecordFields, idPattern: /^\d{2}_\d{2}$/,
    manifestPathPattern: /^\/l2\/tiles\/(?<sha256>[a-f0-9]{64})\/tile\.json$/, maximumManifestBytes: 8_000_000 },
  tables: { fields: [...pinnedManifestRecordFields, "recordCount", "sourceSha256"], idPattern: /^[a-z][a-z0-9_]*(?:-[a-z])?$/,
    manifestPathPattern: /^\/l2\/tables\/(?<sha256>[a-f0-9]{64})\/(?<id>[a-z][a-z0-9_]*(?:-[a-z])?)\.json$/, maximumManifestBytes: 33_554_432 },
  windows: { fields: pinnedManifestRecordFields, idPattern: /^[A-Za-z][A-Za-z0-9_]{0,63}(?:#[1-9]\d{0,3})?$/,
    manifestPathPattern: /^\/l2\/windows\/(?<sha256>[a-f0-9]{64})\/window\.json$/, maximumManifestBytes: 8_000_000 },
};

function invalidCatalogRecord(sliceName: PinnedManifestSliceName): Error {
  return new Error(`Native catalog ${sliceName} entry is invalid.`);
}

function readPinnedManifestRecord(value: unknown, sliceName: PinnedManifestSliceName): PinnedManifestFields & Record<string, unknown> {
  const shape = pinnedManifestRecordShapes[sliceName];
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw invalidCatalogRecord(sliceName);
  const record = value as Record<string, unknown>;
  const recordFields = Object.keys(record);
  if (recordFields.length !== shape.fields.length || !shape.fields.every(field => Object.hasOwn(record, field))) throw invalidCatalogRecord(sliceName);
  const { id, manifest, manifestSha256, manifestBytes } = record;
  if (typeof id !== "string" || !shape.idPattern.test(id)) throw invalidCatalogRecord(sliceName);
  if (typeof manifestSha256 !== "string" || !sha256Pattern.test(manifestSha256)) throw invalidCatalogRecord(sliceName);
  const manifestPathMatch = typeof manifest === "string" ? shape.manifestPathPattern.exec(manifest) : null;
  if (!manifestPathMatch?.groups || manifestPathMatch.groups.sha256 !== manifestSha256) throw invalidCatalogRecord(sliceName);
  if (manifestPathMatch.groups.id !== undefined && manifestPathMatch.groups.id !== id) throw invalidCatalogRecord(sliceName);
  if (typeof manifestBytes !== "number" || !Number.isSafeInteger(manifestBytes) || manifestBytes < 1 || manifestBytes > shape.maximumManifestBytes) {
    throw invalidCatalogRecord(sliceName);
  }
  return { ...record, id, manifest: manifest as string, manifestSha256, manifestBytes };
}

export function readTileCatalogRecord(value: unknown): NativeTileManifestCatalogRecord {
  const { id, manifest, manifestSha256, manifestBytes } = readPinnedManifestRecord(value, "tiles");
  return { tile: id, tileCatalogId: id, manifest, manifestSha256, manifestBytes };
}

export function readTableCatalogRecord(value: unknown): NativeTableCatalogRecord {
  const { id, manifest, manifestSha256, manifestBytes, recordCount, sourceSha256 } = readPinnedManifestRecord(value, "tables");
  if (typeof recordCount !== "number" || !Number.isSafeInteger(recordCount) || recordCount < 0) throw invalidCatalogRecord("tables");
  if (typeof sourceSha256 !== "string" || !sha256Pattern.test(sourceSha256)) throw invalidCatalogRecord("tables");
  return { table: id, manifest, manifestSha256, manifestBytes, recordCount, sourceSha256 };
}

export function readWindowCatalogRecord(value: unknown): NativeWindowCatalogRecord {
  const { id, manifest, manifestSha256, manifestBytes } = readPinnedManifestRecord(value, "windows");
  return { window: id, manifest, manifestSha256, manifestBytes };
}
