import type { ReferenceConstantStatus } from "../../../../shared/referenceConstant";

export type CollisionBackoffRule =
  | { readonly kind: "fixed-distance"; readonly distance: number }
  | { readonly kind: "clamped-fraction"; readonly fraction: number; readonly minimumDistance: number; readonly maximumDistance: number };

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

export interface FloorBandRules {
  readonly minimum: number;
  readonly maximum: number;
  readonly target: number;
}

export interface VerticalSpeedChangeRules {
  readonly speed: number;
  readonly horizontalFactor: number;
  readonly threshold: number;
}

export interface PawnSubstepRules {
  readonly frameCap: number;
  readonly maximumIterations: number;
  readonly maximumTick: number;
  readonly minimumTick: number;
  readonly maximumNested: number;
}

export interface PawnMovementRules {
  readonly maxStepHeight: number;
  readonly floorProbe: number;
  readonly floorBand: FloorBandRules;
  readonly minFloorZ: number;
  readonly maxStepSideZ: number;
  readonly stepUpRecursion: number;
  readonly safeNormalSquareSumMinimum: number;
  readonly steepSlide: number;
  readonly volumeGravity: number;
  readonly terminalVelocity: number;
  readonly waterlineProbe: number;
  readonly waterEntry: VerticalSpeedChangeRules;
  readonly waterExit: VerticalSpeedChangeRules;
  readonly flyingStepWallZ: number;
  readonly flyingLevelDotMinimum: number;
  readonly flyingLevelDotMaximum: number;
  readonly substeps: PawnSubstepRules;
  readonly arrivalSlack: number;
  readonly runStartFramesPerSecond: number;
  readonly walkMoveType: number;
  readonly runMoveType: number;
  readonly localPlayerYawRate: number;
  readonly otherPawnYawRate: number;
  readonly snapDistance: number;
  readonly teleportRaise: number;
  readonly serverPositionIsFeet: boolean;
}

export interface PositionReportRules {
  readonly cadenceSeconds: number;
  readonly stuckSeconds: number;
  readonly stuckDistance: number;
}

export interface BehindViewCameraRules {
  readonly zoomOffset: number;
  readonly traceExtent: number;
  readonly wallMargin: number;
  readonly traceDrop: number;
}

