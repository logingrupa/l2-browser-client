import { describe, expect, it } from "vitest";
import type { GameWorldAdapter } from "../../src/world/GameWorldAdapter";
import { MockWorldAdapter } from "../../src/world/MockWorldAdapter";
import { NativeSliceAdapter } from "../../src/world/NativeSliceAdapter";
import type { WorldEvent } from "../../src/world/worldTypes";

const adapterFactories: ReadonlyArray<readonly [string, () => GameWorldAdapter]> = [
  ["MockWorldAdapter", () => new MockWorldAdapter()],
  ["NativeSliceAdapter", () => new NativeSliceAdapter({ x: 0, y: 0, z: 0 })],
];

function recordEvents(adapter: GameWorldAdapter): WorldEvent[] {
  const receivedEvents: WorldEvent[] = [];
  adapter.subscribe(event => receivedEvents.push(event));
  return receivedEvents;
}

function spawnedEntities(events: readonly WorldEvent[]) {
  return events.flatMap(event => event.type === "spawn" ? [event.entity] : []);
}

describe.each(adapterFactories)("sandbox by-ID commands on %s", (_name, createAdapter) => {
  it("spawns an NPC entity carrying its L2 NPC ID", () => {
    const adapter = createAdapter();
    const receivedEvents = recordEvents(adapter);
    adapter.dispatch({ type: "spawn-npc", npcId: 12345 });
    expect(receivedEvents).toHaveLength(1);
    expect(receivedEvents[0]).toMatchObject({ type: "spawn", entity: { npcId: 12345, displayName: "npc:12345", kind: "monster", health: 100, maximumHealth: 100, animation: "idle" } });
    expect(adapter.getInitialState().some(entity => entity.npcId === 12345)).toBe(true);
    adapter.dispose();
  });

  it("gives each spawn of one NPC ID a new entity id", () => {
    const adapter = createAdapter();
    const receivedEvents = recordEvents(adapter);
    adapter.dispatch({ type: "spawn-npc", npcId: 12345 });
    adapter.dispatch({ type: "spawn-npc", npcId: 12345 });
    const entities = spawnedEntities(receivedEvents);
    expect(entities.map(entity => entity.id)).toEqual(["npc-12345-1", "npc-12345-2"]);
    adapter.dispose();
  });

  it("ignores NPC IDs that are not safe non-negative integers", () => {
    const adapter = createAdapter();
    const receivedEvents = recordEvents(adapter);
    for (const npcId of [-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) adapter.dispatch({ type: "spawn-npc", npcId });
    expect(receivedEvents).toEqual([]);
    adapter.dispose();
  });

  it("handles commands in dispatch order", () => {
    const adapter = createAdapter();
    const receivedEvents = recordEvents(adapter);
    adapter.dispatch({ type: "spawn-npc", npcId: 7 });
    adapter.dispatch({ type: "spawn-npc", npcId: 0 });
    adapter.dispatch({ type: "spawn-npc", npcId: 9 });
    expect(spawnedEntities(receivedEvents).map(entity => entity.npcId)).toEqual([7, 0, 9]);
    adapter.dispose();
  });
});
