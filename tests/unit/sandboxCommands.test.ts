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

  it("equips an item by ID into the upper slot once and clears it with null", () => {
    const adapter = createAdapter();
    const receivedEvents = recordEvents(adapter);
    adapter.dispatch({ type: "equip-item", slot: "upper", itemId: 22 });
    expect(receivedEvents).toHaveLength(1);
    expect(receivedEvents[0]).toMatchObject({ type: "update", entity: { id: "local-player", equipment: { upper: 22 } } });
    adapter.dispatch({ type: "equip-item", slot: "upper", itemId: 22 });
    expect(receivedEvents).toHaveLength(1);
    adapter.dispatch({ type: "equip-item", slot: "upper", itemId: null });
    expect(receivedEvents).toHaveLength(2);
    const cleared = receivedEvents[1];
    expect(cleared?.type === "update" ? cleared.entity.equipment?.upper : "not an update").toBeUndefined();
    adapter.dispatch({ type: "equip-item", slot: "upper", itemId: null });
    expect(receivedEvents).toHaveLength(2);
    adapter.dispose();
  });

  it("equips a named non-local entity and ignores unknown entities and invalid item IDs", () => {
    const adapter = createAdapter();
    const receivedEvents = recordEvents(adapter);
    adapter.dispatch({ type: "spawn-npc", npcId: 12345 });
    const npc = spawnedEntities(receivedEvents)[0]!;
    adapter.dispatch({ type: "equip-item", slot: "upper", itemId: 22, entityId: npc.id });
    expect(receivedEvents.at(-1)).toMatchObject({ type: "update", entity: { id: npc.id, npcId: 12345, equipment: { upper: 22 } } });
    adapter.dispatch({ type: "equip-item", slot: "upper", itemId: 22, entityId: "no-such-entity" });
    for (const itemId of [-1, .5, Number.NaN]) adapter.dispatch({ type: "equip-item", slot: "upper", itemId });
    expect(receivedEvents).toHaveLength(2);
    adapter.dispose();
  });

  it("emits a skill-cast record with the L2 skill ID and level and changes no health", () => {
    const adapter = createAdapter();
    const receivedEvents = recordEvents(adapter);
    adapter.dispatch({ type: "spawn-npc", npcId: 12345 });
    const target = spawnedEntities(receivedEvents)[0]!;
    const healthBefore = adapter.getInitialState().map(entity => [entity.id, entity.health]);
    adapter.dispatch({ type: "cast-skill", skillId: 3, level: 1, targetId: target.id });
    expect(receivedEvents.slice(1)).toEqual([{ type: "skill-cast", casterId: "local-player", skillId: 3, level: 1, targetId: target.id }]);
    adapter.dispatch({ type: "cast-skill", skillId: 3, level: 1 });
    expect(receivedEvents.at(-1)).toEqual({ type: "skill-cast", casterId: "local-player", skillId: 3, level: 1 });
    expect(adapter.getInitialState().map(entity => [entity.id, entity.health])).toEqual(healthBefore);
    adapter.dispose();
  });

  it("ignores casts with invalid IDs, a missing or dead target, or a dead caster", () => {
    const adapter = createAdapter();
    const receivedEvents = recordEvents(adapter);
    adapter.dispatch({ type: "spawn-npc", npcId: 12345 });
    const target = spawnedEntities(receivedEvents)[0]!;
    adapter.dispatch({ type: "cast-skill", skillId: -1, level: 1, targetId: target.id });
    adapter.dispatch({ type: "cast-skill", skillId: 3, level: 0, targetId: target.id });
    adapter.dispatch({ type: "cast-skill", skillId: 3.5, level: 1 });
    adapter.dispatch({ type: "cast-skill", skillId: 3, level: 1, targetId: "no-such-entity" });
    expect(receivedEvents).toHaveLength(1);
    adapter.dispatch({ type: "set-health", entityId: target.id, health: 0 });
    adapter.dispatch({ type: "cast-skill", skillId: 3, level: 1, targetId: target.id });
    adapter.dispatch({ type: "set-health", entityId: "local-player", health: 0 });
    adapter.dispatch({ type: "cast-skill", skillId: 3, level: 1 });
    expect(receivedEvents.filter(event => event.type === "skill-cast")).toEqual([]);
    adapter.dispose();
  });
});
