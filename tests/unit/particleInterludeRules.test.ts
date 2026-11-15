import { describe, expect, it } from "vitest";
import { cosineOfRadiansFromTable, sineOfRadiansFromTable } from "../../src/shared/math/rotator";
import { PARTICLE_CONSTANTS } from "../../src/effects/particles/sim/emitterConstants";
import { parseEmitterRecord, type SpriteEmitterRecord } from "../../src/effects/particles/sim/emitterRecords";
import { createEmitterRandomStream } from "../../src/effects/particles/sim/particleEmitter";
import { readSlotVector } from "../../src/effects/particles/sim/particleState";
import { createSpriteEmitterSimulation, type SpriteEmitterSimulation } from "../../src/effects/particles/sim/spriteEmitter";
import { readSyntheticParticleFixture, standaloneStepContext } from "./support/particleFixtures";

const stepSeconds = PARTICLE_CONSTANTS.simulationStepSeconds.runtimeDefault;
const spriteSource = readSyntheticParticleFixture("synthetic-sprite").components[0]!;
const stillOverrides = {
  StartVelocityRange: { X: { Min: 0, Max: 0 }, Y: { Min: 0, Max: 0 }, Z: { Min: 0, Max: 0 } },
  Acceleration: { X: 0, Y: 0, Z: 0 }, GetVelocityDirectionFrom: 0, StartLocationOffset: { X: 0, Y: 0, Z: 0 },
};

function spriteWith(overrides: Record<string, unknown>): SpriteEmitterSimulation {
  const record = parseEmitterRecord({ ...spriteSource, effectiveProperties: { ...spriteSource.effectiveProperties, ...overrides } }) as SpriteEmitterRecord;
  return createSpriteEmitterSimulation(record, createEmitterRandomStream(1, 0, 0));
}

function stepTimes(simulation: SpriteEmitterSimulation, stepCount: number): void {
  const context = standaloneStepContext(simulation);
  for (let stepIndex = 0; stepIndex < stepCount; stepIndex += 1) simulation.step(stepSeconds, context);
}

describe("Interlude emitter tick rules", () => {
  it("draws InitialDelayRange and then AutoResetTimeRange on the first step, as Initialize runs Reset", () => {
    const simulation = spriteWith({ InitialDelayRange: { Min: 0.5, Max: 0.5 }, AutoResetTimeRange: { Min: 0.25, Max: 0.25 } });
    stepTimes(simulation, 1);
    expect(simulation.counters.resetTimerSeconds).toBe(0.25);
    const freshStream = createEmitterRandomStream(1, 0, 0);
    freshStream.nextUnit(); freshStream.nextUnit();
    expect(simulation.runtime.stream.nextUnit()).toBe(freshStream.nextUnit());
  });

  it("counts a negative InitialDelay down to zero in the first step, as the != 0 gate does", () => {
    const simulation = spriteWith({ InitialDelayRange: { Min: -0.5, Max: -0.5 } });
    expect(simulation.step(stepSeconds, standaloneStepContext(simulation))).toBe("running");
    expect(simulation.counters.delaySeconds).toBe(0);
  });

  it("runs warm-up ticks whenever WarmupTicksPerSecond and RelativeWarmupTime are not 0", () => {
    const warm = spriteWith({ WarmupTicksPerSecond: -7, RelativeWarmupTime: -1, InitialParticlesPerSecond: 100 });
    const cold = spriteWith({ InitialParticlesPerSecond: 100 });
    stepTimes(warm, 1); stepTimes(cold, 1);
    expect(warm.counters.spawnFraction).not.toBe(cold.counters.spawnFraction);
  });

  it("runs trunc(WarmupTicksPerSecond * f32(centre * RelativeWarmupTime)) warm-up ticks", () => {
    const simulation = spriteWith({
      ...stillOverrides, MaxParticles: 1, InitialParticlesPerSecond: 1000, LifetimeRange: { Min: 0.7, Max: 0.7 },
      WarmupTicksPerSecond: 10, RelativeWarmupTime: 1, FadeOut: false,
    });
    stepTimes(simulation, 1);
    expect(simulation.liveSlots()).toEqual([0]);
    expect(simulation.columns.time[0]).toBeCloseTo(0.099 + 5 * 0.1 + stepSeconds, 5);
  });

  it("stops updating an undrawn emitter once its InactiveTime passes SecondsBeforeInactive, counting from the step after a draw", () => {
    const simulation = spriteWith({ SecondsBeforeInactive: 1.5 * stepSeconds });
    const context = standaloneStepContext(simulation), timeAfterStep: number[] = [];
    for (let stepIndex = 0; stepIndex < 3; stepIndex += 1) { simulation.step(stepSeconds, context); timeAfterStep.push(simulation.columns.time[0]!); }
    expect(timeAfterStep[1]).toBeGreaterThan(timeAfterStep[0]!);
    expect(timeAfterStep[2]).toBe(timeAfterStep[1]);
    simulation.markDrawn();
    simulation.step(stepSeconds, context);
    expect(simulation.columns.time[0]).toBeGreaterThan(timeAfterStep[2]!);
  });

  it("never updates when SecondsBeforeInactive is negative, as the != 0 gate does", () => {
    const simulation = spriteWith({ SecondsBeforeInactive: -1 });
    stepTimes(simulation, 3);
    expect(simulation.liveSlots()).toHaveLength(0);
  });
});

