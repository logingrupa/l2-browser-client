import { float32Difference, float32Scaled, float32Sum, float32Vector, type Vector3 } from "../../../shared/math/vector3";
import type { RandomStream } from "../../../shared/random";
import { PARTICLE_CONSTANTS } from "./emitterConstants";
import type { RibbonEmitterRecord } from "./emitterRecords";
import { createParticleEmitterSimulation, type ParticleEmitterSimulation } from "./particleEmitter";
import { PARTICLE_FLAG, hasParticleFlag, writeSlotVector, type EmitterClassOverrides, type EmitterRuntime } from "./particleState";

export interface RibbonPoint {
  readonly location: Vector3;
  readonly locationUnder: Vector3;
  readonly width: number;
}

export type RibbonPointSource = (ribbonWidth: number) => RibbonPoint;

export interface RibbonEmitterSimulation extends ParticleEmitterSimulation {
  readonly kind: "ribbon";
  readonly record: RibbonEmitterRecord;
  readonly numPoints: number;
  readonly bDecaying: boolean;
  ribbonPoints(): readonly RibbonPoint[];
  attachPointSource(source: RibbonPointSource): void;
}

export interface WeaponTrailAttachment {
  readonly casterEntityKind: string;
  readonly weaponLength: number;
  readonly shotTimeSeconds: number;
}

export interface WeaponTrail {
  readonly emitter: RibbonEmitterRecord;
  readonly actorLifeSpanSeconds: number;
}

export class RibbonEmitterError extends Error {
  constructor(emitterObject: string, message: string) {
    super(`RibbonEmitter ${emitterObject}: ${message}`);
    this.name = "RibbonEmitterError";
  }
}

const ACC_DROP = { none: 0, byPoint: 1, byTime: 2, byTimeDual: 3 } as const;

interface RibbonPointWithMovingDirections extends RibbonPoint {
  readonly movingDirection: Vector3;
  readonly movingDirectionUnder: Vector3;
}

const weaponTrailRule = PARTICLE_CONSTANTS.weaponTrail.runtimeDefault;
const weaponTrailCasterGate = PARTICLE_CONSTANTS.weaponTrailCasterGate.runtimeDefault;
const ribbonInterpolationRule = PARTICLE_CONSTANTS.ribbonInterpolation.runtimeDefault;
const zeroVector: Vector3 = { x: 0, y: 0, z: 0 };
const cntrPointsInsertIndex = 3;
const particlesZeroSlot = 0;

const fVectorEquals = (left: Vector3, right: Vector3) => left.x === right.x && left.y === right.y && left.z === right.z;
const float32RibbonPoint = ({ location, locationUnder, width }: RibbonPoint): RibbonPoint =>
  ({ location: float32Vector(location), locationUnder: float32Vector(locationUnder), width: Math.fround(width) });
const ribbonPointWithZeroMovingDirections = ({ location, locationUnder, width }: RibbonPoint): RibbonPointWithMovingDirections =>
  ({ location, locationUnder, width, movingDirection: zeroVector, movingDirectionUnder: zeroVector });
const getNewRibbonPointWritingOnlyWidth: RibbonPointSource = ribbonWidth => ({ location: zeroVector, locationUnder: zeroVector, width: ribbonWidth });

function fVectorDivideAssign(vector: Vector3, divisor: number): Vector3 {
  return float32Scaled(vector, Math.fround(1 / divisor));
}

function fDist(vector1: Vector3, vector2: Vector3): number {
  const float32SquaredDifference = (component1: number, component2: number) => {
    const difference = Math.fround(component2 - component1);
    return Math.fround(difference * difference);
  };
  return Math.fround(Math.sqrt(
    float32SquaredDifference(vector1.x, vector2.x) + float32SquaredDifference(vector1.y, vector2.y) + float32SquaredDifference(vector1.z, vector2.z)));
}

function fDistSumFromLastSampledPoint(lastSampledPoint: RibbonPoint, newRibbonPoint: RibbonPoint): number {
  return fDist(lastSampledPoint.locationUnder, newRibbonPoint.locationUnder) + fDist(lastSampledPoint.location, newRibbonPoint.location);
}

