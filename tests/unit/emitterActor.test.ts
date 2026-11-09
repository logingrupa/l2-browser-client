import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createPresentationClock } from "../../src/shared/presentationClock";
import { createEffectScheduler } from "../../src/effects/particles/effectScheduler";
import { createEmitterActorSimulation, type EmitterActorSimulation } from "../../src/effects/particles/sim/emitterActor";
import { PARTICLE_CONSTANTS, PARTICLE_SIMULATOR_VERSION } from "../../src/effects/particles/sim/emitterConstants";
import { parseEmitterActorRecord, parseEmitterRecord, type EmitterSourceRecord } from "../../src/effects/particles/sim/emitterRecords";
import { readSlotVector, type OwnerPose } from "../../src/effects/particles/sim/particleState";
import { PARTICLE_FIXTURE_FOLDER, STATIONARY_OWNER, particleTraceRows, readSyntheticParticleFixture } from "./support/particleFixtures";

const stepSeconds = PARTICLE_CONSTANTS.simulationStepSeconds.runtimeDefault;
const spriteFixture = readSyntheticParticleFixture("synthetic-sprite");
const plainEmitterOverrides = {
  StartVelocityRange: { X: { Min: 0, Max: 0 }, Y: { Min: 0, Max: 0 }, Z: { Min: 0, Max: 0 } },
  Acceleration: { X: 0, Y: 0, Z: 0 }, StartLocationShape: 0, GetVelocityDirectionFrom: 0,
  VelocityLossRange: { X: { Min: 0, Max: 0 }, Y: { Min: 0, Max: 0 }, Z: { Min: 0, Max: 0 } },
};

function withOverrides(source: EmitterSourceRecord, overrides: Record<string, unknown>): EmitterSourceRecord {
  return { ...source, effectiveProperties: { ...source.effectiveProperties, ...overrides } };
}

function spriteActor(actorOverrides: Record<string, unknown> = {}, emitterOverrides: Record<string, unknown> = {}, effectSerial = 0): EmitterActorSimulation {
  return createEmitterActorSimulation({
    actor: parseEmitterActorRecord(withOverrides(spriteFixture.actor, actorOverrides)),
    emitters: [parseEmitterRecord(withOverrides(spriteFixture.components[0]!, emitterOverrides))],
    sessionSeed: 1, effectSerial,
  });
}

function liveCountsPerStep(actor: EmitterActorSimulation, stepCount: number, owner: OwnerPose = STATIONARY_OWNER): number[] {
  return Array.from({ length: stepCount }, () => { actor.step(stepSeconds, owner); return actor.emitters[0]!.liveSlots().length; });
}

function actorTraceRows(actor: EmitterActorSimulation, stepLimit: number): number[][] {
  const rows: number[][] = [];
  for (let stepIndex = 0; stepIndex < stepLimit && actor.step(stepSeconds, STATIONARY_OWNER) === "running"; stepIndex += 1) {
    actor.emitters.forEach((emitter, ordinal) => rows.push(...particleTraceRows(stepIndex, emitter).map(row => [ordinal, ...row])));
  }
  return rows;
}

