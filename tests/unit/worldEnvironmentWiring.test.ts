import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, describe, expect, it } from "vitest";
import { FOG_DISABLED, type FogState } from "../../src/materials/ue2/babylon/material";
import { cameraFarPlane, wireWorldEnvironment } from "../../src/runtime/worldEnvironmentWiring";
import type { CameraEnvironmentFog } from "../../src/scene/world/cameraEnvironment";
import { startWorldTimeOfDay, type WorldTimeOfDay } from "../../src/scene/world/worldTimeOfDay";
import type { WorldEvent } from "../../src/world/worldTypes";
import { dayNightTimeTables } from "../support/worldTimeOfDayFixture";

const zoneFog: FogState = { enabled: true, source: "camera-zone", colour: [.5, .5, .5], startSourceUnits: 1000, endSourceUnits: 12000 };
const cameraFogOf = (level: FogState): CameraEnvironmentFog => ({ fog: level, skyFog: { route: "inherit-level", fog: level, gaps: [] } });
const unstagedTimeOfDay: WorldTimeOfDay = { status: "gap", reason: "environment-time-tables-unstaged", detail: "not staged" };
const scenes: Scene[] = [];
afterEach(() => { for (const scene of scenes.splice(0)) { const engine = scene.getEngine(); scene.dispose(); engine.dispose(); } });

function runningTimeOfDay(): WorldTimeOfDay {
  const scene = new Scene(new NullEngine());
  scenes.push(scene);
  return startWorldTimeOfDay(scene, dayNightTimeTables(), () => 0);
}

function environmentOn(fog: CameraEnvironmentFog | null, timeOfDay: WorldTimeOfDay = runningTimeOfDay()) {
  let emit!: (event: WorldEvent) => void;
  const camera = { maxZ: 1 };
  let currentFog = fog;
  const environment = wireWorldEnvironment({ adapter: { subscribe(listener) { emit = listener; return () => { emit = () => {}; }; } }, camera,
    timeOfDay, cameraFog: () => currentFog, presentationFarPlane: 480 });
  return { environment, camera, emit: (event: WorldEvent) => emit(event), setFog: (next: CameraEnvironmentFog | null) => { currentFog = next; } };
}

function runningSnapshot(environment: ReturnType<typeof environmentOn>["environment"]) {
  const inspection = environment.inspection().timeOfDay;
  if (inspection.status !== "running") throw new Error(`The time of day is a gap: ${inspection.reason}.`);
  return inspection.snapshot;
}

describe("world environment wiring", () => {
  it("routes server time, SSQ info and red sky to the one environment manager", () => {
    const { environment, emit } = environmentOn(null);
    expect(runningSnapshot(environment).clock).toMatchObject({ hour: 12, hourSource: "start-time" });
    emit({ type: "server-time", gameMinutes: 1200 });
    expect(runningSnapshot(environment).clock).toMatchObject({ hour: 20, hourSource: "server-time" });
    emit({ type: "environment-ssq-info", first: 1, second: 1 });
    expect(runningSnapshot(environment)).toMatchObject({ oldType: 1, targetType: 1, persistentTargetType: 1 });
    emit({ type: "environment-red-sky", timeoutSeconds: 5 });
    expect(runningSnapshot(environment)).toMatchObject({ oldType: 1, targetType: 3, persistentTargetType: 1, remainingRevertSeconds: 5 });
    emit({ type: "spawn", entity: { id: "x", kind: "npc", displayName: "x", position: { x: 0, y: 0, z: 0 }, orientationRadians: 0, health: 1, maximumHealth: 1, animation: "idle" }, collision: null });
    expect(environment.inspection()).toMatchObject({ appliedEventCount: 3, ignoredEventCount: 0, lastIgnoredEvent: null, rejectedEventCount: 0, lastRejectedEvent: null,
      serverPacket: { producer: "sandbox-command", status: "unresolved", reason: "server-packet-unresolved" } });
  });

  it("counts an SSQ info or red sky that ChangeEnv ignores as ignored with its reason, not as applied", () => {
    const { environment, emit } = environmentOn(null);
    const before = runningSnapshot(environment);
    emit({ type: "environment-ssq-info", first: 7, second: 0 });
    expect(runningSnapshot(environment)).toMatchObject({ oldType: before.oldType, targetType: before.targetType });
    expect(environment.inspection()).toMatchObject({ appliedEventCount: 0, ignoredEventCount: 1, rejectedEventCount: 0,
      lastIgnoredEvent: "environment-ssq-info: ChangeEnv environment-type-unloaded" });
    emit({ type: "environment-ssq-info", first: 1, second: 0 });
    expect(environment.inspection()).toMatchObject({ appliedEventCount: 1, ignoredEventCount: 1 });
  });

  it("counts an event the manager refuses, and every event that reaches an unstaged time of day, instead of throwing", () => {
    const { environment, emit } = environmentOn(null);
    expect(() => emit({ type: "server-time", gameMinutes: 1.5 })).not.toThrow();
    expect(environment.inspection()).toMatchObject({ appliedEventCount: 0, rejectedEventCount: 1, lastRejectedEvent: expect.stringContaining("1.5") });
    expect(() => emit({ type: "environment-red-sky", timeoutSeconds: 0.5 })).not.toThrow();
    expect(environment.inspection()).toMatchObject({ rejectedEventCount: 2, lastRejectedEvent: expect.stringContaining("0.5") });
    const unstaged = environmentOn(null, unstagedTimeOfDay);
    unstaged.emit({ type: "server-time", gameMinutes: 30 });
    unstaged.emit({ type: "environment-ssq-info", first: 1, second: 0 });
    expect(unstaged.environment.inspection()).toMatchObject({ timeOfDay: unstagedTimeOfDay, appliedEventCount: 0, rejectedEventCount: 2,
      lastRejectedEvent: "environment-time-tables-unstaged" });
  });

  it("keeps the presentation far plane and names the far-plane source unresolved while the level fog is on, reading the fog every frame", () => {
    expect(cameraFarPlane(cameraFogOf(zoneFog), 480)).toEqual({ maxZ: 480, source: "far-plane-source-unresolved" });
    expect(cameraFarPlane(cameraFogOf(FOG_DISABLED), 480)).toEqual({ maxZ: 480, source: "presentation" });
    expect(cameraFarPlane(null, 480)).toEqual({ maxZ: 480, source: "presentation" });
    const { environment, camera, setFog } = environmentOn(cameraFogOf(zoneFog));
    environment.update();
    expect(camera.maxZ).toBe(480);
    expect(environment.inspection().farPlane).toEqual({ maxZ: 480, source: "far-plane-source-unresolved" });
    setFog(cameraFogOf(FOG_DISABLED));
    environment.update();
    expect(environment.inspection().farPlane).toEqual({ maxZ: 480, source: "presentation" });
    expect(() => wireWorldEnvironment({ adapter: { subscribe: () => () => {} }, camera, timeOfDay: unstagedTimeOfDay, cameraFog: () => null, presentationFarPlane: 0 })).toThrow(RangeError);
  });
});
