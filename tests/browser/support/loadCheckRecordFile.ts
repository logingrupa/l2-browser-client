import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readLaneOwnership } from "../../../scripts/check-lane-ownership.mjs";
import { NATIVE_STORE_LANE_CATALOG_SHA256_HEADER } from "../../../vite/nativeStoreRootPlugin";

export type LoadCheckStatus = "pass" | "failed";

export interface LoadCheckRecord {
  readonly key: string;
  readonly status: LoadCheckStatus;
  readonly reason: string | null;
  readonly atRiga: string;
  readonly assetManifestSchemaVersion: 1 | 2 | null;
}

export interface LoadCheckRecordFile {
  readonly schemaVersion: 1;
  readonly lane: string;
  readonly catalogSha256: string;
  readonly records: readonly LoadCheckRecord[];
}

const laneOwnershipFilePath = resolve(dirname(fileURLToPath(import.meta.url)), "../../../.planning/lanes.json");
const loadCheckRecordFileSchemaVersion = 1;
const loadCheckRecordFields = ["assetManifestSchemaVersion", "atRiga", "key", "reason", "status"];
const loadCheckRecordFileFields = ["catalogSha256", "lane", "records", "schemaVersion"];
const catalogSha256Pattern = /^[0-9a-f]{64}$/;
const rigaTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/;
const catalogKeyPatterns: Readonly<Record<string, RegExp>> = {
  tile: /^tile:\d{2}_\d{2}$/,
  map: /^map:[A-Za-z][A-Za-z0-9_]{0,63}$/,
  npc: /^npc:\d{1,9}$/,
  item: /^item:\d{1,9}$/,
  skill: /^skill:\d{1,9}:[1-9]\d{0,3}$/,
  table: /^table:[a-z][a-z0-9_]*(?:-[a-z])?$/,
  window: /^window:[A-Za-z][A-Za-z0-9_]{0,63}(?:#[1-9]\d{0,3})?$/,
  character: /^character:\d{1,4}$/,
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactlyFields(value: Record<string, unknown>, fields: readonly string[]): boolean {
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify(fields);
}

function requireLaneName(laneName: string): void {
  const laneNames = Object.keys(readLaneOwnership(laneOwnershipFilePath).lanes).sort();
  if (!laneNames.includes(laneName)) throw new Error(`load-check records: ${JSON.stringify(laneName)} is not a lane; use one of ${laneNames.join(", ")}`);
}

function requireCatalogSha256(catalogSha256: string): void {
  if (!catalogSha256Pattern.test(catalogSha256)) throw new Error(`load-check records: catalog SHA-256 ${JSON.stringify(catalogSha256)} is not 64 lowercase hex digits`);
}

function validateLoadCheckRecord(value: unknown): LoadCheckRecord {
  const refuse = (problem: string) => new Error(`load-check record ${JSON.stringify(value)} refused: ${problem}`);
  if (!isPlainObject(value) || !hasExactlyFields(value, loadCheckRecordFields)) throw refuse(`fields must be exactly ${loadCheckRecordFields.join(", ")}`);
  const { key, status, reason, atRiga, assetManifestSchemaVersion } = value;
  if (typeof key !== "string" || !Object.values(catalogKeyPatterns).some((pattern) => pattern.test(key))) {
    throw refuse(`key is not a catalog key (${Object.keys(catalogKeyPatterns).join(", ")})`);
  }
  if (status === "pass") {
    if (reason !== null) throw refuse("a pass has no reason");
  } else if (status === "failed") {
    if (typeof reason !== "string" || reason.trim() === "") throw refuse("a failed record needs a non-empty reason");
  } else {
    throw refuse("status must be pass or failed");
  }
  if (typeof atRiga !== "string" || !rigaTimestampPattern.test(atRiga)) throw refuse("atRiga must be ISO 8601 with the Riga offset");
  if (assetManifestSchemaVersion !== 1 && assetManifestSchemaVersion !== 2 && assetManifestSchemaVersion !== null) {
    throw refuse("assetManifestSchemaVersion must be 1, 2 or null");
  }
  return { key, status, reason, atRiga, assetManifestSchemaVersion };
}

function validateLoadCheckRecordFile(value: unknown, filePath: string, laneName: string, catalogSha256: string): LoadCheckRecordFile {
  const refuse = (problem: string) => new Error(`load-check record file ${filePath} refused: ${problem}`);
  if (!isPlainObject(value) || !hasExactlyFields(value, loadCheckRecordFileFields)) throw refuse(`fields must be exactly ${loadCheckRecordFileFields.join(", ")}`);
  if (value.schemaVersion !== loadCheckRecordFileSchemaVersion) throw refuse(`schemaVersion must be ${loadCheckRecordFileSchemaVersion}`);
  if (value.lane !== laneName) throw refuse(`lane ${JSON.stringify(value.lane)} is not ${laneName}`);
  if (value.catalogSha256 !== catalogSha256) throw refuse(`catalogSha256 ${JSON.stringify(value.catalogSha256)} is not ${catalogSha256}`);
  if (!Array.isArray(value.records)) throw refuse("records must be a list");
  const records = value.records.map(validateLoadCheckRecord);
  for (let index = 1; index < records.length; index += 1) {
    if ((records[index - 1]?.key ?? "") >= (records[index]?.key ?? "")) throw refuse("records must be sorted by key with one record per key");
  }
  return { schemaVersion: loadCheckRecordFileSchemaVersion, lane: laneName, catalogSha256, records };
}

export function loadCheckRecordFilePath(projectRoot: string, laneName: string, catalogSha256: string): string {
  requireLaneName(laneName);
  requireCatalogSha256(catalogSha256);
  return resolve(projectRoot, "artifacts/lane-store", laneName, "load-checks", `${catalogSha256}.json`);
}

export function readLoadCheckRecordFile(filePath: string, laneName: string, catalogSha256: string): readonly LoadCheckRecord[] {
  requireLaneName(laneName);
  requireCatalogSha256(catalogSha256);
  if (!existsSync(filePath)) return [];
  return validateLoadCheckRecordFile(JSON.parse(readFileSync(filePath, "utf8")), filePath, laneName, catalogSha256).records;
}

function writeFileAtomically(filePath: string, content: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const temporaryFilePath = join(dirname(filePath), `.${basename(filePath)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    writeFileSync(temporaryFilePath, content, { flag: "wx" });
    renameSync(temporaryFilePath, filePath);
  } finally {
    rmSync(temporaryFilePath, { force: true });
  }
}

export function writeLoadCheckRecordFile(filePath: string, laneName: string, catalogSha256: string, record: LoadCheckRecord): LoadCheckRecordFile {
  const validRecord = validateLoadCheckRecord(record);
  const records = [...readLoadCheckRecordFile(filePath, laneName, catalogSha256).filter((existing) => existing.key !== validRecord.key), validRecord];
  records.sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0));
  const recordFile: LoadCheckRecordFile = { schemaVersion: loadCheckRecordFileSchemaVersion, lane: laneName, catalogSha256, records };
  writeFileAtomically(filePath, `${JSON.stringify(recordFile, null, 2)}\n`);
  return recordFile;
}

export function readLoadCheckRecords(laneName: string, catalogSha256: string): readonly LoadCheckRecord[] {
  return readLoadCheckRecordFile(loadCheckRecordFilePath(process.cwd(), laneName, catalogSha256), laneName, catalogSha256);
}

export function writeLoadCheckRecord(laneName: string, catalogSha256: string, record: LoadCheckRecord): LoadCheckRecordFile {
  return writeLoadCheckRecordFile(loadCheckRecordFilePath(process.cwd(), laneName, catalogSha256), laneName, catalogSha256, record);
}

export async function servedLaneCatalogSha256(baseUrl: string): Promise<string> {
  const catalogUrl = new URL("/l2/catalog.json", baseUrl);
  const answer = await fetch(catalogUrl, { cache: "no-store", method: "HEAD" });
  if (!answer.ok) throw new Error(`served lane catalog ${catalogUrl.href} answered ${answer.status}`);
  const laneCatalogSha256 = answer.headers.get(NATIVE_STORE_LANE_CATALOG_SHA256_HEADER) ?? "";
  if (!catalogSha256Pattern.test(laneCatalogSha256)) {
    throw new Error(`served catalog ${catalogUrl.href} names no lane catalog SHA-256 in ${NATIVE_STORE_LANE_CATALOG_SHA256_HEADER}; serve it through NATIVE_STORE_ROOT`);
  }
  return laneCatalogSha256;
}
