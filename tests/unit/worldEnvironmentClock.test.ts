import { describe, expect, it } from "vitest";
import { createPresentationClock } from "../../src/shared/presentationClock";
import type { WorldEnvironmentProgram } from "../../src/scene/world/lighting/tileLightingRecords";
import { createWorldEnvironmentClock } from "../../src/scene/world/lighting/worldEnvironmentClock";

const program: WorldEnvironmentProgram = { startTimeHours: 12, timeRatio: 6, environmentTypes: [0, 1, 2, 3], unresolved: [] };

describe("createWorldEnvironmentClock", () => {
  it("starts at the program StartTime with environment type 0 and labels the fallback", () => {
    const presentationClock = createPresentationClock();
    const clock = createWorldEnvironmentClock({ program, presentationClock });
    expect(clock.sample()).toEqual({ gameMinutes: 720, hour: 12, environmentType: 0, source: "environment-program-fallback" });
    presentationClock.advance(600);
    expect(clock.sample()).toMatchObject({ gameMinutes: 780, hour: 13, source: "environment-program-fallback" });
  });

  it("takes game minutes from server time, keeps the environment type and advances from there at TimeRatio", () => {
    const presentationClock = createPresentationClock();
    presentationClock.advance(50);
    const clock = createWorldEnvironmentClock({ program, presentationClock });
    clock.applyServerTime(330);
    expect(clock.sample()).toEqual({ gameMinutes: 330, hour: 5.5, environmentType: 0, source: "server-time" });
    presentationClock.advance(30);
    expect(clock.sample()).toMatchObject({ gameMinutes: 333, environmentType: 0 });
  });

  it("wraps past midnight", () => {
    const presentationClock = createPresentationClock();
    const clock = createWorldEnvironmentClock({ program, presentationClock });
    clock.applyServerTime(1430);
    presentationClock.advance(200);
    expect(clock.sample()).toMatchObject({ gameMinutes: 10, hour: 10 / 60 });
    clock.applyServerTime(2880 + 90);
    expect(clock.sample().hour).toBe(1.5);
  });

  it("refuses server time that is not finite or negative and a program without environment type 0", () => {
    const clock = createWorldEnvironmentClock({ program, presentationClock: createPresentationClock() });
    expect(() => clock.applyServerTime(Number.NaN)).toThrow(RangeError);
    expect(() => clock.applyServerTime(-1)).toThrow(RangeError);
    expect(() => createWorldEnvironmentClock({ program: { ...program, environmentTypes: [1] }, presentationClock: createPresentationClock() }))
      .toThrow(/no environment type 0/);
  });
});
