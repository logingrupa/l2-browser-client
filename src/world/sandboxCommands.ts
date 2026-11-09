import type { BodyPartEquipmentSlot, EquipmentSlot, WorldCommand, WorldEntity, WorldEvent, WorldPosition } from "./worldTypes";

type EquipItemCommand = Extract<WorldCommand, { readonly type: "equip-item" }>;
type CastSkillCommand = Extract<WorldCommand, { readonly type: "cast-skill" }>;
type PlayClipCommand = Extract<WorldCommand, { readonly type: "play-clip" }>;

const upperEquipmentSlot = "upper";
const bodyPartEquipmentSlotPrefix = "body-part:";
const canonicalBodyPartEquipmentSlotPattern = /^body-part:(0|[1-9][0-9]*)$/;

export const maximumSandboxClipNameLength = 128;

export function isLineageIdentifier(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

export function isEquipmentSlot(value: string): value is EquipmentSlot {
  if (value === upperEquipmentSlot) return true;
  const bodyPartMatch = canonicalBodyPartEquipmentSlotPattern.exec(value);
  return bodyPartMatch !== null && isLineageIdentifier(Number(bodyPartMatch[1]));
}

export function equipmentSlotForBodyPart(bodyPart: number): BodyPartEquipmentSlot | null {
  if (!isLineageIdentifier(bodyPart)) return null;
  return `${bodyPartEquipmentSlotPrefix}${bodyPart}`;
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

export function createSpawnedCharacterEntity(characterTemplateIndex: number, spawnSequence: number, position: WorldPosition): WorldEntity {
  return Object.freeze({
    id: `character-${characterTemplateIndex}-${spawnSequence}`,
    kind: "remote-player",
    displayName: `character:${characterTemplateIndex}`,
    characterTemplateIndex,
    position: Object.freeze({ x: position.x, y: position.y, z: position.z }),
    orientationRadians: 0,
    health: 100,
    maximumHealth: 100,
    animation: "idle",
  });
}

export function unknownWorldCommandError(unhandledCommand: never): RangeError {
  const commandType: unknown = (unhandledCommand as { readonly type?: unknown }).type;
  return new RangeError(`Unknown world command type: ${String(commandType)}.`);
}

export function entityWithClampedHealth(entity: WorldEntity, health: number): WorldEntity | null {
  if (!Number.isFinite(health)) return null;
  return { ...entity, health: Math.max(0, Math.min(entity.maximumHealth, health)) };
}

export function entityWithEquippedItem(entities: ReadonlyMap<string, WorldEntity>, command: EquipItemCommand): WorldEntity | null {
  if (!isEquipmentSlot(command.slot)) return null;
  if (command.itemId !== null && !isLineageIdentifier(command.itemId)) return null;
  const entity = entities.get(command.entityId ?? "local-player");
  if (!entity) return null;
  if (entity.equipment?.[command.slot] === (command.itemId ?? undefined)) return entity;
  const otherSlots = Object.fromEntries(Object.entries(entity.equipment ?? {}).filter(([slot]) => slot !== command.slot));
  const equipment = Object.freeze(command.itemId === null ? otherSlots : { ...otherSlots, [command.slot]: command.itemId });
  return { ...entity, equipment };
}

export function isSandboxClipName(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= maximumSandboxClipNameLength;
}

export function entityWithRequestedClip(entities: ReadonlyMap<string, WorldEntity>, command: PlayClipCommand): WorldEntity | null {
  if (!isSandboxClipName(command.clipName)) return null;
  const entity = entities.get(command.entityId);
  if (!entity) return null;
  const requestedClip = Object.freeze({ clipName: command.clipName, requestSequence: (entity.requestedClip?.requestSequence ?? 0) + 1 });
  return { ...entity, requestedClip };
}

export function skillCastEvent(entities: ReadonlyMap<string, WorldEntity>, command: CastSkillCommand): WorldEvent | null {
  if (!isLineageIdentifier(command.skillId) || !Number.isSafeInteger(command.level) || command.level < 1) return null;
  const caster = entities.get("local-player");
  if (!caster || caster.health <= 0) return null;
  if (command.targetId !== undefined) {
    const target = entities.get(command.targetId);
    if (!target || target.health <= 0) return null;
  }
  return {
    type: "skill-cast",
    casterId: caster.id,
    skillId: command.skillId,
    level: command.level,
    ...(command.targetId === undefined ? {} : { targetId: command.targetId }),
  };
}