function cubicInterpWithPointsFirst(point0: Vector3, point1: Vector3, tangent0: Vector3, tangent1: Vector3, alpha: number): Vector3 {
  const alphaCubed = Math.pow(alpha, 3), alphaSquared = Math.pow(alpha, 2);
  const point0Weight = Math.fround(alphaCubed * 2 - alphaSquared * 3 + 1);
  const point1Weight = Math.fround(alphaSquared * 3 - (alphaCubed + alphaCubed));
  const tangent0Weight = Math.fround(alphaCubed - alphaSquared * 2 + alpha);
  const tangent1Weight = Math.fround(alphaCubed - alphaSquared);
  const weightedPoints = float32Sum(float32Scaled(point0, point0Weight), float32Scaled(point1, point1Weight));
  return float32Sum(float32Sum(weightedPoints, float32Scaled(tangent0, tangent0Weight)), float32Scaled(tangent1, tangent1Weight));
}

export function attachWeaponTrail(record: RibbonEmitterRecord, attachment: WeaponTrailAttachment): WeaponTrail | null {
  if (attachment.casterEntityKind === weaponTrailCasterGate.skippedCasterEntityKind) return null;
  const { weaponLength, shotTimeSeconds } = attachment;
  if (!Number.isFinite(weaponLength) || !Number.isFinite(shotTimeSeconds)) {
    throw new RangeError(`Weapon trail needs a finite weapon length and shot time, not ${weaponLength} and ${shotTimeSeconds}.`);
  }
  if (!(Math.fround(weaponLength) > 0)) return null;
  const shotTime = Math.fround(shotTimeSeconds);
  const actorLifeSpanSeconds = Math.fround(shotTime + weaponTrailRule.actorLifeSpanAfterShotSeconds);
  const unroundedEndOffset = Math.fround(weaponLength) * weaponTrailRule.endOffsetPerWeaponLength;
  const endOffset = Math.fround(unroundedEndOffset);
  const emitter = Object.freeze({
    ...record,
    EndBoneOffset: { x: endOffset, y: 0, z: 0 },
    StartBoneOffset: { x: Math.fround(unroundedEndOffset * weaponTrailRule.startOffsetPerEndOffset), y: 0, z: 0 },
    RibbonWidth: endOffset,
    FadeOutStartTime: shotTime,
    FadeInEndTime: Math.fround(shotTime / weaponTrailRule.fadeInEndTimeShotTimeDivisor),
    ThresholdTime: Math.fround(weaponTrailRule.thresholdTimePerShotTime * shotTime),
    ThresholdTime2: shotTime,
  });
  return { emitter, actorLifeSpanSeconds };
}

