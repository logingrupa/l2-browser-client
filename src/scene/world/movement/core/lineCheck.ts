import { float32Vector, float32VectorSize, type Vector3 } from "../../../../shared/math/vector3";
import {
  float32PointAlongSweep, float32SweepDelta, isZeroExtent, requireExtent, requireFiniteVector, requireSurroundings,
  type CollisionHitSource, type CollisionPrimitive, type CollisionSurroundings, type CollisionSweep,
} from "./collisionTrace";
import type { CollisionWorld } from "./collisionWorld";
import { hitTimeAfterBackoff, type MovementNativeRules } from "./movementRules";
import { residentPrimitives } from "./residentPrimitives";

export interface WorldSweepHit {
  readonly time: number;
  readonly normal: Vector3;
  readonly primitive: CollisionPrimitive;
  readonly source: CollisionHitSource;
}

export interface LineCheckQuery extends CollisionSurroundings {
  readonly start: Vector3;
  readonly end: Vector3;
  readonly extent: Vector3;
}

export interface LineCheckHit extends WorldSweepHit {
  readonly location: Vector3;
}

export function traceCollisionWorld(world: CollisionWorld, sweep: CollisionSweep, surroundings: CollisionSurroundings,
  rules: MovementNativeRules): WorldSweepHit | null {
  requireFiniteVector(sweep.start, "A sweep start");
  requireFiniteVector(sweep.end, "A sweep end");
  requireExtent(sweep.extent, "A sweep extent");
  requireSurroundings(surroundings);
  const traceLength = float32VectorSize(float32SweepDelta(sweep));
  if (traceLength === 0) return null;
  const zeroExtent = isZeroExtent(sweep.extent);
  let best: WorldSweepHit | null = null;
  for (const resident of residentPrimitives(world, surroundings, rules)) {
    const hit = resident.trace(sweep);
    if (hit === null) continue;
    const time = hitTimeAfterBackoff(zeroExtent ? resident.rayBackoff : resident.boxBackoff, hit.time, traceLength);
    if (best === null || time < best.time) best = { time, normal: hit.normal, primitive: hit.primitive, source: resident.source };
  }
  return best;
}

export function singleLineCheck(world: CollisionWorld, query: LineCheckQuery, rules: MovementNativeRules): LineCheckHit | null {
  const sweep: CollisionSweep = { start: float32Vector(query.start), end: float32Vector(query.end), extent: float32Vector(query.extent) };
  const hit = traceCollisionWorld(world, sweep, query, rules);
  if (hit === null) return null;
  return {
    time: hit.time, normal: float32Vector(hit.normal), primitive: hit.primitive, source: hit.source,
    location: float32PointAlongSweep(sweep, hit.time),
  };
}
