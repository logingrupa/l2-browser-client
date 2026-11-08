import type { WorldEntity, WorldPosition } from "./worldTypes";

export function isLineageIdentifier(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

export function createSpawnedNpcEntity(npcId: number, spawnSequence: number, position: WorldPosition): WorldEntity {
  return Object.freeze({
    id: `npc-${npcId}-${spawnSequence}`,
    kind: "monster",
    displayName: `npc:${npcId}`,
    npcId,
    position: Object.freeze({ x: position.x, y: position.y, z: position.z }),
    orientationRadians: 0,
    health: 100,
    maximumHealth: 100,
    animation: "idle",
  });
}
