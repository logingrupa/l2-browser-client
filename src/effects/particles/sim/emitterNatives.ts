import { scaleVector } from "../../../shared/math/vector3";
import type { EmitterActorSimulation } from "./emitterActor";
import { PARTICLE_CONSTANTS } from "./emitterConstants";
import { EmitterRecordError, MAXIMUM_PARTICLES_PER_EMITTER, type FloatRange, type ParticleEmitterRecord, type RangeVector } from "./emitterRecords";
import { drawRange, rangeCenter } from "./particleSpawn";
import { createParticleColumns, type EmitterRuntime } from "./particleState";

export const EMITTER_NATIVE_NAMES = ["AdjustparticleLife", "SetSizeScale", "SetDelayed", "Kill", "Trigger"] as const;
export type EmitterNativeName = (typeof EMITTER_NATIVE_NAMES)[number];

export type EmitterNativeCall =
  | { readonly name: "AdjustparticleLife"; readonly lifeSeconds: number }
  | { readonly name: "SetSizeScale"; readonly scale: number }
  | { readonly name: "SetDelayed"; readonly delaySeconds: number }
  | { readonly name: "Kill" }
  | { readonly name: "Trigger" };

export interface EmitterNativeOutcome {
  readonly name: EmitterNativeName;
  readonly changedEmitters: readonly string[];
  readonly skipped: string | null;
}

export class EmitterNativeError extends Error {
  constructor(message: string) {
    super(`Emitter native: ${message}`);
    this.name = "EmitterNativeError";
  }
}

const sizeScaleRequiresActorFlag = PARTICLE_CONSTANTS.setSizeScaleFields.runtimeDefault.gatedOnActorFlag;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function requireFiniteArgument(call: Record<string, unknown>, argument: string): number {
  const value = call[argument];
  if (typeof value !== "number" || !Number.isFinite(value)) throw new EmitterNativeError(`${String(call.name)} needs a finite ${argument}, not ${String(value)}.`);
  return value;
}

export function parseEmitterNativeCall(call: unknown): EmitterNativeCall {
  if (!isRecord(call) || typeof call.name !== "string") throw new EmitterNativeError("a call must be an object with a name.");
  switch (call.name) {
    case "AdjustparticleLife": return { name: call.name, lifeSeconds: requireFiniteArgument(call, "lifeSeconds") };
    case "SetSizeScale": return { name: call.name, scale: requireFiniteArgument(call, "scale") };
    case "SetDelayed": return { name: call.name, delaySeconds: requireFiniteArgument(call, "delaySeconds") };
    case "Kill": case "Trigger": return { name: call.name };
    default: throw new EmitterNativeError(`${call.name} is not one of ${EMITTER_NATIVE_NAMES.join(", ")}.`);
  }
}

function shiftRange(range: FloatRange, delta: number): FloatRange {
  return { min: range.min + delta, max: range.max + delta };
}

function scaleRange(range: FloatRange, scale: number): FloatRange {
  return { min: range.min * scale, max: range.max * scale };
}

function scaleRangeVector(range: RangeVector, scale: number): RangeVector {
  return { x: scaleRange(range.x, scale), y: scaleRange(range.y, scale), z: scaleRange(range.z, scale) };
}

function replaceEmitterRecord(runtime: EmitterRuntime, changes: Partial<ParticleEmitterRecord>): void {
  runtime.record = Object.freeze({ ...runtime.record, ...changes }) as ParticleEmitterRecord;
}

function forcedMaximumParticles(runtime: EmitterRuntime, lifeSeconds: number): number {
  const { record, counters, columns } = runtime;
  const forced = Math.trunc(Math.trunc(record.InitialParticlesPerSecond) * (lifeSeconds - rangeCenter(record.LifetimeRange)));
  if (forced > MAXIMUM_PARTICLES_PER_EMITTER) throw new EmitterRecordError(record.object, `ForcedMaxParticles ${forced} is above ${MAXIMUM_PARTICLES_PER_EMITTER}.`);
  if (!counters.initialized) {
    runtime.columns = createParticleColumns(Math.max(0, forced));
    return forced;
  }
  return Math.min(forced, columns.capacity);
}

