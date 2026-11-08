import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import { CharacterAnimator } from "../animation/CharacterAnimator";
import { ProceduralAnimator } from "../animation/ProceduralAnimator";
import type { WorldEntity } from "../world/worldTypes";
import type { CharacterBounds } from "./characterBounds";
import { createProceduralCharacter } from "./createProceduralCharacter";
import type { NativeActorClock, NativeBoneAnchorInspection, NativeBoneAnchorView } from "./native/NativeActor";

export interface CharacterVisual {
  readonly root: TransformNode;
  readonly animation: CharacterAnimator;
  readonly isFallback: boolean;
  readonly bounds: CharacterBounds;
  readonly modelId: string | null;
  readonly ready?: Promise<void>;
  readonly groundClearance?: number;
  readonly forwardDirection?: Vector3 | null;
  readonly missingAssetDiagnostic?: string;
  attachmentSnapshot?(): readonly (NativeBoneAnchorInspection & { id: string })[];
  attachmentAnchor?(id: string): NativeBoneAnchorView | null;
  sourceClock?(): NativeActorClock | null;
  setEntity?(entity: WorldEntity): void;
  dispose(): void;
}

export type CharacterVisualFactory = (scene: Scene, entity: WorldEntity, onAssetStatus?: (message: string) => void) => CharacterVisual;

export function createCharacterVisual(scene: Scene, entity: WorldEntity): CharacterVisual {
  const root = new TransformNode(`entity:${entity.id}`, scene);
  const proceduralCharacter = createProceduralCharacter(scene, entity);
  proceduralCharacter.root.parent = root;
  const animation = new CharacterAnimator(new ProceduralAnimator(proceduralCharacter.joints));
  animation.setState(entity.animation);
  const proceduralBounds: CharacterBounds = {
    minimum: new Vector3(-0.7, 0.02, -0.4), maximum: new Vector3(0.7, 1.8, 0.4),
    labelHeight: 2.25, selectionRadius: 0.825, pickingHeight: 1,
  };
  let isDisposed = false;

  const dispose = (): void => {
    if (isDisposed) return;
    isDisposed = true;
    animation.dispose();
    proceduralCharacter.dispose();
    root.dispose();
    scene.onDisposeObservable.remove(disposeObserver);
  };
  const disposeObserver = scene.onDisposeObservable.add(dispose);

  return { root, animation, isFallback: true, bounds: proceduralBounds, modelId: null, dispose };
}
