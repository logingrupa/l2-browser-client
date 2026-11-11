import { describe, expect, it, vi } from "vitest";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { NativeSliceAdapter } from "../../src/world/NativeSliceAdapter";
import { reportedHeadingNotIntegerReason, reportedPositionNotFiniteReason } from "../../src/world/sandboxCommands";
import type { WorldEvent } from "../../src/world/worldTypes";
import { committedMoveTypes, sourcedHumanFighterSpeed as speed } from "../fixtures/movement/pawnWorldFixtures";

const origin = { x: 2, y: 3, z: 4 };
const collision = { radius: 9, height: 23 };
const moveTypes = committedMoveTypes;
function player(adapter: NativeSliceAdapter) { return adapter.getInitialState().find(entity => entity.id === "local-player")!; }
function movingAdapter() { return new NativeSliceAdapter(origin, null, undefined, { walkSupported: true, speed, collision, moveTypes }); }
function recorded(adapter: NativeSliceAdapter) { const events: WorldEvent[] = []; adapter.subscribe(event => events.push(event)); return events; }

describe("native slice adapter boundary", () => {
  it("answers move-local with one move record in source units and moves no entity itself", () => {
    const vector = new Vector3(2, 3, 4), adapter = new NativeSliceAdapter(vector, 22, undefined, { walkSupported: false, speed, collision, moveTypes });
    expect(player(adapter)).toMatchObject({ position: origin, appearanceId: "native-human-fighter", equipment: { upper: 22 } });
    vector.x = 999;
    const snapshot = player(adapter); Reflect.set(snapshot.position, "x", 123);
    expect(player(adapter).position).toEqual(origin);
    const events = recorded(adapter);
    adapter.dispatch({ type: "move-local", position: new Vector3(2.7, 900, 4) });
    expect(events).toEqual([{ type: "move", entityId: "local-player", origin: { x: 200, y: 400, z: 300 }, destination: { x: 270, y: 400, z: 90000 },
      moveType: moveTypes.run, speeds: { walk: 80, run: 115 }, collision }]);
    expect(player(adapter)).toMatchObject({ position: origin, animation: "idle" });
    adapter.dispose();
  });

  it("increments action sequences for repeated explicit attacks and stops the local move once", () => {
    const adapter = movingAdapter(), events = recorded(adapter);
    adapter.dispatch({ type: "move-local", position: { x: 5, y: 0, z: 4 } });
    adapter.dispatch({ type: "set-animation", animation: "attack" });
    adapter.dispatch({ type: "set-animation", animation: "attack" });
    expect(events.filter(event => event.type === "stop")).toEqual([{ type: "stop", entityId: "local-player", position: { x: 200, y: 400, z: 300 }, heading: 16384 }]);
    expect(player(adapter)).toMatchObject({ position: origin, animation: "attack", animationSequence: 2 });
    adapter.dispose();
  });

  it("targets repeated monster attacks without interrupting local movement and ignores unknown targets", () => {
    const adapter = movingAdapter();
    const monster = adapter.getInitialState().find(entity => entity.id === "native-musveren")!;
    adapter.dispatch({ type: "move-local", position: { x: 5, y: 3, z: 4 } });
    const movingPlayer = player(adapter), events = recorded(adapter);
    adapter.dispatch({ type: "set-animation", entityId: monster.id, animation: "attack" });
    adapter.dispatch({ type: "set-animation", entityId: monster.id, animation: "attack" });
    expect(events).toEqual([
      { type: "update", entity: { ...monster, animation: "attack", animationSequence: 1 } },
      { type: "update", entity: { ...monster, animation: "attack", animationSequence: 2 } },
    ]);
    expect(player(adapter)).toEqual(movingPlayer);
    const beforeUnknown = adapter.getInitialState();
    adapter.dispatch({ type: "set-animation", entityId: "unknown", animation: "idle" });
    expect(adapter.getInitialState()).toEqual(beforeUnknown);
    expect(events).toHaveLength(2);
    adapter.dispose();
  });

  it("clamps health, sends no move for a dead player, and permits explicit equipment actions while paused", () => {
    const adapter = movingAdapter(), events = recorded(adapter);
    adapter.dispatch({ type: "set-health", entityId: "local-player", health: -5 });
    adapter.dispatch({ type: "move-local", position: { x: 5, y: 3, z: 4 } });
    expect(player(adapter)).toMatchObject({ health: 0, position: origin });
    expect(events.some(event => event.type === "move")).toBe(false);
    adapter.dispatch({ type: "set-health", entityId: "local-player", health: Number.NaN });
    expect(player(adapter).health).toBe(0);
    adapter.dispatch({ type: "set-health", entityId: "local-player", health: 999 });
    adapter.dispatch({ type: "set-paused", isPaused: true });
    expect(adapter.isPaused).toBe(true);
    adapter.dispatch({ type: "equip-item", slot: "upper", itemId: 22 });
    expect(player(adapter)).toMatchObject({ health: 100, position: origin, equipment: { upper: 22 } });
    for (const itemId of [-1, .5, Number.NaN]) adapter.dispatch({ type: "equip-item", slot: "upper", itemId });
    expect(player(adapter).equipment).toEqual({ upper: 22 });
    adapter.dispatch({ type: "equip-item", slot: "upper", itemId: null });
    expect(player(adapter).equipment?.upper).toBeUndefined();
    adapter.dispose();
  });

  it("refuses move-local with a named reason when the local player has no collision cylinder, and refuses a bad cylinder", () => {
    const adapter = new NativeSliceAdapter(origin), events = recorded(adapter);
    adapter.dispatch({ type: "move-local", position: { x: 5, y: 3, z: 4 } });
    expect(events).toEqual([{ type: "command-rejected", commandType: "move-local", reason: "local-collision-cylinder-absent" }]);
    expect(() => new NativeSliceAdapter(origin, null, undefined, { walkSupported: false, collision: { radius: 0, height: 23 } })).toThrow("collision cylinder");
    adapter.dispose();
  });

  it("refuses move-local with a named reason when the movement rules gave it no walk and run move types", () => {
    const adapter = new NativeSliceAdapter(origin, null, undefined, { walkSupported: true, collision }), events = recorded(adapter);
    adapter.dispatch({ type: "move-local", position: { x: 5, y: 3, z: 4 } });
    expect(events).toEqual([{ type: "command-rejected", commandType: "move-local", reason: "local-move-types-absent" }]);
    adapter.dispose();
  });

  it("mirrors an accepted reported source position and heading into the local player's metre position and yaw", () => {
    const adapter = new NativeSliceAdapter(origin), events = recorded(adapter);
    adapter.dispatch({ type: "report-position", position: { x: 500, y: 600, z: 300 }, heading: 16384 });
    expect(player(adapter)).toMatchObject({ position: { x: 5, y: 3, z: 6 }, orientationRadians: 0 });
    expect(events).toEqual([{ type: "update", entity: player(adapter) }]);
    adapter.dispose();
  });

  it("stops a local move at the last reported heading when an animation interrupts it", () => {
    const adapter = movingAdapter();
    adapter.dispatch({ type: "move-local", position: { x: 9, y: 3, z: 4 } });
    adapter.dispatch({ type: "report-position", position: { x: 500, y: 600, z: 300 }, heading: 16384 });
    const events = recorded(adapter);
    adapter.dispatch({ type: "set-animation", animation: "attack" });
    expect(events.filter(event => event.type === "stop")).toEqual([{ type: "stop", entityId: "local-player", position: { x: 500, y: 600, z: 300 }, heading: 16384 }]);
    adapter.dispose();
  });

  it("stops after a special-attack preview toward the monster on world +x with the source heading along source +X", () => {
    const adapter = new NativeSliceAdapter(origin, null, undefined, { walkSupported: true, specialAttackPreviewSupported: true, speed, collision, moveTypes });
    adapter.dispatch({ type: "move-local", position: { x: 9, y: 3, z: 4 } });
    adapter.dispatch({ type: "preview-action", action: "special-attack", targetId: "native-musveren" });
    adapter.dispatch({ type: "move-local", position: { x: 9, y: 3, z: 4 } });
    const events = recorded(adapter);
    adapter.dispatch({ type: "set-animation", animation: "idle" });
    expect(events.filter(event => event.type === "stop")).toEqual([{ type: "stop", entityId: "local-player", position: { x: 200, y: 400, z: 300 }, heading: 0 }]);
    adapter.dispose();
  });

  it("answers cannot-move with one stop at the reported source position and heading and ends the sandbox move", () => {
    const adapter = movingAdapter();
    adapter.dispatch({ type: "move-local", position: { x: 9, y: 3, z: 4 } });
    const events = recorded(adapter);
    adapter.dispatch({ type: "cannot-move", position: { x: 500, y: 600, z: 300 }, heading: 16384 });
    expect(events).toEqual([{ type: "update", entity: player(adapter) },
      { type: "stop", entityId: "local-player", position: { x: 500, y: 600, z: 300 }, heading: 16384 }]);
    adapter.dispatch({ type: "set-animation", animation: "attack" });
    expect(events.filter(event => event.type === "stop")).toHaveLength(1);
    expect(player(adapter)).toMatchObject({ position: { x: 5, y: 3, z: 6 } });
    adapter.dispose();
  });

  it("rejects a reported position it cannot apply with a named reason instead of throwing", () => {
    const adapter = new NativeSliceAdapter(origin), events = recorded(adapter);
    expect(() => adapter.dispatch({ type: "report-position", position: { x: Number.NaN, y: 0, z: 0 }, heading: 0 })).not.toThrow();
    adapter.dispatch({ type: "cannot-move", position: { x: 0, y: 0, z: 0 }, heading: .5 });
    expect(events).toEqual([
      { type: "command-rejected", commandType: "report-position", reason: reportedPositionNotFiniteReason },
      { type: "command-rejected", commandType: "cannot-move", reason: reportedHeadingNotIntegerReason },
    ]);
    expect(player(adapter).position).toEqual(origin);
    adapter.dispose();
  });

  it("emits removal once, preserves the local player and stops notifications after unsubscribe/dispose", () => {
    const adapter = new NativeSliceAdapter(origin), events: WorldEvent[] = [], listener = vi.fn((event: WorldEvent) => events.push(event));
    const unsubscribe = adapter.subscribe(listener);
    adapter.dispatch({ type: "despawn", entityId: "local-player" });
    adapter.dispatch({ type: "despawn", entityId: "native-musveren" });
    adapter.dispatch({ type: "despawn", entityId: "native-musveren" });
    expect(events).toEqual([{ type: "despawn", entityId: "native-musveren" }]);
    expect(adapter.getInitialState().map(entity => entity.id)).toEqual(["local-player"]);
    unsubscribe(); adapter.dispatch({ type: "set-animation", animation: "run" });
    adapter.dispose(); adapter.dispose(); adapter.dispatch({ type: "set-animation", animation: "attack" });
    expect(listener).toHaveBeenCalledTimes(1); expect(adapter.getInitialState()).toEqual([]);
  });
});
