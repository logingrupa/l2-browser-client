import { createRandomStream, deriveStreamSeed, type RandomStream } from "../../../shared/random";
import { COORDINATE_SYSTEM, ROTATION_SOURCE } from "./emitterConstants";
import type { ParticleEmitterRecord } from "./emitterRecords";
import { drawRange } from "./particleSpawn";
import {
  createEmitterCounters, createParticleColumns, listLiveSlots,
  type EmitterCounters, type EmitterRuntime, type EmitterStepContext, type ParticleColumns,
} from "./particleState";
import { updateParticles } from "./particleUpdate";

export type EmitterStepOutcome = "disabled" | "delayed" | "running" | "dead";
export type ParticleStorageSpace = "world" | "owner";
export type EmitterFeatureGapReason = `emitter-feature-unported:${string}`;

export interface UnportedEmitterFeature {
  readonly reason: EmitterFeatureGapReason;
  readonly property: string;
  readonly value: boolean | number;
}

export interface ParticleEmitterSimulation {
  readonly record: ParticleEmitterRecord;
  readonly runtime: EmitterRuntime;
  readonly columns: ParticleColumns;
  readonly counters: Readonly<EmitterCounters>;
  readonly storageSpace: ParticleStorageSpace;
  readonly unportedFeatures: readonly UnportedEmitterFeature[];
  step(stepSeconds: number, context: EmitterStepContext): EmitterStepOutcome;
  reset(context: EmitterStepContext): void;
  markDrawn(): void;
  liveSlots(): number[];
}

export function createEmitterRandomStream(sessionSeed: number, effectSerial: number, emitterOrdinal: number): RandomStream {
  return createRandomStream(deriveStreamSeed(sessionSeed, "emitter", [effectSerial, emitterOrdinal]));
}

export function listUnportedEmitterFeatures(record: ParticleEmitterRecord): UnportedEmitterFeature[] {
  const unported: [string, boolean | number, boolean][] = [
    ["UseCollision", record.UseCollision, record.UseCollision],
    ["UseCollisionPlanes", record.UseCollisionPlanes, record.UseCollisionPlanes],
    ["UseActorForces", record.UseActorForces, record.UseActorForces],
    ["MeshSpawning", record.MeshSpawning, record.MeshSpawning !== 0],
    ["UseSkeletalLocationAs", record.UseSkeletalLocationAs, record.UseSkeletalLocationAs !== 0],
    ["SpawnFromOtherEmitter", record.SpawnFromOtherEmitter, record.SpawnFromOtherEmitter >= 0],
    ["UseRotationFrom", record.UseRotationFrom, record.UseRotationFrom === ROTATION_SOURCE.normal],
    ["CoordinateSystem", record.CoordinateSystem, record.CoordinateSystem === COORDINATE_SYSTEM.relativeRotation],
    ["WeatherEffect", record.WeatherEffect, record.WeatherEffect],
  ];
  return unported.filter(([, , isUnported]) => isUnported)
    .map(([property, value]) => ({ reason: `emitter-feature-unported:${property}` as const, property, value }));
}

function particleStorageSpace(coordinateSystem: number): ParticleStorageSpace {
  const spawnAddsOwnerLocation = coordinateSystem === COORDINATE_SYSTEM.independent || coordinateSystem === COORDINATE_SYSTEM.spray;
  return spawnAddsOwnerLocation ? "world" : "owner";
}

function drawInitialDelay(runtime: EmitterRuntime): void {
  const { record, stream, counters } = runtime;
  counters.delaySeconds = drawRange(stream, record.InitialDelayRange);
  counters.delayDrawn = true;
}

function restartEmitter(runtime: EmitterRuntime, context: EmitterStepContext): void {
  const { record, stream, columns, counters } = runtime;
  counters.activeSlots = counters.nextSlot = counters.otherEmitterCursor = 0;
  counters.dead = counters.warmedUp = false;
  drawInitialDelay(runtime);
  counters.resetTimerSeconds = drawRange(stream, record.AutoResetTimeRange);
  counters.lastOwnerLocation = context.owner.location;
  columns.flags.fill(0);
}

