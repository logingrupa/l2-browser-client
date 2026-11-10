import { describe, expect, it } from "vitest";
import { calculateBehindView } from "../../src/scene/world/movement/core/behindViewCamera";
import { traceClickDestination } from "../../src/scene/world/movement/core/clickTrace";
import { CollisionWorldError } from "../../src/scene/world/movement/core/collisionWorld";
import { collisionWorldFromFixtures, emptyChunkArrays, wallTreeArrays } from "../fixtures/movement/movementCollisionFixtures";
import { boxVolumeWorld, floorSlab, pawnRules } from "../fixtures/movement/pawnWorldFixtures";

const wallWorld = () => collisionWorldFromFixtures(emptyChunkArrays(), wallTreeArrays());
const wallNearX = 256;
const lookingTowardMinusX = 32768;
const pivot = { x: 0, y: 0, z: 0 };

describe("calculateBehindView", () => {
  it("pulls the camera in front of a wall between the pivot and the camera, to min(D, h) - 30 along the view", () => {
    const zoomDistance = 300;
    const view = calculateBehindView(wallWorld(), { pivot, pitch: 0, yaw: lookingTowardMinusX, zoomDistance }, pawnRules);
    const { zoomOffset, wallMargin } = pawnRules.camera;
    expect(view.hitDistance).not.toBeNull();
    expect(view.hitDistance!).toBeLessThan(wallNearX);
    expect(view.hitDistance!).toBeGreaterThan(wallNearX - 5);
    expect(view.distance).toBe(Math.min(zoomDistance + zoomOffset, view.hitDistance!));
    expect(view.location.x).toBeCloseTo(view.distance - wallMargin, 4);
    expect(view.location.x).toBeLessThan(wallNearX);
    expect(view.location.y).toBeCloseTo(0, 6);
    expect(view.location.z).toBe(0);
  });

  it("sits at D - 30 along the view when the hit check misses", () => {
    const zoomDistance = -100;
    const view = calculateBehindView(wallWorld(), { pivot, pitch: 0, yaw: lookingTowardMinusX, zoomDistance }, pawnRules);
    expect(view.hitDistance).toBeNull();
    expect(view.location.x).toBe(zoomDistance + pawnRules.camera.zoomOffset - pawnRules.camera.wallMargin);
  });

  it("builds the view direction from pitch and yaw through the float32 sine table", () => {
    const view = calculateBehindView(boxVolumeWorld([]), { pivot, pitch: 16384, yaw: 0, zoomDistance: 0 }, pawnRules);
    const distance = pawnRules.camera.zoomOffset - pawnRules.camera.wallMargin;
    expect(view.location.z).toBeCloseTo(-distance, 4);
    expect(Math.abs(view.location.x)).toBeLessThan(1e-4);
  });
});

describe("traceClickDestination", () => {
  const clickOrigin = { x: 40, y: -20, z: 500 };
  const loadedBoundsLength = 4000;

  it("returns the first floor hit under a zero-extent ray and null for a ray into the sky", () => {
    const world = boxVolumeWorld([floorSlab(0)]);
    const destination = traceClickDestination(world, { origin: clickOrigin, direction: { x: 0, y: 0, z: -1 }, loadedBoundsLength, swimsOrFlies: false }, pawnRules);
    expect(destination).not.toBeNull();
    expect(destination!.x).toBe(40);
    expect(destination!.y).toBe(-20);
    expect(destination!.z).toBeGreaterThanOrEqual(0);
    expect(destination!.z).toBeLessThan(1);
    expect(traceClickDestination(world, { origin: clickOrigin, direction: { x: 0, y: 0, z: 1 }, loadedBoundsLength, swimsOrFlies: false }, pawnRules)).toBeNull();
  });

  it("reaches click.pickLength while swimming or flying and moves there when nothing is hit", () => {
    const world = boxVolumeWorld([floorSlab(0)]);
    const destination = traceClickDestination(world, { origin: clickOrigin, direction: { x: 0, y: 0, z: 2 }, loadedBoundsLength, swimsOrFlies: true }, pawnRules);
    expect(destination).toEqual({ x: 40, y: -20, z: 500 + pawnRules.clickPickLength });
  });

  it("refuses a ray without a finite direction or a positive length", () => {
    const world = boxVolumeWorld([floorSlab(0)]);
    expect(() => traceClickDestination(world, { origin: pivot, direction: { x: 0, y: 0, z: 0 }, loadedBoundsLength, swimsOrFlies: false }, pawnRules)).toThrow(CollisionWorldError);
    expect(() => traceClickDestination(world, { origin: pivot, direction: { x: 0, y: 0, z: -1 }, loadedBoundsLength: 0, swimsOrFlies: false }, pawnRules)).toThrow(/length/);
  });
});