export interface MovementNativeRules {
  readonly rows: readonly MovementNativeRuleRow[];
  readonly pawn: PawnMovementRules;
  readonly reports: PositionReportRules;
  readonly camera: BehindViewCameraRules;
  readonly clickPickLength: number;
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
  const fixedDistanceBackoff = (id: string): CollisionBackoffRule => ({ kind: "fixed-distance", distance: numberRule(id) });
  const clampedFractionBackoff = (prefix: string): CollisionBackoffRule => {
    const backoff = {
      kind: "clamped-fraction" as const, fraction: numberRule(`${prefix}Fraction`),
      minimumDistance: numberRule(`${prefix}Minimum`), maximumDistance: numberRule(`${prefix}Maximum`),
    };
    if (backoff.minimumDistance > backoff.maximumDistance) throw new MovementRulesError(`${prefix} minimum exceeds its maximum.`);
    return backoff;
  };
  const verticalSpeedChange = (prefix: string): VerticalSpeedChangeRules => ({
    speed: numberRule(`${prefix}.speed`), horizontalFactor: numberRule(`${prefix}.horizontalFactor`), threshold: numberRule(`${prefix}.threshold`),
  });
  const floorBand: FloorBandRules = {
    minimum: numberRule("movement.floorBand.minimum"), maximum: numberRule("movement.floorBand.maximum"), target: numberRule("movement.floorBand.target"),
  };
  if (!(floorBand.minimum <= floorBand.target && floorBand.target <= floorBand.maximum)) throw new MovementRulesError("movement.floorBand target lies outside its band.");
  const walkMoveType = numberRule("movement.walkMoveType"), runMoveType = numberRule("movement.runMoveType");
  if (!Number.isInteger(walkMoveType) || !Number.isInteger(runMoveType) || walkMoveType === runMoveType) {
    throw new MovementRulesError("movement.walkMoveType and movement.runMoveType must be two different integers.");
  }
  return {
    rows,
    pawn: {
      maxStepHeight: numberRule("movement.maxStepHeight"),
      floorProbe: numberRule("movement.floorProbe"),
      floorBand,
      minFloorZ: numberRule("movement.minFloorZ"),
      maxStepSideZ: numberRule("movement.maxStepSideZ"),
      stepUpRecursion: numberRule("movement.stepUpRecursion"),
      safeNormalSquareSumMinimum: numberRule("movement.safeNormalSquareSumMinimum"),
      steepSlide: numberRule("movement.steepSlide"),
      volumeGravity: numberRule("movement.volumeGravity"),
      terminalVelocity: numberRule("movement.terminalVelocity"),
      waterlineProbe: numberRule("movement.waterlineProbe"),
      waterEntry: verticalSpeedChange("movement.waterEntry"),
      waterExit: verticalSpeedChange("movement.waterExit"),
      flyingStepWallZ: numberRule("movement.flying.stepWallZ"),
      flyingLevelDotMinimum: numberRule("movement.flying.levelDotMinimum"),
      flyingLevelDotMaximum: numberRule("movement.flying.levelDotMaximum"),
      substeps: {
        frameCap: numberRule("movement.substeps.frameCap"),
        maximumIterations: numberRule("movement.substeps.maximumIterations"),
        maximumTick: numberRule("movement.substeps.maximumTick"),
        minimumTick: numberRule("movement.substeps.minimumTick"),
        maximumNested: numberRule("movement.substeps.maximumNested"),
      },
      arrivalSlack: numberRule("movement.arrivalSlack"),
      runStartFramesPerSecond: numberRule("movement.runStart"),
      walkMoveType,
      runMoveType,
      localPlayerYawRate: numberRule("movement.yawRate.localPlayer"),
      otherPawnYawRate: numberRule("movement.yawRate.otherPawn"),
      snapDistance: numberRule("movement.snapThresholds"),
      teleportRaise: numberRule("movement.teleportRaise"),
      serverPositionIsFeet: booleanRule("movement.serverPositionIsFeet"),
    },
    reports: {
      cadenceSeconds: numberRule("report.validatePositionCadence"),
      stuckSeconds: numberRule("report.stuckRule.seconds"),
      stuckDistance: numberRule("report.stuckRule.distance"),
    },
    camera: {
      zoomOffset: numberRule("camera.distance.zoomOffset"),
      traceExtent: numberRule("camera.distance.traceExtent"),
      wallMargin: numberRule("camera.distance.wallMargin"),
      traceDrop: numberRule("camera.distance.traceDrop"),
    },
    clickPickLength: numberRule("click.pickLength"),
    moveActorExtension: numberRule("collision.moveActorExtension"),
    nearZeroDelta: numberRule("collision.nearZeroDelta"),
    backoff: {
      bspRay: fixedDistanceBackoff("collision.backoff.bspRay"),
      bspBox: clampedFractionBackoff("collision.backoff.bspBox"),
      staticMesh: clampedFractionBackoff("collision.backoff.staticMesh"),
      terrain: fixedDistanceBackoff("collision.backoff.terrain"),
      pawnCylinder: fixedDistanceBackoff("collision.backoff.pawnCylinder"),
    },
    bspPushOutScale: numberRule("collision.bspPushOut"),
    bspSideEpsilon: numberRule("collision.bspTolerances.side"),
    parallelEpsilon: numberRule("collision.bspTolerances.parallel"),
    bevelAxisDotMinimum: numberRule("collision.bspTolerances.bevelAxisDot"),
    bevelCrossSquaredMinimum: numberRule("collision.bspTolerances.bevelCrossSquared"),
    hullBoxOffset: numberRule("collision.hullBoxOffsets"),
    hullPlaneLimit: numberRule("collision.hullPlaneLimit"),
    leafHullFlipBit: numberRule("collision.leafHullsEncoding"),
    notCsgNodeFlags: numberRule("collision.isCsg"),
    terrainMotionEpsilon: numberRule("collision.terrainTriangle"),
    terrainHolesDropCollision: booleanRule("collision.terrainHoles"),
    cylinderTimeOffset: numberRule("collision.cylinder.timeOffset"),
    cylinderInsideMargin: numberRule("collision.cylinder.insideMargin"),
    cylinderInwardDot: numberRule("collision.cylinder.inwardDot"),
  };
}

function clampBetween(value: number, minimum: number, maximum: number): number {
  return value < minimum ? minimum : value < maximum ? value : maximum;
}

function backoffTime(rule: CollisionBackoffRule, traceLength: number): number {
  if (rule.kind === "fixed-distance") return rule.distance / traceLength;
  return clampBetween(Math.fround(rule.fraction), Math.fround(rule.minimumDistance / traceLength), Math.fround(rule.maximumDistance / traceLength));
}

export function hitTimeAfterBackoff(rule: CollisionBackoffRule, hitTime: number, traceLength: number): number {
  return clampBetween(Math.fround(hitTime - backoffTime(rule, traceLength)), 0, 1);
}
