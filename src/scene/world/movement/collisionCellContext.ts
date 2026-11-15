import type { Scene } from "@babylonjs/core/scene";
import type { WorldPosition } from "../../../world/sourceFrame";
import type { CollisionWorld } from "./core/collisionWorld";

export interface CollisionCellContext {
  readonly world: CollisionWorld;
  focusPosition(): WorldPosition | null;
}

const collisionCellContextsByScene = new WeakMap<Scene, CollisionCellContext>();

export function provideCollisionCellContext(scene: Scene, context: CollisionCellContext): () => void {
  if (collisionCellContextsByScene.has(scene)) throw new Error("This scene already has a collision cell context provider.");
  collisionCellContextsByScene.set(scene, context);
  let withdrawn = false;
  const withdraw = () => {
    if (withdrawn) return;
    withdrawn = true;
    scene.onDisposeObservable.remove(disposeObserver);
    if (collisionCellContextsByScene.get(scene) === context) collisionCellContextsByScene.delete(scene);
  };
  const disposeObserver = scene.onDisposeObservable.add(withdraw);
  return withdraw;
}

export function collisionCellContextFor(scene: Scene): CollisionCellContext | null {
  return collisionCellContextsByScene.get(scene) ?? null;
}
