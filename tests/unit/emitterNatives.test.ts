import { describe, expect, it } from "vitest";
import { createEmitterActorSimulation, type EmitterActorSimulation } from "../../src/effects/particles/sim/emitterActor";
import { applyEmitterNative, EMITTER_NATIVE_NAMES, EmitterNativeError } from "../../src/effects/particles/sim/emitterNatives";
import { parseEmitterActorRecord, parseEmitterRecord, type EmitterSourceRecord } from "../../src/effects/particles/sim/emitterRecords";
import { listTypeScriptModules, readSourceImports } from "../support/sourceImportSpecifiers";
import { readSyntheticParticleFixture, STATIONARY_OWNER } from "./support/particleFixtures";

const spriteFixture = readSyntheticParticleFixture("synthetic-sprite");
const stepSeconds = 1 / 60;

function withOverrides(source: EmitterSourceRecord, overrides: Record<string, unknown>): EmitterSourceRecord {
  return { ...source, effectiveProperties: { ...source.effectiveProperties, ...overrides } };
}

function spriteActor(actorOverrides: Record<string, unknown> = {}, emitterOverrides: Record<string, unknown> = {}): EmitterActorSimulation {
  return createEmitterActorSimulation({
    actor: parseEmitterActorRecord(withOverrides(spriteFixture.actor, actorOverrides)),
    emitters: [parseEmitterRecord(withOverrides(spriteFixture.components[0]!, emitterOverrides))], sessionSeed: 1, effectSerial: 0,
  });
}

