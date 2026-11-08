import { describe, expect, it } from "vitest";
import type { GameWorldAdapter } from "../../src/world/GameWorldAdapter";
import { NativeSliceAdapter } from "../../src/world/NativeSliceAdapter";
import type { WorldNavigation } from "../../src/world/WorldNavigation";
import type { WorldEntity, WorldEvent, WorldPosition } from "../../src/world/worldTypes";

const createAdapter = (navigation?: WorldNavigation): GameWorldAdapter => new NativeSliceAdapter({ x: 0, y: 0, z: 0 }, navigation);

const planStartNpcPositions: readonly WorldPosition[] = [{ x: 1.4, y: 0, z: 0 }, { x: 2.8, y: 0, z: 0 }, { x: 1.4 * 3, y: 0, z: 0 }];

function createSwitchableSpawnNavigation() {
  const spawnAvailability = { hasFreeSpawnPoint: true };
  const navigation: WorldNavigation = {
    origin: { x: 0, y: 0, z: 0 },
    ground: position => position,
    destination: position => position,
    spawn: offset => spawnAvailability.hasFreeSpawnPoint ? { x: offset.x, y: offset.y, z: offset.z } : null,
    move: (_from, to) => ({ position: to, blocked: false }),
  };
  return { navigation, spawnAvailability };
}

function recordEvents(adapter: GameWorldAdapter): WorldEvent[] {
  const receivedEvents: WorldEvent[] = [];
  adapter.subscribe(event => receivedEvents.push(event));
  return receivedEvents;
}

function spawnedEntities(events: readonly WorldEvent[]) {
  return events.flatMap(event => event.type === "spawn" ? [event.entity] : []);
}

