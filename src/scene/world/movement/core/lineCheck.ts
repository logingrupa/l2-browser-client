import { vectorLength, type Vector3 } from "../../../../shared/math/vector3";
import {
  float32Vector, isZeroExtent, pointAlongSweep, requireExtent, requireFiniteVector, requireSurroundings, sweepDelta, type CollisionHitSource,
  type CollisionPrimitive, type CollisionSurroundings, type CollisionSweep,
} from "./collisionTrace";
import type { CollisionWorld } from "./collisionWorld";
import { backoffDistance, type MovementNativeRules } from "./movementRules";
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
  const testLength = vectorLength(sweepDelta(sweep));
  if (testLength === 0) return null;
  const zeroExtent = isZeroExtent(sweep.extent);
  let best: WorldSweepHit | null = null;
  for (const resident of residentPrimitives(world, surroundings, rules)) {
    const hit = resident.trace(sweep);
    if (hit === null) continue;
    const backoff = zeroExtent ? resident.rayBackoff : resident.boxBackoff;
    const time = Math.max(0, hit.time - backoffDistance(backoff, testLength) / testLength);
    if (best === null || time < best.time) best = { time, normal: hit.normal, primitive: hit.primitive, source: resident.source };
  }
  return best;
}

export function singleLineCheck(world: CollisionWorld, query: LineCheckQuery, rules: MovementNativeRules): LineCheckHit | null {
  const sweep: CollisionSweep = { start: query.start, end: query.end, extent: query.extent };
  const hit = traceCollisionWorld(world, sweep, query, rules);
  if (hit === null) return null;
  return {
    time: Math.fround(hit.time), normal: float32Vector(hit.normal), primitive: hit.primitive, source: hit.source,
    location: float32Vector(pointAlongSweep(sweep, hit.time)),
  };
}
