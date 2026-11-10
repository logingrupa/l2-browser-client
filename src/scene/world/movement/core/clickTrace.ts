import { float32Scaled, float32Sum, float32Vector, type Vector3 } from "../../../../shared/math/vector3";
import { requireFiniteVector, type CollisionSurroundings } from "./collisionTrace";
import { CollisionWorldError, type CollisionWorld } from "./collisionWorld";
import { singleLineCheck } from "./lineCheck";
import type { MovementNativeRules } from "./movementRules";

export interface ClickRay {
  readonly origin: Vector3;
  readonly direction: Vector3;
  readonly loadedBoundsLength: number;
  readonly swimsOrFlies: boolean;
}

const zeroExtent: Vector3 = { x: 0, y: 0, z: 0 };

export function traceClickDestination(world: CollisionWorld, ray: ClickRay, rules: MovementNativeRules, surroundings: CollisionSurroundings = {}): Vector3 | null {
  requireFiniteVector(ray.origin, "A click ray origin");
  requireFiniteVector(ray.direction, "A click ray direction");
  const directionLength = Math.hypot(ray.direction.x, ray.direction.y, ray.direction.z);
  if (directionLength === 0) throw new CollisionWorldError("A click ray direction must not be zero.");
  const length = ray.swimsOrFlies ? rules.clickPickLength : ray.loadedBoundsLength;
  if (!Number.isFinite(length) || length <= 0) throw new CollisionWorldError(`A click ray length ${length} must be positive.`);
  const origin = float32Vector(ray.origin);
  const end = float32Sum(origin, float32Scaled(ray.direction, length / directionLength));
  const hit = singleLineCheck(world, { start: origin, end, extent: zeroExtent, ...surroundings }, rules);
  if (hit !== null) return hit.location;
  return ray.swimsOrFlies ? end : null;
}
