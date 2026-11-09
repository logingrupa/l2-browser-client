import { tileIdPattern } from "../../assets/native/nativeCatalogRecords";
import { parseNativeTileBspResource, type NativeTileBspResource } from "./nativeBspResources";

export type NativeTileVector = readonly [number, number, number];
export type NativeTileGapStatus = "pass" | "gap" | "pending" | "failed";

export interface NativeTileGapRow {
  readonly key: string;
  readonly part: string;
  readonly step: string;
  readonly status: NativeTileGapStatus;
  readonly reason: string | null;
}

export interface NativeTileSectorRange {
  readonly firstColumn: number;
  readonly lastColumn: number;
  readonly firstRow: number;
  readonly lastRow: number;
}

export interface NativeTileChunkTerrain {
  readonly resource: string;
  readonly sha256: string;
  readonly maskUvRule: "extrapolated";
}

export interface NativeTileChunkPlacement {
  readonly id: string;
  readonly modelId: string;
  readonly sourceActor: string;
  readonly exportIndex: number;
  readonly sourceMesh: string;
  readonly matrix: readonly number[];
  readonly materialOverrides: readonly [];
  readonly collision: Readonly<Record<string, unknown>>;
}

export interface NativeTileChunkModel {
  readonly id: string;
  readonly archive: string;
  readonly archiveSha256: string;
  readonly placements: readonly NativeTileChunkPlacement[];
}

export interface NativeTileChunkCollision {
  readonly resource: string;
  readonly sha256: string;
}

export interface NativeTileChunkManifest {
  readonly kind: "native-tile-chunk-runtime";
  readonly schemaVersion: 1;
  readonly tileId: string;
  readonly chunkId: string;
  readonly sectorRange: NativeTileSectorRange;
  readonly terrain: NativeTileChunkTerrain | null;
  readonly models: readonly NativeTileChunkModel[];
  readonly bsp: NativeTileBspResource | null;
  readonly collision: NativeTileChunkCollision | null;
  readonly gaps: readonly NativeTileGapRow[];
}

export const nativeTileSha256Pattern = /^[a-f0-9]{64}$/;
const chunkIdPattern = /^chunk-(\d{1,3})-(\d{1,3})$/;
const stepNamePattern = /^[a-z][a-z0-9-]{0,63}$/;
const qualifiedObjectPattern = /^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+$/;
const chunkTerrainResourcePattern = /^\/l2\/maps\/([a-f0-9]{64})\/native-tile-chunk-terrain\/terrain\.glb$/;
const modelArchivePattern = /^\/l2\/([a-f0-9]{64})\/asset\.l2asset$/;
const chunkCollisionResourcePattern = /^\/l2\/maps\/([a-f0-9]{64})\/native-tile-chunk-collision\/asset\.json$/;
const componentResourceFields = ["resource", "sha256"];
const gapStatuses: readonly NativeTileGapStatus[] = ["pass", "gap", "pending", "failed"];
const gapRowFields = ["key", "part", "step", "status", "reason", "sourceIdentity", "evidence"];
const chunkManifestFields = ["kind", "schemaVersion", "tileId", "chunkId", "sectorRange", "terrain", "models", "bsp", "collision", "gaps"];
const sectorRangeFields = ["firstColumn", "lastColumn", "firstRow", "lastRow"] as const;
const terrainFields = ["resource", "sha256", "maskUvRule"];
const modelFields = ["id", "archive", "archiveSha256", "placements"];
const placementFields = ["id", "modelId", "sourceActor", "exportIndex", "sourceMesh", "matrix", "materialOverrides", "collision"];
const chunkSectorSpan = 4;
const maximumChunkModels = 1024;
const maximumChunkPlacements = 4096;
const placementMatrixLength = 16;
const affineBottomRowIndices = [3, 7, 11] as const;
const minimumPlacementDeterminant = 1e-12;

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function hasExactKeys(value: unknown, fields: readonly string[]): value is Record<string, unknown> {
  if (!isPlainRecord(value)) return false;
  const keys = Object.keys(value);
  return keys.length === fields.length && fields.every(field => Object.hasOwn(value, field));
}

export function isFiniteVector(value: unknown): value is NativeTileVector {
  return Array.isArray(value) && value.length === 3 && value.every(component => typeof component === "number" && Number.isFinite(component));
}

export function isQualifiedObjectName(value: unknown): value is string {
  return typeof value === "string" && qualifiedObjectPattern.test(value);
}

