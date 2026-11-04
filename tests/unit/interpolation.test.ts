import { describe, expect, it } from "vitest";
import { PositionInterpolator } from "../../src/interpolation/PositionInterpolator";

describe("position interpolation", () => {
  it("starts at the supplied state and preserves it without elapsed time", () => {
    const interpolator = new PositionInterpolator({ x: 1, y: 2, z: 3 });
    interpolator.setTarget({ x: 4, y: 5, z: 6 });
    expect(interpolator.update(0)).toEqual({ x: 1, y: 2, z: 3 });
  });

  it("advances smoothly between updates without overshooting", () => {
    const interpolator = new PositionInterpolator({ x: 0, y: 0, z: 0 });
    interpolator.setTarget({ x: 4, y: 2, z: -3 });
    const firstFrame = interpolator.update(1 / 60);
    const secondFrame = interpolator.update(1 / 60);
    expect(firstFrame.x).toBeGreaterThan(0);
    expect(secondFrame.x).toBeGreaterThan(firstFrame.x);
    expect(secondFrame.x).toBeLessThan(4);
    expect(secondFrame.z).toBeGreaterThan(-3);
    expect(interpolator.update(20)).toEqual({ x: 4, y: 2, z: -3 });
  });

  it("is frame-rate independent for a constant target", () => {
    const singleStep = new PositionInterpolator({ x: 0, y: 0, z: 0 });
    const multipleSteps = new PositionInterpolator({ x: 0, y: 0, z: 0 });
    singleStep.setTarget({ x: 3, y: 1, z: 2 });
    multipleSteps.setTarget({ x: 3, y: 1, z: 2 });
    singleStep.update(0.1);
    for (let frame = 0; frame < 6; frame += 1) multipleSteps.update(1 / 60);
    expect(multipleSteps.position.x).toBeCloseTo(singleStep.position.x, 12);
    expect(multipleSteps.position.y).toBeCloseTo(singleStep.position.y, 12);
    expect(multipleSteps.position.z).toBeCloseTo(singleStep.position.z, 12);
  });

  it("continues from the visual position when a fresh target arrives", () => {
    const interpolator = new PositionInterpolator({ x: 0, y: 0, z: 0 });
    interpolator.setTarget({ x: 3, y: 0, z: 0 });
    const earlierPosition = interpolator.update(0.05);
    interpolator.setTarget({ x: 5, y: 0, z: 0 });
    expect(interpolator.position).toEqual(earlierPosition);
    expect(interpolator.update(0.01).x).toBeGreaterThan(earlierPosition.x);
  });

  it("snaps explicit teleports even below the automatic distance threshold", () => {
    const interpolator = new PositionInterpolator({ x: 0, y: 0, z: 0 });
    interpolator.setTarget({ x: 1, y: 0, z: 2 }, true);
    expect(interpolator.position).toEqual({ x: 1, y: 0, z: 2 });
    expect(interpolator.update(0)).toEqual({ x: 1, y: 0, z: 2 });
  });

  it("smooths at exactly eight metres and snaps beyond eight metres", () => {
    const interpolator = new PositionInterpolator({ x: 0, y: 0, z: 0 });
    interpolator.setTarget({ x: 8, y: 0, z: 0 });
    expect(interpolator.position.x).toBe(0);
    interpolator.setTarget({ x: 8.001, y: 0, z: 0 });
    expect(interpolator.position.x).toBe(8.001);
  });

  it("does not retain caller-owned coordinate objects", () => {
    const initialPosition = { x: 0, y: 0, z: 0 };
    const targetPosition = { x: 2, y: 0, z: 0 };
    const interpolator = new PositionInterpolator(initialPosition);
    initialPosition.x = 999;
    interpolator.setTarget(targetPosition);
    targetPosition.x = 999;
    const reportedPosition = interpolator.position;
    Reflect.set(reportedPosition, "x", 999);
    expect(interpolator.position.x).toBe(0);
    expect(interpolator.update(20).x).toBe(2);
  });

  it("rejects invalid time and positions without poisoning existing state", () => {
    const interpolator = new PositionInterpolator({ x: 0, y: 0, z: 0 });
    for (const elapsedSeconds of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => interpolator.update(elapsedSeconds)).toThrow(RangeError);
    }
    expect(() => interpolator.setTarget({ x: Number.NaN, y: 0, z: 0 })).toThrow(RangeError);
    expect(() => new PositionInterpolator({ x: 0, y: Number.POSITIVE_INFINITY, z: 0 })).toThrow(RangeError);
    expect(interpolator.position).toEqual({ x: 0, y: 0, z: 0 });
  });
});
