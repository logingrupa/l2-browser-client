import { addVectors, scaleVector, vectorLength, type Vector3 } from "../../../../shared/math/vector3";
import { float32Vector, requireFiniteVector, type CollisionHitSource, type CollisionPrimitive, type CollisionSurroundings } from "./collisionTrace";
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

const isNearZeroDelta = (delta: Vector3, rules: MovementNativeRules) =>
  Math.abs(delta.x) < rules.nearZeroDelta && Math.abs(delta.y) < rules.nearZeroDelta && Math.abs(delta.z) < rules.nearZeroDelta;

export function moveActor(world: CollisionWorld, actor: MovingActor, delta: Vector3, rules: MovementNativeRules,
  surroundings: CollisionSurroundings = {}): MoveActorResult {
  requireFiniteVector(actor.location, "A moving actor location");
  requireFiniteVector(delta, "A move delta");
  const roundedDelta = float32Vector(delta);
  const fullMove: MoveActorResult = { location: float32Vector(addVectors(actor.location, roundedDelta)), hit: null };
  if (isNearZeroDelta(roundedDelta, rules)) return fullMove;
  const moveLength = vectorLength(roundedDelta), testLength = moveLength + rules.moveActorExtension;
  const sweep = {
    start: actor.location,
    end: addVectors(actor.location, scaleVector(roundedDelta, testLength / moveLength)),
    extent: { x: actor.collisionRadius, y: actor.collisionRadius, z: actor.collisionHeight },
  };
  const sweepHit = traceCollisionWorld(world, sweep, surroundings, rules);
  if (sweepHit === null) return fullMove;
  const hitDistance = sweepHit.time * testLength;
  const time = hitDistance > rules.moveActorExtension ? (hitDistance - rules.moveActorExtension) / moveLength : 0;
  if (time > 1) return fullMove;
  return {
    location: float32Vector(addVectors(actor.location, scaleVector(roundedDelta, time))),
    hit: { time: Math.fround(time), normal: float32Vector(sweepHit.normal), primitive: sweepHit.primitive, source: sweepHit.source },
  };
}
