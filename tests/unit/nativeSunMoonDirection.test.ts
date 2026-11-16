import { describe, expect, it } from "vitest";
import { celestialBodyAtHour, moonAngles, sunAngles } from "../../src/environment/model/nativeSunMoonDirection";

const radiansPerSunHour = 0.17453292519943295;
const radiansPerMoonHour = 0.5235987755982988;
const quarterTurn = 1.5707963267948966;
const belowHorizon = -3.1415927410125732;

describe("GetSunModifierInfo 0x10514420", () => {
  it.each([[5, Math.fround((5 - 6) * radiansPerSunHour - quarterTurn)], [23.5, Math.fround((23.5 - 6) * radiansPerSunHour - quarterTurn)],
    [0.5, Math.fround((0.5 + 24 - 6) * radiansPerSunHour - quarterTurn)], [1, belowHorizon], [4.5, belowHorizon], [24, belowHorizon]])(
    "gives theta at hour %s", (hour, theta) => {
      expect(sunAngles(hour, 180).theta).toBe(theta);
    });

  it("derives phi from the manager degrees and leaves the third output 0", () => {
    expect(sunAngles(12, 180)).toEqual({ theta: Math.fround(6 * radiansPerSunHour - quarterTurn), phi: Math.fround(Math.PI), zeroedThirdOutput: 0 });
  });
});

describe("GetMoonModifierInfo 0x105144e0", () => {
  it("uses the formula at exactly hour 23", () => {
    expect(moonAngles(23, 180).theta).toBe(Math.fround(23 * radiansPerMoonHour - quarterTurn));
  });

  it.each([7, 12, 22.5])("is below the horizon at hour %s", hour => {
    expect(moonAngles(hour, 180).theta).toBe(belowHorizon);
  });

  it.each([0, 6.5, 23.5])("uses h * pi / 6 - pi / 2 at hour %s", hour => {
    expect(moonAngles(hour, 180).theta).toBe(Math.fround(Math.fround(hour) * radiansPerMoonHour - quarterTurn));
  });
});

describe("direction helper 0x10514560 body choice", () => {
  it.each([[5.5, "moon"], [6, "sun"], [23.5, "sun"], [24, "moon"], [0, "moon"]])("at hour %s uses the %s", (hour, body) => {
    expect(celestialBodyAtHour(hour)).toBe(body);
  });
});
