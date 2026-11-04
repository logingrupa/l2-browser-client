import type { EntityKind, WorldEntity, WorldPosition } from "./worldTypes";

function createEntity(
  id: string,
  kind: EntityKind,
  displayName: string,
  position: WorldPosition,
  health = 100,
): WorldEntity {
  return {
    id,
    kind,
    displayName,
    position,
    orientationRadians: 0,
    health,
    maximumHealth: 100,
    animation: "idle",
  };
}

export function createInitialWorld(): readonly WorldEntity[] {
  return [
    createEntity("local-player", "local-player", "Elyra", { x: 0, y: 0, z: 0 }),
    createEntity("remote-1", "remote-player", "Orin", { x: -5, y: 0, z: -3 }),
    createEntity("remote-2", "remote-player", "Seren", { x: 5, y: 0, z: 2 }),
    createEntity("monster-1", "monster", "Moss Golem", { x: -4, y: 0, z: 5 }, 80),
    createEntity("monster-2", "monster", "Amber Wisp", { x: 2, y: 0, z: 6 }, 65),
    createEntity("monster-3", "monster", "Watcher", { x: 6, y: 0, z: -4 }, 90),
  ];
}
