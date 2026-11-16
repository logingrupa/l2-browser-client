import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";

type Point = readonly [number, number, number];

export interface NativeEffectShotPlacement {
  readonly policy: "presented-pivot-half-source-radius-v1" | "pawnviewer-self-target-v1";
  readonly caster: [number, number, number];
  readonly target: [number, number, number];
  readonly position: [number, number, number];
  readonly direction: [number, number, number];
  readonly quaternion: [number, number, number, number];
  readonly collisionRadius: number;
  readonly halfRadius: number;
  readonly distance: number;
  readonly nativeRuntimeLocationVerified: false;
  readonly nativeRotationQuantizationVerified: false;
}

const sourceForwardAxis: Point = [1, 0, 0];
const identityQuaternion: [number, number, number, number] = [0, 0, 0, 1];

function requireFinitePointsAndPositiveRadius(points: readonly Point[], collisionRadius: number): void {
  if (!points.flat().concat(collisionRadius).every(Number.isFinite) || collisionRadius <= 0) {
    throw new Error("Shot placement requires finite pivots and a positive source collision radius.");
  }
}

export function nativeEffectShotPlacement(caster: Point, target: Point, collisionRadius: number): NativeEffectShotPlacement {
  requireFinitePointsAndPositiveRadius([caster, target], collisionRadius);
  const forward = new Vector3(target[0] - caster[0], target[1] - caster[1], target[2] - caster[2]);
  const distance = forward.length();
  if (!Number.isFinite(distance) || distance <= 1e-9) throw new Error("Coincident actor pivots cannot define a shot direction.");
  forward.scaleInPlace(1 / distance);
  const horizontal = Math.hypot(forward.x, forward.z);
  const side = horizontal > 1e-12 ? new Vector3(-forward.z / horizontal, 0, forward.x / horizontal) : new Vector3(0, 0, 1);
  const up = Vector3.Cross(side, forward).normalize(), matrix = Matrix.Identity();
  Matrix.FromXYZAxesToRef(forward, up, side, matrix);
  const rotation = Quaternion.FromRotationMatrix(matrix).normalize();
  const position = Vector3.FromArray(target).subtract(forward.scale(collisionRadius / 2));
  return { policy: "presented-pivot-half-source-radius-v1",
    caster: [...caster], target: [...target],
    position: position.asArray() as [number, number, number], direction: forward.asArray() as [number, number, number],
    quaternion: rotation.asArray() as [number, number, number, number], collisionRadius, halfRadius: collisionRadius / 2,
    distance, nativeRuntimeLocationVerified: false, nativeRotationQuantizationVerified: false };
}

export function nativeEffectSelfTargetViewerPlacement(caster: Point, collisionRadius: number): NativeEffectShotPlacement {
  requireFinitePointsAndPositiveRadius([caster], collisionRadius);
  const halfRadius = collisionRadius / 2;
  return { policy: "pawnviewer-self-target-v1",
    caster: [...caster], target: [...caster],
    position: [caster[0] - sourceForwardAxis[0] * halfRadius, caster[1] - sourceForwardAxis[1] * halfRadius, caster[2] - sourceForwardAxis[2] * halfRadius],
    direction: [...sourceForwardAxis], quaternion: [...identityQuaternion], collisionRadius, halfRadius,
    distance: 0, nativeRuntimeLocationVerified: false, nativeRotationQuantizationVerified: false };
}