describe("sandbox by-ID commands on NativeSliceAdapter", () => {
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

  it("equips an item by ID into the upper slot, clears it with null, and confirms a request the slot already holds", () => {
    const adapter = createAdapter();
    const receivedEvents = recordEvents(adapter);
    const upperItemOfEvent = (event: WorldEvent | undefined) => event?.type === "update" ? event.entity.equipment?.upper : "not an update";
    adapter.dispatch({ type: "equip-item", slot: "upper", itemId: 22 });
    expect(receivedEvents).toHaveLength(1);
    expect(receivedEvents[0]).toMatchObject({ type: "update", entity: { id: "local-player", equipment: { upper: 22 } } });
    adapter.dispatch({ type: "equip-item", slot: "upper", itemId: 22 });
    expect(receivedEvents).toHaveLength(2);
    expect(receivedEvents[1]).toMatchObject({ type: "update", entity: { id: "local-player", equipment: { upper: 22 } } });
    adapter.dispatch({ type: "equip-item", slot: "upper", itemId: null });
    expect(receivedEvents).toHaveLength(3);
    expect(upperItemOfEvent(receivedEvents[2])).toBeUndefined();
    adapter.dispatch({ type: "equip-item", slot: "upper", itemId: null });
    expect(receivedEvents).toHaveLength(4);
    expect(upperItemOfEvent(receivedEvents[3])).toBeUndefined();
    expect(adapter.getInitialState().find(entity => entity.id === "local-player")?.equipment?.upper).toBeUndefined();
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

describe("spawn-character on NativeSliceAdapter", () => {
  it("spawns a remote-player entity that carries only its chargrp template index and the sandbox defaults", () => {
    const adapter = createAdapter();
    const receivedEvents = recordEvents(adapter);
    adapter.dispatch({ type: "spawn-character", characterTemplateIndex: 7 });
    expect(receivedEvents).toHaveLength(1);
    const character = spawnedEntities(receivedEvents)[0]!;
    expect(character).toMatchObject({ id: "character-7-1", kind: "remote-player", displayName: "character:7", characterTemplateIndex: 7,
      health: 100, maximumHealth: 100, animation: "idle" });
    for (const derivedField of ["appearanceId", "npcId", "equipment", "locomotion", "requestedClip"]) expect(character).not.toHaveProperty(derivedField);
    expect(adapter.getInitialState().find(entity => entity.id === "character-7-1")).toMatchObject({ characterTemplateIndex: 7 });
    adapter.dispose();
  });

  it("gives two spawns of one index two separate entities", () => {
    const adapter = createAdapter();
    const receivedEvents = recordEvents(adapter);
    adapter.dispatch({ type: "spawn-character", characterTemplateIndex: 7 });
    adapter.dispatch({ type: "spawn-character", characterTemplateIndex: 7 });
    expect(spawnedEntities(receivedEvents).map(entity => entity.id)).toEqual(["character-7-1", "character-7-2"]);
    expect(adapter.getInitialState().filter(entity => entity.characterTemplateIndex === 7)).toHaveLength(2);
    adapter.dispose();
  });

  it("accepts index 0 and Number.MAX_SAFE_INTEGER and writes them as plain decimal integers", () => {
    const adapter = createAdapter();
    const receivedEvents = recordEvents(adapter);
    adapter.dispatch({ type: "spawn-character", characterTemplateIndex: 0 });
    adapter.dispatch({ type: "spawn-character", characterTemplateIndex: Number.MAX_SAFE_INTEGER });
    expect(spawnedEntities(receivedEvents).map(entity => [entity.id, entity.displayName, entity.characterTemplateIndex])).toEqual([
      ["character-0-1", "character:0", 0],
      ["character-9007199254740991-2", "character:9007199254740991", Number.MAX_SAFE_INTEGER],
    ]);
    adapter.dispose();
  });

  it("refuses indexes that are not safe non-negative integers without rounding or advancing any counter", () => {
    const adapter = createAdapter();
    const receivedEvents = recordEvents(adapter);
    for (const characterTemplateIndex of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      adapter.dispatch({ type: "spawn-character", characterTemplateIndex });
    }
    expect(receivedEvents).toEqual([]);
    adapter.dispatch({ type: "spawn-character", characterTemplateIndex: 3 });
    adapter.dispatch({ type: "spawn-npc", npcId: 5 });
    expect(spawnedEntities(receivedEvents).map(entity => entity.id)).toEqual(["character-3-1", "npc-5-1"]);
    expect(spawnedEntities(receivedEvents).map(entity => entity.position)).toEqual(planStartNpcPositions.slice(0, 2));
    adapter.dispose();
  });

  it("keeps the plan-start positions when only NPCs are spawned", () => {
    const adapter = createAdapter();
    const receivedEvents = recordEvents(adapter);
    for (const npcId of [1, 2, 3]) adapter.dispatch({ type: "spawn-npc", npcId });
    expect(spawnedEntities(receivedEvents).map(entity => entity.position)).toEqual(planStartNpcPositions);
    adapter.dispose();
  });

  it("places an NPC and a character spawned back to back at different positions", () => {
    const adapter = createAdapter();
    const receivedEvents = recordEvents(adapter);
    adapter.dispatch({ type: "spawn-npc", npcId: 12345 });
    adapter.dispatch({ type: "spawn-character", characterTemplateIndex: 7 });
    const [npc, character] = spawnedEntities(receivedEvents);
    expect(character!.position).not.toEqual(npc!.position);
    adapter.dispose();
  });

  it("emits mixed spawns in dispatch order with a sequence per kind starting at 1", () => {
    const adapter = createAdapter();
    const receivedEvents = recordEvents(adapter);
    adapter.dispatch({ type: "spawn-npc", npcId: 7 });
    adapter.dispatch({ type: "spawn-character", characterTemplateIndex: 3 });
    adapter.dispatch({ type: "spawn-npc", npcId: 0 });
    adapter.dispatch({ type: "spawn-character", characterTemplateIndex: 3 });
    expect(spawnedEntities(receivedEvents).map(entity => entity.id)).toEqual(["npc-7-1", "character-3-1", "npc-0-2", "character-3-2"]);
    adapter.dispose();
  });

  it("emits nothing and keeps the id sequence when navigation has no free spawn point", () => {
    const { navigation, spawnAvailability } = createSwitchableSpawnNavigation();
    const adapter = createAdapter(navigation);
    const receivedEvents = recordEvents(adapter);
    spawnAvailability.hasFreeSpawnPoint = false;
    adapter.dispatch({ type: "spawn-character", characterTemplateIndex: 7 });
    expect(receivedEvents).toEqual([]);
    spawnAvailability.hasFreeSpawnPoint = true;
    adapter.dispatch({ type: "spawn-character", characterTemplateIndex: 7 });
    expect(spawnedEntities(receivedEvents).map(entity => entity.id)).toEqual(["character-7-1"]);
    adapter.dispose();
  });

  it("emits nothing after dispose", () => {
    const adapter = createAdapter();
    const receivedEvents = recordEvents(adapter);
    adapter.dispose();
    adapter.dispatch({ type: "spawn-character", characterTemplateIndex: 7 });
    expect(receivedEvents).toEqual([]);
  });
});

describe("play-clip on NativeSliceAdapter", () => {
  function updatedEntities(events: readonly WorldEvent[]) {
    return events.flatMap(event => event.type === "update" ? [event.entity] : []);
  }

  function localPlayer(adapter: GameWorldAdapter): WorldEntity {
    return adapter.getInitialState().find(entity => entity.id === "local-player")!;
  }

  it("emits one update carrying the exact clip name and request sequence and changes no gameplay state", () => {
    const adapter = createAdapter();
    adapter.dispatch({ type: "equip-item", slot: "upper", itemId: 22 });
    const playerBefore = localPlayer(adapter);
    const receivedEvents = recordEvents(adapter);
    adapter.dispatch({ type: "play-clip", entityId: "local-player", clipName: "Wait" });
    expect(receivedEvents).toHaveLength(1);
    const [updated] = updatedEntities(receivedEvents);
    expect(updated!.requestedClip).toEqual({ clipName: "Wait", requestSequence: 1 });
    const { requestedClip: _requestedClip, ...gameplayState } = updated!;
    expect(gameplayState).toEqual(playerBefore);
    adapter.dispose();
  });

  it("keeps two identical requests as two sequenced requests and sequences each entity on its own", () => {
    const adapter = createAdapter();
    const receivedEvents = recordEvents(adapter);
    adapter.dispatch({ type: "spawn-npc", npcId: 12345 });
    const npc = spawnedEntities(receivedEvents)[0]!;
    adapter.dispatch({ type: "play-clip", entityId: "local-player", clipName: "Wait" });
    adapter.dispatch({ type: "play-clip", entityId: "local-player", clipName: "Wait" });
    adapter.dispatch({ type: "play-clip", entityId: npc.id, clipName: "Wait" });
    expect(updatedEntities(receivedEvents).map(entity => [entity.id, entity.requestedClip])).toEqual([
      ["local-player", { clipName: "Wait", requestSequence: 1 }],
      ["local-player", { clipName: "Wait", requestSequence: 2 }],
      [npc.id, { clipName: "Wait", requestSequence: 1 }],
    ]);
    adapter.dispose();
  });

  it("keeps clip names as exact UTF-16 strings with no trimming, case folding or normalisation", () => {
    const adapter = createAdapter();
    const receivedEvents = recordEvents(adapter);
    const clipNames = ["Wait", "wait", " Wait ", "Café", "Café"];
    for (const clipName of clipNames) adapter.dispatch({ type: "play-clip", entityId: "local-player", clipName });
    expect(updatedEntities(receivedEvents).map(entity => entity.requestedClip?.clipName)).toEqual(clipNames);
    adapter.dispose();
  });

  it("accepts a 128-code-unit name and refuses an empty name, a 129-code-unit name and an unknown entity", () => {
    const adapter = createAdapter();
    const receivedEvents = recordEvents(adapter);
    adapter.dispatch({ type: "play-clip", entityId: "local-player", clipName: "" });
    adapter.dispatch({ type: "play-clip", entityId: "local-player", clipName: "a".repeat(129) });
    adapter.dispatch({ type: "play-clip", entityId: "no-such-entity", clipName: "Wait" });
    expect(receivedEvents).toEqual([]);
    adapter.dispatch({ type: "play-clip", entityId: "local-player", clipName: "a".repeat(128) });
    expect(updatedEntities(receivedEvents).map(entity => entity.requestedClip)).toEqual([{ clipName: "a".repeat(128), requestSequence: 1 }]);
    adapter.dispose();
  });

  it("emits nothing after dispose", () => {
    const adapter = createAdapter();
    const receivedEvents = recordEvents(adapter);
    adapter.dispose();
    adapter.dispatch({ type: "play-clip", entityId: "local-player", clipName: "Wait" });
    expect(receivedEvents).toEqual([]);
  });

  it("keeps a moving local player moving toward its destination", () => {
    const adapter = createAdapter();
    adapter.dispatch({ type: "move-local", position: { x: 0, y: 0, z: 20 } });
    adapter.advance(.5);
    const positionBeforeClip = localPlayer(adapter).position;
    adapter.dispatch({ type: "play-clip", entityId: "local-player", clipName: "Wait" });
    expect(localPlayer(adapter).animation).toBe("run");
    adapter.advance(.5);
    expect(localPlayer(adapter).position.z).toBeGreaterThan(positionBeforeClip.z);
    adapter.dispose();
  });

  it("leaves requestedClip absent on every entity that never received play-clip", () => {
    const adapter = createAdapter();
    adapter.dispatch({ type: "spawn-npc", npcId: 12345 });
    adapter.dispatch({ type: "spawn-character", characterTemplateIndex: 7 });
    adapter.dispatch({ type: "play-clip", entityId: "local-player", clipName: "Wait" });
    for (const entity of adapter.getInitialState().filter(entity => entity.id !== "local-player")) expect(entity).not.toHaveProperty("requestedClip");
    adapter.dispose();
  });
});
