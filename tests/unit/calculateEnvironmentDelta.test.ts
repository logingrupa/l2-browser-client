import { describe, expect, it } from "vitest";
import { calculateEnvironmentDelta, type EnvironmentTransitionWindow } from "../../src/environment/model/calculateEnvironmentDelta";

const window: EnvironmentTransitionWindow = { start: 10, end: 12, peak: 11, targetWeight: 0.25 };

describe("CalcEnvDelta 0x10514720 in native branch order", () => {
  it("returns W before the start and after the end", () => {
    expect(calculateEnvironmentDelta(window, 9.5)).toBe(0.25);
    expect(calculateEnvironmentDelta(window, 12.5)).toBe(0.25);
  });

  it("ramps from 0 at the start, keeping the step from W", () => {
    expect(calculateEnvironmentDelta(window, 10)).toBe(0);
    expect(calculateEnvironmentDelta(window, 10.5)).toBe(0.5);
  });

  it("returns 1 at the peak and for W = 1 after it", () => {
    expect(calculateEnvironmentDelta(window, 11)).toBe(1);
    expect(calculateEnvironmentDelta({ ...window, targetWeight: 1 }, 11.5)).toBe(1);
  });

  it("falls toward W after the peak with the float32 span (end - peak) * (W / (1 - W) + 1)", () => {
    const hour = Math.fround(11.3);
    const span = Math.fround((12 - 11) * (0.25 / (1 - 0.25) + 1));
    expect(calculateEnvironmentDelta(window, hour)).toBe(Math.fround(1 - (hour - 11) / span));
    expect(calculateEnvironmentDelta(window, 12)).toBe(Math.fround(1 - 1 / span));
  });

  it("returns W at every hour for a window that crosses midnight, so the +24 wraps never apply", () => {
    const crossing: EnvironmentTransitionWindow = { start: 23.5, end: 0.5, peak: 23.75, targetWeight: 0.4 };
    const hours = [0, 0.25, 0.5, 12, 23.5, 23.6, 23.75, 23.9];
    expect(hours.map(hour => calculateEnvironmentDelta(crossing, hour))).toEqual(hours.map(() => 0.4));
  });
});
