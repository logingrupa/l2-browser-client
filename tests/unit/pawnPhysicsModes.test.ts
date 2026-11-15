import { describe, expect, it } from "vitest";
import type { Vector3 } from "../../src/shared/math/vector3";
import type { CollisionWorld } from "../../src/scene/world/movement/core/collisionWorld";
import { singleLineCheck } from "../../src/scene/world/movement/core/lineCheck";
import type { PawnBody } from "../../src/scene/world/movement/core/pawnBody";
import { advancePawnSimulation, type PawnSimulation, type PawnTraits } from "../../src/scene/world/movement/core/pawnPhysics";
import { twoWallAdjust } from "../../src/scene/world/movement/core/pawnStepUp";
import type { PawnSpeeds } from "../../src/scene/world/movement/core/pawnVelocity";
import type { GoldenTrace } from "../support/goldenTrace";
import { expectMovementGoldenTrace } from "../fixtures/movement/movementCollisionFixtures";
import {
  blockingBox, boxVolumeWorld, centreAboveFloor, floorSlab, pawnContext, pawnRules, standingPawn, syntheticPawnHalfHeight, syntheticPawnRadius, waterBox,
} from "../fixtures/movement/pawnWorldFixtures";

const frameSeconds = 1 / 60;
const allSpeeds: PawnSpeeds = { walk: 80, run: 115, swimWalk: 50, swimRun: 70, flyWalk: 120, flyRun: 160, nonAttackSpeedRate: 1 };
const walker: PawnTraits = { isLocalPlayer: false, walkAnimationFramesInMove: null, flies: false };
const flier: PawnTraits = { ...walker, flies: true };
const modeCodes: Readonly<Record<PawnBody["mode"], number>> = { walking: 0, falling: 1, swimming: 2, flying: 3 };

function simulationOf(body: PawnBody, destination: Vector3 | null): PawnSimulation {
  const goal = destination === null ? null : { destination, offset: 0, runs: false, speeds: allSpeeds };
  return { body, yaw: 0, goal, moveTimerSeconds: 0, speedUnresolved: false };
}

function runFrames(world: CollisionWorld, simulation: PawnSimulation, traits: PawnTraits, frameCount: number): PawnSimulation[] {
  const context = pawnContext(world);
  const frames: PawnSimulation[] = [];
  let current = simulation;
  for (let frame = 0; frame < frameCount; frame += 1) {
    current = advancePawnSimulation(context, current, traits, frameSeconds);
    frames.push(current);
  }
  return frames;
}

function probedFloorGap(world: CollisionWorld, location: Vector3): number {
  const probe = pawnRules.pawn.floorProbe;
  const hit = singleLineCheck(world, {
    start: location, end: { ...location, z: location.z - probe }, extent: { x: syntheticPawnRadius, y: syntheticPawnRadius, z: syntheticPawnHalfHeight },
  }, pawnRules);
  return probe * (hit?.time ?? 1);
}

function modeGoldenTrace(frames: readonly PawnSimulation[]): GoldenTrace {
  return {
    seed: 0, stepSeconds: frameSeconds, columns: ["frame", "x", "y", "z", "velocityX", "velocityY", "velocityZ", "mode"],
    rows: frames.map((frame, frameIndex) => {
      const { location, velocity, mode } = frame.body;
      return [frameIndex, location.x, location.y, location.z, velocity.x, velocity.y, velocity.z, modeCodes[mode]];
    }),
  };
}

const stepWorld = (stepHeight: number) => boxVolumeWorld([floorSlab(0), blockingBox([228, 0, stepHeight - 64], [128, 512, 64])]);

