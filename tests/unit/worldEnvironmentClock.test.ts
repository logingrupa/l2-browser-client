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

  it("takes game minutes and type from an environment event and advances from there at TimeRatio", () => {
    const presentationClock = createPresentationClock();
    presentationClock.advance(50);
    const clock = createWorldEnvironmentClock({ program, presentationClock });
    clock.applyEnvironmentEvent({ type: "environment", gameMinutes: 330, environmentType: 2 });
    expect(clock.sample()).toEqual({ gameMinutes: 330, hour: 5.5, environmentType: 2, source: "environment-event" });
    presentationClock.advance(30);
    expect(clock.sample()).toMatchObject({ gameMinutes: 333, environmentType: 2 });
  });

  it("wraps past midnight", () => {
    const presentationClock = createPresentationClock();
    const clock = createWorldEnvironmentClock({ program, presentationClock });
    clock.applyEnvironmentEvent({ type: "environment", gameMinutes: 1430, environmentType: 1 });
    presentationClock.advance(200);
    expect(clock.sample()).toMatchObject({ gameMinutes: 10, hour: 10 / 60 });
    clock.applyEnvironmentEvent({ type: "environment", gameMinutes: 2880 + 90, environmentType: 1 });
    expect(clock.sample().hour).toBe(1.5);
  });

  it("refuses game minutes that are not finite or negative and environment types outside the program", () => {
    const clock = createWorldEnvironmentClock({ program, presentationClock: createPresentationClock() });
    expect(() => clock.applyEnvironmentEvent({ type: "environment", gameMinutes: Number.NaN, environmentType: 0 })).toThrow(RangeError);
    expect(() => clock.applyEnvironmentEvent({ type: "environment", gameMinutes: -1, environmentType: 0 })).toThrow(RangeError);
    expect(() => clock.applyEnvironmentEvent({ type: "environment", gameMinutes: 10, environmentType: 4 })).toThrow(/not one of the program types/);
    expect(() => createWorldEnvironmentClock({ program: { ...program, environmentTypes: [1] }, presentationClock: createPresentationClock() }))
      .toThrow(/no environment type 0/);
  });
});
