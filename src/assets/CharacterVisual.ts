import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import type { CharacterAnimator } from "../animation/CharacterAnimator";
import type { WorldEntity } from "../world/worldTypes";
import type { NativeActorClock, NativeBoneAnchorInspection, NativeBoneAnchorView } from "./native/NativeActor";

export interface CharacterBounds {
  readonly minimum: Vector3;
  readonly maximum: Vector3;
  readonly labelHeight: number;
  readonly selectionRadius: number;
}

export interface CharacterVisual {
  readonly root: TransformNode;
  readonly animation: CharacterAnimator;
  readonly hasNativeModel: boolean;
  readonly bounds: CharacterBounds;
  readonly modelId: string | null;
  readonly ready: Promise<void>;
  readonly groundClearance: number;
  readonly forwardDirection: Vector3 | null;
  readonly missingAssetDiagnostic: string | null;
  attachmentSnapshot(): readonly (NativeBoneAnchorInspection & { id: string })[];
  attachmentAnchor(id: string): NativeBoneAnchorView | null;
  sourceClock(): NativeActorClock | null;
  setEntity(entity: WorldEntity): void;
  dispose(): void;
}

export type CharacterVisualFactory = (scene: Scene, entity: WorldEntity, onAssetStatus?: (message: string) => void) => CharacterVisual;
