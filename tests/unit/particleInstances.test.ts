import { describe, expect, it } from "vitest";
import { createParticleInstanceBuffers, PARTICLE_MATRIX_STRIDE, writeParticleInstances } from "../../src/effects/particles/render/particleInstances";
import { createEmitterActorSimulation, type EmitterActorSimulation } from "../../src/effects/particles/sim/emitterActor";
import { COORDINATE_SYSTEM, PARTICLE_CONSTANTS } from "../../src/effects/particles/sim/emitterConstants";
import { parseEmitterActorRecord, parseEmitterRecord } from "../../src/effects/particles/sim/emitterRecords";
import { rotateByAxes } from "../../src/effects/particles/sim/particleRotation";
import { rotatorAxes } from "../../src/shared/math/rotator";
import { readSlotVector } from "../../src/effects/particles/sim/particleState";
import { sourcePositionToWorld } from "../../src/world/sourceFrame";
import { STATIONARY_OWNER, readSyntheticParticleFixture } from "./support/particleFixtures";

const stepSeconds = PARTICLE_CONSTANTS.simulationStepSeconds.runtimeDefault;
const spriteFixture = readSyntheticParticleFixture("synthetic-sprite");

function rotatingSpriteActor(coordinateSystem: number): EmitterActorSimulation {
  const actor = createEmitterActorSimulation({
    actor: parseEmitterActorRecord({ ...spriteFixture.actor, effectiveProperties: {
      ...spriteFixture.actor.effectiveProperties, bRotEmitter: true, RotPerSecond: { Pitch: 0, Yaw: 16384, Roll: 0 },
    } }),
    emitters: [parseEmitterRecord({ ...spriteFixture.components[0]!, effectiveProperties: {
      ...spriteFixture.components[0]!.effectiveProperties, CoordinateSystem: coordinateSystem, MaxParticles: 120, InitialParticlesPerSecond: 60,
      ParticlesPerSecond: 60, LifetimeRange: { Min: 3, Max: 3 }, StartLocationOffset: { X: 10, Y: 0, Z: 0 }, StartLocationShape: 0,
      StartVelocityRange: { X: { Min: 0, Max: 0 }, Y: { Min: 0, Max: 0 }, Z: { Min: 0, Max: 0 } }, Acceleration: { X: 0, Y: 0, Z: 0 },
      GetVelocityDirectionFrom: 0, VelocityLossRange: { X: { Min: 0, Max: 0 }, Y: { Min: 0, Max: 0 }, Z: { Min: 0, Max: 0 } },
    } })],
    sessionSeed: 1, effectSerial: 0,
  });
  for (let stepIndex = 0; stepIndex < 60; stepIndex += 1) actor.step(stepSeconds, STATIONARY_OWNER);
  return actor;
}

function firstInstanceTranslation(actor: EmitterActorSimulation): number[] {
  const emitter = actor.emitters[0]!, buffers = createParticleInstanceBuffers(emitter.columns.capacity);
  writeParticleInstances(emitter, buffers, { emitterRotation: actor.emitterRotation, colourOverride: null, atlasOverride: null });
  return Array.from(buffers.matrices.subarray(12, PARTICLE_MATRIX_STRIDE - 1));
}

function expectTranslation(actual: readonly number[], expected: { x: number; y: number; z: number }): void {
  expect(actual[0]).toBeCloseTo(expected.x, 5);
  expect(actual[1]).toBeCloseTo(expected.y, 5);
  expect(actual[2]).toBeCloseTo(expected.z, 5);
}

describe("particle instance placement", () => {
  it("draws a world-stored Spray particle where it was born, without the live bRotEmitter rotation", () => {
    const actor = rotatingSpriteActor(COORDINATE_SYSTEM.spray), emitter = actor.emitters[0]!;
    expect(emitter.storageSpace).toBe("world");
    expect(actor.emitterRotation.yaw).toBeCloseTo(16384, 6);
    expectTranslation(firstInstanceTranslation(actor), sourcePositionToWorld(readSlotVector(emitter.columns.location, emitter.liveSlots()[0]!)));
  });

  it("turns an owner-stored Relative particle with the live bRotEmitter rotation", () => {
    const actor = rotatingSpriteActor(COORDINATE_SYSTEM.relative), emitter = actor.emitters[0]!;
    expect(emitter.storageSpace).toBe("owner");
    const storedLocation = readSlotVector(emitter.columns.location, emitter.liveSlots()[0]!);
    expectTranslation(firstInstanceTranslation(actor), sourcePositionToWorld(rotateByAxes(storedLocation, rotatorAxes(actor.emitterRotation))));
  });
});