describe("Emitter actor rules", () => {
  it("holds spawning through the initial delay and runs the full step that crosses zero", () => {
    const actor = spriteActor({}, { InitialDelayRange: { Min: 0.04, Max: 0.04 } });
    expect(liveCountsPerStep(actor, 3)).toEqual([0, 0, 6]);
    expect(actor.lastEmitterOutcomes).toEqual(["running"]);
  });

  it("runs the warmup updates before the first step", () => {
    const warm = spriteActor({}, { WarmupTicksPerSecond: 20, RelativeWarmupTime: 0.5 }), cold = spriteActor();
    warm.step(stepSeconds, STATIONARY_OWNER); cold.step(stepSeconds, STATIONARY_OWNER);
    const oldestTime = (actor: EmitterActorSimulation) => Math.max(...actor.emitters[0]!.liveSlots().map(slot => actor.emitters[0]!.columns.time[slot]!));
    expect(oldestTime(cold)).toBeLessThan(stepSeconds);
    expect(oldestTime(warm)).toBeGreaterThan(4 * 0.05);
  });

  it("destroys an AutoDestroy actor once every emitter is dead, unless bNoDelete refuses", () => {
    const destroyed = spriteActor();
    const outcomes = Array.from({ length: 60 }, () => destroyed.step(stepSeconds, STATIONARY_OWNER));
    expect(outcomes).toContain("destroyed");
    expect(destroyed.destroyed).toBe(true);
    const kept = spriteActor({ bNoDelete: true });
    expect(Array.from({ length: 60 }, () => kept.step(stepSeconds, STATIONARY_OWNER))).not.toContain("destroyed");
    expect(kept.lastEmitterOutcomes).toEqual(["dead"]);
  });

  it("resets every emitter after TimeTillResetRange once none is running", () => {
    const actor = spriteActor({ AutoDestroy: false, AutoReset: true, TimeTillResetRange: { Min: 0.1, Max: 0.1 } });
    const liveCounts = liveCountsPerStep(actor, 60);
    const firstEmptyStep = liveCounts.indexOf(0);
    expect(firstEmptyStep).toBeGreaterThan(0);
    expect(liveCounts.slice(firstEmptyStep).some(count => count > 0)).toBe(true);
    expect(actor.destroyed).toBe(false);
  });

  it("scales every emitter step by SpeedRate", () => {
    const doubled = spriteActor({ SpeedRate: 2 });
    doubled.step(stepSeconds, STATIONARY_OWNER);
    const emitter = doubled.emitters[0]!;
    expect(emitter.columns.time[0]).toBe(Math.fround(2 * stepSeconds - 1 / 360));
  });

  it("adds the drawn GlobalOffset to every spawn", () => {
    const offsetRange = { X: { Min: 10, Max: 10 }, Y: { Min: -4, Max: -4 }, Z: { Min: 0, Max: 0 } };
    const offset = spriteActor({ GlobalOffsetRange: offsetRange }, plainEmitterOverrides), plain = spriteActor({}, plainEmitterOverrides);
    offset.step(stepSeconds, STATIONARY_OWNER); plain.step(stepSeconds, STATIONARY_OWNER);
    expect(offset.globalOffset).toEqual({ x: 10, y: -4, z: 0 });
    const offsetLocation = readSlotVector(offset.emitters[0]!.columns.location, 0), plainLocation = readSlotVector(plain.emitters[0]!.columns.location, 0);
    expect(offsetLocation.x - plainLocation.x).toBeCloseTo(10, 4);
    expect(offsetLocation.y - plainLocation.y).toBeCloseTo(-4, 4);
  });

  it("turns Spray spawns with the bRotEmitter rotation", () => {
    const actor = spriteActor({ bRotEmitter: true, RotPerSecond: { Pitch: 0, Yaw: 16384, Roll: 0 } }, {
      ...plainEmitterOverrides, CoordinateSystem: 4, MaxParticles: 120, InitialParticlesPerSecond: 60, ParticlesPerSecond: 60,
      LifetimeRange: { Min: 3, Max: 3 }, StartLocationOffset: { X: 10, Y: 0, Z: 0 },
    });
    for (let stepIndex = 0; stepIndex < 60; stepIndex += 1) actor.step(stepSeconds, STATIONARY_OWNER);
    expect(actor.emitterRotation.yaw).toBeCloseTo(16384, 6);
    const emitter = actor.emitters[0]!, firstSpawn = readSlotVector(emitter.columns.location, 0), lastSpawn = readSlotVector(emitter.columns.location, 59);
    expect(emitter.storageSpace).toBe("world");
    expect(firstSpawn.x).toBeCloseTo(10, 1);
    expect(lastSpawn.x).toBeCloseTo(0, 1);
    expect(lastSpawn.y).toBeCloseTo(10, 2);
  });

  it("lists unresolved actor fields and refuses emitters out of order", () => {
    expect(spriteActor({ AutoReplay: true, DrawScale3D: { X: 2, Y: 1, Z: 1 } }).unresolvedFields).toEqual(["AutoReplay", "DrawScale3D"]);
    expect(() => createEmitterActorSimulation({
      actor: parseEmitterActorRecord(withOverrides(spriteFixture.actor, { Emitters: [{ symbol: "SpriteEmitter7" }] })),
      emitters: [parseEmitterRecord(spriteFixture.components[0]!)], sessionSeed: 1, effectSerial: 0,
    })).toThrow(/Emitters synthetic.sprite_burst.SpriteEmitter7 differ/);
  });
});