describe("Interlude spawn rules", () => {
  it("refuses a spawn when LifetimeRange.Max is not above 0 and leaves the slot counters and the stream alone", () => {
    const simulation = spriteWith({ LifetimeRange: { Min: 0, Max: 0 } });
    const outcomes = Array.from({ length: 3 }, () => simulation.step(stepSeconds, standaloneStepContext(simulation)));
    expect(outcomes).toEqual(["running", "running", "running"]);
    expect({ activeSlots: simulation.counters.activeSlots, nextSlot: simulation.counters.nextSlot }).toEqual({ activeSlots: 0, nextSlot: 0 });
    const freshStream = createEmitterRandomStream(1, 0, 0);
    freshStream.nextUnit(); freshStream.nextUnit();
    expect(simulation.runtime.stream.nextUnit()).toBe(freshStream.nextUnit());
  });

  it("keeps the spawn leftover and the birth ages as float32 values in the SpawnParticles order", () => {
    const simulation = spriteWith({ InitialParticlesPerSecond: 100, MaxParticles: 6 });
    stepTimes(simulation, 1);
    const rate = 100, step = Math.fround(stepSeconds), secondsBetweenBirths = Math.fround(1 / rate);
    const owed = Math.fround(rate * step + 0);
    expect(simulation.counters.spawnFraction).toBe(Math.fround(owed - Math.floor(owed)));
    const firstBirthAge = Math.fround(secondsBetweenBirths * 0 + step - secondsBetweenBirths);
    expect(simulation.liveSlots()).toEqual([0]);
    expect(simulation.columns.time[0]).toBe(firstBirthAge);
  });

  it("places a polar start with the FGlobalMath table sine and cosine in the SpawnParticle grouping", () => {
    const simulation = spriteWith({
      ...stillOverrides, StartLocationShape: 2,
      StartLocationPolarRange: { X: { Min: 30, Max: 30 }, Y: { Min: 50, Max: 50 }, Z: { Min: 10, Max: 10 } },
    });
    stepTimes(simulation, 1);
    const azimuth = Math.fround(30 * Math.PI / 180), inclination = Math.fround(50 * Math.PI / 180);
    expect(readSlotVector(simulation.columns.location, 0)).toEqual({
      x: Math.fround(sineOfRadiansFromTable(inclination) * (cosineOfRadiansFromTable(azimuth) * 10)),
      y: Math.fround(sineOfRadiansFromTable(inclination) * (sineOfRadiansFromTable(azimuth) * 10)),
      z: Math.fround(cosineOfRadiansFromTable(inclination) * 10),
    });
    expect(readSlotVector(simulation.columns.location, 0).z).not.toBe(Math.fround(Math.cos(50 * Math.PI / 180) * 10));
  });

  it("reads the sine table the way FGlobalMath SinFloat and CosFloat index it", () => {
    expect(sineOfRadiansFromTable(Math.PI / 2)).toBe(1);
    expect(cosineOfRadiansFromTable(0)).toBe(1);
    expect(sineOfRadiansFromTable(-Math.PI / 2)).toBe(-1);
    expect(cosineOfRadiansFromTable(Math.PI)).toBe(-1);
  });
});

describe("Interlude atlas blending", () => {
  function atlasAt(subdivisionStart: number, subdivisionEnd: number, relativeAge: number) {
    const simulation = spriteWith({ TextureUSubdivisions: 2, TextureVSubdivisions: 2, SubdivisionStart: subdivisionStart, SubdivisionEnd: subdivisionEnd, BlendBetweenSubdivisions: true });
    stepTimes(simulation, 1);
    simulation.columns.time[0] = relativeAge;
    simulation.columns.maxLifetime[0] = 1;
    return simulation.atlasCell(0);
  }

  it("holds the blend target where the next cell equals the subdivision count", () => {
    expect(atlasAt(1, 3, 0.25)).toMatchObject({ cell: 1, nextCell: 1, blendWeight: 127 / 255 });
  });

  it("blends past the last cell of the range and keeps the weight byte there", () => {
    expect(atlasAt(2, 4, 0.75)).toMatchObject({ cell: 3, nextCell: 4, blendWeight: 127 / 255 });
  });
});
