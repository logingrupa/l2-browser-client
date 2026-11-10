import type { ReferenceConstantStatus } from "../../../../shared/referenceConstant";

export interface CollisionBackoffRule {
  readonly fraction: number;
  readonly minimum: number;
  readonly maximum: number;
}

export interface CollisionBackoffRules {
  readonly bspRay: CollisionBackoffRule;
  readonly bspBox: CollisionBackoffRule;
  readonly staticMesh: CollisionBackoffRule;
  readonly terrain: CollisionBackoffRule;
  readonly pawnCylinder: CollisionBackoffRule;
}

export interface MovementNativeRuleRow {
  readonly id: string;
  readonly status: ReferenceConstantStatus;
  readonly provenance: string;
  readonly interludeEvidence: string | null;
  readonly runtimeDefault: number | boolean;
}

export interface MovementNativeRules {
  readonly rows: readonly MovementNativeRuleRow[];
  readonly moveActorExtension: number;
  readonly nearZeroDelta: number;
  readonly backoff: CollisionBackoffRules;
  readonly bspPushOutScale: number;
  readonly bspSideEpsilon: number;
  readonly parallelEpsilon: number;
  readonly bevelAxisDotMinimum: number;
  readonly bevelCrossSquaredMinimum: number;
  readonly hullBoxOffset: number;
  readonly hullPlaneLimit: number;
  readonly leafHullFlipBit: number;
  readonly notCsgNodeFlags: number;
  readonly terrainMotionEpsilon: number;
  readonly terrainHolesDropCollision: boolean;
  readonly cylinderTimeOffset: number;
  readonly cylinderInsideMargin: number;
  readonly cylinderInwardDot: number;
}

export class MovementRulesError extends Error {
  constructor(message: string) {
    super(`recipes/world/movement-native-rules.json ${message}`);
    this.name = "MovementRulesError";
  }
}

const statusIsShared: Readonly<Record<ReferenceConstantStatus, true>> = {
  "ue2-data": true, unconfirmed: true, "confirmed-interlude": true, "corrected-interlude": true, unknown: true,
};
const statusesNeedingInterludeEvidence: ReadonlySet<string> = new Set(["confirmed-interlude", "corrected-interlude"]);

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isSharedStatus = (status: unknown): status is ReferenceConstantStatus => typeof status === "string" && Object.hasOwn(statusIsShared, status);

function readRuleRow(candidate: unknown, rowIndex: number): MovementNativeRuleRow {
  if (!isRecord(candidate)) throw new MovementRulesError(`row ${rowIndex} must be an object.`);
  const { id, status, provenance, interludeEvidence, runtimeDefault } = candidate;
  if (typeof id !== "string" || id.length === 0) throw new MovementRulesError(`row ${rowIndex} needs a non-empty id.`);
  if (!isSharedStatus(status)) throw new MovementRulesError(`row ${id} has the status ${JSON.stringify(status)} outside the shared vocabulary.`);
  if (typeof provenance !== "string" || provenance.trim().length === 0) throw new MovementRulesError(`row ${id} needs a provenance.`);
  if (!("value" in candidate)) throw new MovementRulesError(`row ${id} needs a value.`);
  if (interludeEvidence !== null && typeof interludeEvidence !== "string") throw new MovementRulesError(`row ${id} interludeEvidence must be null or text.`);
  if (statusesNeedingInterludeEvidence.has(status) && interludeEvidence === null) throw new MovementRulesError(`row ${id} is ${status} without interludeEvidence.`);
  if (typeof runtimeDefault === "boolean" || (typeof runtimeDefault === "number" && Number.isFinite(runtimeDefault))) {
    return { id, status, provenance, interludeEvidence, runtimeDefault };
  }
  throw new MovementRulesError(`row ${id} runtimeDefault must be a finite number or a boolean.`);
}

export function parseMovementNativeRules(document: unknown): MovementNativeRules {
  if (!isRecord(document) || document.schemaVersion !== 1 || !Array.isArray(document.rows)) {
    throw new MovementRulesError("must hold schemaVersion 1 and rows.");
  }
  const rows = document.rows.map(readRuleRow);
  const rowsById = new Map<string, MovementNativeRuleRow>();
  for (const row of rows) {
    if (rowsById.has(row.id)) throw new MovementRulesError(`holds the row ${row.id} twice.`);
    rowsById.set(row.id, row);
  }
  const numberRule = (id: string) => {
    const runtimeDefault = rowsById.get(id)?.runtimeDefault;
    if (typeof runtimeDefault !== "number") throw new MovementRulesError(`needs a numeric ${id} row.`);
    return runtimeDefault;
  };
  const booleanRule = (id: string) => {
    const runtimeDefault = rowsById.get(id)?.runtimeDefault;
    if (typeof runtimeDefault !== "boolean") throw new MovementRulesError(`needs a boolean ${id} row.`);
    return runtimeDefault;
  };
  const constantBackoff = (id: string): CollisionBackoffRule => ({ fraction: 0, minimum: numberRule(id), maximum: numberRule(id) });
  const scaledBackoff = (prefix: string): CollisionBackoffRule => {
    const backoff = { fraction: numberRule(`${prefix}-fraction`), minimum: numberRule(`${prefix}-minimum`), maximum: numberRule(`${prefix}-maximum`) };
    if (backoff.minimum > backoff.maximum) throw new MovementRulesError(`${prefix} minimum exceeds its maximum.`);
    return backoff;
  };
  return {
    rows,
    moveActorExtension: numberRule("collision.move-actor-extension"),
    nearZeroDelta: numberRule("collision.near-zero-delta"),
    backoff: {
      bspRay: constantBackoff("collision.backoff-bsp-ray"),
      bspBox: scaledBackoff("collision.backoff-bsp-box"),
      staticMesh: scaledBackoff("collision.backoff-static-mesh"),
      terrain: constantBackoff("collision.backoff-terrain"),
      pawnCylinder: constantBackoff("collision.backoff-pawn-cylinder"),
    },
    bspPushOutScale: numberRule("collision.bsp-push-out-scale"),
    bspSideEpsilon: numberRule("collision.bsp-side-epsilon"),
    parallelEpsilon: numberRule("collision.parallel-epsilon"),
    bevelAxisDotMinimum: numberRule("collision.bevel-axis-dot-minimum"),
    bevelCrossSquaredMinimum: numberRule("collision.bevel-cross-squared-minimum"),
    hullBoxOffset: numberRule("collision.hull-box-offset"),
    hullPlaneLimit: numberRule("collision.hull-plane-limit"),
    leafHullFlipBit: numberRule("collision.leaf-hull-flip-bit"),
    notCsgNodeFlags: numberRule("collision.not-csg-node-flags"),
    terrainMotionEpsilon: numberRule("collision.terrain-motion-epsilon"),
    terrainHolesDropCollision: booleanRule("collision.terrain-holes"),
    cylinderTimeOffset: numberRule("collision.cylinder-time-offset"),
    cylinderInsideMargin: numberRule("collision.cylinder-inside-margin"),
    cylinderInwardDot: numberRule("collision.cylinder-inward-dot"),
  };
}

export function backoffDistance(rule: CollisionBackoffRule, testLength: number): number {
  return Math.min(Math.max(rule.fraction * testLength, rule.minimum), rule.maximum);
}