function adjustParticleLife(actor: EmitterActorSimulation, lifeSeconds: number): string[] {
  const runtimes = actor.emitters.map(emitter => emitter.runtime);
  const forcedLifetimes = runtimes.filter(runtime => runtime.record.ForcedLifeTime).map(runtime => runtime.record.LifetimeRange.max);
  const delta = lifeSeconds - Math.max(0, ...forcedLifetimes);
  const changed: string[] = [];
  for (const runtime of runtimes) {
    const { record } = runtime;
    if (!record.ForcedLifeTime && !record.ForcedMaxParticles) continue;
    if (record.ForcedLifeTime) {
      replaceEmitterRecord(runtime, { LifetimeRange: shiftRange(record.LifetimeRange, delta), ...record.ForcedFade ? { FadeOutStartTime: record.FadeOutStartTime + delta } : {} });
    }
    if (record.ForcedMaxParticles) replaceEmitterRecord(runtime, { MaxParticles: forcedMaximumParticles(runtime, lifeSeconds) });
    changed.push(record.object);
  }
  actor.replaceActorRecord(actor.record, "EL_LifeSpan");
  return changed;
}

function setSizeScale(actor: EmitterActorSimulation, scale: number): string[] {
  return actor.emitters.map(({ runtime }) => {
    const { record } = runtime;
    replaceEmitterRecord(runtime, {
      Acceleration: scaleVector(record.Acceleration, scale), StartLocationRange: scaleRangeVector(record.StartLocationRange, scale),
      SphereRadiusRange: scaleRange(record.SphereRadiusRange, scale), StartLocationPolarRange: scaleRangeVector(record.StartLocationPolarRange, scale),
      StartSizeRange: scaleRangeVector(record.StartSizeRange, scale), StartVelocityRange: scaleRangeVector(record.StartVelocityRange, scale),
    });
    return record.object;
  });
}

function setDelayed(actor: EmitterActorSimulation, delaySeconds: number): string[] {
  return actor.emitters.map(({ runtime }) => {
    replaceEmitterRecord(runtime, { InitialDelayRange: shiftRange(runtime.record.InitialDelayRange, delaySeconds) });
    return runtime.record.object;
  });
}

function kill(actor: EmitterActorSimulation): string[] {
  const changed = actor.emitters.map(({ runtime }) => {
    replaceEmitterRecord(runtime, { RespawnDeadParticles: false, ParticlesPerSecond: 0, InitialParticlesPerSecond: 0, AutoReset: false, AutoDestroy: false });
    runtime.counters.killPending = true;
    return runtime.record.object;
  });
  actor.replaceActorRecord(Object.freeze({ ...actor.record, AutoReset: false, AutoDestroy: true }), null);
  return changed;
}

function trigger(actor: EmitterActorSimulation): string[] {
  return actor.emitters.filter(({ runtime }) => runtime.counters.disabled).map(({ runtime }) => {
    const { record, counters, stream } = runtime;
    if (record.TriggerDisabled) counters.disabled = false;
    if (record.ResetOnTrigger) counters.initialized = false;
    counters.spawnOnTrigger = Math.trunc(counters.spawnOnTrigger + drawRange(stream, record.SpawnOnTriggerRange));
    if (counters.spawnOnTrigger !== 0) counters.dead = false;
    return record.object;
  });
}

export function applyEmitterNative(actor: EmitterActorSimulation, input: unknown): EmitterNativeOutcome {
  const call = parseEmitterNativeCall(input);
  if (actor.destroyed) return { name: call.name, changedEmitters: [], skipped: "actor-destroyed" };
  switch (call.name) {
    case "AdjustparticleLife": return { name: call.name, changedEmitters: adjustParticleLife(actor, call.lifeSeconds), skipped: null };
    case "SetSizeScale":
      if (sizeScaleRequiresActorFlag && !actor.record.bSetSizeScale) return { name: call.name, changedEmitters: [], skipped: "bSetSizeScale=false" };
      return { name: call.name, changedEmitters: setSizeScale(actor, call.scale), skipped: null };
    case "SetDelayed": return { name: call.name, changedEmitters: setDelayed(actor, call.delaySeconds), skipped: null };
    case "Kill": return { name: call.name, changedEmitters: kill(actor), skipped: null };
    case "Trigger": return { name: call.name, changedEmitters: trigger(actor), skipped: null };
  }
}
