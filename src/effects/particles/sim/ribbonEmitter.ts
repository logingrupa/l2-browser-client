import { float32Difference, float32Scaled, float32Sum, float32Vector, type Vector3 } from "../../../shared/math/vector3";
import type { RandomStream } from "../../../shared/random";
import { PARTICLE_CONSTANTS } from "./emitterConstants";
import type { RibbonEmitterRecord } from "./emitterRecords";
import { createParticleEmitterSimulation, type ParticleEmitterSimulation } from "./particleEmitter";
import { PARTICLE_FLAG, hasParticleFlag, type EmitterClassOverrides, type EmitterRuntime } from "./particleState";

export interface RibbonPoint {
  readonly location: Vector3;
  readonly locationUnder: Vector3;
  readonly width: number;
}

export type RibbonPointSource = (ribbonWidth: number) => RibbonPoint;

export interface RibbonEmitterSimulation extends ParticleEmitterSimulation {
  readonly kind: "ribbon";
  readonly record: RibbonEmitterRecord;
  readonly pointLimit: number;
  ribbonPoints(): readonly RibbonPoint[];
  attachPointSource(source: RibbonPointSource | null): void;
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

export const RIBBON_POINT_DROP = { none: 0, byPoint: 1, byTime: 2, byTimeDual: 3 } as const;

interface StoredRibbonPoint extends RibbonPoint {
  readonly movingDirection: Vector3;
  readonly movingDirectionUnder: Vector3;
}

const weaponTrailRule = PARTICLE_CONSTANTS.weaponTrail.runtimeDefault;
const weaponTrailCasterGate = PARTICLE_CONSTANTS.weaponTrailCasterGate.runtimeDefault;
const interpolationRule = PARTICLE_CONSTANTS.ribbonInterpolation.runtimeDefault;
const zeroVector: Vector3 = { x: 0, y: 0, z: 0 };
const curveInsertIndex = 3;

const isZeroVector = (vector: Vector3) => vector.x === 0 && vector.y === 0 && vector.z === 0;
const storedPoint = (location: Vector3, locationUnder: Vector3, width: number): StoredRibbonPoint =>
  ({ location, locationUnder, width, movingDirection: zeroVector, movingDirectionUnder: zeroVector });

function dividedByFloatReciprocal(vector: Vector3, divisor: number): Vector3 {
  return float32Scaled(vector, Math.fround(1 / divisor));
}

function float32PointDistance(from: Vector3, to: Vector3): number {
  const squaredStep = (fromComponent: number, toComponent: number) => {
    const step = Math.fround(toComponent - fromComponent);
    return Math.fround(step * step);
  };
  return Math.fround(Math.sqrt(squaredStep(from.x, to.x) + squaredStep(from.y, to.y) + squaredStep(from.z, to.z)));
}

function ribbonCurvePoint(farPoint: Vector3, nearPoint: Vector3, farDirection: Vector3, nearDirection: Vector3, alpha: number): Vector3 {
  const alphaCubed = Math.pow(alpha, 3), alphaSquared = Math.pow(alpha, 2);
  const farPointWeight = Math.fround(alphaCubed * 2 - alphaSquared * 3 + 1);
  const nearPointWeight = Math.fround(alphaSquared * 3 - (alphaCubed + alphaCubed));
  const farDirectionWeight = Math.fround(alphaCubed - alphaSquared * 2 + alpha);
  const nearDirectionWeight = Math.fround(alphaCubed - alphaSquared);
  const pointsBlend = float32Sum(float32Scaled(farPoint, farPointWeight), float32Scaled(nearPoint, nearPointWeight));
  return float32Sum(float32Sum(pointsBlend, float32Scaled(farDirection, farDirectionWeight)), float32Scaled(nearDirection, nearDirectionWeight));
}

export function attachWeaponTrail(record: RibbonEmitterRecord, attachment: WeaponTrailAttachment): WeaponTrail | null {
  if (attachment.casterEntityKind === weaponTrailCasterGate.skippedCasterEntityKind) return null;
  const { weaponLength, shotTimeSeconds } = attachment;
  if (!Number.isFinite(weaponLength) || !Number.isFinite(shotTimeSeconds)) {
    throw new RangeError(`Weapon trail needs a finite weapon length and shot time, not ${weaponLength} and ${shotTimeSeconds}.`);
  }
  if (!(Math.fround(weaponLength) > 0)) return null;
  const shotTime = Math.fround(shotTimeSeconds);
  const endOffset = Math.fround(Math.fround(weaponLength) * weaponTrailRule.endOffsetPerWeaponLength);
  const emitter = Object.freeze({
    ...record,
    StartBoneOffset: { x: Math.fround(endOffset * weaponTrailRule.startOffsetPerEndOffset), y: 0, z: 0 },
    EndBoneOffset: { x: endOffset, y: 0, z: 0 },
    RibbonWidth: endOffset,
    ThresholdTime: Math.fround(weaponTrailRule.thresholdTimePerShotTime * shotTime),
    ThresholdTime2: shotTime,
    FadeOutStartTime: shotTime,
    FadeInEndTime: Math.fround(shotTime / weaponTrailRule.fadeInEndTimeShotTimeDivisor),
  });
  return { emitter, actorLifeSpanSeconds: Math.fround(shotTime + weaponTrailRule.actorLifeSpanAfterShotSeconds) };
}

export function createRibbonEmitterSimulation(record: RibbonEmitterRecord, stream: RandomStream): RibbonEmitterSimulation {
  let points: StoredRibbonPoint[] = [], pointLimit = record.NumPoints, sampleTimer = 0, realSampleRate = 0, killed = false;
  let lastSampledPoint: RibbonPoint = storedPoint(zeroVector, zeroVector, 0), pointSource: RibbonPointSource | null = null;
  const ribbonRecord = (runtime: EmitterRuntime) => runtime.record as RibbonEmitterRecord;

  const setNewestSpanDirections = (current: RibbonEmitterRecord, location: Vector3, locationUnder: Vector3) => {
    const olderPoint = points[curveInsertIndex]!, scaleRatio = Math.fround(current.ScaleRatio);
    points[2] = {
      ...points[2]!,
      movingDirection: dividedByFloatReciprocal(float32Difference(location, olderPoint.location), Math.fround(scaleRatio * interpolationRule.startTangentDivisor)),
      movingDirectionUnder: dividedByFloatReciprocal(float32Difference(locationUnder, olderPoint.locationUnder), Math.fround(scaleRatio * interpolationRule.endTangentDivisor)),
    };
  };
  const insertCurvePoints = (current: RibbonEmitterRecord, width: number) => {
    const nearPoint = points[2]!, farPoint = points[curveInsertIndex]!, insertedCount = current.CntrPoints - 1;
    if (insertedCount < 0) {
      points.splice(curveInsertIndex + insertedCount, -insertedCount);
      return;
    }
    const curvePoints = Array.from({ length: insertedCount }, (_, index) => {
      const alpha = 1 - Math.fround(index + 1) / current.CntrPoints;
      return storedPoint(
        ribbonCurvePoint(farPoint.location, nearPoint.location, farPoint.movingDirection, nearPoint.movingDirection, alpha),
        ribbonCurvePoint(farPoint.locationUnder, nearPoint.locationUnder, farPoint.movingDirectionUnder, nearPoint.movingDirectionUnder, alpha),
        width);
    });
    points.splice(curveInsertIndex, 0, ...curvePoints);
  };
  const dropPoints = (current: RibbonEmitterRecord, particleTime: number) => {
    const { AccDrop, PointsDropRate, MinPoints } = current, pointCount = points.length;
    const droppedByTime = (AccDrop === RIBBON_POINT_DROP.byTime || AccDrop === RIBBON_POINT_DROP.byTimeDual) && Math.fround(current.ThresholdTime) <= particleTime;
    if (pointCount >= PointsDropRate + MinPoints && (AccDrop === RIBBON_POINT_DROP.byPoint && pointCount >= pointLimit || droppedByTime)) pointLimit -= PointsDropRate;
    else if (AccDrop === RIBBON_POINT_DROP.byTimeDual && Math.fround(current.ThresholdTime2) <= particleTime) pointLimit = Math.max(0, pointLimit - 1);
    if (pointLimit < 0) throw new RibbonEmitterError(current.object, `NumPoints fell to ${pointLimit}; Interlude asserts on the negative remove index.`);
    if (points.length > pointLimit) points.length = pointLimit;
  };
  const samplePoints = (current: RibbonEmitterRecord, deltaSeconds: number, particleTime: number) => {
    if (pointSource === null) return;
    const sample = pointSource(Math.fround(current.RibbonWidth)), location = float32Vector(sample.location);
    if (isZeroVector(location)) return;
    const locationUnder = float32Vector(sample.locationUnder), width = Math.fround(sample.width), firstPoint = points.length === 0;
    points[0] = firstPoint ? storedPoint(location, locationUnder, width) : { ...points[0]!, location, locationUnder };
    sampleTimer = Math.fround(sampleTimer + deltaSeconds);
    let stopped = false;
    if (sampleTimer >= realSampleRate) {
      const movedDistance = float32PointDistance(lastSampledPoint.locationUnder, locationUnder) + float32PointDistance(lastSampledPoint.location, location);
      if (firstPoint || !(Math.fround(current.MinSampleDist) <= movedDistance)) {
        sampleTimer = realSampleRate;
        stopped = true;
      } else {
        sampleTimer = 0;
        const sampledPoint = storedPoint(location, locationUnder, width);
        points.splice(1, 0, sampledPoint);
        lastSampledPoint = sampledPoint;
        if (current.bUseInterpolation && points.length >= interpolationRule.tangentFromPointCount) setNewestSpanDirections(current, location, locationUnder);
        if (current.bUseInterpolation && points.length >= interpolationRule.insertFromPointCount) insertCurvePoints(current, width);
      }
    }
    if (current.bDecayPoints && stopped) {
      if (points.length > 1) points.pop();
      sampleTimer = 0;
    }
    dropPoints(current, particleTime);
  };
  const decayStoppedRibbon = (current: RibbonEmitterRecord, runtime: EmitterRuntime, deltaSeconds: number) => {
    const { columns, counters } = runtime;
    if (counters.killPending && !killed) {
      killed = true;
      if (current.bSyncDecayWhenKilled) realSampleRate = Math.fround((columns.maxLifetime[0]! - columns.time[0]!) / (points.length - 1));
    }
    if (!current.bDecayPointsWhenStopped || points.length === 0) return;
    sampleTimer = Math.fround(sampleTimer + deltaSeconds);
    if (sampleTimer >= realSampleRate) {
      sampleTimer = 0;
      points.pop();
    }
  };
  const ribbonOverrides: EmitterClassOverrides = {
    afterInitialize(runtime) {
      sampleTimer = realSampleRate = Math.fround(ribbonRecord(runtime).SampleRate);
      killed = false;
    },
    afterSpawnParticle(runtime) {
      const current = ribbonRecord(runtime);
      if (current.bSamplePoints) points = [];
      realSampleRate = Math.fround(current.SampleRate);
    },
    afterUpdateParticles(runtime, stepSeconds) {
      const { columns, counters } = runtime, current = ribbonRecord(runtime), deltaSeconds = Math.fround(stepSeconds);
      if (columns.capacity === 0 || !hasParticleFlag(columns, 0, PARTICLE_FLAG.active)) return;
      if (current.bSamplePoints && !counters.killPending) samplePoints(current, deltaSeconds, columns.time[0]!);
      else decayStoppedRibbon(current, runtime, deltaSeconds);
    },
  };
  const simulation = createParticleEmitterSimulation(record, stream, record.UniformSize, ribbonOverrides);
  const ribbon = Object.assign(simulation as ParticleEmitterSimulation & { readonly record: RibbonEmitterRecord }, {
    kind: "ribbon" as const,
    ribbonPoints: (): readonly RibbonPoint[] => points.map(({ location, locationUnder, width }) => ({ location: { ...location }, locationUnder: { ...locationUnder }, width })),
    attachPointSource(source: RibbonPointSource | null) { pointSource = source; },
  });
  return Object.defineProperty(ribbon, "pointLimit", { get: () => pointLimit, enumerable: true }) as RibbonEmitterSimulation;
}
