import { dotProduct, float32Difference, float32Scaled, float32Vector, type Vector3 } from "../../../../shared/math/vector3";
import type { CollisionPrimitive, CollisionSurroundings } from "./collisionTrace";
import type { CollisionWorld } from "./collisionWorld";
import type { MovingActor } from "./moveActor";
import type { MovementNativeRules } from "./movementRules";
import { governingPhysicsVolume, volumesContaining } from "./volumeContainment";

export type PawnPhysicsMode = "walking" | "falling" | "swimming" | "flying";

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

export const ZERO_VELOCITY: Vector3 = { x: 0, y: 0, z: 0 };

export const pawnCylinderAt = (body: PawnBody, location: Vector3): MovingActor => ({
  location, collisionRadius: body.collisionRadius, collisionHeight: body.collisionHeight,
});

export const pawnExtent = (body: PawnBody): Vector3 => float32Vector({ x: body.collisionRadius, y: body.collisionRadius, z: body.collisionHeight });

export const horizontalLength = (vector: Vector3) => Math.hypot(vector.x, vector.y);

export const isWalkableFloorNormal = (normal: Vector3, rules: MovementNativeRules) => normal.z >= rules.pawn.minFloorZ;

export function physicsVolumeGravityDirection(rules: MovementNativeRules): Vector3 {
  return { x: 0, y: 0, z: rules.pawn.volumeGravity > 0 ? 1 : -1 };
}

export function safeNormal(vector: Vector3, rules: MovementNativeRules): Vector3 {
  const squareSum = Math.fround(vector.x * vector.x + vector.y * vector.y + vector.z * vector.z);
  if (squareSum < rules.pawn.safeNormalSquareSumMinimum) return ZERO_VELOCITY;
  return float32Scaled(vector, Math.fround(1 / Math.fround(Math.sqrt(squareSum))));
}

export function horizontalDirection(vector: Vector3): Vector3 {
  const length = horizontalLength(vector);
  return length === 0 ? ZERO_VELOCITY : { x: vector.x / length, y: vector.y / length, z: 0 };
}

export function velocityFromDisplacement(start: Vector3, end: Vector3, seconds: number): Vector3 {
  return float32Scaled(float32Difference(end, start), Math.fround(1 / seconds));
}

export function isPawnInWater(context: PawnPhysicsContext, location: Vector3): boolean {
  const waterlinePoint = { x: location.x, y: location.y, z: location.z + context.rules.pawn.waterlineProbe };
  return governingPhysicsVolume(volumesContaining(context.world, waterlinePoint, context.rules))?.volume.water === true;
}

export function slideAlongPlane(delta: Vector3, normal: Vector3, hitTime: number): Vector3 {
  const intoPlane = Math.fround(dotProduct(delta, normal));
  return float32Scaled(float32Difference(delta, float32Scaled(normal, intoPlane)), Math.fround(1 - hitTime));
}
