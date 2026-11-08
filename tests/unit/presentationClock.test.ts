import { describe, expect, it } from "vitest";
import { createFixedStepAccumulator } from "../../src/shared/fixedStep";
import { createPresentationClock } from "../../src/shared/presentationClock";

describe("presentation clock", () => {
  it("starts at level second 0 and grows by each frame delta", () => {
    const clock = createPresentationClock();
    expect([clock.levelSeconds, clock.frameDeltaSeconds, clock.paused]).toEqual([0, 0, false]);
    clock.advance(0.25);
    clock.advance(0.5);
    expect(clock.levelSeconds).toBe(0.75);
    expect(clock.frameDeltaSeconds).toBe(0.5);
  });

  it("stops level seconds while paused and reports a zero frame delta", () => {
    const clock = createPresentationClock();
    clock.advance(1);
    clock.pause();
    clock.advance(0.5);
    expect([clock.levelSeconds, clock.frameDeltaSeconds, clock.paused]).toEqual([1, 0, true]);
    clock.resume();
    clock.advance(0.5);
    expect([clock.levelSeconds, clock.frameDeltaSeconds, clock.paused]).toEqual([1.5, 0.5, false]);
  });

  it("sets level seconds on seek without counting the jump as frame time", () => {
    const clock = createPresentationClock();
    clock.advance(0.1);
    clock.seek(42);
    expect([clock.levelSeconds, clock.frameDeltaSeconds]).toEqual([42, 0]);
    clock.advance(0.5);
    expect(clock.levelSeconds).toBe(42.5);
    clock.seek(3);
    expect(clock.levelSeconds).toBe(3);
  });

  it("never takes a negative or non-finite delta or seek target", () => {
    const clock = createPresentationClock();
    expect(() => clock.advance(-0.01)).toThrow(RangeError);
    expect(() => clock.advance(Number.NaN)).toThrow(RangeError);
    expect(() => clock.seek(-1)).toThrow(RangeError);
    expect(() => clock.seek(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(clock.levelSeconds).toBe(0);
  });
});

describe("fixed-step accumulator", () => {
  it("runs the capped step count for a long frame and drops the remainder", () => {
    for (const maximumStepsPerFrame of [1, 4, 8, 11]) {
      const accumulator = createFixedStepAccumulator({ stepSeconds: 1 / 60, maximumStepsPerFrame });
      expect(accumulator.advance(0.2)).toBe(maximumStepsPerFrame);
      expect(accumulator.backlogSeconds).toBe(0);
      expect(accumulator.advance(1 / 60)).toBe(1);
    }
  });

  it("carries a partial step into the next frame when under the cap", () => {
    const accumulator = createFixedStepAccumulator({ stepSeconds: 0.25, maximumStepsPerFrame: 8 });
    expect(accumulator.advance(0.375)).toBe(1);
    expect(accumulator.backlogSeconds).toBe(0.125);
    expect(accumulator.advance(0.125)).toBe(1);
    expect(accumulator.backlogSeconds).toBe(0);
    expect(accumulator.advance(0.1)).toBe(0);
    expect(accumulator.advance(0)).toBe(0);
  });

  it("refuses a non-positive step, a non-integer cap and a negative frame delta", () => {
    expect(() => createFixedStepAccumulator({ stepSeconds: 0, maximumStepsPerFrame: 8 })).toThrow(RangeError);
    expect(() => createFixedStepAccumulator({ stepSeconds: 1 / 60, maximumStepsPerFrame: 0 })).toThrow(RangeError);
    expect(() => createFixedStepAccumulator({ stepSeconds: 1 / 60, maximumStepsPerFrame: 2.5 })).toThrow(RangeError);
    expect(() => createFixedStepAccumulator({ stepSeconds: 1 / 60, maximumStepsPerFrame: 8 }).advance(-1)).toThrow(RangeError);
  });
});
