import type { Scene } from "@babylonjs/core/scene";
import { createSceneScopedContext } from "../../sceneScopedContext";
import type { WorldPosition } from "../../../world/sourceFrame";
import type { CollisionWorld } from "./core/collisionWorld";

export interface CollisionCellContext {
  readonly world: CollisionWorld;
  focusPosition(): WorldPosition | null;
}

const collisionCellContexts = createSceneScopedContext<CollisionCellContext>("collision cell context");

export function provideCollisionCellContext(scene: Scene, context: CollisionCellContext): () => void {
  return collisionCellContexts.provide(scene, context);
}

export function collisionCellContextFor(scene: Scene): CollisionCellContext | null {
  return collisionCellContexts.contextFor(scene);
}
