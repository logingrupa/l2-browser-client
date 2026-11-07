/** Metres in Babylon's left-handed world: +Y is up, X/Z form the ground. */
export interface WorldPosition {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export type AnimationState = "idle" | "run" | "attack";
export type LocomotionMode = "walk" | "run";
export type SourceActionPreview = "special-attack";
export type EntityKind = "local-player" | "remote-player" | "monster";

export interface WorldEntity {
  readonly id: string;
  readonly kind: EntityKind;
  readonly displayName: string;
  readonly position: WorldPosition;
  /** Rotation around +Y, measured in radians. */
  readonly orientationRadians: number;
  readonly health: number;
  readonly maximumHealth: number;
  readonly animation: AnimationState;
  /** Explicit demo source-animation preview; not a gameplay skill or weapon selection. */
  readonly actionPreview?: SourceActionPreview;
  /** Target captured for one explicit local source-action preview generation. */
  readonly actionTargetId?: string;
  /** Travel gait is independent of the moving/idle/action state. Omitted means run. */
  readonly locomotion?: LocomotionMode;
  /** Semantic appearance key; presentation resolves resources and native clip families. */
  readonly appearanceId?: string;
  /** Changes for an explicit repeated action; ordinary snapshots do not retrigger clips. */
  readonly animationSequence?: number;
  readonly modelUrl?: string;
  /** Semantic item identifiers; native meshes/materials remain presentation data. */
  readonly equipment?: Readonly<{ upper?: number }>;
}

/** Complete state replaces earlier state; presentation owns interpolation. */
export type WorldEvent =
  | { readonly type: "spawn"; readonly entity: WorldEntity }
  | {
      readonly type: "update";
      readonly entity: WorldEntity;
      readonly shouldSnap?: boolean;
    }
  | { readonly type: "despawn"; readonly entityId: string };

/** Synthetic demo intents. A future adapter decides which intents it supports. */
export type WorldCommand =
  | { readonly type: "set-animation"; readonly animation: AnimationState; readonly entityId?: string }
  | { readonly type: "preview-action"; readonly action: SourceActionPreview; readonly targetId?: string }
  | { readonly type: "set-locomotion"; readonly mode: LocomotionMode }
  | { readonly type: "move-local"; readonly position: WorldPosition }
  | { readonly type: "teleport-local" }
  | { readonly type: "spawn" }
  | { readonly type: "despawn"; readonly entityId: string }
  | { readonly type: "set-paused"; readonly isPaused: boolean }
  | { readonly type: "load-missing-model" }
  | { readonly type: "equip-upper"; readonly itemId: number | null }
  | { readonly type: "set-health"; readonly entityId: string; readonly health: number };