describe("effect scheduler", () => {
  function schedulerWithSprite() {
    const clock = createPresentationClock();
    const scheduler = createEffectScheduler({ clock, sessionSeed: 1, sampleOwner: () => STATIONARY_OWNER });
    const effect = scheduler.spawnEffect(parseEmitterActorRecord(spriteFixture.actor), [parseEmitterRecord(spriteFixture.components[0]!)], "caster");
    return { clock, scheduler, effect };
  }

  it("runs exactly the fixed steps the accumulator allows per frame and drops the remainder past the cap", () => {
    const { clock, scheduler } = schedulerWithSprite();
    clock.advance(1.5 * stepSeconds);
    expect(scheduler.advanceFrame()).toBe(1);
    clock.advance(0.5 * stepSeconds);
    expect(scheduler.advanceFrame()).toBe(1);
    clock.advance(20 * stepSeconds);
    expect(scheduler.advanceFrame()).toBe(PARTICLE_CONSTANTS.maximumStepsPerFrame.runtimeDefault);
    clock.advance(0.5 * stepSeconds);
    expect(scheduler.advanceFrame()).toBe(0);
    clock.pause(); clock.advance(stepSeconds);
    expect(scheduler.advanceFrame()).toBe(0);
  });

  it("drops destroyed effects and keeps one effect's trace when another spawns between steps", () => {
    const alone = schedulerWithSprite(), crowded = schedulerWithSprite();
    alone.clock.advance(stepSeconds); alone.scheduler.advanceFrame();
    crowded.clock.advance(stepSeconds); crowded.scheduler.advanceFrame();
    crowded.scheduler.spawnEffect(parseEmitterActorRecord(spriteFixture.actor), [parseEmitterRecord(spriteFixture.components[0]!)], "target");
    for (let frame = 0; frame < 3; frame += 1) {
      alone.clock.advance(stepSeconds); alone.scheduler.advanceFrame();
      crowded.clock.advance(stepSeconds); crowded.scheduler.advanceFrame();
    }
    expect(particleTraceRows(0, crowded.effect.actor.emitters[0]!)).toEqual(particleTraceRows(0, alone.effect.actor.emitters[0]!));
    for (let frame = 0; frame < 60; frame += 1) { alone.clock.advance(stepSeconds); alone.scheduler.advanceFrame(); }
    expect(alone.scheduler.liveEffects).toEqual([]);
  });
});

const powerStrikeEffectSource = process.env.POWER_STRIKE_EFFECT_SOURCE ?? "";
const powerStrikeSkipReason = "set POWER_STRIKE_EFFECT_SOURCE to the effect-source.json the converter writes for --client (artifacts/native-parity/migration/effects/power-strike-source-dispatch/effect-source.json in the main checkout)";
interface PowerStrikeHashes {
  readonly effectSourceSha256: string; readonly seed: number; readonly stepSeconds: number; readonly stepLimit: number;
  readonly simulatorVersion: number; readonly traceSha256ByActor: Readonly<Record<string, string>>;
}
interface EffectSourceActor extends EmitterSourceRecord { readonly children: readonly EmitterSourceRecord[] }

describe("Power Strike real-client traces", () => {
  it("hashes the s_u002_a and p_u004_a traces to the committed values", context => {
    context.skip(!powerStrikeEffectSource || !existsSync(powerStrikeEffectSource), powerStrikeSkipReason);
    const hashesPath = `${PARTICLE_FIXTURE_FOLDER}/power-strike.hashes.json`, sourceBytes = readFileSync(powerStrikeEffectSource);
    const effectSourceSha256 = createHash("sha256").update(sourceBytes).digest("hex");
    const effects = (JSON.parse(sourceBytes.toString("utf8")) as { effects: EffectSourceActor[] }).effects;
    const seed = 1, stepLimit = 600, regeneratedTraces: Record<string, number[][]> = {};
    for (const effect of effects) {
      const actor = createEmitterActorSimulation({ actor: parseEmitterActorRecord(effect), emitters: effect.children.map(parseEmitterRecord), sessionSeed: seed, effectSerial: 0 });
      expect(actor.featureGaps).toEqual([]);
      regeneratedTraces[effect.object] = actorTraceRows(actor, stepLimit);
    }
    const traceSha256ByActor = Object.fromEntries(Object.entries(regeneratedTraces)
      .map(([object, rows]) => [object, createHash("sha256").update(JSON.stringify(rows)).digest("hex")]));
    const regenerated: PowerStrikeHashes = { effectSourceSha256, seed, stepSeconds, stepLimit, simulatorVersion: PARTICLE_SIMULATOR_VERSION, traceSha256ByActor };
    if (process.env.PARTICLE_GOLDEN_WRITE === "1") writeFileSync(hashesPath, `${JSON.stringify(regenerated, null, 2)}\n`);
    const committed = JSON.parse(readFileSync(hashesPath, "utf8")) as PowerStrikeHashes;
    expect(effectSourceSha256).toBe(committed.effectSourceSha256);
    if (JSON.stringify(regenerated) !== JSON.stringify(committed)) {
      mkdirSync("artifacts/particles", { recursive: true });
      writeFileSync("artifacts/particles/power-strike-regenerated-traces.json", JSON.stringify(regeneratedTraces));
    }
    expect(regenerated).toEqual(committed);
  });
});
