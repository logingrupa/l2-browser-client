import { describe, expect, it } from "vitest";
import type { Vector3 } from "../../src/shared/math/vector3";
import { parseMovementNativeRules } from "../../src/scene/world/movement/core/movementRules";
import type { PawnPhysicsContext } from "../../src/scene/world/movement/core/pawnBody";
import { flyPawn } from "../../src/scene/world/movement/core/pawnFlying";
import { readCommittedMovementRulesDocument } from "../fixtures/movement/movementCollisionFixtures";
import { blockingBox, boxVolumeWorld, floorSlab, pawnContext, pawnRules, standingPawn, syntheticPawnRadius } from "../fixtures/movement/pawnWorldFixtures";

const tickSeconds = 1 / 60;
const deltaTime = Math.fround(tickSeconds);
const lowWallFaceX = 100;
const lowWallWorld = boxVolumeWorld([blockingBox([228, 0, -79], [128, 512, 64])]);
const lastXBeforeLowWall = lowWallFaceX - syntheticPawnRadius;

function contextWithVolumeGravity(volumeGravity: number): PawnPhysicsContext {
  const document = readCommittedMovementRulesDocument() as { rows: Record<string, unknown>[] };
  const rows = document.rows.map(row => row.id === "movement.volumeGravity" ? { ...row, value: volumeGravity, runtimeDefault: volumeGravity } : row);
  return { ...pawnContext(lowWallWorld), rules: parseMovementNativeRules({ ...document, rows }) };
}

const flyIntoLowWall = (context: PawnPhysicsContext, startZ: number, velocity: Vector3) =>
  flyPawn(context, standingPawn({ x: 89, y: 0, z: startZ }, "flying"), velocity, tickSeconds).body;

describe("flyPawn follows APawn::physFlying", () => {
  it("reads the flying step bounds from Engine.dll as the client's float constants", () => {
    for (const id of ["movement.flying.stepWallZ", "movement.flying.levelDotMinimum", "movement.flying.levelDotMaximum"]) {
      const row = pawnRules.rows.find(candidate => candidate.id === id)!;
      expect(row.status).toMatch(/^(confirmed|corrected)-interlude$/);
      expect(row.provenance).toMatch(/^Engine\.dll 4dd2f63c APawn::physFlying 0x1063CDF0: /);
      expect(row.provenance).not.toMatch(/lineage2js/i);
    }
    expect(pawnRules.pawn.flyingStepWallZ).toBe(Math.fround(0.2));
    expect(pawnRules.pawn.flyingLevelDotMinimum).toBe(Math.fround(-0.2));
    expect(pawnRules.pawn.flyingLevelDotMaximum).toBe(0.5);
  });

  it("moves by the float32 velocity times the float32 deltaTime and writes Velocity back as the move over deltaTime", () => {
    const start = { x: 10.3, y: -4.1, z: 7.7 }, velocity = { x: 107.3, y: 20.5, z: 53.6 };
    const step = flyPawn(pawnContext(boxVolumeWorld([floorSlab(-1000)])), standingPawn(start, "flying"), velocity, tickSeconds);
    const axes = ["x", "y", "z"] as const;
    const expectedLocation = Object.fromEntries(axes.map(axis =>
      [axis, Math.fround(Math.fround(start[axis]) + Math.fround(Math.fround(velocity[axis]) * deltaTime))])) as unknown as Vector3;
    expect(step.body.location).toEqual(expectedLocation);
    expect(step.body.velocity).toEqual(Object.fromEntries(axes.map(axis =>
      [axis, Math.fround((expectedLocation[axis] - Math.fround(start[axis])) / deltaTime)])));
    expect(step.body.mode).toBe("flying");
    expect(step.unusedSeconds).toBe(0);
  });

  it("steps a level flier over a wall lower than movement.maxStepHeight and keeps the step height out of Velocity", () => {
    const stepped = flyIntoLowWall(pawnContext(lowWallWorld), 0, { x: 600, y: 0, z: 0 });
    expect(stepped.location.x).toBeGreaterThan(lastXBeforeLowWall);
    expect(stepped.location.z).toBeGreaterThan(5);
    expect(stepped.velocity.z).toBe(0);
  });

  it("steps while the velocity along gravity lies between levelDotMinimum and levelDotMaximum and slides outside them", () => {
    const context = pawnContext(lowWallWorld);
    expect(flyIntoLowWall(context, 5, { x: 600, y: 0, z: -200 }).location.x).toBeGreaterThan(lastXBeforeLowWall);
    const descendingSteeply = flyIntoLowWall(context, 5, { x: 600, y: 0, z: -400 });
    expect(descendingSteeply.location.x).toBeLessThanOrEqual(lastXBeforeLowWall);
    expect(descendingSteeply.location.z).toBeLessThan(5);
    const climbing = flyIntoLowWall(context, 0, { x: 600, y: 0, z: 300 });
    expect(climbing.location.x).toBeLessThanOrEqual(lastXBeforeLowWall);
    expect(climbing.location.z).toBeGreaterThan(0);
    expect(climbing.velocity.z).toBeGreaterThan(0);
  });

  it("takes the gravity direction from the sign of the physics volume gravity", () => {
    const gentleDescent = { x: 600, y: 0, z: -200 };
    expect(flyIntoLowWall(contextWithVolumeGravity(-1500), 5, gentleDescent).location.x).toBeGreaterThan(lastXBeforeLowWall);
    expect(flyIntoLowWall(contextWithVolumeGravity(1500), 5, gentleDescent).location.x).toBeLessThanOrEqual(lastXBeforeLowWall);
  });
});
