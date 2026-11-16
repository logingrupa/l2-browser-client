import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, describe, expect, it } from "vitest";
import { wireWorldEnvironment } from "../../src/runtime/worldEnvironmentWiring";
import { startWorldTimeOfDay } from "../../src/scene/world/worldTimeOfDay";
import { NativeSliceAdapter } from "../../src/world/NativeSliceAdapter";
import type { WorldEvent } from "../../src/world/worldTypes";
import { dayNightTimeTables } from "../support/worldTimeOfDayFixture";

const scenes: Scene[] = [];
afterEach(() => { for (const scene of scenes.splice(0)) { const engine = scene.getEngine(); scene.dispose(); engine.dispose(); } });

function adapterWiredToTimeOfDay() {
  const adapter = new NativeSliceAdapter({ x: 0, y: 0, z: 0 });
  const scene = new Scene(new NullEngine());
  scenes.push(scene);
  const timeOfDay = startWorldTimeOfDay(scene, dayNightTimeTables(), () => 0);
  const environment = wireWorldEnvironment({ adapter, camera: { maxZ: 1 }, timeOfDay, cameraFog: () => null, presentationFarPlane: 480 });
  const receivedEvents: WorldEvent[] = [];
  adapter.subscribe(event => receivedEvents.push(event));
  return { adapter, environment, timeOfDay, receivedEvents };
}

describe("NativeSliceAdapter environment sandbox commands", () => {
  it("answers each environment command with exactly its own event and passes the values through unchanged", () => {
    const { adapter, receivedEvents } = adapterWiredToTimeOfDay();
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

  it("moves the one environment manager through the adapter and names the unresolved server packet", () => {
    const { adapter, environment, timeOfDay } = adapterWiredToTimeOfDay();
    adapter.dispatch({ type: "set-server-time", gameMinutes: 1500 });
    expect(timeOfDay.sample()).toMatchObject({ hour: 25, hourSource: "server-time" });
    adapter.dispatch({ type: "set-environment-ssq-info", first: 2, second: 1 });
    expect(timeOfDay.sample()).toMatchObject({ oldType: 2, targetType: 2 });
    expect(environment.inspection()).toMatchObject({ appliedEventCount: 2, rejectedEventCount: 0, lastRejectedEvent: null,
      serverPacket: { producer: "sandbox-command", status: "unresolved", reason: "server-packet-unresolved" } });
    adapter.dispose();
  });

  it("emits nothing after dispose", () => {
    const { adapter, receivedEvents } = adapterWiredToTimeOfDay();
    adapter.dispose();
    adapter.dispatch({ type: "set-server-time", gameMinutes: 60 });
    expect(receivedEvents).toEqual([]);
  });
});
