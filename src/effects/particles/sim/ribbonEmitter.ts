import { scaleVector, subtractVectors, vectorLength, type Vector3 } from "../../../shared/math/vector3";
import type { RandomStream } from "../../../shared/random";
import { PARTICLE_CONSTANTS } from "./emitterConstants";
import type { RibbonEmitterRecord } from "./emitterRecords";
import { createParticleEmitterSimulation, type ParticleEmitterSimulation } from "./particleEmitter";
import { PARTICLE_FLAG, hasParticleFlag, type EmitterStepContext } from "./particleState";

export interface RibbonPointSample {
  readonly start: Vector3;
  readonly end: Vector3;
}

export interface RibbonPoint extends RibbonPointSample {
  readonly width: number;
}

export type RibbonPointSource = () => RibbonPointSample | null;

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

export const RIBBON_POINT_DROP = { none: 0, byPoint: 1, byTime: 2, byTimeDual: 3 } as const;

const weaponTrailRule = PARTICLE_CONSTANTS.weaponTrail.runtimeDefault;
const interpolationRule = PARTICLE_CONSTANTS.ribbonInterpolation.runtimeDefault;
const zeroVector: Vector3 = { x: 0, y: 0, z: 0 };

interface SampledRibbonPoint extends RibbonPoint {
  readonly startTangent: Vector3;
  readonly endTangent: Vector3;
}

function float32Distance(left: Vector3, right: Vector3): number {
  return Math.fround(vectorLength(subtractVectors(left, right)));
}

function hermite(from: number, to: number, fromTangent: number, toTangent: number, parameter: number): number {
  const square = parameter * parameter, cube = square * parameter;
  return (2 * cube - 3 * square + 1) * from + (3 * square - 2 * cube) * to + (cube - 2 * square + parameter) * fromTangent + (cube - square) * toTangent;
}

function hermiteVector(from: Vector3, to: Vector3, fromTangent: Vector3, toTangent: Vector3, parameter: number): Vector3 {
  return {
    x: hermite(from.x, to.x, fromTangent.x, toTangent.x, parameter),
    y: hermite(from.y, to.y, fromTangent.y, toTangent.y, parameter),
    z: hermite(from.z, to.z, fromTangent.z, toTangent.z, parameter),
  };
}

export function attachWeaponTrail(record: RibbonEmitterRecord, attachment: WeaponTrailAttachment): WeaponTrail | null {
  if (attachment.casterEntityKind === weaponTrailRule.skippedCasterEntityKind) return null;
  const { weaponLength, shotTimeSeconds } = attachment;
  if (!(weaponLength > 0) || !(shotTimeSeconds > 0)) throw new RangeError(`Weapon trail needs a positive weapon length and shot time, not ${weaponLength} and ${shotTimeSeconds}.`);
  const endOffset = Math.fround(weaponLength * Math.fround(weaponTrailRule.endOffsetPerWeaponLength));
  const emitter = Object.freeze({
    ...record,
    StartBoneOffset: { x: Math.fround(weaponLength * Math.fround(weaponTrailRule.startOffsetPerWeaponLength)), y: 0, z: 0 },
    EndBoneOffset: { x: endOffset, y: 0, z: 0 },
    RibbonWidth: endOffset,
    ThresholdTime: Math.fround(shotTimeSeconds * weaponTrailRule.thresholdTimePerShotTime),
    ThresholdTime2: shotTimeSeconds,
    FadeOutStartTime: shotTimeSeconds,
    FadeInEndTime: Math.fround(shotTimeSeconds * Math.fround(weaponTrailRule.fadeInEndTimePerShotTime)),
  });
  return { emitter, actorLifeSpanSeconds: shotTimeSeconds + weaponTrailRule.actorLifeSpanAfterShotSeconds };
}