describe("L2 emitter natives on live emitters", () => {
  it("lists exactly the five natives skills call and refuses any other name or a malformed argument", () => {
    expect(EMITTER_NATIVE_NAMES).toEqual(["AdjustparticleLife", "SetSizeScale", "SetDelayed", "Kill", "Trigger"]);
    const actor = spriteActor();
    expect(() => applyEmitterNative(actor, { name: "SetSpeedScale", scale: 2 })).toThrow(EmitterNativeError);
    expect(() => applyEmitterNative(actor, { name: "SetDelayed", delaySeconds: Number.NaN })).toThrow("finite delaySeconds");
    expect(() => applyEmitterNative(actor, "Kill")).toThrow("an object with a name");
  });

  it("AdjustparticleLife shifts ForcedLifeTime lifetimes and ForcedFade fade-outs, sizes ForcedMaxParticles and lists EL_LifeSpan unresolved", () => {
    const actor = spriteActor({}, { ForcedLifeTime: true, ForcedFade: true, ForcedMaxParticles: true, FadeOut: true, FadeOutStartTime: .3, LifetimeRange: { Min: .4, Max: .55 } });
    const outcome = applyEmitterNative(actor, { name: "AdjustparticleLife", lifeSeconds: 1.55 });
    const emitter = actor.emitters[0]!;
    expect(outcome).toEqual({ name: "AdjustparticleLife", changedEmitters: [emitter.record.object], skipped: null });
    expect(emitter.record.LifetimeRange.min).toBeCloseTo(1.4, 12); expect(emitter.record.LifetimeRange.max).toBeCloseTo(1.55, 12);
    expect(emitter.record.FadeOutStartTime).toBeCloseTo(1.3, 12);
    const expectedMaximum = Math.trunc(360 * (1.55 - Math.fround((Math.fround(1.55) + Math.fround(1.4)) * .5)));
    expect(emitter.record.MaxParticles).toBe(expectedMaximum);
    expect(emitter.columns.capacity).toBe(expectedMaximum);
    expect(actor.unresolvedFields).toContain("EL_LifeSpan");
  });

  it("keeps ageing every allocated slot when AdjustparticleLife lowers ForcedMaxParticles after initialization", () => {
    const actor = spriteActor({}, { MaxParticles: 10, ForcedMaxParticles: true, LifetimeRange: { Min: 1, Max: 1 } });
    const emitter = actor.emitters[0]!;
    for (let step = 0; step < 2; step += 1) actor.step(stepSeconds, STATIONARY_OWNER);
    expect(emitter.liveSlots()).toHaveLength(10);
    applyEmitterNative(actor, { name: "AdjustparticleLife", lifeSeconds: 1.0125 });
    expect(emitter.record.MaxParticles).toBe(4);
    expect(emitter.columns.capacity).toBe(10);
    const lastSlotTimeBefore = emitter.columns.time[9]!;
    actor.step(stepSeconds, STATIONARY_OWNER);
    expect(emitter.columns.time[9]!).toBeGreaterThan(lastSlotTimeBefore);
    for (let step = 0; step < 90; step += 1) actor.step(stepSeconds, STATIONARY_OWNER);
    expect(emitter.liveSlots()).toEqual([]);
    expect(actor.lastEmitterOutcomes[0]).toBe("dead");
  });

  it("SetSizeScale scales the spawn fields only on a bSetSizeScale actor", () => {
    const actor = spriteActor({ bSetSizeScale: true }), before = actor.emitters[0]!.record;
    applyEmitterNative(actor, { name: "SetSizeScale", scale: 2 });
    const after = actor.emitters[0]!.record;
    expect(after.StartSizeRange.y).toEqual({ min: before.StartSizeRange.y.min * 2, max: before.StartSizeRange.y.max * 2 });
    expect(after.StartLocationPolarRange.z).toEqual({ min: before.StartLocationPolarRange.z.min * 2, max: before.StartLocationPolarRange.z.max * 2 });
    expect(after.Acceleration).toEqual({ x: 0, y: 0, z: -60 });
    const gated = spriteActor({ bSetSizeScale: false });
    expect(applyEmitterNative(gated, { name: "SetSizeScale", scale: 2 })).toMatchObject({ changedEmitters: [], skipped: "bSetSizeScale=false" });
  });

  it("SetDelayed holds the first spawn by the added delay", () => {
    const delayed = spriteActor();
    applyEmitterNative(delayed, { name: "SetDelayed", delaySeconds: .25 });
    expect(delayed.emitters[0]!.record.InitialDelayRange).toEqual({ min: .25, max: .25 });
    const outcomes = Array.from({ length: 10 }, () => { delayed.step(stepSeconds, STATIONARY_OWNER); return delayed.lastEmitterOutcomes[0]; });
    expect(outcomes.every(outcome => outcome === "delayed")).toBe(true);
    expect(delayed.emitters[0]!.liveSlots()).toHaveLength(0);
  });

  it("Kill stops spawning, lets the live particles die and destroys the actor", () => {
    const actor = spriteActor({ AutoDestroy: false, AutoReset: true }, { RespawnDeadParticles: true, AutomaticInitialSpawning: true });
    for (let step = 0; step < 5; step += 1) actor.step(stepSeconds, STATIONARY_OWNER);
    expect(actor.emitters[0]!.liveSlots().length).toBeGreaterThan(0);
    applyEmitterNative(actor, { name: "Kill" });
    expect(actor.record).toMatchObject({ AutoReset: false, AutoDestroy: true });
    expect(actor.emitters[0]!.record).toMatchObject({ RespawnDeadParticles: false, ParticlesPerSecond: 0, InitialParticlesPerSecond: 0 });
    for (let step = 0; step < 120 && !actor.destroyed; step += 1) actor.step(stepSeconds, STATIONARY_OWNER);
    expect(actor.destroyed).toBe(true);
    expect(applyEmitterNative(actor, { name: "Kill" })).toMatchObject({ skipped: "actor-destroyed" });
  });

  it("Trigger enables only a disabled TriggerDisabled emitter and spawns SpawnOnTrigger particles", () => {
    const actor = spriteActor({}, { Disabled: true, TriggerDisabled: true, InitialParticlesPerSecond: 0, SpawnOnTriggerRange: { Min: 3, Max: 3 }, SpawnOnTriggerPPS: 600 });
    actor.step(stepSeconds, STATIONARY_OWNER);
    expect(actor.lastEmitterOutcomes[0]).toBe("disabled");
    expect(applyEmitterNative(actor, { name: "Trigger" }).changedEmitters).toHaveLength(1);
    for (let step = 0; step < 3; step += 1) actor.step(stepSeconds, STATIONARY_OWNER);
    expect(actor.emitters[0]!.liveSlots()).toHaveLength(3);
    expect(applyEmitterNative(actor, { name: "Trigger" }).changedEmitters).toEqual([]);
  });

  it("reaches emitters only through the native hook of the emitter actor playback, never from the UI, the runtime or the scene", () => {
    const callers = ["src/effects", "src/ui", "src/runtime", "src/scene"].flatMap(folder => listTypeScriptModules(folder))
      .filter(modulePath => readSourceImports(modulePath).some(sourceImport => sourceImport.resolvedModulePath === "src/effects/particles/sim/emitterNatives.ts"));
    expect(callers).toEqual(["src/effects/particles/render/emitterActorPlayback.ts"]);
  });
});
