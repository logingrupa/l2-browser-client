import { describe, expect, it } from "vitest";
import { float32Scaled, float32Vector, float32VectorSize, type Vector3 } from "../../src/shared/math/vector3";
import { moveActor } from "../../src/scene/world/movement/core/moveActor";
import { pawnCylinderAt, safeNormal, slideAlongPlane, type PawnBody, type PawnPhysicsContext } from "../../src/scene/world/movement/core/pawnBody";
import { stepUpPawn, twoWallAdjust } from "../../src/scene/world/movement/core/pawnStepUp";
import { blockingBox, boxVolumeWorld, floorSlab, pawnContext, pawnRules, standingPawn } from "../fixtures/movement/pawnWorldFixtures";

const downwardGravity = { x: 0, y: 0, z: -1 };
const stepDown = { x: 0, y: 0, z: -10 };
const lift = { x: 0, y: 0, z: 10 };
const wallHitFacingMinusX = { time: 0, normal: { x: -1, y: 0, z: 0 } };
const thirtyDegreesPitchDown = -5461;
const slopeFacingMinusX = blockingBox([134, 0, 0], [64, 256, 64], [thirtyDegreesPitchDown, 0, 0]);
const sideWallFacingMinusY = blockingBox([0, 79, 0], [512, 64, 256]);

const moveFrom = (context: PawnPhysicsContext, body: PawnBody, location: Vector3, delta: Vector3) =>
  moveActor(context.world, pawnCylinderAt(body, location), delta, pawnRules, context.surroundings);

describe("stepUpPawn follows APawn::stepUp", () => {
  it("reads the step limits from Engine.dll and shares one float step side bound for the lift and the recursion", () => {
    const rowsById = new Map(pawnRules.rows.map(row => [row.id, row]));
    for (const id of ["movement.maxStepHeight", "movement.minFloorZ", "movement.maxStepSideZ", "movement.stepUpRecursion"]) {
      expect(rowsById.get(id)!.status).toMatch(/^(confirmed|corrected)-interlude$/);
      expect(rowsById.get(id)!.provenance).toMatch(/^Engine\.dll 4dd2f63c APawn::stepUp 0x1063A0C0: /);
      expect(rowsById.get(id)!.provenance).not.toMatch(/lineage2js/i);
    }
    expect(rowsById.has("movement.stepUpWallZ")).toBe(false);
    expect(pawnRules.pawn.maxStepSideZ).toBe(Math.fround(0.7));
    expect(pawnRules.pawn.minFloorZ).toBe(0.7);
    expect(pawnRules.pawn.maxStepHeight).toBe(10);
    expect(pawnRules.pawn.stepUpRecursion).toBe(144);
  });

  it("steps down and steps up again after the lift when the next face is steeper than 0.2 but under the 0.7f step side bound", () => {
    const context = pawnContext(boxVolumeWorld([slopeFacingMinusX]));
    const flier = standingPawn({ x: 20, y: 0, z: 0 }, "flying");
    const delta = { x: 40, y: 0, z: 0 };
    const across = moveFrom(context, flier, float32Vector({ x: 20, y: 0, z: 10 }), delta);
    expect(Math.abs(across.hit!.normal.z)).toBeGreaterThan(0.2);
    expect(Math.abs(across.hit!.normal.z)).toBeLessThan(pawnRules.pawn.maxStepSideZ);
    expect(float32VectorSize(delta) ** 2 * across.hit!.time).toBeGreaterThan(pawnRules.pawn.stepUpRecursion);
    const down = moveFrom(context, flier, across.location, stepDown);
    const recursedLift = moveFrom(context, flier, down.location, lift);
    const recursedAcross = moveFrom(context, flier, recursedLift.location, float32Scaled(delta, Math.fround(1 - down.hit!.time)));
    const stepped = stepUpPawn(context, flier, flier.location, downwardGravity, { x: 1, y: 0, z: 0 }, delta, wallHitFacingMinusX);
    expect(stepped.x).toBe(recursedAcross.location.x);
    expect(stepped.x).toBeGreaterThan(across.location.x);
    expect(stepped.z).toBeGreaterThan(down.location.z);
  });

  it("slides after the lift along the wall normal with Z cleared and hands that flattened normal to TwoWallAdjust as the old normal", () => {
    const context = pawnContext(boxVolumeWorld([slopeFacingMinusX, sideWallFacingMinusY]));
    const flier = standingPawn({ x: 36, y: 0, z: 0 }, "flying");
    const delta = { x: 6, y: 6, z: -3 };
    const desiredDirection = safeNormal(delta, pawnRules);
    const across = moveFrom(context, flier, moveFrom(context, flier, flier.location, lift).location, delta);
    expect(across.hit!.normal.z).toBeGreaterThan(0.2);
    const flattenedNormal = safeNormal({ x: across.hit!.normal.x, y: across.hit!.normal.y, z: 0 }, pawnRules);
    const slideDelta = slideAlongPlane(delta, flattenedNormal, across.hit!.time);
    const slide = moveFrom(context, flier, across.location, slideDelta);
    expect(slide.hit!.normal).toEqual({ x: 0, y: -1, z: 0 });
    const creaseMove = twoWallAdjust(desiredDirection, slideDelta, slide.hit!.normal, flattenedNormal, slide.hit!.time, pawnRules);
    const withHitNormal = twoWallAdjust(desiredDirection, slideDelta, slide.hit!.normal, across.hit!.normal, slide.hit!.time, pawnRules);
    expect(Math.abs(creaseMove.x)).toBe(0);
    expect(withHitNormal.x).toBeGreaterThan(0.1);
    const expected = moveFrom(context, flier, moveFrom(context, flier, slide.location, creaseMove).location, stepDown).location;
    expect(stepUpPawn(context, flier, flier.location, downwardGravity, desiredDirection, delta, wallHitFacingMinusX)).toEqual(expected);
  });

  it("moves a pawn that is not walking up a ceiling face by Delta + (0, 0, Size(Delta) n_z), while a walking pawn gets no move", () => {
    const context = pawnContext(boxVolumeWorld([floorSlab(-1000)]));
    const ceilingHit = { time: 0.5, normal: float32Vector({ x: -0.6, y: 0, z: -0.8 }) };
    const start = { x: 0, y: 0, z: 0 }, delta = { x: 10, y: 0, z: 0 };
    const slopeRise = Math.fround(float32VectorSize(delta) * ceilingHit.normal.z);
    const flown = stepUpPawn(context, standingPawn(start, "flying"), start, downwardGravity, { x: 1, y: 0, z: 0 }, delta, ceilingHit);
    expect(flown).toEqual({ x: 10, y: 0, z: Math.fround(slopeRise - 10) });
    const walked = stepUpPawn(context, standingPawn(start, "walking"), start, downwardGravity, { x: 1, y: 0, z: 0 }, delta, ceilingHit);
    expect(walked.x).toBeCloseTo(0, 5);
    expect(walked.z).toBe(-10);
  });

  it("lifts against the gravity direction it is given and steps down along it", () => {
    const context = pawnContext(boxVolumeWorld([blockingBox([0, 0, 29 + 64], [256, 256, 64])]));
    const start = { x: 0, y: 0, z: 0 }, flier = standingPawn(start, "flying"), delta = { x: 5, y: 0, z: 0 };
    const wallHit = { time: 0.5, normal: { x: -1, y: 0, z: 0 } };
    expect(stepUpPawn(context, flier, start, { x: 0, y: 0, z: 1 }, { x: 1, y: 0, z: 0 }, delta, wallHit)).toEqual({ x: 5, y: 0, z: 0 });
    expect(stepUpPawn(context, flier, start, downwardGravity, { x: 1, y: 0, z: 0 }, delta, wallHit).z).toBeLessThan(-5);
  });
});