export function createRibbonEmitterSimulation(record: RibbonEmitterRecord, stream: RandomStream): RibbonEmitterSimulation {
  const simulation = createParticleEmitterSimulation(record, stream, record.UniformSize);
  let points: SampledRibbonPoint[] = [], pointLimit = record.NumPoints, sampleTimer = Math.fround(record.SampleRate);
  let realSampleRate = Math.fround(record.SampleRate), lastSampled: RibbonPointSample = { start: zeroVector, end: zeroVector };
  let killed = false, pointSource: RibbonPointSource | null = null;
  const currentRecord = () => simulation.record as RibbonEmitterRecord;
  const restartRibbon = () => {
    const { NumPoints, SampleRate } = currentRecord();
    points = []; pointLimit = NumPoints; sampleTimer = realSampleRate = Math.fround(SampleRate);
    killed = false; lastSampled = { start: zeroVector, end: zeroVector };
  };
  const sampleWidth = (sample: RibbonPointSample) => currentRecord().bUseBoneDistance ? vectorLength(subtractVectors(sample.end, sample.start)) : currentRecord().RibbonWidth;
  const interpolateNewestSpan = (width: number) => {
    const { ScaleRatio, CntrPoints } = currentRecord();
    if (points.length >= interpolationRule.tangentFromPointCount && ScaleRatio !== 0) {
      const tangentPoint = points[2]!, newest = points[0]!, older = points[3]!;
      points[2] = {
        ...tangentPoint,
        startTangent: scaleVector(subtractVectors(newest.start, older.start), 1 / (ScaleRatio * interpolationRule.startTangentDivisor)),
        endTangent: scaleVector(subtractVectors(newest.end, older.end), 1 / (ScaleRatio * interpolationRule.endTangentDivisor)),
      };
    }
    if (points.length < interpolationRule.insertFromPointCount || CntrPoints < 2) return;
    const near = points[2]!, far = points[3]!;
    const inserted = Array.from({ length: CntrPoints - 1 }, (_, index) => {
      const parameter = 1 - (index + 1) / CntrPoints;
      return { start: hermiteVector(far.start, near.start, far.startTangent, near.startTangent, parameter),
        end: hermiteVector(far.end, near.end, far.endTangent, near.endTangent, parameter), width, startTangent: zeroVector, endTangent: zeroVector };
    });
    points.splice(3, 0, ...inserted);
  };
  const dropPoints = (particleTime: number) => {
    const { AccDrop, PointsDropRate, MinPoints, ThresholdTime, ThresholdTime2 } = currentRecord();
    const byTime = AccDrop === RIBBON_POINT_DROP.byTime || AccDrop === RIBBON_POINT_DROP.byTimeDual;
    const dropDue = AccDrop === RIBBON_POINT_DROP.byPoint && points.length >= pointLimit || byTime && particleTime >= ThresholdTime;
    if (points.length >= PointsDropRate + MinPoints && dropDue) pointLimit -= PointsDropRate;
    else if (AccDrop === RIBBON_POINT_DROP.byTimeDual && particleTime >= ThresholdTime2) pointLimit = Math.max(0, pointLimit - 1);
    if (points.length > Math.max(0, pointLimit)) points.length = Math.max(0, pointLimit);
  };
  const samplePoint = (stepSeconds: number, sample: RibbonPointSample) => {
    const { MinSampleDist, bDecayPoints } = currentRecord();
    const width = sampleWidth(sample), first = points.length === 0;
    const head: SampledRibbonPoint = { ...sample, width, startTangent: zeroVector, endTangent: zeroVector };
    if (first) points.unshift(head); else points[0] = head;
    const timer = sampleTimer + stepSeconds;
    sampleTimer = Math.fround(timer);
    let stopped = false;
    if (timer >= realSampleRate) {
      const moved = float32Distance(sample.start, lastSampled.start) + float32Distance(sample.end, lastSampled.end);
      if (first || moved < MinSampleDist) { sampleTimer = realSampleRate; stopped = true; }
      else {
        sampleTimer = 0;
        points.splice(1, 0, head);
        lastSampled = sample;
        interpolateNewestSpan(width);
      }
    }
    if (bDecayPoints && stopped) { if (points.length > 1) points.pop(); sampleTimer = 0; }
  };
  const decayStoppedRibbon = (stepSeconds: number) => {
    const { bSyncDecayWhenKilled, bDecayPointsWhenStopped } = currentRecord(), { columns, counters } = simulation;
    if (counters.killPending && !killed) {
      killed = true;
      if (bSyncDecayWhenKilled && points.length > 1) realSampleRate = Math.fround((columns.maxLifetime[0]! - columns.time[0]!) / (points.length - 1));
    }
    if (!bDecayPointsWhenStopped || points.length === 0) return;
    const timer = sampleTimer + stepSeconds;
    sampleTimer = Math.fround(timer);
    if (timer >= realSampleRate) { sampleTimer = 0; points.pop(); }
  };
  const updateRibbon = (stepSeconds: number) => {
    const { columns, counters } = simulation;
    if (columns.capacity === 0 || !hasParticleFlag(columns, 0, PARTICLE_FLAG.active)) return;
    if (!currentRecord().bSamplePoints || counters.killPending) { decayStoppedRibbon(stepSeconds); return; }
    const sample = pointSource?.() ?? null;
    if (sample === null || vectorLength(sample.start) === 0) return;
    samplePoint(stepSeconds, sample);
    dropPoints(columns.time[0]!);
  };
  const baseStep = simulation.step, baseReset = simulation.reset;
  const ribbon = Object.assign(simulation as ParticleEmitterSimulation & { readonly record: RibbonEmitterRecord }, {
    kind: "ribbon" as const,
    step(stepSeconds: number, context: EmitterStepContext) {
      const outcome = baseStep(stepSeconds, context);
      if (outcome === "running") updateRibbon(stepSeconds);
      return outcome;
    },
    reset(context: EmitterStepContext) { baseReset(context); restartRibbon(); },
    ribbonPoints: (): readonly RibbonPoint[] => points.map(({ start, end, width }) => ({ start: { ...start }, end: { ...end }, width })),
    attachPointSource(source: RibbonPointSource | null) { pointSource = source; },
  });
  return Object.defineProperty(ribbon, "pointLimit", { get: () => pointLimit, enumerable: true }) as RibbonEmitterSimulation;
}
