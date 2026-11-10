import { describe, expect, it, vi } from "vitest";
import {
  ACIS_HUMAN_FIGHTER_SPEED, NativeSliceAdapter, SYNTHETIC_SLICE_SPEED, nativeSliceSpeedProfile,
} from "../../src/world/NativeSliceAdapter";
import type { WorldGroundContact, WorldNavigation } from "../../src/world/WorldNavigation";
import type { WorldEvent } from "../../src/world/worldTypes";

const origin = { x: 0, y: 0, z: 0 };
const player = (adapter: NativeSliceAdapter) => adapter.getInitialState().find(entity => entity.id === "local-player")!;
const native = nativeSliceSpeedProfile("human-male-fighter", 100);
function adapter(walkSupported = true) {
  return new NativeSliceAdapter(origin, undefined, null, undefined, { walkSupported, speed: native, collision: { radius: 9, height: 23 } });
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

  it("sends walk 80 and run 115 source units per second in every move record, with moveType 0 walking and 1 running", () => {
    const value = adapter(), events: WorldEvent[] = [];
    value.subscribe(event => events.push(event));
    value.dispatch({ type: "move-local", position: { x: 0, y: 0, z: 10 } });
    value.dispatch({ type: "set-locomotion", mode: "walk" });
    value.dispatch({ type: "move-local", position: { x: 0, y: 0, z: 10 } });
    const moves = events.flatMap(event => event.type === "move" ? [[event.moveType, event.speeds]] : []);
    expect(moves).toEqual([[1, { walk: 80, run: 115 }], [0, { walk: 80, run: 115 }]]);
    expect(player(value).position).toEqual(origin);
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
