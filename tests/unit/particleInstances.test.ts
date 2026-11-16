import { describe, expect, it } from "vitest";
import { createParticleInstanceBuffers, PARTICLE_MATRIX_STRIDE, writeParticleInstances } from "../../src/effects/particles/render/particleInstances";
import { createEmitterActorSimulation, type EmitterActorSimulation } from "../../src/effects/particles/sim/emitterActor";
import { COORDINATE_SYSTEM, DIRECTION_USAGE, PARTICLE_CONSTANTS } from "../../src/effects/particles/sim/emitterConstants";
import { parseEmitterActorRecord, parseEmitterRecord } from "../../src/effects/particles/sim/emitterRecords";
import { rotateByAxes, rotateByTransposedAxes } from "../../src/effects/particles/sim/particleRotation";
import { rotatorAxes } from "../../src/shared/math/rotator";
import { readSlotVector } from "../../src/effects/particles/sim/particleState";
import { crossProduct, scaleVector, subtractVectors, vectorLength, type Vector3 } from "../../src/shared/math/vector3";
import { sourcePositionToWorld } from "../../src/world/sourceFrame";
import { STATIONARY_OWNER, readSyntheticParticleFixture } from "./support/particleFixtures";

const stepSeconds = PARTICLE_CONSTANTS.simulationStepSeconds.runtimeDefault;
const spriteFixture = readSyntheticParticleFixture("synthetic-sprite");

const cameraSourceLocation: Vector3 = { x: 40, y: -300, z: 120 };

function rotatingSpriteActor(coordinateSystem: number, directionUsage: number = DIRECTION_USAGE.up): EmitterActorSimulation {
  const actor = createEmitterActorSimulation({
    actor: parseEmitterActorRecord({ ...spriteFixture.actor, effectiveProperties: {
      ...spriteFixture.actor.effectiveProperties, bRotEmitter: true, RotPerSecond: { Pitch: 0, Yaw: 16384, Roll: 0 },
    } }),
    emitters: [parseEmitterRecord({ ...spriteFixture.components[0]!, effectiveProperties: {
      ...spriteFixture.components[0]!.effectiveProperties, CoordinateSystem: coordinateSystem, UseDirectionAs: directionUsage, SpinParticles: false, MaxParticles: 120, InitialParticlesPerSecond: 60,
      ParticlesPerSecond: 60, LifetimeRange: { Min: 3, Max: 3 }, StartLocationOffset: { X: 10, Y: 0, Z: 0 }, StartLocationShape: 0,
      StartVelocityRange: { X: { Min: 30, Max: 30 }, Y: { Min: 0, Max: 0 }, Z: { Min: 20, Max: 20 } }, Acceleration: { X: 0, Y: 0, Z: 0 },
      GetVelocityDirectionFrom: 0, VelocityLossRange: { X: { Min: 0, Max: 0 }, Y: { Min: 0, Max: 0 }, Z: { Min: 0, Max: 0 } },
    } })],
    sessionSeed: 1, effectSerial: 0,
  });
  for (let stepIndex = 0; stepIndex < 60; stepIndex += 1) actor.step(stepSeconds, STATIONARY_OWNER);
  return actor;
}

function firstInstanceTranslation(actor: EmitterActorSimulation): number[] {
  const emitter = actor.emitters[0]!, buffers = createParticleInstanceBuffers(emitter.columns.capacity);
  writeParticleInstances(emitter, buffers, { emitterRotation: actor.emitterRotation, cameraSourceLocation, colourOverride: null, atlasOverride: null });
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

function firstInstanceColumn(buffers: { matrices: Float32Array }, column: number): Vector3 {
  const [x, y, z] = Array.from(buffers.matrices.subarray(column * 4, column * 4 + 3));
  return { x: x!, y: y!, z: z! };
}

function expectVectorClose(actual: Vector3, expected: Vector3): void {
  expect(actual.x).toBeCloseTo(expected.x, 5);
  expect(actual.y).toBeCloseTo(expected.y, 5);
  expect(actual.z).toBeCloseTo(expected.z, 5);
}

describe("oriented sprite instances", () => {
  it("lays a PTDU_Up needle along its last displacement and across the owner-local camera, then turns both with the owner", () => {
    const actor = rotatingSpriteActor(COORDINATE_SYSTEM.relative), emitter = actor.emitters[0]!, slot = emitter.liveSlots()[0]!;
    const buffers = createParticleInstanceBuffers(emitter.columns.capacity);
    writeParticleInstances(emitter, buffers, { emitterRotation: actor.emitterRotation, cameraSourceLocation, colourOverride: null, atlasOverride: null });
    const ownerAxes = rotatorAxes(actor.emitterRotation);
    const location = readSlotVector(emitter.columns.location, slot), size = readSlotVector(emitter.columns.size, slot);
    const displacement = subtractVectors(location, readSlotVector(emitter.columns.oldLocation, slot));
    const direction = scaleVector(displacement, 1 / vectorLength(displacement));
    const across = crossProduct(direction, subtractVectors(location, rotateByTransposedAxes(cameraSourceLocation, ownerAxes)));
    const toWorld = (axis: Vector3) => sourcePositionToWorld(rotateByAxes(axis, ownerAxes));
    expectVectorClose(firstInstanceColumn(buffers, 1), toWorld(scaleVector(direction, size.y)));
    expectVectorClose(firstInstanceColumn(buffers, 0), toWorld(scaleVector(across, size.x / vectorLength(across))));
    expect(Array.from(buffers.spriteShapes.subarray(0, 4))).toEqual([0, 0, 0, 0]);
    expect(vectorLength(displacement)).toBeGreaterThan(0);
  });

  it("refuses an oriented sprite frame without a camera location", () => {
    const actor = rotatingSpriteActor(COORDINATE_SYSTEM.relative), emitter = actor.emitters[0]!;
    const frame = { emitterRotation: actor.emitterRotation, cameraSourceLocation: null, colourOverride: null, atlasOverride: null };
    expect(() => writeParticleInstances(emitter, createParticleInstanceBuffers(emitter.columns.capacity), frame)).toThrow("builds its axes from the camera location");
  });

  it("keeps PTDU_None camera-facing and sizes both half extents by Size.X", () => {
    const actor = rotatingSpriteActor(COORDINATE_SYSTEM.relative, DIRECTION_USAGE.none), emitter = actor.emitters[0]!, slot = emitter.liveSlots()[0]!;
    const buffers = createParticleInstanceBuffers(emitter.columns.capacity);
    writeParticleInstances(emitter, buffers, { emitterRotation: actor.emitterRotation, cameraSourceLocation: null, colourOverride: null, atlasOverride: null });
    const halfExtent = sourcePositionToWorld({ x: emitter.columns.size[slot * 3]!, y: 0, z: emitter.columns.size[slot * 3]! });
    expect(Array.from(buffers.spriteShapes.subarray(0, 2))).toEqual([halfExtent.x, halfExtent.y].map(Math.fround));
    expect(Array.from(buffers.matrices.subarray(0, 11))).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  });
});
