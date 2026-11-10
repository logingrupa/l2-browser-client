import { rotatorSineFromTable } from "../../../../shared/math/rotator";
import { dotProduct, float32Difference, float32Scaled, float32Vector, type Vector3 } from "../../../../shared/math/vector3";
import { requireFiniteVector } from "./collisionTrace";
import { CollisionWorldError, type CollisionWorld } from "./collisionWorld";
import { singleLineCheck } from "./lineCheck";
import type { MovementNativeRules } from "./movementRules";

export interface BehindViewQuery {
  readonly pivot: Vector3;
  readonly pitch: number;
  readonly yaw: number;
  readonly zoomDistance: number;
}

export interface BehindView {
  readonly location: Vector3;
  readonly distance: number;
  readonly hitDistance: number | null;
}

const rotatorUnitsPerQuarterTurn = 16384;

const rotatorCosineFromTable = (rotatorUnits: number) => rotatorSineFromTable(rotatorUnits + rotatorUnitsPerQuarterTurn);

function viewDirection(pitch: number, yaw: number): Vector3 {
  const pitchCosine = rotatorCosineFromTable(pitch);
  return float32Vector({ x: pitchCosine * rotatorCosineFromTable(yaw), y: pitchCosine * rotatorSineFromTable(yaw), z: rotatorSineFromTable(pitch) });
}

function requireBehindViewQuery(query: BehindViewQuery): void {
  requireFiniteVector(query.pivot, "A behind view pivot");
  if (!Number.isInteger(query.pitch) || !Number.isInteger(query.yaw)) throw new CollisionWorldError("A behind view needs integer rotator pitch and yaw.");
  if (!Number.isFinite(query.zoomDistance)) throw new CollisionWorldError("A behind view needs a finite zoom distance.");
}

export function calculateBehindView(world: CollisionWorld, query: BehindViewQuery, rules: MovementNativeRules): BehindView {
  requireBehindViewQuery(query);
  const { zoomOffset, traceExtent, wallMargin, traceDrop } = rules.camera;
  const pivot = float32Vector(query.pivot);
  const direction = viewDirection(query.pitch, query.yaw);
  const fullDistance = Math.fround(query.zoomDistance + zoomOffset);
  const behindPivot = float32Difference(pivot, float32Scaled(direction, fullDistance + wallMargin));
  const traceEnd = float32Vector({ x: behindPivot.x, y: behindPivot.y, z: behindPivot.z - traceDrop });
  const hit = singleLineCheck(world, { start: pivot, end: traceEnd, extent: { x: traceExtent, y: traceExtent, z: traceExtent } }, rules);
  const hitDistance = hit === null ? null : Math.fround(dotProduct(float32Difference(pivot, hit.location), direction));
  const distance = hitDistance === null ? fullDistance : Math.min(fullDistance, hitDistance);
  return { location: float32Difference(pivot, float32Scaled(direction, distance - wallMargin)), distance, hitDistance };
}
