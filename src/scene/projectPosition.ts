import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import type { WorldPosition } from "../world/worldTypes";

/** CSS pixels relative to the rendering canvas; z is the normalized clip depth. */
export function projectPosition(scene: Scene, position: WorldPosition): Vector3 {
  const canvas = scene.getEngine().getRenderingCanvas();
  const viewport = scene.activeCamera?.viewport.toGlobal(canvas?.clientWidth ?? 1, canvas?.clientHeight ?? 1);
  return viewport
    ? Vector3.Project(new Vector3(position.x, position.y, position.z), Matrix.IdentityReadOnly, scene.getTransformMatrix(), viewport)
    : new Vector3(0, 0, -1);
}
