/** Metres in Babylon's left-handed world: +Y is up, X/Z form the ground. */
export interface WorldPosition {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export type AnimationState = "idle" | "run" | "attack";
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
  readonly modelUrl?: string;
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
  | { readonly type: "set-animation"; readonly animation: AnimationState }
  | { readonly type: "move-local"; readonly position: WorldPosition }
  | { readonly type: "teleport-local" }
  | { readonly type: "spawn" }
  | { readonly type: "despawn"; readonly entityId: string }
  | { readonly type: "set-paused"; readonly isPaused: boolean }
  | { readonly type: "load-missing-model" };