export function nativeTileChunkGridPosition(chunkId: unknown): readonly [number, number] | null {
  const match = typeof chunkId === "string" ? chunkIdPattern.exec(chunkId) : null;
  return match ? [Number(match[1]), Number(match[2])] : null;
}

export function describeNativeTileGapRow(row: NativeTileGapRow): string {
  return `${row.step}: ${row.reason ?? row.status}`;
}

export function parseNativeTileGapRows(value: unknown, tileId: string, label: string): readonly NativeTileGapRow[] {
  if (!Array.isArray(value)) throw new Error(`${label} gaps must be a list.`);
  const rows = value.map(row => {
    if (!hasExactKeys(row, gapRowFields) || row.key !== `tile:${tileId}` || typeof row.part !== "string" || !row.part ||
      typeof row.step !== "string" || !stepNamePattern.test(row.step) || !gapStatuses.includes(row.status as NativeTileGapStatus) ||
      (row.status === "pass" ? row.reason !== null : typeof row.reason !== "string" || !row.reason)) {
      throw new Error(`${label} has an invalid gap row.`);
    }
    return { key: row.key, part: row.part, step: row.step, status: row.status as NativeTileGapStatus, reason: row.reason as string | null };
  });
  const steps = rows.map(row => row.step);
  if (new Set(steps).size !== steps.length || steps.some((step, index) => index > 0 && steps[index - 1]! > step)) {
    throw new Error(`${label} gap rows must name each step once, sorted by step.`);
  }
  return rows;
}

function parseSectorRange(value: unknown, column: number, row: number, label: string): NativeTileSectorRange {
  if (!hasExactKeys(value, sectorRangeFields) || !sectorRangeFields.every(field => Number.isSafeInteger(value[field]) && (value[field] as number) >= 0)) {
    throw new Error(`${label} sectorRange is invalid.`);
  }
  const range = value as unknown as NativeTileSectorRange;
  const spans = [range.lastColumn - range.firstColumn + 1, range.lastRow - range.firstRow + 1];
  if (range.firstColumn !== chunkSectorSpan * column || range.firstRow !== chunkSectorSpan * row ||
    spans.some(span => span < 1 || span > chunkSectorSpan)) {
    throw new Error(`${label} sectorRange does not match its chunk id.`);
  }
  return { firstColumn: range.firstColumn, lastColumn: range.lastColumn, firstRow: range.firstRow, lastRow: range.lastRow };
}

function parseChunkTerrain(value: unknown, label: string): NativeTileChunkTerrain {
  if (!hasExactKeys(value, terrainFields) || typeof value.sha256 !== "string" || !nativeTileSha256Pattern.test(value.sha256) ||
    typeof value.resource !== "string") {
    throw new Error(`${label} terrain is invalid.`);
  }
  if (chunkTerrainResourcePattern.exec(value.resource)?.[1] !== value.sha256) {
    throw new Error(`${label} terrain resource must be /l2/maps/<its sha256>/native-tile-chunk-terrain/terrain.glb.`);
  }
  if (value.maskUvRule !== "extrapolated") throw new Error(`${label} terrain maskUvRule is not supported.`);
  return { resource: value.resource, sha256: value.sha256, maskUvRule: "extrapolated" };
}

function parseChunkCollision(value: unknown, label: string): NativeTileChunkCollision {
  if (!hasExactKeys(value, componentResourceFields) || typeof value.sha256 !== "string" || !nativeTileSha256Pattern.test(value.sha256) ||
    typeof value.resource !== "string" || chunkCollisionResourcePattern.exec(value.resource)?.[1] !== value.sha256) {
    throw new Error(`${label} collision must be /l2/maps/<its sha256>/native-tile-chunk-collision/asset.json with its SHA-256.`);
  }
  return { resource: value.resource, sha256: value.sha256 };
}

function upperLeftDeterminant(matrix: readonly number[]): number {
  const [a, b, c, , d, e, f, , g, h, i] = matrix as [number, number, number, number, number, number, number, number, number, number, number];
  return a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
}

export function isAffinePlacementMatrix(value: unknown): value is readonly number[] {
  return Array.isArray(value) && value.length === placementMatrixLength &&
    value.every(component => typeof component === "number" && Number.isFinite(component)) &&
    affineBottomRowIndices.every(index => value[index] === 0) && value[15] === 1 &&
    Math.abs(upperLeftDeterminant(value)) >= minimumPlacementDeterminant;
}

