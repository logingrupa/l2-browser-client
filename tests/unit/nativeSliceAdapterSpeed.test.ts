import { describe, expect, it } from "vitest";
import {
  ACIS_HUMAN_FIGHTER_SPEED, NativeSliceAdapter, isNativeSliceAdapterWithSourcedSpeed, nativeSliceSpeedProfile, type NativeSliceSpeedProfile,
} from "../../src/world/NativeSliceAdapter";
import type { WorldEvent } from "../../src/world/worldTypes";
import { createMovementPresenter } from "../../src/scene/world/movement/movementPresenter";
import { boxVolumeWorld, committedMoveTypes, floorSlab, pawnRules } from "../fixtures/movement/pawnWorldFixtures";

const origin = { x: 0, y: 0, z: 0 };
const player = (adapter: NativeSliceAdapter) => adapter.getInitialState().find(entity => entity.id === "local-player")!;
const native = nativeSliceSpeedProfile("human-male-fighter", 100);
function adapter(walkSupported = true, speed: NativeSliceSpeedProfile = native) {
  return new NativeSliceAdapter(origin, null, undefined, { walkSupported, speed, collision: { radius: 9, height: 23 }, moveTypes: committedMoveTypes });
}

describe("native slice walk/run speed (aCis server data)", () => {
  it("converts walk 80 / run 115 source units per second with sourceUnitsPerMetre 100 and labels the source", () => {
    expect(native).toMatchObject({ walkMetresPerSecond: .8, runMetresPerSecond: 1.15, runStartSeconds: .4 });
    expect(native.source).toContain("aCis server data");
    expect(ACIS_HUMAN_FIGHTER_SPEED).toMatchObject({ walkUnitsPerSecond: 80, runUnitsPerSecond: 115 });
    expect(nativeSliceSpeedProfile("human-male-fighter", 50)).toMatchObject({ walkMetresPerSecond: 1.6 });
    expect(() => nativeSliceSpeedProfile("human-male-fighter", 0)).toThrow("units");
    expect(new NativeSliceAdapter(origin).speedProfile).toEqual({ isSourced: false, playerProfileId: "no-speed-profile",
      source: "speed unresolved: the adapter was given no player speed profile" });
    if (!native.isSourced) throw new Error("The human fighter speed must be sourced.");
    expect(() => new NativeSliceAdapter(origin, null, undefined, { walkSupported: false,
      speed: { ...native, runMetresPerSecond: Number.NaN } })).toThrow("speed profile");
  });

  it("applies the class 0 server speed to both human fighter sexes and leaves other classes visibly unresolved", () => {
    expect(nativeSliceSpeedProfile("human-female-fighter", 100)).toEqual(native);
    for (const profileId of ["human-male-mystic", "human-female-mystic"]) {
      const unresolved = nativeSliceSpeedProfile(profileId, 100);
      expect(unresolved).toEqual({ isSourced: false, playerProfileId: profileId,
        source: `speed unresolved for ${profileId}: no sourced server speed is recorded for this class` });
      expect(Object.values(unresolved).some(value => typeof value === "number")).toBe(false);
    }
    expect(native.isSourced).toBe(true);
  });

  it("sends walk 80 and run 115 source units per second in every move record, with the committed walk and run move types", () => {
    const value = adapter(), events: WorldEvent[] = [];
    value.subscribe(event => events.push(event));
    value.dispatch({ type: "move-local", position: { x: 0, y: 0, z: 10 } });
    value.dispatch({ type: "set-locomotion", mode: "walk" });
    value.dispatch({ type: "move-local", position: { x: 0, y: 0, z: 10 } });
    const moves = events.flatMap(event => event.type === "move" ? [[event.moveType, event.speeds]] : []);
    expect(moves).toEqual([[pawnRules.pawn.runMoveType, { walk: 80, run: 115 }], [pawnRules.pawn.walkMoveType, { walk: 80, run: 115 }]]);
    expect(player(value).position).toEqual(origin);
  });

  it("refuses move-local with speed-unresolved for a profile without a sourced server speed and sends no move record", () => {
    const value = adapter(true, nativeSliceSpeedProfile("human-male-mystic", 100)), events: WorldEvent[] = [];
    value.subscribe(event => events.push(event));
    value.dispatch({ type: "move-local", position: { x: 0, y: 0, z: 10 } });
    value.dispatch({ type: "set-locomotion", mode: "walk" });
    value.dispatch({ type: "move-local", position: { x: 0, y: 0, z: 10 } });
    expect(events.filter(event => event.type === "move")).toEqual([]);
    expect(events.filter(event => event.type === "command-rejected")).toEqual([
      { type: "command-rejected", commandType: "move-local", reason: "speed-unresolved:human-male-mystic" },
      { type: "command-rejected", commandType: "move-local", reason: "speed-unresolved:human-male-mystic" }]);
    expect(value.locomotionMode).toBe("walk");
    expect(isNativeSliceAdapterWithSourcedSpeed(value)).toBe(false);
    expect(isNativeSliceAdapterWithSourcedSpeed(adapter())).toBe(true);
  });

  it("refuses move-local from an adapter given no speed profile", () => {
    const value = new NativeSliceAdapter(origin, null, undefined, { walkSupported: true, collision: { radius: 9, height: 23 }, moveTypes: committedMoveTypes });
    const events: WorldEvent[] = [];
    value.subscribe(event => events.push(event));
    value.dispatch({ type: "move-local", position: { x: 0, y: 0, z: 10 } });
    expect(events).toEqual([{ type: "command-rejected", commandType: "move-local", reason: "speed-unresolved:no-speed-profile" }]);
  });

  it("has its run move record presented at run speed by the movement presenter reading the same rules", () => {
    const value = adapter();
    const presenter = createMovementPresenter({
      collisionWorld: boxVolumeWorld([floorSlab(0)]), rules: pawnRules, reportIntent: () => undefined,
      pawnTraits: () => ({ isLocalPlayer: false, walkAnimationFramesInMove: null, flies: false }),
    });
    value.subscribe(event => presenter.applyEvent(event));
    value.dispatch({ type: "move-local", origin: { x: 0, y: .03, z: 0 }, position: { x: 0, y: .03, z: 10 } });
    const frameCount = 30, frameSeconds = 1 / 60;
    for (let frame = 0; frame < frameCount; frame += 1) presenter.advance(frameSeconds);
    const travelled = presenter.inspection().pawns[0]!.feetPosition.y;
    expect(travelled).toBeCloseTo(115 * frameCount * frameSeconds, 0);
  });
});
