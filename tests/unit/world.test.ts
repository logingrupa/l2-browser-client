import { describe, expect, it } from "vitest";
import { MockWorldAdapter } from "../../src/world/MockWorldAdapter";
import type { WorldEvent } from "../../src/world/worldTypes";

describe("synthetic world adapter", () => {
  it("starts with exactly one local player, two remote players and three monsters", () => {
    const adapter = new MockWorldAdapter();
    const entities = adapter.getInitialState();
    expect(entities).toHaveLength(6);
    expect(new Set(entities.map((entity) => entity.id)).size).toBe(6);
    expect(entities.filter((entity) => entity.kind === "local-player")).toHaveLength(1);
    expect(entities.filter((entity) => entity.kind === "remote-player")).toHaveLength(2);
    expect(entities.filter((entity) => entity.kind === "monster")).toHaveLength(3);
    expect(entities.find((entity) => entity.id === "local-player")?.position).toEqual({ x: 0, y: 0, z: 0 });
    adapter.dispose();
  });

  it("exposes immutable snapshots and does not mutate previously emitted state", () => {
    const adapter = new MockWorldAdapter();
    const earlierSnapshot = adapter.getInitialState();
    const earlierRemote = earlierSnapshot.find((entity) => entity.id === "remote-1");
    expect(earlierRemote).toBeDefined();
    if (!earlierRemote) throw new Error("Missing initial remote player.");
    expect(Reflect.set(earlierRemote.position, "x", 999)).toBe(false);
    adapter.advance(1);
    expect(earlierRemote.position).toEqual({ x: -5, y: 0, z: -3 });
    expect(adapter.getInitialState().find((entity) => entity.id === "remote-1")?.position.x).not.toBe(-5);
    adapter.dispose();
  });

  it("publishes spawn, state updates and removal in order through the contract", () => {
    const adapter = new MockWorldAdapter();
    const events: WorldEvent[] = [];
    adapter.subscribe((event) => events.push(event));
    adapter.dispatch({ type: "spawn" });
    const spawnedEntity = adapter.getInitialState().find((entity) => entity.id === "spawned-1");
    expect(spawnedEntity?.displayName).toBe("Sentinel 1");
    adapter.dispatch({ type: "set-animation", animation: "attack" });
    adapter.dispatch({ type: "despawn", entityId: "spawned-1" });
    adapter.dispatch({ type: "despawn", entityId: "spawned-1" });
    expect(events.map((event) => event.type)).toEqual(["spawn", "update", "despawn"]);
    expect(events[1]).toMatchObject({ type: "update", entity: { id: "local-player", animation: "attack" } });
    expect(adapter.getInitialState()).toHaveLength(6);
    adapter.dispose();
  });

  it("uses unique stable identifiers even after despawning earlier demo entities", () => {
    const adapter = new MockWorldAdapter();
    adapter.dispatch({ type: "spawn" });
    adapter.dispatch({ type: "despawn", entityId: "spawned-1" });
    adapter.dispatch({ type: "spawn" });
    expect(adapter.getInitialState().some((entity) => entity.id === "spawned-1")).toBe(false);
    expect(adapter.getInitialState().some((entity) => entity.id === "spawned-2")).toBe(true);
    adapter.dispose();
  });


  it("does not publish movement before a 100 ms update boundary", () => {
    const adapter = new MockWorldAdapter();
    const events: WorldEvent[] = [];
    adapter.subscribe((event) => events.push(event));
    adapter.advance(0);
    adapter.advance(0.04);
    adapter.advance(0.059);
    expect(events).toHaveLength(0);
    adapter.advance(0.001);
    expect(events.filter((event) => event.type === "update" && event.entity.kind === "remote-player")).toHaveLength(2);
    adapter.dispose();
  });

  it("produces identical simulation state across different frame timing partitions", () => {
    const singleFrameAdapter = new MockWorldAdapter();
    const manyFramesAdapter = new MockWorldAdapter();
    singleFrameAdapter.advance(2);
    for (let frame = 0; frame < 120; frame += 1) manyFramesAdapter.advance(1 / 60);
    expect(manyFramesAdapter.getInitialState()).toEqual(singleFrameAdapter.getInitialState());
    singleFrameAdapter.dispose();
    manyFramesAdapter.dispose();
  });

  it("pauses simulation without disabling explicit state-changing commands", () => {
    const adapter = new MockWorldAdapter();
    adapter.dispatch({ type: "set-paused", isPaused: true });
    const beforePause = adapter.getInitialState();
    adapter.advance(10);
    expect(adapter.getInitialState()).toEqual(beforePause);
    adapter.dispatch({ type: "set-animation", animation: "attack" });
    expect(adapter.getInitialState().find((entity) => entity.id === "local-player")?.animation).toBe("attack");
    adapter.dispatch({ type: "set-paused", isPaused: false });
    adapter.advance(0.1);
    expect(adapter.getInitialState().find((entity) => entity.id === "remote-1")?.position.x).not.toBe(-5);
    adapter.dispose();
  });

  it("moves the local player through authoritative updates and returns to idle at arrival", () => {
    const adapter = new MockWorldAdapter();
    adapter.dispatch({ type: "move-local", position: { x: 2, y: 20, z: 0 } });
    adapter.advance(0.2);
    expect(adapter.getInitialState().find((entity) => entity.id === "local-player")).toMatchObject({
      animation: "run", position: { x: 0.8, y: 0, z: 0 }, orientationRadians: Math.PI / 2,
    });
    adapter.advance(0.4);
    expect(adapter.getInitialState().find((entity) => entity.id === "local-player")).toMatchObject({
      animation: "idle", position: { x: 2, y: 0, z: 0 },
    });
    adapter.dispose();
  });

  it("marks explicit teleports for immediate snapping and cancels a pending walk", () => {
    const adapter = new MockWorldAdapter();
    const events: WorldEvent[] = [];
    adapter.subscribe((event) => events.push(event));
    adapter.dispatch({ type: "move-local", position: { x: 3, y: 0, z: 0 } });
    adapter.dispatch({ type: "teleport-local" });
    expect(events.at(-1)).toMatchObject({ type: "update", shouldSnap: true, entity: { position: { x: 7, y: 0, z: 0 } } });
    adapter.advance(1);
    expect(adapter.getInitialState().find((entity) => entity.id === "local-player")?.position.x).toBe(7);
    adapter.dispatch({ type: "teleport-local" });
    expect(adapter.getInitialState().find((entity) => entity.id === "local-player")?.position.x).toBe(-7);
    adapter.dispose();
  });

  it("accepts all three explicit animation states", () => {
    const adapter = new MockWorldAdapter();
    for (const animation of ["run", "attack", "idle"] as const) {
      adapter.dispatch({ type: "set-animation", animation });
      expect(adapter.getInitialState().find((entity) => entity.id === "local-player")?.animation).toBe(animation);
    }
    adapter.dispose();
  });

  it("targets repeated monster attacks without interrupting local movement and ignores unknown targets", () => {
    const adapter = new MockWorldAdapter();
    const monster = adapter.getInitialState().find(entity => entity.kind === "monster")!;
    adapter.dispatch({ type: "move-local", position: { x: 3, y: 0, z: 0 } });
    const movingPlayer = adapter.getInitialState().find(entity => entity.id === "local-player"), events: WorldEvent[] = [];
    adapter.subscribe(event => events.push(event));
    adapter.dispatch({ type: "set-animation", entityId: monster.id, animation: "attack" });
    adapter.dispatch({ type: "set-animation", entityId: monster.id, animation: "attack" });
    expect(events).toEqual([
      { type: "update", entity: { ...monster, animation: "attack", animationSequence: 1 }, shouldSnap: false },
      { type: "update", entity: { ...monster, animation: "attack", animationSequence: 2 }, shouldSnap: false },
    ]);
    expect(adapter.getInitialState().find(entity => entity.id === "local-player")).toEqual(movingPlayer);
    const beforeUnknown = adapter.getInitialState();
    adapter.dispatch({ type: "set-animation", entityId: "unknown", animation: "idle" });
    expect(adapter.getInitialState()).toEqual(beforeUnknown);
    expect(events).toHaveLength(2);
    adapter.advance(.1);
    expect(adapter.getInitialState().find(entity => entity.id === "local-player")).toMatchObject({
      position: { x: .4, y: 0, z: 0 }, animation: "run",
    });
    adapter.dispose();
  });

  it("rejects invalid time and ignores invalid movement destinations", () => {
    const adapter = new MockWorldAdapter();
    for (const elapsedSeconds of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => adapter.advance(elapsedSeconds)).toThrow(RangeError);
    }
    adapter.dispatch({ type: "move-local", position: { x: Number.NaN, y: 0, z: 0 } });
    adapter.advance(0.1);
    expect(adapter.getInitialState().find((entity) => entity.id === "local-player")?.position).toEqual({ x: 0, y: 0, z: 0 });
    adapter.dispose();
  });

  it("unsubscribes listeners and disposes the adapter idempotently", () => {
    const adapter = new MockWorldAdapter();
    const events: WorldEvent[] = [];
    const unsubscribe = adapter.subscribe((event) => events.push(event));
    adapter.dispatch({ type: "spawn" });
    unsubscribe();
    unsubscribe();
    adapter.dispatch({ type: "spawn" });
    expect(events).toHaveLength(1);
    adapter.subscribe((event) => events.push(event));
    adapter.dispose();
    adapter.dispose();
    adapter.advance(1);
    adapter.dispatch({ type: "spawn" });
    adapter.subscribe((event) => events.push(event))();
    expect(events).toHaveLength(1);
    expect(adapter.getInitialState()).toHaveLength(0);
  });
});
