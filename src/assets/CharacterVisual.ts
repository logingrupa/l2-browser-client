import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { AssetContainer } from "@babylonjs/core/assetContainer";
import type { Scene } from "@babylonjs/core/scene";
import { CharacterAnimator } from "../animation/CharacterAnimator";
import { ModelAnimator } from "../animation/ModelAnimator";
import { ProceduralAnimator } from "../animation/ProceduralAnimator";
import type { WorldEntity } from "../world/worldTypes";
import { createProceduralCharacter } from "./createProceduralCharacter";
import { loadCharacterModel } from "./loadCharacterModel";
import { prepareCharacterModel } from "./prepareCharacterModel";

export interface CharacterVisual {
  readonly root: TransformNode;
  readonly animation: CharacterAnimator;
  readonly isFallback: boolean;
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
  let loadedContainer: AssetContainer | undefined;
  let isDisposed = false;
  let isFallback = true;

  const dispose = (): void => {
    if (isDisposed) return;
    isDisposed = true;
    cancellation.abort();
    animation.dispose();
    loadedContainer?.dispose();
    placeholder.dispose();
    root.dispose();
    scene.onDisposeObservable.remove(disposeObserver);
  };
  const disposeObserver = scene.onDisposeObservable.add(dispose);

  if (entity.modelUrl) {
    void loadCharacterModel(scene, entity.modelUrl, cancellation.signal).then(container => {
      if (isDisposed || root.isDisposed() || scene.isDisposed) {
        container.dispose();
        return;
      }
      const clips = prepareCharacterModel(container, root, entity.id);
      loadedContainer = container;
      animation.replaceDriver(new ModelAnimator(clips));
      placeholder.dispose();
      isFallback = false;
      onAssetStatus?.(`${entity.displayName}: animated model loaded.`);
    }).catch((error: unknown) => {
      if (isDisposed || cancellation.signal.aborted) return;
      const reason = error instanceof Error ? error.message : "Unknown model error.";
      onAssetStatus?.(`${entity.displayName}: ${reason} Animated placeholder retained.`);
    });
  }

  return { root, animation, get isFallback() { return isFallback; }, dispose };
}
