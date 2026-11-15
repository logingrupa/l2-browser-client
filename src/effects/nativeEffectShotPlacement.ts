import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";

type Point = readonly [number, number, number];

/** Source-qualified single-target formula on presented actor pivots in metres.
 * Native Rotation quantization/runtime state are not recreated. +X is forward;
 * no-roll yaw/pitch is a named modern orientation policy in the XZY frame. */
export function nativeEffectShotPlacement(caster: Point, target: Point, collisionRadius: number) {
  if (![...caster, ...target, collisionRadius].every(Number.isFinite) || collisionRadius <= 0) {
    throw new Error("Shot placement requires finite pivots and a positive source collision radius.");
  }
  const forward = new Vector3(target[0] - caster[0], target[1] - caster[1], target[2] - caster[2]);
  const distance = forward.length();
  if (!Number.isFinite(distance) || distance <= 1e-9) throw new Error("Coincident actor pivots cannot define a shot direction.");
  forward.scaleInPlace(1 / distance);
  const horizontal = Math.hypot(forward.x, forward.z);
  // At the vertical pole yaw is explicitly zero, matching the limit from +X.
  const side = horizontal > 1e-12 ? new Vector3(-forward.z / horizontal, 0, forward.x / horizontal) : new Vector3(0, 0, 1);
  const up = Vector3.Cross(side, forward).normalize(), matrix = Matrix.Identity();
  Matrix.FromXYZAxesToRef(forward, up, side, matrix);
  const rotation = Quaternion.FromRotationMatrix(matrix).normalize();
  const position = Vector3.FromArray(target).subtract(forward.scale(collisionRadius / 2));
  return { policy: "presented-pivot-half-source-radius-v1" as const,
    caster: [...caster] as [number, number, number], target: [...target] as [number, number, number],
    position: position.asArray() as [number, number, number], direction: forward.asArray() as [number, number, number],
    quaternion: rotation.asArray() as [number, number, number, number], collisionRadius, halfRadius: collisionRadius / 2,
    distance, nativeRuntimeLocationVerified: false, nativeRotationQuantizationVerified: false };
}
