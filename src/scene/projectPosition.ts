import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import type { WorldPosition } from "../world/worldTypes";
import { getWorldCanvas } from "./getWorldCanvas";

/** CSS pixels relative to the displayed world canvas; z is normalized clip depth. */
export function projectPosition(scene: Scene, position: WorldPosition): Vector3 {
  const canvas = getWorldCanvas(scene.getEngine());
  const viewport = scene.activeCamera?.viewport.toGlobal(canvas?.clientWidth ?? 1, canvas?.clientHeight ?? 1);
  return viewport
    ? Vector3.Project(new Vector3(position.x, position.y, position.z), Matrix.IdentityReadOnly, scene.getTransformMatrix(), viewport)
    : new Vector3(0, 0, -1);
}
