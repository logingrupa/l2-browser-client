import type { Vector3 } from "../../../../shared/math/vector3";
import {
  requireExtent, requireFiniteVector, requireSurroundings, type CollisionHitSource, type CollisionPrimitive, type CollisionSurroundings,
} from "./collisionTrace";
import type { CollisionWorld } from "./collisionWorld";
import type { MovementNativeRules } from "./movementRules";
import { residentPrimitives } from "./residentPrimitives";

export interface PointCheckQuery extends CollisionSurroundings {
  readonly point: Vector3;
  readonly extent: Vector3;
}

export interface PointCheckHit {
  readonly primitive: CollisionPrimitive;
  readonly source: CollisionHitSource;
}

export function pointCheck(world: CollisionWorld, query: PointCheckQuery, rules: MovementNativeRules): PointCheckHit | null {
  requireFiniteVector(query.point, "A point check point");
  requireExtent(query.extent, "A point check extent");
  requireSurroundings(query);
  for (const resident of residentPrimitives(world, query, rules)) {
    const primitive = resident.overlappedBy(query.point, query.extent);
    if (primitive !== null) return { primitive, source: resident.source };
  }
  return null;
}
