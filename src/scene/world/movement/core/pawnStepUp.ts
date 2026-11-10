import { crossProduct, dotProduct, float32Scaled, type Vector3 } from "../../../../shared/math/vector3";
import { moveActor, type MoveActorHit } from "./moveActor";
import { horizontalDirection, pawnCylinderAt, slideAlongPlane, ZERO_VELOCITY, type PawnBody, type PawnPhysicsContext } from "./pawnBody";

const squaredLength = (vector: Vector3) => dotProduct(vector, vector);

export function twoWallAdjust(desiredDirection: Vector3, delta: Vector3, newNormal: Vector3, oldNormal: Vector3, hitTime: number): Vector3 {
  if (dotProduct(oldNormal, newNormal) <= 0) {
    const crease = crossProduct(newNormal, oldNormal);
    const creaseLength = Math.sqrt(squaredLength(crease));
    if (creaseLength === 0) return ZERO_VELOCITY;
    const creaseDirection = { x: crease.x / creaseLength, y: crease.y / creaseLength, z: crease.z / creaseLength };
    const alongCrease = float32Scaled(creaseDirection, dotProduct(delta, creaseDirection) * (1 - hitTime));
    return dotProduct(alongCrease, desiredDirection) < 0 ? float32Scaled(alongCrease, -1) : alongCrease;
  }
  const slide = slideAlongPlane(delta, newNormal, 1 - hitTime);
  return dotProduct(slide, desiredDirection) > 0 ? slide : ZERO_VELOCITY;
}

export function slideAlongSurface(context: PawnPhysicsContext, body: PawnBody, location: Vector3, desiredDirection: Vector3, delta: Vector3,
  slideNormal: Vector3, wallHit: MoveActorHit): Vector3 {
  const { world, rules, surroundings } = context;
  const slideDelta = slideAlongPlane(delta, slideNormal, 1 - wallHit.time);
  if (dotProduct(slideDelta, desiredDirection) < 0) return location;
  const slide = moveActor(world, pawnCylinderAt(body, location), slideDelta, rules, surroundings);
  if (slide.hit === null) return slide.location;
  const adjustedDelta = twoWallAdjust(desiredDirection, slideDelta, slide.hit.normal, wallHit.normal, slide.hit.time);
  return moveActor(world, pawnCylinderAt(body, slide.location), adjustedDelta, rules, surroundings).location;
}

export function stepUpPawn(context: PawnPhysicsContext, body: PawnBody, start: Vector3, desiredDirection: Vector3, delta: Vector3, hit: MoveActorHit): Vector3 {
  const { world, rules, surroundings } = context;
  const { maxStepHeight, maxStepSideZ, minFloorZ, stepUpWallZ, stepUpRecursion } = rules.pawn;
  const stepDown = { x: 0, y: 0, z: -maxStepHeight };
  const moveFrom = (location: Vector3, moveDelta: Vector3) => moveActor(world, pawnCylinderAt(body, location), moveDelta, rules, surroundings);
  const isStepFace = Math.abs(hit.normal.z) < maxStepSideZ || hit.normal.z >= minFloorZ;
  let location = start, currentHit: MoveActorHit | null = hit;
  if (isStepFace) {
    const lifted = moveFrom(start, { x: 0, y: 0, z: maxStepHeight }).location;
    const across = moveFrom(lifted, delta);
    location = across.location;
    currentHit = across.hit;
  }
  if (currentHit !== null && currentHit.time < 1) {
    if (Math.abs(currentHit.normal.z) < stepUpWallZ && squaredLength(delta) * currentHit.time > stepUpRecursion) {
      const down = moveFrom(location, stepDown);
      if (down.hit === null) return down.location;
      return stepUpPawn(context, body, down.location, desiredDirection, float32Scaled(delta, 1 - down.hit.time), down.hit);
    }
    location = slideAlongSurface(context, body, location, desiredDirection, delta, horizontalDirection(currentHit.normal), currentHit);
  }
  return moveFrom(location, stepDown).location;
}