function parseChunkPlacement(value: unknown, modelIds: ReadonlySet<string>, parentModelId: string, placementIds: Set<string>, label: string): NativeTileChunkPlacement {
  if (!hasExactKeys(value, placementFields) || typeof value.id !== "string" || !value.id || placementIds.has(value.id) ||
    typeof value.modelId !== "string" || !modelIds.has(value.modelId) || value.modelId !== parentModelId || !isQualifiedObjectName(value.sourceActor) ||
    !Number.isSafeInteger(value.exportIndex) || (value.exportIndex as number) < 1 || typeof value.sourceMesh !== "string" || !value.sourceMesh ||
    !isAffinePlacementMatrix(value.matrix) || !Array.isArray(value.materialOverrides) || value.materialOverrides.length ||
    !isPlainRecord(value.collision)) {
    throw new Error(`${label} has an invalid placement.`);
  }
  placementIds.add(value.id);
  return { id: value.id, modelId: value.modelId, sourceActor: value.sourceActor, exportIndex: value.exportIndex as number,
    sourceMesh: value.sourceMesh, matrix: value.matrix, materialOverrides: [], collision: value.collision };
}

function parseChunkModels(value: unknown, label: string): readonly NativeTileChunkModel[] {
  if (!Array.isArray(value) || value.length > maximumChunkModels) throw new Error(`${label} models must be a list of at most ${maximumChunkModels}.`);
  const modelIds = new Set<string>();
  for (const model of value) {
    if (!hasExactKeys(model, modelFields) || typeof model.id !== "string" || !model.id || modelIds.has(model.id) ||
      typeof model.archive !== "string" || typeof model.archiveSha256 !== "string" || !nativeTileSha256Pattern.test(model.archiveSha256) ||
      modelArchivePattern.exec(model.archive)?.[1] !== model.archiveSha256 || !Array.isArray(model.placements) || !model.placements.length) {
      throw new Error(`${label} has an invalid model.`);
    }
    modelIds.add(model.id);
  }
  const placementIds = new Set<string>();
  const models = value.map(model => ({ id: model.id as string, archive: model.archive as string, archiveSha256: model.archiveSha256 as string,
    placements: (model.placements as unknown[]).map(placement => parseChunkPlacement(placement, modelIds, model.id as string, placementIds, label)) }));
  if (placementIds.size > maximumChunkPlacements) throw new Error(`${label} lists more than ${maximumChunkPlacements} placements.`);
  return models;
}

function requireGapRowForMissingComponent(gaps: readonly NativeTileGapRow[], step: string, label: string): void {
  const row = gaps.find(gap => gap.step === step);
  if (!row || row.status === "pass") throw new Error(`${label} has no ${step}; it needs a ${step} gap row whose status is not pass.`);
}

export function parseNativeTileChunkManifest(input: unknown): NativeTileChunkManifest {
  if (!hasExactKeys(input, chunkManifestFields) || input.kind !== "native-tile-chunk-runtime" || input.schemaVersion !== 1 ||
    typeof input.tileId !== "string" || !tileIdPattern.test(input.tileId)) {
    throw new Error("Native tile chunk manifest kind, schema version or tile id is invalid.");
  }
  const position = nativeTileChunkGridPosition(input.chunkId);
  if (!position) throw new Error("Native tile chunk manifest chunkId must match chunk-<column>-<row>.");
  const chunkId = input.chunkId as string, label = `Native tile chunk manifest ${input.tileId} ${chunkId}`;
  const sectorRange = parseSectorRange(input.sectorRange, position[0], position[1], label);
  const gaps = parseNativeTileGapRows(input.gaps, input.tileId, label);
  if (input.bsp === null) requireGapRowForMissingComponent(gaps, "bsp", label);
  if (input.collision === null) requireGapRowForMissingComponent(gaps, "collision", label);
  if (input.terrain === null) requireGapRowForMissingComponent(gaps, "terrain", label);
  return { kind: "native-tile-chunk-runtime", schemaVersion: 1, tileId: input.tileId, chunkId, sectorRange,
    terrain: input.terrain === null ? null : parseChunkTerrain(input.terrain, label), models: parseChunkModels(input.models, label),
    bsp: input.bsp === null ? null : parseNativeTileBspResource(input.bsp), collision: input.collision === null ? null : parseChunkCollision(input.collision, label), gaps };
}
