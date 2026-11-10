import { float32Vector, type Vector3 } from "../../../../shared/math/vector3";
import type { CollisionPrimitive } from "./collisionTrace";
import { singleLineCheck, type LineCheckHit } from "./lineCheck";
import { moveActor } from "./moveActor";
import {
  horizontalLength, isWalkableFloorNormal, pawnCylinderAt, pawnExtent, ZERO_VELOCITY,
  type PawnBody, type PawnPhysicsContext, type PawnStepResult,
} from "./pawnBody";

interface FloorSettlement {
  readonly location: Vector3;
  readonly isInFloorBand: boolean;
}

const sameFloor = (previous: CollisionPrimitive | null, next: CollisionPrimitive) => previous !== null && JSON.stringify(previous) === JSON.stringify(next);

function probeFloor(context: PawnPhysicsContext, body: PawnBody, location: Vector3): LineCheckHit | null {
  const probeLength = context.rules.pawn.floorProbe;
  return singleLineCheck(context.world, {
    start: location, end: { x: location.x, y: location.y, z: location.z - probeLength }, extent: pawnExtent(body), ...context.surroundings,
  }, context.rules);
}

function moveVertically(context: PawnPhysicsContext, body: PawnBody, location: Vector3, distance: number): Vector3 {
  return moveActor(context.world, pawnCylinderAt(body, location), { x: 0, y: 0, z: distance }, context.rules, context.surroundings).location;
}

function settleIntoFloorBand(context: PawnPhysicsContext, body: PawnBody, location: Vector3, floorHit: LineCheckHit): FloorSettlement {
  const { floorProbe, floorBand } = context.rules.pawn;
  const gap = floorProbe * floorHit.time;
  const isOutsideBand = gap > floorBand.maximum || (gap > 0 && gap < floorBand.minimum);
  if (isOutsideBand) return { location: moveVertically(context, body, location, floorBand.target - gap), isInFloorBand: false };
  return { location, isInFloorBand: gap >= floorBand.minimum };
}

function steepSlideDelta(normal: Vector3, slideDistance: number): Vector3 {
  return float32Vector({
    x: slideDistance * normal.z * normal.x, y: slideDistance * normal.z * normal.y, z: -slideDistance * (1 - normal.z * normal.z),
  });
}

function walkingBody(body: PawnBody, location: Vector3, floor: CollisionPrimitive, restsInFloorBand: boolean): PawnBody {
  return { ...body, location, mode: "walking", floor, restsInFloorBand };
}

function walkSubstep(context: PawnPhysicsContext, body: PawnBody, velocity: Vector3, tickSeconds: number): PawnStepResult {
  if (body.restsInFloorBand && velocity.x === 0 && velocity.y === 0) return { body: { ...body, velocity: ZERO_VELOCITY }, unusedSeconds: 0 };
  const { world, rules, surroundings } = context;
  const start = body.location;
  const desiredDelta = float32Vector({ x: velocity.x * tickSeconds, y: velocity.y * tickSeconds, z: 0 });
  let location = moveActor(world, pawnCylinderAt(body, start), desiredDelta, rules, surroundings).location;
  const floorHit = probeFloor(context, body, location);
  if (floorHit !== null && isWalkableFloorNormal(floorHit.normal, rules)) {
    const settlement = settleIntoFloorBand(context, body, location, floorHit);
    return { body: walkingBody(body, settlement.location, floorHit.primitive, settlement.isInFloorBand && sameFloor(body.floor, floorHit.primitive)), unusedSeconds: 0 };
  }
  if (floorHit !== null && desiredDelta.x * floorHit.normal.x + desiredDelta.y * floorHit.normal.y < 0) {
    const slide = moveActor(world, pawnCylinderAt(body, location), steepSlideDelta(floorHit.normal, rules.pawn.steepSlide), rules, surroundings);
    location = slide.location;
    if (slide.hit !== null && isWalkableFloorNormal(slide.hit.normal, rules)) return { body: walkingBody(body, location, slide.hit.primitive, false), unusedSeconds: 0 };
  }
  const desiredLength = horizontalLength(desiredDelta);
  const walkedLength = horizontalLength({ x: location.x - start.x, y: location.y - start.y, z: 0 });
  const unusedSeconds = desiredLength === 0 ? tickSeconds : tickSeconds * (1 - Math.min(1, walkedLength / desiredLength));
  const fallingBody: PawnBody = { ...body, location, velocity: { x: velocity.x, y: velocity.y, z: 0 }, mode: "falling", floor: null, restsInFloorBand: false };
  return { body: fallingBody, unusedSeconds };
}

export function walkPawn(context: PawnPhysicsContext, body: PawnBody, velocity: Vector3, tickSeconds: number, splitsIntoSubsteps: boolean): PawnStepResult {
  const { maximumTick } = context.rules.pawn.substeps;
  const start = body.location;
  let current = body, remainingSeconds = tickSeconds;
  while (remainingSeconds > 0) {
    const substepSeconds = splitsIntoSubsteps && remainingSeconds > maximumTick ? Math.min(maximumTick, remainingSeconds / 2) : remainingSeconds;
    const step = walkSubstep(context, current, velocity, substepSeconds);
    remainingSeconds -= substepSeconds;
    if (step.body.mode !== "walking") return { body: step.body, unusedSeconds: step.unusedSeconds + remainingSeconds };
    current = step.body;
  }
  const walkedVelocity = float32Vector({ x: (current.location.x - start.x) / tickSeconds, y: (current.location.y - start.y) / tickSeconds, z: 0 });
  return { body: { ...current, velocity: walkedVelocity }, unusedSeconds: 0 };
}
