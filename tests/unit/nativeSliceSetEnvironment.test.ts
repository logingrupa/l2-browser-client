import { describe, expect, it } from "vitest";
import { createPresentationClock } from "../../src/shared/presentationClock";
import { createWorldEnvironmentClock } from "../../src/scene/world/lighting/worldEnvironmentClock";
import { wireWorldEnvironment } from "../../src/runtime/worldEnvironmentWiring";
import { NativeSliceAdapter } from "../../src/world/NativeSliceAdapter";
import type { WorldEvent } from "../../src/world/worldTypes";

const syntheticEnvironmentProgram = { startTimeHours: 6, timeRatio: 6, environmentTypes: [0, 1], unresolved: [] };

function adapterWiredToEnvironmentClock() {
  const adapter = new NativeSliceAdapter({ x: 0, y: 0, z: 0 });
  const presentationClock = createPresentationClock();
  const environmentClock = createWorldEnvironmentClock({ program: syntheticEnvironmentProgram, presentationClock });
  const environment = wireWorldEnvironment({ adapter, camera: { maxZ: 1 }, environmentClock, cameraFog: () => null, presentationFarPlane: 480 });
  const receivedEvents: WorldEvent[] = [];
  adapter.subscribe(event => receivedEvents.push(event));
  return { adapter, environment, receivedEvents };
}

describe("NativeSliceAdapter set-environment", () => {
  it("answers set-environment with the environment event the wiring applies to the clock", () => {
    const { adapter, environment, receivedEvents } = adapterWiredToEnvironmentClock();
    adapter.dispatch({ type: "set-environment", gameMinutes: 1200, environmentType: 1 });
    expect(receivedEvents).toEqual([{ type: "environment", gameMinutes: 1200, environmentType: 1 }]);
    expect(environment.inspection()).toMatchObject({ appliedEventCount: 1, rejectedEventCount: 0, lastRejectedEvent: null });
    expect(environment.inspection().clock).toMatchObject({ gameMinutes: 1200, environmentType: 1, source: "environment-event" });
    adapter.dispose();
  });

  it("passes an unknown environment type through so the clock refuses it and the wiring counts the rejection", () => {
    const { adapter, environment } = adapterWiredToEnvironmentClock();
    expect(() => adapter.dispatch({ type: "set-environment", gameMinutes: 30, environmentType: 7 })).not.toThrow();
    expect(environment.inspection()).toMatchObject({ appliedEventCount: 0, rejectedEventCount: 1,
      lastRejectedEvent: "Environment event type 7 is not one of the program types 0, 1." });
    expect(environment.inspection().clock).toMatchObject({ gameMinutes: 360, environmentType: 0, source: "environment-program-fallback" });
    adapter.dispose();
  });
});
