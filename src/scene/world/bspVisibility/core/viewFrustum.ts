import type { Vector3 } from "../../../../shared/math/vector3";

export interface ViewPose {
  readonly position: Vector3;
  readonly forward: Vector3;
  readonly up: Vector3;
  readonly verticalFieldOfView: number;
  readonly aspectRatio: number;
  readonly near: number;
  readonly far: number;
}
