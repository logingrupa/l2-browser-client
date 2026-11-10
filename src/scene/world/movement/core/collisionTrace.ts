import { addVectors, scaleVector, subtractVectors, type Vector3 } from "../../../../shared/math/vector3";
import type { CollisionMoverSource } from "./collisionCell";
import { CollisionWorldError } from "./collisionWorld";

export type CollisionPrimitive =
  | { readonly kind: "bsp-tree"; readonly tileId: string }
  | { readonly kind: "volume"; readonly cellId: string; readonly volumeIndex: number; readonly exportIndex: number }
  | { readonly kind: "static-mesh"; readonly cellId: string; readonly placementIndex: number; readonly exportIndex: number }
  | { readonly kind: "mover"; readonly cellId: string; readonly moverIndex: number; readonly exportIndex: number }
  | { readonly kind: "terrain"; readonly cellId: string; readonly quadIndex: number }
  | { readonly kind: "pawn"; readonly pawnIndex: number };

export type CollisionHitSource =
  | "bsp-collision-tree" | "blocking-volume" | "static-mesh-slots" | CollisionMoverSource | "terrain-heightmap" | "pawn-cylinder";

export interface CollisionSweep {
  readonly start: Vector3;
  readonly end: Vector3;
  readonly extent: Vector3;
}

export interface PrimitiveSweepHit {
  readonly time: number;
  readonly normal: Vector3;
}

export interface PawnCylinder {
  readonly location: Vector3;
  readonly collisionRadius: number;
  readonly collisionHeight: number;
}

export type MoverCollisionState = "closed" | "open";

export interface CollisionSurroundings {
  readonly pawns?: readonly PawnCylinder[];
  readonly moverStates?: ReadonlyMap<number, MoverCollisionState>;
}

export interface PointBounds {
  readonly minimum: Vector3;
  readonly maximum: Vector3;
}

export const ZERO_VECTOR: Vector3 = { x: 0, y: 0, z: 0 };

export const UNIT_AXES: readonly Vector3[] = [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }];

export function boundsOfPoints(points: readonly Vector3[]): PointBounds {
  const minimum = { x: Infinity, y: Infinity, z: Infinity }, maximum = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const point of points) {
    minimum.x = Math.min(minimum.x, point.x);
    minimum.y = Math.min(minimum.y, point.y);
    minimum.z = Math.min(minimum.z, point.z);
    maximum.x = Math.max(maximum.x, point.x);
    maximum.y = Math.max(maximum.y, point.y);
    maximum.z = Math.max(maximum.z, point.z);
  }
  return { minimum, maximum };
}

export const isZeroExtent = (extent: Vector3) => extent.x === 0 && extent.y === 0 && extent.z === 0;

export const boxSupportAlongNormal = (normal: Vector3, extent: Vector3) =>
  Math.abs(normal.x * extent.x) + Math.abs(normal.y * extent.y) + Math.abs(normal.z * extent.z);

export const sweepDelta = (sweep: CollisionSweep) => subtractVectors(sweep.end, sweep.start);

export const pointAlongSweep = (sweep: CollisionSweep, time: number) => addVectors(sweep.start, scaleVector(sweepDelta(sweep), time));

export const negateVector = (vector: Vector3): Vector3 => ({ x: 0 - vector.x, y: 0 - vector.y, z: 0 - vector.z });

export const float32Vector = (vector: Vector3): Vector3 => ({ x: Math.fround(vector.x), y: Math.fround(vector.y), z: Math.fround(vector.z) });

const isFiniteVector = (vector: Vector3) => Number.isFinite(vector.x) && Number.isFinite(vector.y) && Number.isFinite(vector.z);

export function requireFiniteVector(vector: Vector3, label: string): void {
  if (!isFiniteVector(vector)) throw new CollisionWorldError(`${label} must hold finite source units.`);
}

export function requireExtent(extent: Vector3, label: string): void {
  requireFiniteVector(extent, label);
  if (extent.x < 0 || extent.y < 0 || extent.z < 0) throw new CollisionWorldError(`${label} must not be negative.`);
}

export function requireSurroundings(surroundings: CollisionSurroundings): void {
  (surroundings.pawns ?? []).forEach((pawn, pawnIndex) => {
    requireFiniteVector(pawn.location, `pawn ${pawnIndex} location`);
    if (!(pawn.collisionRadius >= 0) || !(pawn.collisionHeight >= 0) || !Number.isFinite(pawn.collisionRadius) || !Number.isFinite(pawn.collisionHeight)) {
      throw new CollisionWorldError(`pawn ${pawnIndex} needs a finite, non-negative collision radius and height.`);
    }
  });
}