describe("stepUp, wall slide and twoWallAdjust", () => {
  it("climbs a step at movement.maxStepHeight and pins the climb in a golden trace", () => {
    const world = stepWorld(pawnRules.pawn.maxStepHeight);
    const frames = runFrames(world, simulationOf(standingPawn(centreAboveFloor(0, 0, 0)), { x: 300, y: 0, z: 0 }), walker, 270);
    const last = frames.at(-1)!.body;
    expect(last.location.x).toBeCloseTo(300, 1);
    expect(last.location.z - syntheticPawnHalfHeight).toBeGreaterThan(pawnRules.pawn.maxStepHeight);
    expect(last.mode).toBe("walking");
    expectMovementGoldenTrace("pawn-step-up.golden.json", modeGoldenTrace(frames));
  });

  it("is blocked by a step twice movement.maxStepHeight", () => {
    const frames = runFrames(stepWorld(2 * pawnRules.pawn.maxStepHeight), simulationOf(standingPawn(centreAboveFloor(0, 0, 0)), { x: 300, y: 0, z: 0 }), walker, 270);
    const last = frames.at(-1)!.body;
    expect(last.location.x).toBeLessThan(100 - syntheticPawnRadius);
    expect(last.location.z - syntheticPawnHalfHeight).toBeLessThan(pawnRules.pawn.maxStepHeight);
  });

  it("slides along a wall above the step limit toward the desired direction", () => {
    const world = boxVolumeWorld([floorSlab(0), blockingBox([132, 0, 256], [32, 1024, 256])]);
    const frames = runFrames(world, simulationOf(standingPawn(centreAboveFloor(0, 0, 0)), { x: 300, y: 300, z: 0 }), walker, 180);
    const last = frames.at(-1)!.body;
    expect(last.location.x).toBeLessThan(100 - syntheticPawnRadius);
    expect(last.location.y).toBeGreaterThan(150);
  });

  it("resolves a corner without tunnelling through either wall", () => {
    const world = boxVolumeWorld([floorSlab(0), blockingBox([132, 0, 256], [32, 1024, 256]), blockingBox([0, 132, 256], [1024, 32, 256])]);
    const frames = runFrames(world, simulationOf(standingPawn(centreAboveFloor(0, 0, 0)), { x: 400, y: 400, z: 0 }), walker, 240);
    for (const frame of frames) {
      expect(frame.body.location.x).toBeLessThanOrEqual(100 - syntheticPawnRadius);
      expect(frame.body.location.y).toBeLessThanOrEqual(100 - syntheticPawnRadius);
    }
    expect(frames.at(-1)!.body.location.x).toBeGreaterThan(80);
    expect(frames.at(-1)!.body.location.y).toBeGreaterThan(80);
  });

  it("moves along the crease of facing walls and drops a slide that turns against the desired direction", () => {
    const facingSlopes = [{ x: -0.8, y: 0, z: 0.6 }, { x: 0.8, y: 0, z: 0.6 }] as const;
    const crease = twoWallAdjust({ x: 0.6, y: 0.8, z: 0 }, { x: 10, y: 5, z: 0 }, facingSlopes[0], facingSlopes[1], 0.5, pawnRules);
    expect(crease.x).toBeCloseTo(0, 6);
    expect(crease.y).toBeCloseTo(2.5, 5);
    expect(crease.z).toBeCloseTo(0, 6);
    const flipped = twoWallAdjust({ x: 0, y: -1, z: 0 }, { x: 10, y: 5, z: 0 }, facingSlopes[0], facingSlopes[1], 0.5, pawnRules);
    expect(flipped.y).toBeCloseTo(-2.5, 5);
    const slide = twoWallAdjust({ x: 1, y: 0, z: 0 }, { x: 10, y: 4, z: 0 }, { x: -0.6, y: -0.8, z: 0 }, { x: -1, y: 0, z: 0 }, 0.5, pawnRules);
    expect(slide.x).toBeGreaterThan(0);
    const against = twoWallAdjust({ x: 1, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, { x: -1, y: 0, z: 0 }, { x: -0.6, y: -0.8, z: 0 }, 0.5, pawnRules);
    expect(against).toEqual({ x: 0, y: 0, z: 0 });
  });
});

describe("falling, swimming and flying", () => {
  it("falls off a 300-unit ledge and lands with the probed gap in the floor band", () => {
    const world = boxVolumeWorld([floorSlab(0), floorSlab(300, -2048, 0)]);
    const frames = runFrames(world, simulationOf(standingPawn(centreAboveFloor(-40, 0, 300)), { x: 200, y: 0, z: 0 }), walker, 240);
    expect(frames.some(frame => frame.body.mode === "falling")).toBe(true);
    const last = frames.at(-1)!.body;
    expect(last.mode).toBe("walking");
    expect(last.location.z).toBeLessThan(40);
    const gap = probedFloorGap(world, last.location);
    expect(gap).toBeGreaterThanOrEqual(pawnRules.pawn.floorBand.minimum);
    expect(gap).toBeLessThanOrEqual(pawnRules.pawn.floorBand.maximum);
    expectMovementGoldenTrace("pawn-falling-ledge.golden.json", modeGoldenTrace(frames));
  });

  it("swims a pawn inside a water volume toward a 3D goal at swim speed", () => {
    const world = boxVolumeWorld([floorSlab(-600), waterBox([0, 0, -250], [2048, 2048, 250])]);
    const frames = runFrames(world, simulationOf(standingPawn({ x: 0, y: 0, z: -200 }), { x: 0, y: 0, z: -400 }), walker, 270);
    expect(frames[0]!.body.mode).toBe("swimming");
    expect(frames[0]!.body.location.z).toBeCloseTo(-200 - allSpeeds.swimWalk! * frameSeconds, 3);
    expect(frames.at(-1)!.body.location.z).toBeCloseTo(-400, 1);
    expectMovementGoldenTrace("pawn-swimming.golden.json", modeGoldenTrace(frames));
  });

  it("enters water from a fall and falls again with the exit speed when the waterline leaves the water", () => {
    const world = boxVolumeWorld([floorSlab(-600), waterBox([0, 0, -250], [2048, 2048, 250])]);
    const entering = runFrames(world, simulationOf(standingPawn({ x: 0, y: 0, z: 60 }, "falling"), null), walker, 60);
    expect(entering.some(frame => frame.body.mode === "swimming")).toBe(true);
    const leaving = runFrames(world, simulationOf(standingPawn({ x: 0, y: 0, z: -40 }), { x: 0, y: 0, z: 100 }), walker, 60);
    const firstFall = leaving.find(frame => frame.body.mode === "falling")!;
    expect(firstFall.body.location.z + pawnRules.pawn.waterlineProbe).toBeGreaterThan(0);
    expect(firstFall.body.velocity.z).toBeGreaterThan(0);
  });

  it("flies to a 3D goal while ignoring the floor probe, where a walking pawn falls", () => {
    const world = boxVolumeWorld([floorSlab(-1000)]);
    const flying = runFrames(world, simulationOf(standingPawn({ x: 0, y: 0, z: 0 }, "flying"), { x: 120, y: 0, z: 60 }), flier, 120);
    expect(flying.every(frame => frame.body.mode === "flying")).toBe(true);
    expect(flying.at(-1)!.body.location).toEqual({ x: expect.closeTo(120, 1), y: 0, z: expect.closeTo(60, 1) });
    const walking = runFrames(world, simulationOf(standingPawn({ x: 0, y: 0, z: 0 }), { x: 120, y: 0, z: 60 }), walker, 30);
    expect(walking.at(-1)!.body.mode).toBe("falling");
    expect(walking.at(-1)!.body.location.z).toBeLessThan(-10);
    expectMovementGoldenTrace("pawn-flying.golden.json", modeGoldenTrace(flying));
  });

  it("steps a level flying pawn over a low near-vertical obstacle", () => {
    const world = boxVolumeWorld([blockingBox([228, 0, -79], [128, 512, 64])]);
    const frames = runFrames(world, simulationOf(standingPawn({ x: 0, y: 0, z: 0 }, "flying"), { x: 400, y: 0, z: 0 }), flier, 300);
    expect(frames.at(-1)!.body.location.x).toBeCloseTo(400, 0);
  });
});
