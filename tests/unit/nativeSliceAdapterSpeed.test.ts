import { describe, expect, it, vi } from "vitest";
import {
  ACIS_HUMAN_FIGHTER_SPEED, NativeSliceAdapter, SYNTHETIC_SLICE_SPEED, nativeSliceSpeedProfile,
} from "../../src/world/NativeSliceAdapter";
import type { WorldGroundContact, WorldNavigation } from "../../src/world/WorldNavigation";

const origin = { x: 0, y: 0, z: 0 };
const player = (adapter: NativeSliceAdapter) => adapter.getInitialState().find(entity => entity.id === "local-player")!;
const native = nativeSliceSpeedProfile("human-male-fighter", 100);
function adapter(walkSupported = true) {
  return new NativeSliceAdapter(origin, undefined, null, undefined, { walkSupported, speed: native });
}

describe("native slice walk/run speed (aCis server data)", () => {
  it("converts walk 80 / run 115 source units per second with sourceUnitsPerMetre 100 and labels the source", () => {
    expect(native).toMatchObject({ walkMetresPerSecond: .8, runMetresPerSecond: 1.15, runStartSeconds: .4 });
    expect(native.source).toContain("aCis server data");
    expect(ACIS_HUMAN_FIGHTER_SPEED).toMatchObject({ walkUnitsPerSecond: 80, runUnitsPerSecond: 115 });
    expect(nativeSliceSpeedProfile("human-male-fighter", 50).walkMetresPerSecond).toBe(1.6);
    expect(() => nativeSliceSpeedProfile("human-male-fighter", 0)).toThrow("units");
    expect(new NativeSliceAdapter(origin).speedProfile).toBe(SYNTHETIC_SLICE_SPEED);
    expect(() => new NativeSliceAdapter(origin, undefined, null, undefined, { walkSupported: false,
      speed: { ...native, runMetresPerSecond: Number.NaN } })).toThrow("speed profile");
  });

  it("applies the class 0 server speed to both human fighter sexes and leaves other classes visibly unresolved", () => {
    expect(nativeSliceSpeedProfile("human-female-fighter", 100)).toEqual(native);
    for (const profileId of ["human-male-mystic", "human-female-mystic"]) {
      const unresolved = nativeSliceSpeedProfile(profileId, 100);
      expect(unresolved.isSourced).toBe(false);
      expect(unresolved.source).toContain(`speed unresolved for ${profileId}`);
      expect(unresolved.source).not.toContain("aCis");
      expect(unresolved).toMatchObject({ walkMetresPerSecond: SYNTHETIC_SLICE_SPEED.walkMetresPerSecond, runMetresPerSecond: SYNTHETIC_SLICE_SPEED.runMetresPerSecond });
    }
    expect(native.isSourced).toBe(true);
  });

  it("walks at 0.80 m/s with no acceleration ramp and reports zero speed at rest", () => {
    const value = adapter(); value.dispatch({ type: "set-locomotion", mode: "walk" });
    expect(value.currentSpeed).toBe(0);
    value.dispatch({ type: "move-local", position: { x: 0, y: 0, z: 10 } });
    expect(value.currentSpeed).toBe(.8);
    value.advance(.1); expect(player(value).position.z).toBeCloseTo(.08, 12);
    value.advance(1); expect(player(value).position.z).toBeCloseTo(.88, 12);
  });

  it("starts a run at walk speed for 0.4 s, integrates the split frame exactly, then runs at 1.15 m/s", () => {
    const value = adapter();
    value.dispatch({ type: "move-local", position: { x: 0, y: 0, z: 10 } });
    value.advance(.3); expect(player(value).position.z).toBeCloseTo(.24, 12); expect(value.currentSpeed).toBe(.8);
    value.advance(.3);
    expect(player(value).position.z).toBeCloseTo(.24 + .08 + .23, 12); expect(value.currentSpeed).toBe(1.15);
    value.advance(1); expect(player(value).position.z).toBeCloseTo(.55 + 1.15, 12);
  });

  it("resets the run start when the actor stops, but not when a new destination is issued while moving", () => {
    const value = adapter();
    value.dispatch({ type: "move-local", position: { x: 0, y: 0, z: .5 } });
    value.advance(1); expect(player(value)).toMatchObject({ position: { z: .5 }, animation: "idle" });
    value.dispatch({ type: "move-local", position: { x: 0, y: 0, z: 10 } });
    value.advance(.4); expect(player(value).position.z).toBeCloseTo(.5 + .32, 12);
    value.dispatch({ type: "move-local", position: { x: 0, y: 0, z: 20 } });
    value.advance(1); expect(player(value).position.z).toBeCloseTo(.82 + 1.15, 12);
    value.dispatch({ type: "set-animation", animation: "attack" }); value.advance(.1);
    value.dispatch({ type: "move-local", position: { x: 0, y: 0, z: 30 } });
    value.advance(.2); expect(value.currentSpeed).toBe(.8);
  });
});

describe("native slice ground contact at spawn", () => {
  it("seeds the accepted support from the spawn position before the first move", () => {
    const contact: WorldGroundContact = { queryPosition: origin, position: origin, controllingSample: 0,
      samples: [{ meshId: "terrain", meshUniqueId: 1, meshName: "20_20.TerrainInfo0", indexOffset: 0, triangleIndex: 0, position: origin }] };
    const groundContact = vi.fn(() => contact);
    const navigation: WorldNavigation = { origin, ground: point => point, groundContact, destination: point => point, spawn: () => origin,
      move: (_from, to) => ({ position: to, blocked: false, contact }) };
    const value = new NativeSliceAdapter(origin, navigation);
    expect(value.groundContact).toEqual(contact);
    expect(groundContact).toHaveBeenCalledWith(origin);
    expect(value.groundContact).not.toBe(contact);
    const { groundContact: _unused, ...withoutContact } = navigation;
    expect(new NativeSliceAdapter(origin, withoutContact).groundContact).toBeNull();
  });
});
