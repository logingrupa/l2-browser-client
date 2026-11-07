import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import { CharacterAnimator } from "../animation/CharacterAnimator";
import { ModelAnimator } from "../animation/ModelAnimator";
import { ProceduralAnimator } from "../animation/ProceduralAnimator";
import type { WorldEntity } from "../world/worldTypes";
import { createProceduralCharacter } from "./createProceduralCharacter";
import { loadCharacterModel } from "./loadCharacterModel";
import { prepareCharacterModel, type CharacterBounds, type PreparedCharacterModel } from "./prepareCharacterModel";
import { resolveCharacterProfile } from "./characterProfiles";
import type { NativeActorClock, NativeBoneAnchorInspection, NativeBoneAnchorView } from "./native/NativeActor";

export interface CharacterVisual {
  readonly root: TransformNode;
  readonly animation: CharacterAnimator;
  readonly isFallback: boolean;
  readonly bounds: CharacterBounds;
  readonly modelId: string | null;
  /** Resolves when a required native model and its initial equipment are ready.
   * Factories with an intentionally usable procedural appearance may omit it. */
  readonly ready?: Promise<void>;
  /** Local surface-placement clearance. The imported rig keeps its native pivot. */
  readonly groundClearance?: number;
  /** Actual world-space facing from the presentation's established model axis. */
  readonly forwardDirection?: Vector3 | null;
  /** Presentation-owned source rig anchors, inspected only on explicit request. */
  attachmentSnapshot?(): readonly (NativeBoneAnchorInspection & { id: string })[];
  /** Borrowed presentation attachment. The character retains its ownership. */
  attachmentAnchor?(id: string): NativeBoneAnchorView | null;
  /** Lightweight original animation clock for attached presentation consumers. */
  sourceClock?(): NativeActorClock | null;
  setEntity?(entity: WorldEntity): void;
  dispose(): void;
}

/** A usable character is returned immediately; asynchronous loads never leave a hole. */
export function createCharacterVisual(
  scene: Scene, entity: WorldEntity, onAssetStatus?: (message: string) => void,
): CharacterVisual {
  const root = new TransformNode(`entity:${entity.id}`, scene);
  const placeholder = createProceduralCharacter(scene, entity);
  placeholder.root.parent = root;
  const animation = new CharacterAnimator(new ProceduralAnimator(placeholder.joints));
  animation.setState(entity.animation);
  const cancellation = new AbortController();
  const profile = resolveCharacterProfile(entity);
  let prepared: PreparedCharacterModel | undefined;
  const fallbackBounds: CharacterBounds = {
    minimum: new Vector3(-0.7, 0.02, -0.4), maximum: new Vector3(0.7, 1.8, 0.4),
    labelHeight: 2.25, selectionRadius: 0.825, pickingHeight: 1,
  };
  let isDisposed = false;
  let isFallback = true;

  const dispose = (): void => {
    if (isDisposed) return;
    isDisposed = true;
    cancellation.abort();
    animation.dispose();
    prepared?.dispose();
    placeholder.dispose();
    root.dispose();
    scene.onDisposeObservable.remove(disposeObserver);
  };
  const disposeObserver = scene.onDisposeObservable.add(dispose);

  if (profile) {
    void loadCharacterModel(scene, profile.resource.url, cancellation.signal).then(container => {
      if (isDisposed || root.isDisposed() || scene.isDisposed) {
        container.dispose();
        return;
      }
      prepared = prepareCharacterModel(container, root, entity.id, profile);
      animation.replaceDriver(new ModelAnimator(prepared.clips, profile.animations));
      placeholder.dispose();
      isFallback = false;
      onAssetStatus?.(`${entity.displayName}: animated model loaded.`);
    }).catch((error: unknown) => {
      if (isDisposed || cancellation.signal.aborted) return;
      const reason = error instanceof Error ? error.message : "Unknown model error.";
      onAssetStatus?.(`${entity.displayName}: ${reason} Animated placeholder retained.`);
    });
  }

  return {
    root, animation, get isFallback() { return isFallback; },
    get bounds() { return prepared?.bounds ?? fallbackBounds; },
    get modelId() { return isFallback ? null : profile?.id ?? null; }, dispose,
  };
}
