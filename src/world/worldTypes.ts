import type { SourcePosition, WorldPosition } from "./sourceFrame";

export type AnimationState = "idle" | "run" | "attack";
export type LocomotionMode = "walk" | "run";
export type SourceActionPreview = "special-attack";
type EntityKind = "local-player" | "remote-player" | "monster" | "npc";
export type BodyPartEquipmentSlot = `body-part:${number}`;
export type EquipmentSlot = "upper" | BodyPartEquipmentSlot;

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
  readonly requestedClip?: { readonly clipName: string; readonly requestSequence: number };
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
    }
  | { readonly type: "command-rejected"; readonly commandType: WorldCommand["type"]; readonly reason: string }
  | { readonly type: "environment"; readonly gameMinutes: number; readonly environmentType: number }
  | {
      readonly type: "move";
      readonly entityId: string;
      readonly origin: SourcePosition;
      readonly destination: SourcePosition;
      readonly targetId?: string;
      readonly offset?: number;
      readonly moveType: number;
      readonly speeds: Readonly<Record<string, number>>;
      readonly collision: { readonly radius: number; readonly height: number };
    }
  | { readonly type: "stop"; readonly entityId: string; readonly position: SourcePosition; readonly heading: number }
  | { readonly type: "correct"; readonly entityId: string; readonly position: SourcePosition; readonly heading: number }
  | { readonly type: "teleport"; readonly entityId: string; readonly position: SourcePosition };

export type WorldCommand =
  | { readonly type: "set-animation"; readonly animation: AnimationState; readonly entityId?: string }
  | { readonly type: "preview-action"; readonly action: SourceActionPreview; readonly targetId?: string }
  | { readonly type: "set-locomotion"; readonly mode: LocomotionMode }
  | { readonly type: "move-local"; readonly position: WorldPosition; readonly origin?: WorldPosition }
  | { readonly type: "spawn-npc"; readonly npcId: number }
  | { readonly type: "spawn-character"; readonly characterTemplateIndex: number }
  | { readonly type: "play-clip"; readonly entityId: string; readonly clipName: string }
  | { readonly type: "despawn"; readonly entityId: string }
  | { readonly type: "set-paused"; readonly isPaused: boolean }
  | { readonly type: "equip-item"; readonly slot: EquipmentSlot; readonly itemId: number | null; readonly entityId?: string }
  | { readonly type: "cast-skill"; readonly skillId: number; readonly level: number; readonly targetId?: string }
  | { readonly type: "set-health"; readonly entityId: string; readonly health: number }
  | { readonly type: "report-position"; readonly position: SourcePosition; readonly heading: number }
  | { readonly type: "cannot-move"; readonly position: SourcePosition; readonly heading: number };
