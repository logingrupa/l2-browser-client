import { dotProduct, float32Vector, type Vector3 } from "../../../../shared/math/vector3";
import type { CollisionPrimitive, CollisionSurroundings } from "./collisionTrace";
import type { CollisionWorld } from "./collisionWorld";
import type { MoveActorHit, MovingActor } from "./moveActor";
import type { MovementNativeRules } from "./movementRules";

export type PawnPhysicsMode = "walking" | "falling";

export interface PawnBody {
  readonly location: Vector3;
  readonly velocity: Vector3;
  readonly collisionRadius: number;
  readonly collisionHeight: number;
  readonly mode: PawnPhysicsMode;
  readonly floor: CollisionPrimitive | null;
  readonly restsInFloorBand: boolean;
}

export interface PawnPhysicsContext {
  readonly world: CollisionWorld;
  readonly rules: MovementNativeRules;
  readonly surroundings: CollisionSurroundings;
}

export interface PawnStepResult {
  readonly body: PawnBody;
  readonly unusedSeconds: number;
}

export interface PawnMoveOutcome {
  readonly location: Vector3;
  readonly hit: MoveActorHit | null;
}

export const ZERO_VELOCITY: Vector3 = { x: 0, y: 0, z: 0 };

export const pawnCylinderAt = (body: PawnBody, location: Vector3): MovingActor => ({
  location, collisionRadius: body.collisionRadius, collisionHeight: body.collisionHeight,
});

export const pawnExtent = (body: PawnBody): Vector3 => float32Vector({ x: body.collisionRadius, y: body.collisionRadius, z: body.collisionHeight });

export const horizontalLength = (vector: Vector3) => Math.hypot(vector.x, vector.y);

export const isWalkableFloorNormal = (normal: Vector3, rules: MovementNativeRules) => normal.z >= rules.pawn.minFloorZ;

export function horizontalDirection(vector: Vector3): Vector3 {
  const length = horizontalLength(vector);
  return length === 0 ? ZERO_VELOCITY : { x: vector.x / length, y: vector.y / length, z: 0 };
}

export function velocityFromDisplacement(start: Vector3, end: Vector3, seconds: number): Vector3 {
  return float32Vector({ x: (end.x - start.x) / seconds, y: (end.y - start.y) / seconds, z: (end.z - start.z) / seconds });
}

export function slideAlongPlane(delta: Vector3, normal: Vector3, remainingFraction: number): Vector3 {
  const intoPlane = dotProduct(delta, normal);
  return float32Vector({
    x: (delta.x - normal.x * intoPlane) * remainingFraction, y: (delta.y - normal.y * intoPlane) * remainingFraction, z: (delta.z - normal.z * intoPlane) * remainingFraction,
  });
}
