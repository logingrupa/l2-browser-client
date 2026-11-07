import { describe, expect, it, vi } from "vitest";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { NativeSliceAdapter } from "../../src/world/NativeSliceAdapter";
import type { WorldNavigation } from "../../src/world/WorldNavigation";
import type { WorldEvent } from "../../src/world/worldTypes";

const origin = { x: 2, y: 3, z: 4 };
function player(adapter: NativeSliceAdapter) { return adapter.getInitialState().find(entity => entity.id === "local-player")!; }

describe("native slice adapter boundary", () => {
  it("accepts Babylon Vector3 coordinates and isolates external position/snapshot mutation", () => {
    const vector = new Vector3(2, 3, 4), adapter = new NativeSliceAdapter(vector, undefined, 22);
    expect(player(adapter)).toMatchObject({ position: origin, appearanceId: "native-human-fighter", equipment: { upper: 22 } });
    vector.x = 999;
    const snapshot = player(adapter); Reflect.set(snapshot.position, "x", 123);
    expect(player(adapter).position).toEqual(origin);
    adapter.dispatch({ type: "move-local", position: new Vector3(2.7, 900, 4) });
    adapter.advance(1.01);
    expect(player(adapter)).toMatchObject({ position: { x: 2.7, y: 3, z: 4 }, animation: "idle", orientationRadians: Math.PI / 2 });
    adapter.dispose();
  });

  it("increments action sequences for repeated explicit attacks and cancels previous movement", () => {
    const adapter = new NativeSliceAdapter(origin);
    adapter.dispatch({ type: "move-local", position: { x: 5, y: 0, z: 4 } });
    adapter.dispatch({ type: "set-animation", animation: "attack" });
    adapter.dispatch({ type: "set-animation", animation: "attack" });
    adapter.advance(10);
    expect(player(adapter)).toMatchObject({ position: origin, animation: "attack", animationSequence: 2 });
    expect(player(adapter).modelUrl).toBeUndefined();
    adapter.dispose();
  });

  it("targets repeated monster attacks without interrupting local movement and ignores unknown targets", () => {
    const adapter = new NativeSliceAdapter(origin);
    const monster = adapter.getInitialState().find(entity => entity.id === "native-musveren")!;
    adapter.dispatch({ type: "move-local", position: { x: 5, y: 3, z: 4 } });
    const movingPlayer = player(adapter), events: WorldEvent[] = [];
    adapter.subscribe(event => events.push(event));
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
    adapter.advance(.5);
    expect(player(adapter).position.x).toBeCloseTo(2.35);
    expect(player(adapter).animation).toBe("run");
    adapter.dispose();
  });

  it("clamps health, freezes dead/paused movement, and permits explicit equipment actions while paused", () => {
    const adapter = new NativeSliceAdapter(origin);
    adapter.dispatch({ type: "move-local", position: { x: 5, y: 3, z: 4 } });
    adapter.dispatch({ type: "set-health", entityId: "local-player", health: -5 }); adapter.advance(1);
    expect(player(adapter)).toMatchObject({ health: 0, position: origin });
    adapter.dispatch({ type: "set-health", entityId: "local-player", health: Number.NaN });
    expect(player(adapter).health).toBe(0);
    adapter.dispatch({ type: "set-health", entityId: "local-player", health: 999 });
    adapter.dispatch({ type: "set-paused", isPaused: true }); adapter.advance(10);
    adapter.dispatch({ type: "equip-upper", itemId: 22 });
    expect(player(adapter)).toMatchObject({ health: 100, position: origin, equipment: { upper: 22 } });
    for (const itemId of [-1, .5, Number.NaN]) adapter.dispatch({ type: "equip-upper", itemId });
    expect(player(adapter).equipment).toEqual({ upper: 22 });
    adapter.dispatch({ type: "equip-upper", itemId: null });
    expect(player(adapter).equipment?.upper).toBeUndefined();
    adapter.dispatch({ type: "set-paused", isPaused: false }); adapter.advance(.5);
    expect(player(adapter).position.x).toBeCloseTo(2.35);
    expect(() => adapter.advance(-1)).toThrow(); expect(() => adapter.advance(Number.NaN)).toThrow();
    adapter.dispose();
  });

  it("honors navigation rejection and obstruction without falling back through blocked geometry", () => {
    const destination = vi.fn<WorldNavigation["destination"]>().mockReturnValueOnce(null).mockReturnValue({ x: 5, y: 3, z: 4 });
    const navigation: WorldNavigation = { origin, ground: point => point, destination, spawn: () => null,
      move: vi.fn().mockReturnValue({ position: { x: 2.1, y: 3, z: 4 }, blocked: true }) };
    const adapter = new NativeSliceAdapter(origin, navigation);
    adapter.dispatch({ type: "move-local", position: { x: 5, y: 3, z: 4 } }); adapter.advance(1);
    expect(player(adapter).position).toEqual(origin); expect(navigation.move).not.toHaveBeenCalled();
    adapter.dispatch({ type: "move-local", position: { x: 5, y: 3, z: 4 } }); adapter.advance(1);
    expect(player(adapter)).toMatchObject({ position: { x: 2.1, y: 3, z: 4 }, animation: "idle" });
    adapter.advance(1); expect(navigation.move).toHaveBeenCalledTimes(1);
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
    adapter.dispose(); adapter.dispose(); adapter.dispatch({ type: "set-animation", animation: "attack" }); adapter.advance(1);
    expect(listener).toHaveBeenCalledTimes(1); expect(adapter.getInitialState()).toEqual([]);
  });
});
