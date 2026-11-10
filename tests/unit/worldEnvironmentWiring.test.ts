import { describe, expect, it, vi } from "vitest";
import { createPresentationClock } from "../../src/shared/presentationClock";
import { createWorldEnvironmentClock } from "../../src/scene/world/lighting/worldEnvironmentClock";
import { FOG_DISABLED, type FogState } from "../../src/materials/ue2/babylon/material";
import { cameraFarPlane, cameraFogOnZoneChange, wireWorldEnvironment } from "../../src/runtime/worldEnvironmentWiring";
import type { NativeSection } from "../../src/scene/world/loadNativeSection";
import type { TileVisibilityBinding } from "../../src/scene/world/bspVisibility/bindTileVisibility";
import type { WorldEvent } from "../../src/world/worldTypes";

const program = { startTimeHours: 6, timeRatio: 6, environmentTypes: [0, 1], unresolved: [] };
const zoneFog: FogState = { enabled: true, source: "camera-zone", colour: [.5, .5, .5], startSourceUnits: 1000, endSourceUnits: 12000, fogEnd: 12000 };

function environmentOn(fog: FogState | null, withClock = true) {
  const presentationClock = createPresentationClock();
  const clock = withClock ? createWorldEnvironmentClock({ program, presentationClock }) : null;
  let emit!: (event: WorldEvent) => void;
  const camera = { maxZ: 1 };
  let currentFog = fog;
  const environment = wireWorldEnvironment({ adapter: { subscribe(listener) { emit = listener; return () => { emit = () => {}; }; } }, camera,
    environmentClock: clock, cameraFog: () => currentFog, presentationFarPlane: 480 });
  return { environment, camera, presentationClock, emit: (event: WorldEvent) => emit(event), setFog: (next: FogState | null) => { currentFog = next; } };
}

describe("world environment wiring", () => {
  it("reports the program fallback until an adapter environment event moves the game clock", () => {
    const { environment, presentationClock, emit } = environmentOn(null);
    expect(environment.inspection().clock).toMatchObject({ gameMinutes: 360, environmentType: 0, source: "environment-program-fallback" });
    emit({ type: "environment", gameMinutes: 1200, environmentType: 1 });
    presentationClock.advance(10);
    expect(environment.inspection().clock).toMatchObject({ gameMinutes: 1201, environmentType: 1, source: "environment-event" });
    expect(environment.inspection()).toMatchObject({ appliedEventCount: 1, rejectedEventCount: 0 });
  });

  it("counts an environment event the clock refuses, and one that reaches a world without a clock, instead of throwing", () => {
    const { environment, emit } = environmentOn(null);
    expect(() => emit({ type: "environment", gameMinutes: 30, environmentType: 7 })).not.toThrow();
    expect(environment.inspection()).toMatchObject({ appliedEventCount: 0, rejectedEventCount: 1, lastRejectedEvent: expect.stringContaining("type 7") });
    const unlit = environmentOn(null, false);
    unlit.emit({ type: "environment", gameMinutes: 30, environmentType: 0 });
    expect(unlit.environment.inspection()).toMatchObject({ clock: null, rejectedEventCount: 1, lastRejectedEvent: expect.stringContaining("environment-clock-absent") });
  });

  it("sets camera maxZ to fogEnd while fog is on and keeps the presentation far plane otherwise", () => {
    expect(cameraFarPlane(zoneFog, 480)).toEqual({ maxZ: 120, source: "fog-end" });
    expect(cameraFarPlane(FOG_DISABLED, 480)).toEqual({ maxZ: 480, source: "presentation" });
    expect(cameraFarPlane(null, 480)).toEqual({ maxZ: 480, source: "presentation" });
    const { environment, camera, setFog } = environmentOn(zoneFog);
    environment.update();
    expect(camera.maxZ).toBe(120);
    setFog(FOG_DISABLED);
    environment.update();
    expect(camera.maxZ).toBe(480);
    expect(environment.inspection().farPlane).toEqual({ maxZ: 480, source: "presentation" });
    expect(() => wireWorldEnvironment({ adapter: { subscribe: () => () => {} }, camera, environmentClock: null, cameraFog: () => null, presentationFarPlane: 0 })).toThrow(RangeError);
  });

  it("reads the camera-environment fog from the tile inspection only when the camera zone changes", () => {
    let cameraZone = 3, fog: FogState = zoneFog;
    const inspection = vi.fn(() => ({ lighting: { cameraEnvironment: { fog } } }) as unknown as ReturnType<NativeSection["inspection"]>);
    const section = { tileVisibility: { frame: () => ({ cameraZone }) } as unknown as TileVisibilityBinding, inspection };
    const cameraFog = cameraFogOnZoneChange(section);
    expect(cameraFog()).toBe(zoneFog);
    fog = FOG_DISABLED;
    expect(cameraFog()).toBe(zoneFog);
    expect(inspection).toHaveBeenCalledTimes(1);
    cameraZone = 4;
    expect(cameraFog()).toBe(FOG_DISABLED);
    expect(inspection).toHaveBeenCalledTimes(2);
    const unlit = cameraFogOnZoneChange({ tileVisibility: null, inspection: () => ({}) as ReturnType<NativeSection["inspection"]> });
    expect(unlit()).toBeNull();
  });
});
