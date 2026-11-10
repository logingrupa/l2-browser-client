import { float32Difference, float32Scaled, float32Sum, float32Vector, float32VectorSize, type Vector3 } from "../../../../shared/math/vector3";
import { requireFiniteVector, ZERO_VECTOR, type CollisionHitSource, type CollisionPrimitive, type CollisionSurroundings } from "./collisionTrace";
import type { CollisionWorld } from "./collisionWorld";
import { traceCollisionWorld } from "./lineCheck";
import type { MovementNativeRules } from "./movementRules";

export interface MovingActor {
  readonly location: Vector3;
  readonly collisionRadius: number;
  readonly collisionHeight: number;
}

export interface MoveActorHit {
  readonly time: number;
  readonly normal: Vector3;
  readonly primitive: CollisionPrimitive;
  readonly source: CollisionHitSource;
}

export interface MoveActorResult {
  readonly location: Vector3;
  readonly hit: MoveActorHit | null;
}

const isNearlyZero = (delta: Vector3, rules: MovementNativeRules) =>
  Math.abs(delta.x) < rules.nearZeroDelta && Math.abs(delta.y) < rules.nearZeroDelta && Math.abs(delta.z) < rules.nearZeroDelta;

export function moveActor(world: CollisionWorld, actor: MovingActor, delta: Vector3, rules: MovementNativeRules,
  surroundings: CollisionSurroundings = {}): MoveActorResult {
  requireFiniteVector(actor.location, "A moving actor location");
  requireFiniteVector(delta, "A move delta");
  const location = float32Vector(actor.location), moveDelta = float32Vector(delta);
  const fullMove: MoveActorResult = { location: float32Sum(location, moveDelta), hit: null };
  if (isNearlyZero(moveDelta, rules)) return fullMove;
  const deltaSize = float32VectorSize(moveDelta);
  if (deltaSize === 0) return fullMove;
  const extension = rules.moveActorExtension;
  const extensionAlongMove = float32Scaled(float32Scaled(moveDelta, Math.fround(1 / deltaSize)), extension);
  const extendedDelta = float32Sum(extensionAlongMove, moveDelta);
  const sweep = {
    start: location,
    end: float32Sum(location, extendedDelta),
    extent: float32Vector({ x: actor.collisionRadius, y: actor.collisionRadius, z: actor.collisionHeight }),
  };
  const sweepHit = traceCollisionWorld(world, sweep, surroundings, rules);
  if (sweepHit === null || !(sweepHit.time < 1)) return fullMove;
  const hitDistance = Math.fround((extension + deltaSize) * sweepHit.time);
  const movesPastExtension = hitDistance > extension;
  const movedDelta = movesPastExtension ? float32Difference(float32Scaled(extendedDelta, sweepHit.time), extensionAlongMove) : ZERO_VECTOR;
  const time = movesPastExtension ? Math.fround((hitDistance - extension) / deltaSize) : 0;
  return {
    location: float32Sum(location, movedDelta),
    hit: { time, normal: float32Vector(sweepHit.normal), primitive: sweepHit.primitive, source: sweepHit.source },
  };
}
