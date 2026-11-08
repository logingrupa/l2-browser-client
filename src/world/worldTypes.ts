export interface WorldPosition {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export type AnimationState = "idle" | "run" | "attack";
export type LocomotionMode = "walk" | "run";
export type SourceActionPreview = "special-attack";
export type EntityKind = "local-player" | "remote-player" | "monster";
export type EquipmentSlot = "upper";

export interface WorldEntity {
  readonly id: string;
  readonly kind: EntityKind;
  readonly displayName: string;
  readonly position: WorldPosition;
  readonly orientationRadians: number;
  readonly health: number;
  readonly maximumHealth: number;
  readonly animation: AnimationState;
  readonly actionPreview?: SourceActionPreview;
  readonly actionTargetId?: string;
  readonly locomotion?: LocomotionMode;
  readonly appearanceId?: string;
  readonly animationSequence?: number;
  readonly npcId?: number;
  readonly characterTemplateIndex?: number;
  readonly equipment?: Readonly<Partial<Record<EquipmentSlot, number>>>;
}

export type WorldEvent =
  | { readonly type: "spawn"; readonly entity: WorldEntity }
  | {
      readonly type: "update";
      readonly entity: WorldEntity;
      readonly shouldSnap?: boolean;
    }
  | { readonly type: "despawn"; readonly entityId: string }
  | {
      readonly type: "skill-cast";
      readonly casterId: string;
      readonly skillId: number;
      readonly level: number;
      readonly targetId?: string;
    };

export type WorldCommand =
  | { readonly type: "set-animation"; readonly animation: AnimationState; readonly entityId?: string }
  | { readonly type: "preview-action"; readonly action: SourceActionPreview; readonly targetId?: string }
  | { readonly type: "set-locomotion"; readonly mode: LocomotionMode }
  | { readonly type: "move-local"; readonly position: WorldPosition }
  | { readonly type: "teleport-local" }
  | { readonly type: "spawn" }
  | { readonly type: "spawn-npc"; readonly npcId: number }
  | { readonly type: "spawn-character"; readonly characterTemplateIndex: number }
  | { readonly type: "despawn"; readonly entityId: string }
  | { readonly type: "set-paused"; readonly isPaused: boolean }
  | { readonly type: "equip-item"; readonly slot: EquipmentSlot; readonly itemId: number | null; readonly entityId?: string }
  | { readonly type: "cast-skill"; readonly skillId: number; readonly level: number; readonly targetId?: string }
  | { readonly type: "set-health"; readonly entityId: string; readonly health: number };
