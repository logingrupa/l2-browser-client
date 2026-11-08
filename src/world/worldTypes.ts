export interface WorldPosition {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export type AnimationState = "idle" | "run" | "attack";
export type LocomotionMode = "walk" | "run";
export type SourceActionPreview = "special-attack";
type EntityKind = "local-player" | "remote-player" | "monster";

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
  readonly equipment?: Readonly<{ upper?: number }>;
}

export type WorldEvent =
  | { readonly type: "spawn"; readonly entity: WorldEntity }
  | {
      readonly type: "update";
      readonly entity: WorldEntity;
      readonly shouldSnap?: boolean;
    }
  | { readonly type: "despawn"; readonly entityId: string };

export type WorldCommand =
  | { readonly type: "set-animation"; readonly animation: AnimationState; readonly entityId?: string }
  | { readonly type: "preview-action"; readonly action: SourceActionPreview; readonly targetId?: string }
  | { readonly type: "set-locomotion"; readonly mode: LocomotionMode }
  | { readonly type: "move-local"; readonly position: WorldPosition }
  | { readonly type: "despawn"; readonly entityId: string }
  | { readonly type: "set-paused"; readonly isPaused: boolean }
  | { readonly type: "equip-upper"; readonly itemId: number | null }
  | { readonly type: "set-health"; readonly entityId: string; readonly health: number };