describe("the float32 helpers stepUp, physFlying and TwoWallAdjust share", () => {
  it("normalises like Core.dll FVector::SafeNormal: float32 steps and zero below a square sum of movement.safeNormalSquareSumMinimum", () => {
    const row = pawnRules.rows.find(candidate => candidate.id === "movement.safeNormalSquareSumMinimum")!;
    expect(row.status).toBe("confirmed-interlude");
    expect(row.provenance).toMatch(/^Core\.dll 9462f87a FVector::SafeNormal 0x1014E070: /);
    expect(pawnRules.pawn.safeNormalSquareSumMinimum).toBe(1e-8);
    const inverseSize = Math.fround(1 / Math.fround(Math.sqrt(169)));
    expect(safeNormal({ x: 3, y: 4, z: 12 }, pawnRules)).toEqual({ x: Math.fround(3 * inverseSize), y: Math.fround(4 * inverseSize), z: Math.fround(12 * inverseSize) });
    expect(safeNormal(float32Vector({ x: 9e-5, y: 0, z: 0 }), pawnRules)).toEqual({ x: 0, y: 0, z: 0 });
    expect(safeNormal(float32Vector({ x: 2e-4, y: 0, z: 0 }), pawnRules).x).toBeCloseTo(1, 6);
  });

  it("slides along a plane in float32 steps: f32(Delta . N), f32(N d), f32(Delta - N d), then times f32(1 - Time)", () => {
    const delta = float32Vector({ x: 10.3, y: -4.7, z: 2.9 }), normal = float32Vector({ x: -0.6, y: 0.48, z: 0.64 }), hitTime = Math.fround(0.37);
    const intoPlane = Math.fround(delta.x * normal.x + delta.y * normal.y + delta.z * normal.z);
    const remaining = Math.fround(1 - hitTime);
    const axes = ["x", "y", "z"] as const;
    expect(slideAlongPlane(delta, normal, hitTime)).toEqual(Object.fromEntries(axes.map(axis =>
      [axis, Math.fround(Math.fround(delta[axis] - Math.fround(normal[axis] * intoPlane)) * remaining)])));
  });

  it("moves nothing along a crease whose cross product squares below the SafeNormal minimum", () => {
    const nearlyOpposite = float32Vector({ x: -1, y: 1e-5, z: 0 });
    expect(twoWallAdjust({ x: 0, y: 0, z: 1 }, { x: 10, y: 5, z: 3 }, { x: 1, y: 0, z: 0 }, nearlyOpposite, 0.5, pawnRules)).toEqual({ x: 0, y: 0, z: 0 });
  });
});
