import { crossProduct, dotProduct, float32Scaled, float32Vector, float32VectorSize, type Vector3 } from "../../../../shared/math/vector3";
import { moveActor, type MoveActorHit } from "./moveActor";
import type { MovementNativeRules } from "./movementRules";
import { pawnCylinderAt, safeNormal, slideAlongPlane, ZERO_VELOCITY, type PawnBody, type PawnPhysicsContext } from "./pawnBody";

export type CheckResultTimeAndNormal = Pick<MoveActorHit, "time" | "normal">;

const UNBLOCKED_CHECK_RESULT: CheckResultTimeAndNormal = { time: 1, normal: ZERO_VELOCITY };

const float32SizeSquared = (vector: Vector3) => Math.fround(dotProduct(vector, vector));

export function twoWallAdjust(desiredDirection: Vector3, delta: Vector3, hitNormal: Vector3, oldHitNormal: Vector3, hitTime: number,
  rules: MovementNativeRules): Vector3 {
  if (!(Math.fround(dotProduct(hitNormal, oldHitNormal)) > 0)) {
    const creaseDirection = safeNormal(float32Vector(crossProduct(hitNormal, oldHitNormal)), rules);
    const alongCrease = float32Scaled(creaseDirection, Math.fround((1 - hitTime) * Math.fround(dotProduct(delta, creaseDirection))));
    return Math.fround(dotProduct(desiredDirection, alongCrease)) < 0 ? float32Scaled(alongCrease, -1) : alongCrease;
  }
  const slide = slideAlongPlane(delta, hitNormal, hitTime);
  return Math.fround(dotProduct(desiredDirection, slide)) > 0 ? slide : ZERO_VELOCITY;
}

export function slideAlongSurface(context: PawnPhysicsContext, body: PawnBody, location: Vector3, desiredDirection: Vector3, delta: Vector3,
  slideNormal: Vector3, hitTime: number): Vector3 {
  const { world, rules, surroundings } = context;
  const slideDelta = slideAlongPlane(delta, slideNormal, hitTime);
  if (Math.fround(dotProduct(slideDelta, delta)) < 0) return location;
  const slide = moveActor(world, pawnCylinderAt(body, location), slideDelta, rules, surroundings);
  if (slide.hit === null) return slide.location;
  const adjustedDelta = twoWallAdjust(desiredDirection, slideDelta, slide.hit.normal, slideNormal, slide.hit.time, rules);
  return moveActor(world, pawnCylinderAt(body, slide.location), adjustedDelta, rules, surroundings).location;
}

export function stepUpPawn(context: PawnPhysicsContext, body: PawnBody, start: Vector3, gravityDirection: Vector3, desiredDirection: Vector3,
  delta: Vector3, hit: CheckResultTimeAndNormal): Vector3 {
  const { world, rules, surroundings } = context;
  const { maxStepHeight, maxStepSideZ, minFloorZ, stepUpRecursion } = rules.pawn;
  const stepDown = float32Scaled(gravityDirection, maxStepHeight);
  const moveFrom = (location: Vector3, moveDelta: Vector3) => moveActor(world, pawnCylinderAt(body, location), moveDelta, rules, surroundings);
  let location = start, currentHit = hit;
  if (Math.abs(hit.normal.z) < maxStepSideZ || hit.normal.z >= minFloorZ) {
    const lifted = moveFrom(start, float32Scaled(stepDown, -1)).location;
    const across = moveFrom(lifted, delta);
    location = across.location;
    currentHit = across.hit ?? UNBLOCKED_CHECK_RESULT;
  } else if (body.mode !== "walking") {
    const slopeRise = Math.fround(float32VectorSize(delta) * hit.normal.z);
    const upSlope = moveFrom(start, float32Vector({ x: delta.x, y: delta.y, z: delta.z + slopeRise }));
    location = upSlope.location;
    currentHit = upSlope.hit ?? UNBLOCKED_CHECK_RESULT;
  }
  if (currentHit.time < 1) {
    if (Math.abs(currentHit.normal.z) < maxStepSideZ && float32SizeSquared(delta) * currentHit.time > stepUpRecursion) {
      const down = moveFrom(location, stepDown);
      const downHit = down.hit ?? UNBLOCKED_CHECK_RESULT;
      return stepUpPawn(context, body, down.location, gravityDirection, desiredDirection, float32Scaled(delta, Math.fround(1 - downHit.time)), downHit);
    }
    const flattenedWallNormal = safeNormal({ x: currentHit.normal.x, y: currentHit.normal.y, z: 0 }, rules);
    location = slideAlongSurface(context, body, location, desiredDirection, delta, flattenedWallNormal, currentHit.time);
  }
  return moveFrom(location, stepDown).location;
}
