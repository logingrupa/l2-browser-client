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

describe("NativeSliceAdapter environment sandbox commands", () => {
  it("answers each environment command with exactly its own event and passes the values through unchanged", () => {
    const { adapter, receivedEvents } = adapterWiredToEnvironmentClock();
    adapter.dispatch({ type: "set-server-time", gameMinutes: -90 });
    adapter.dispatch({ type: "set-environment-ssq-info", first: 2, second: 1 });
    adapter.dispatch({ type: "set-environment-red-sky", timeoutSeconds: 30 });
    expect(receivedEvents).toEqual([
      { type: "server-time", gameMinutes: -90 },
      { type: "environment-ssq-info", first: 2, second: 1 },
      { type: "environment-red-sky", timeoutSeconds: 30 },
    ]);
    adapter.dispose();
  });

  it("reaches the wiring with server time and names the unresolved server packet in the inspection", () => {
    const { adapter, environment } = adapterWiredToEnvironmentClock();
    adapter.dispatch({ type: "set-server-time", gameMinutes: 1200 });
    expect(environment.inspection()).toMatchObject({ appliedEventCount: 1, rejectedEventCount: 0, lastRejectedEvent: null,
      serverPacket: { producer: "sandbox-command", status: "unresolved", reason: "server-packet-unresolved" } });
    expect(environment.inspection().clock).toMatchObject({ gameMinutes: 1200, source: "server-time" });
    adapter.dispose();
  });

  it("emits nothing after dispose", () => {
    const { adapter, receivedEvents } = adapterWiredToEnvironmentClock();
    adapter.dispose();
    adapter.dispatch({ type: "set-server-time", gameMinutes: 60 });
    expect(receivedEvents).toEqual([]);
  });
});