export function createRibbonEmitterSimulation(record: RibbonEmitterRecord, stream: RandomStream): RibbonEmitterSimulation {
  let ribbonPoints: RibbonPointWithMovingDirections[] = [];
  let numPoints = record.NumPoints;
  let sampleTimer = 0;
  let realSampleRate = 0;
  let bKilled = false;
  let bDecaying = false;
  let lastSampledPoint = ribbonPointWithZeroMovingDirections({ location: zeroVector, locationUnder: zeroVector, width: 0 });
  let getNewRibbonPoint: RibbonPointSource = getNewRibbonPointWritingOnlyWidth;
  const ribbonEmitterRecordOf = (runtime: EmitterRuntime) => runtime.record as RibbonEmitterRecord;

  const setRibbonPoint2MovingDirections = (ribbonEmitterRecord: RibbonEmitterRecord, newRibbonPoint: RibbonPoint) => {
    const ribbonPoint3 = ribbonPoints[3]!, scaleRatio = Math.fround(ribbonEmitterRecord.ScaleRatio);
    ribbonPoints[2] = {
      ...ribbonPoints[2]!,
      movingDirection: fVectorDivideAssign(float32Difference(newRibbonPoint.location, ribbonPoint3.location),
        Math.fround(scaleRatio * ribbonInterpolationRule.startTangentDivisor)),
      movingDirectionUnder: fVectorDivideAssign(float32Difference(newRibbonPoint.locationUnder, ribbonPoint3.locationUnder),
        Math.fround(scaleRatio * ribbonInterpolationRule.endTangentDivisor)),
    };
  };
  const insertCntrPointsBeforeRibbonPoint3 = (ribbonEmitterRecord: RibbonEmitterRecord, width: number) => {
    const ribbonPoint2 = ribbonPoints[2]!, ribbonPoint3 = ribbonPoints[3]!, cntrPoints = ribbonEmitterRecord.CntrPoints, insertCount = cntrPoints - 1;
    if (insertCount < 0) {
      ribbonPoints.splice(cntrPointsInsertIndex + insertCount, -insertCount);
      return;
    }
    const insertedPoints = Array.from({ length: insertCount }, (_, insertOffset) => {
      const alpha = 1 - Math.fround(insertOffset + 1) / cntrPoints;
      return ribbonPointWithZeroMovingDirections({
        location: cubicInterpWithPointsFirst(ribbonPoint3.location, ribbonPoint2.location, ribbonPoint3.movingDirection, ribbonPoint2.movingDirection, alpha),
        locationUnder: cubicInterpWithPointsFirst(
          ribbonPoint3.locationUnder, ribbonPoint2.locationUnder, ribbonPoint3.movingDirectionUnder, ribbonPoint2.movingDirectionUnder, alpha),
        width,
      });
    });
    ribbonPoints.splice(cntrPointsInsertIndex, 0, ...insertedPoints);
  };
  const applyAccDrop = (ribbonEmitterRecord: RibbonEmitterRecord, particlesZeroTime: number) => {
    const { AccDrop, PointsDropRate, MinPoints } = ribbonEmitterRecord;
    if (ribbonPoints.length >= PointsDropRate + MinPoints
      && (AccDrop === ACC_DROP.byPoint && ribbonPoints.length >= numPoints
        || (AccDrop === ACC_DROP.byTime || AccDrop === ACC_DROP.byTimeDual) && Math.fround(ribbonEmitterRecord.ThresholdTime) <= particlesZeroTime)) {
      numPoints -= PointsDropRate;
    } else if (AccDrop === ACC_DROP.byTimeDual && Math.fround(ribbonEmitterRecord.ThresholdTime2) <= particlesZeroTime) {
      numPoints -= 1;
      if (numPoints < 0) numPoints = 0;
    }
    while (ribbonPoints.length > numPoints) {
      if (ribbonPoints.length === 0) {
        throw new RibbonEmitterError(ribbonEmitterRecord.object, `NumPoints fell to ${numPoints}; TArray::Remove asserts on the remove index -1.`);
      }
      ribbonPoints.pop();
    }
  };
  const sampleWhenSampleTimerReachesRealSampleRate = (ribbonEmitterRecord: RibbonEmitterRecord, newRibbonPoint: RibbonPoint, ribbonPointsNumWasZero: boolean) => {
    if (!(sampleTimer >= realSampleRate)) return;
    if (ribbonPointsNumWasZero || !(Math.fround(ribbonEmitterRecord.MinSampleDist) <= fDistSumFromLastSampledPoint(lastSampledPoint, newRibbonPoint))) {
      sampleTimer = realSampleRate;
      if (!ribbonEmitterRecord.bDecayPoints) return;
      bDecaying = true;
      if (ribbonPoints.length > 1) ribbonPoints.pop();
      sampleTimer = 0;
      return;
    }
    bDecaying = false;
    sampleTimer = 0;
    ribbonPoints.splice(1, 0, ribbonPointWithZeroMovingDirections(newRibbonPoint));
    lastSampledPoint = ribbonPoints[1]!;
    if (!ribbonEmitterRecord.bUseInterpolation) return;
    if (ribbonPoints.length >= ribbonInterpolationRule.tangentFromPointCount) setRibbonPoint2MovingDirections(ribbonEmitterRecord, newRibbonPoint);
    if (ribbonPoints.length >= ribbonInterpolationRule.insertFromPointCount) insertCntrPointsBeforeRibbonPoint3(ribbonEmitterRecord, newRibbonPoint.width);
  };
  const updateWithSamplePointsAndNoKillPending = (ribbonEmitterRecord: RibbonEmitterRecord, deltaTime: number, particlesZeroTime: number) => {
    const newRibbonPoint = float32RibbonPoint(getNewRibbonPoint(Math.fround(ribbonEmitterRecord.RibbonWidth)));
    if (fVectorEquals(newRibbonPoint.location, zeroVector)) return;
    const ribbonPointsNumWasZero = ribbonPoints.length === 0;
    if (ribbonPointsNumWasZero) ribbonPoints.push(ribbonPointWithZeroMovingDirections(newRibbonPoint));
    ribbonPoints[0] = { ...ribbonPoints[0]!, location: newRibbonPoint.location, locationUnder: newRibbonPoint.locationUnder };
    sampleTimer = Math.fround(sampleTimer + deltaTime);
    sampleWhenSampleTimerReachesRealSampleRate(ribbonEmitterRecord, newRibbonPoint, ribbonPointsNumWasZero);
    applyAccDrop(ribbonEmitterRecord, particlesZeroTime);
  };
  const updateWithoutSamplePointsOrWithKillPending = (ribbonEmitterRecord: RibbonEmitterRecord, runtime: EmitterRuntime, deltaTime: number) => {
    const { columns, counters } = runtime;
    if (counters.killPending && !bKilled) {
      bKilled = true;
      if (ribbonEmitterRecord.bSyncDecayWhenKilled) {
        realSampleRate = Math.fround((columns.maxLifetime[particlesZeroSlot]! - columns.time[particlesZeroSlot]!) / (ribbonPoints.length - 1));
      }
    }
    if (!ribbonEmitterRecord.bDecayPointsWhenStopped || ribbonPoints.length === 0) return;
    bDecaying = true;
    sampleTimer = Math.fround(sampleTimer + deltaTime);
    if (!(sampleTimer >= realSampleRate)) return;
    sampleTimer = 0;
    ribbonPoints.pop();
  };
  const ribbonEmitterClassOverrides: EmitterClassOverrides = {
    afterInitialize(runtime) {
      sampleTimer = realSampleRate = Math.fround(ribbonEmitterRecordOf(runtime).SampleRate);
      bKilled = false;
    },
    afterSpawnParticle(runtime) {
      const ribbonEmitterRecord = ribbonEmitterRecordOf(runtime);
      if (ribbonEmitterRecord.bSamplePoints) ribbonPoints = [];
      realSampleRate = Math.fround(ribbonEmitterRecord.SampleRate);
    },
    afterUpdateParticles(runtime, stepSeconds, context) {
      const { columns, counters } = runtime, ribbonEmitterRecord = ribbonEmitterRecordOf(runtime), deltaTime = Math.fround(stepSeconds);
      if (columns.capacity === 0) return;
      if (!hasParticleFlag(columns, particlesZeroSlot, PARTICLE_FLAG.active)) return;
      writeSlotVector(columns.location, particlesZeroSlot, context.owner.location);
      if (!ribbonEmitterRecord.bSamplePoints || counters.killPending) updateWithoutSamplePointsOrWithKillPending(ribbonEmitterRecord, runtime, deltaTime);
      else updateWithSamplePointsAndNoKillPending(ribbonEmitterRecord, deltaTime, columns.time[particlesZeroSlot]!);
    },
  };
  const simulation = createParticleEmitterSimulation(record, stream, record.UniformSize, ribbonEmitterClassOverrides);
  const ribbon = Object.assign(simulation as ParticleEmitterSimulation & { readonly record: RibbonEmitterRecord }, {
    kind: "ribbon" as const,
    ribbonPoints: (): readonly RibbonPoint[] =>
      ribbonPoints.map(({ location, locationUnder, width }) => ({ location: { ...location }, locationUnder: { ...locationUnder }, width })),
    attachPointSource(source: RibbonPointSource) { getNewRibbonPoint = source; },
  });
  return Object.defineProperties(ribbon, {
    numPoints: { get: () => numPoints, enumerable: true },
    bDecaying: { get: () => bDecaying, enumerable: true },
  }) as RibbonEmitterSimulation;
}