function initialDelayHoldsStep(counters: EmitterCounters, stepSeconds: number): boolean {
  if (counters.delaySeconds > 0) {
    const remainingDelaySeconds = counters.delaySeconds - stepSeconds;
    counters.delaySeconds = remainingDelaySeconds > 0 ? remainingDelaySeconds : 0;
    return remainingDelaySeconds > 0;
  }
  return false;
}

function warmUp(runtime: EmitterRuntime, context: EmitterStepContext): void {
  const { record, counters } = runtime;
  counters.lastOwnerLocation = context.owner.location;
  if (record.WarmupTicksPerSecond > 0 && record.RelativeWarmupTime > 0) {
    const lifetimeCenterSeconds = (record.LifetimeRange.min + record.LifetimeRange.max) / 2;
    const ticksAcrossOneLifetime = record.WarmupTicksPerSecond * lifetimeCenterSeconds;
    const warmupStepSeconds = 1 / record.WarmupTicksPerSecond;
    for (let remainingTicks = Math.floor(ticksAcrossOneLifetime * record.RelativeWarmupTime); remainingTicks > 0; remainingTicks -= 1) {
      updateParticles(runtime, warmupStepSeconds, context);
    }
  }
  counters.warmedUp = true;
}

function stepDeadEmitter(runtime: EmitterRuntime, stepSeconds: number, context: EmitterStepContext): void {
  const { record, stream, counters } = runtime;
  const emitterResetsItself = record.AutoReset && !context.actorAutoReset;
  if (!emitterResetsItself) {
    if (record.AutoDestroy && !context.actorAutoDestroy) counters.disabled = true;
    return;
  }
  const secondsUntilReset = counters.resetTimerSeconds - stepSeconds;
  counters.resetTimerSeconds = secondsUntilReset;
  if (secondsUntilReset <= 0) {
    counters.resetTimerSeconds = drawRange(stream, record.AutoResetTimeRange);
    restartEmitter(runtime, context);
  }
}

function undrawnPastInactiveLimit({ record, counters }: EmitterRuntime): boolean {
  return record.SecondsBeforeInactive > 0 && counters.secondsSinceDrawn > record.SecondsBeforeInactive;
}

function stepEmitter(runtime: EmitterRuntime, stepSeconds: number, context: EmitterStepContext): EmitterStepOutcome {
  const { counters } = runtime;
  if (counters.disabled) return "disabled";
  if (!counters.delayDrawn) drawInitialDelay(runtime);
  if (initialDelayHoldsStep(counters, stepSeconds)) return "delayed";
  if (!counters.warmedUp) warmUp(runtime, context);
  if (counters.dead) {
    stepDeadEmitter(runtime, stepSeconds, context);
    return "dead";
  }
  counters.secondsSinceDrawn += stepSeconds;
  if (!undrawnPastInactiveLimit(runtime)) updateParticles(runtime, stepSeconds, context);
  return "running";
}

export function createParticleEmitterSimulation(record: ParticleEmitterRecord, stream: RandomStream, uniformSize: boolean): ParticleEmitterSimulation {
  const columns = createParticleColumns(record.MaxParticles), counters = createEmitterCounters(record.Disabled);
  const runtime: EmitterRuntime = { record, stream, columns, counters, uniformSize };
  return {
    record, runtime, columns, counters, storageSpace: particleStorageSpace(record.CoordinateSystem), unportedFeatures: listUnportedEmitterFeatures(record),
    step: (stepSeconds, context) => stepEmitter(runtime, stepSeconds, context),
    reset: context => restartEmitter(runtime, context),
    markDrawn: () => { counters.secondsSinceDrawn = 0; },
    liveSlots: () => listLiveSlots(columns, counters),
  };
}
