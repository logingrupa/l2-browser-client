import { createRandomStream, deriveStreamSeed, type RandomStream } from "../../../shared/random";
import { COORDINATE_SYSTEM, ROTATION_SOURCE } from "./emitterConstants";
import type { ParticleEmitterRecord } from "./emitterRecords";
import { drawRange } from "./particleSpawn";
import {
  createEmitterCounters, createParticleColumns, listLiveSlots,
  type EmitterCounters, type EmitterRuntime, type EmitterStepContext, type ParticleColumns,
} from "./particleState";
import { updateParticles } from "./particleUpdate";

export type EmitterStepOutcome = "disabled" | "delayed" | "dead" | "running";
export type ParticleStorageSpace = "owner" | "world";
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

function warmUp(runtime: EmitterRuntime, context: EmitterStepContext): void {
  const { record, counters } = runtime;
  counters.lastOwnerLocation = context.owner.location;
  const lifetimeCenter = (record.LifetimeRange.min + record.LifetimeRange.max) / 2;
  if (record.RelativeWarmupTime > 0 && record.WarmupTicksPerSecond > 0) {
    const warmupTicks = Math.floor(record.WarmupTicksPerSecond * lifetimeCenter * record.RelativeWarmupTime);
    for (let tick = 0; tick < warmupTicks; tick += 1) updateParticles(runtime, 1 / record.WarmupTicksPerSecond, context);
  }
  counters.warmedUp = true;
}

export function createParticleEmitterSimulation(record: ParticleEmitterRecord, stream: RandomStream, uniformSize: boolean): ParticleEmitterSimulation {
  const columns = createParticleColumns(record.MaxParticles), counters = createEmitterCounters(record.Disabled);
  const runtime: EmitterRuntime = { record, stream, columns, counters, uniformSize };
  const reset = (context: EmitterStepContext) => {
    counters.activeSlots = 0; counters.nextSlot = 0; counters.otherEmitterCursor = 0;
    counters.dead = false; counters.warmedUp = false;
    counters.delaySeconds = drawRange(stream, record.InitialDelayRange); counters.delayDrawn = true;
    counters.resetTimerSeconds = drawRange(stream, record.AutoResetTimeRange);
    counters.lastOwnerLocation = context.owner.location;
    columns.flags.fill(0);
  };
  const step = (stepSeconds: number, context: EmitterStepContext): EmitterStepOutcome => {
    if (counters.disabled) return "disabled";
    if (!counters.delayDrawn) { counters.delaySeconds = drawRange(stream, record.InitialDelayRange); counters.delayDrawn = true; }
    if (counters.delaySeconds > 0) {
      counters.delaySeconds -= stepSeconds;
      if (counters.delaySeconds > 0) return "delayed";
      counters.delaySeconds = 0;
    }
    if (!counters.warmedUp) warmUp(runtime, context);
    if (counters.dead) {
      if (record.AutoReset && !context.actorAutoReset) {
        counters.resetTimerSeconds -= stepSeconds;
        if (counters.resetTimerSeconds <= 0) { counters.resetTimerSeconds = drawRange(stream, record.AutoResetTimeRange); reset(context); }
      } else if (record.AutoDestroy && !context.actorAutoDestroy) counters.disabled = true;
      return "dead";
    }
    counters.secondsSinceDrawn += stepSeconds;
    if (record.SecondsBeforeInactive > 0 && counters.secondsSinceDrawn > record.SecondsBeforeInactive) return "running";
    updateParticles(runtime, stepSeconds, context);
    return "running";
  };
  const worldStored = record.CoordinateSystem === COORDINATE_SYSTEM.independent || record.CoordinateSystem === COORDINATE_SYSTEM.spray;
  return {
    record, runtime, columns, counters, storageSpace: worldStored ? "world" : "owner", unportedFeatures: listUnportedEmitterFeatures(record),
    step, reset, markDrawn: () => { counters.secondsSinceDrawn = 0; }, liveSlots: () => listLiveSlots(columns, counters),
  };
}
