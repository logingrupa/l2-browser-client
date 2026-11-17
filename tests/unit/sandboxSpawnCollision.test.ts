import { describe, expect, it } from "vitest";
import type { NativeCatalogIndex, NativeCatalogLookup, NativeCatalogRecord } from "../../src/assets/native/nativeCatalogIndex";
import { sandboxSpawnCollision } from "../../src/runtime/sandboxSpawnCollision";
import { createSpawnedCharacterEntity, createSpawnedNpcEntity } from "../../src/world/sandboxCommands";
import type { WorldEntity } from "../../src/world/worldTypes";

const convertedRecords = new Map<string, NativeCatalogRecord>([
  ["npc:21622", { npcId: 21622, profileId: "npc:21622", modelCatalogId: "musveren:0", join: "model-catalog-id" }],
  ["npc:30000", { npcId: 30000, profileId: "npc:unserved", modelCatalogId: "missing:0", join: "model-catalog-id" }],
  ["character:0", { chargrpIndex: 0, playerProfileId: "human-male-fighter", catalogId: "fighter:0" }],
]);
const catalogIndex: NativeCatalogIndex = {
  lookup(key): NativeCatalogLookup {
    const record = convertedRecords.get(key);
    return record === undefined ? { status: "not-in-catalog", key, reason: "absent" } : { status: "converted", key, record, namedGaps: [] };
  },
  keys: () => [],
};
const resolve = sandboxSpawnCollision({
  catalogIndex,
  npcProfiles: new Map([["npc:21622", { collisionRadius: 30, collisionHeight: 36 }]]),
  playerProfiles: new Map([["human-male-fighter", { collisionRadius: 9, collisionHeight: 23 }]]),
  cylinderByAppearanceId: new Map([["native-musveren", { radius: 30, height: 36 }]]),
});
const position = { x: 0, y: 0, z: 0 };

describe("sandbox spawn collision from the class defaults the runtime already holds", () => {
  it("reads an NPC cylinder through its catalog profile and a character cylinder through its player profile", () => {
    expect(resolve(createSpawnedNpcEntity(21622, 1, position))).toEqual({ radius: 30, height: 36 });
    expect(resolve(createSpawnedCharacterEntity(0, 1, position))).toEqual({ radius: 9, height: 23 });
  });

  it("reads a preloaded appearance cylinder for an entity without catalog ids", () => {
    const musveren: WorldEntity = { id: "native-musveren", kind: "monster", displayName: "Greater Musveren", appearanceId: "native-musveren",
      position, orientationRadians: 0, health: 100, maximumHealth: 100, animation: "idle" };
    expect(resolve(musveren)).toEqual({ radius: 30, height: 36 });
  });

  it("leaves the cylinder unresolved for an unconverted id, an unserved profile and an unknown appearance", () => {
    expect(resolve(createSpawnedNpcEntity(12345, 1, position))).toBeNull();
    expect(resolve(createSpawnedNpcEntity(30000, 1, position))).toBeNull();
    expect(resolve(createSpawnedCharacterEntity(7, 1, position))).toBeNull();
    expect(resolve({ id: "bare", kind: "npc", displayName: "bare", position, orientationRadians: 0, health: 1, maximumHealth: 1, animation: "idle" })).toBeNull();
  });
});
