import { nativeResourceUrl } from "./nativeResourceUrl";

export type NativeCoverageStatus = "pass" | "gap" | "pending" | "failed";
export type NativeCoverageLoads = "pass" | "failed" | "unverified";

export type NativeCoverageVerdict =
  | { readonly status: "pass"; readonly reason: null }
  | { readonly status: Exclude<NativeCoverageStatus, "pass">; readonly reason: string };

export type NativeCoverageStep = { readonly step: string } & NativeCoverageVerdict;

export type NativeCoverageRow = {
  readonly key: string;
  readonly part: string;
  readonly converted: boolean;
  readonly loads: NativeCoverageLoads;
  readonly steps: readonly NativeCoverageStep[];
} & NativeCoverageVerdict;

export interface NativeCoverage {
  readonly schemaVersion: 1;
  readonly catalogSha256: string;
  readonly rows: readonly NativeCoverageRow[];
}

export class NativeCoverageCatalogMismatchError extends Error {
  constructor(coverageCatalogSha256: string, servedCatalogSha256: string) {
    super(`Native coverage report is pinned to catalog ${coverageCatalogSha256}, but the served catalog is ${servedCatalogSha256}.`);
    this.name = "NativeCoverageCatalogMismatchError";
  }
}

const nativeCoveragePath = "/l2/coverage.json";
const maximumCoverageBytes = 33_554_432;
const htmlFallbackPage = /^\s*(?:<!doctype html|<html)/i;
const sha256Pattern = /^[a-f0-9]{64}$/;
const stepNamePattern = /^[a-z][a-z0-9-]{0,63}$/;
const coverageStatuses: ReadonlySet<string> = new Set<NativeCoverageStatus>(["pass", "gap", "pending", "failed"]);
const coverageLoads: ReadonlySet<string> = new Set<NativeCoverageLoads>(["pass", "failed", "unverified"]);
const coverageFields = ["schemaVersion", "catalogSha256", "storeRoot", "generatedAtRiga", "denominators", "parts", "rows"];
const rowFields = ["key", "part", "status", "reason", "converted", "loads", "steps"];
const stepFields = ["step", "status", "reason"];

function invalidCoverage(): Error {
  return new Error("Native coverage report is invalid.");
}

function exactObject(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw invalidCoverage();
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== fields.length || !fields.every(field => Object.hasOwn(record, field))) throw invalidCoverage();
  return record;
}

function plainObject(value: unknown): void {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw invalidCoverage();
}

function nonEmptyString(value: unknown): string {
  if (typeof value !== "string" || !value) throw invalidCoverage();
  return value;
}

function readCoverageVerdict(status: unknown, reason: unknown): NativeCoverageVerdict {
  if (typeof status !== "string" || !coverageStatuses.has(status)) throw invalidCoverage();
  if (status === "pass") {
    if (reason !== null) throw invalidCoverage();
    return { status, reason: null };
  }
  return { status: status as Exclude<NativeCoverageStatus, "pass">, reason: nonEmptyString(reason) };
}

function readCoverageStep(value: unknown): NativeCoverageStep {
  const step = exactObject(value, stepFields);
  if (typeof step.step !== "string" || !stepNamePattern.test(step.step)) throw invalidCoverage();
  return { step: step.step, ...readCoverageVerdict(step.status, step.reason) };
}

function readCoverageRow(value: unknown): NativeCoverageRow {
  const row = exactObject(value, rowFields);
  if (typeof row.converted !== "boolean" || typeof row.loads !== "string" || !coverageLoads.has(row.loads) || !Array.isArray(row.steps)) {
    throw invalidCoverage();
  }
  return { key: nonEmptyString(row.key), part: nonEmptyString(row.part), ...readCoverageVerdict(row.status, row.reason),
    converted: row.converted, loads: row.loads as NativeCoverageLoads, steps: row.steps.map(readCoverageStep) };
}

function validateNativeCoverage(input: unknown): NativeCoverage {
  const coverage = exactObject(input, coverageFields);
  if (coverage.schemaVersion !== 1 || typeof coverage.catalogSha256 !== "string" || !sha256Pattern.test(coverage.catalogSha256)) throw invalidCoverage();
  if (typeof coverage.storeRoot !== "string" || typeof coverage.generatedAtRiga !== "string") throw invalidCoverage();
  plainObject(coverage.denominators);
  plainObject(coverage.parts);
  if (!Array.isArray(coverage.rows)) throw invalidCoverage();
  const rows = coverage.rows.map(readCoverageRow);
  if (new Set(rows.map(row => row.key)).size !== rows.length) throw invalidCoverage();
  return { schemaVersion: 1, catalogSha256: coverage.catalogSha256, rows };
}

function decodeCoverageBody(bytes: Uint8Array): string {
  if (bytes.byteLength > maximumCoverageBytes) throw invalidCoverage();
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw invalidCoverage(); }
}

function parseCoverageBody(body: string): unknown {
  try { return JSON.parse(body); }
  catch { throw invalidCoverage(); }
}

export async function readNativeCoverageUnlessAbsent(signal: AbortSignal, servedCatalogSha256: string,
  fetchResource: typeof fetch = fetch): Promise<NativeCoverage | null> {
  signal.throwIfAborted();
  const response = await fetchResource(nativeResourceUrl(nativeCoveragePath), { signal });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Native coverage report returned HTTP ${response.status}.`);
  if (Number(response.headers.get("content-length") ?? 0) > maximumCoverageBytes) throw invalidCoverage();
  const bytes = new Uint8Array(await response.arrayBuffer());
  signal.throwIfAborted();
  const body = decodeCoverageBody(bytes);
  if (htmlFallbackPage.test(body)) return null;
  const coverage = validateNativeCoverage(parseCoverageBody(body));
  if (coverage.catalogSha256 !== servedCatalogSha256) throw new NativeCoverageCatalogMismatchError(coverage.catalogSha256, servedCatalogSha256);
  return coverage;
}
