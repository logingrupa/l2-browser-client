import { float32Vector, type Vector3 } from "../../../../shared/math/vector3";
import { moveActor } from "./moveActor";
import {
  horizontalLength, isPawnInWater, isWalkableFloorNormal, pawnCylinderAt, safeNormal, velocityFromDisplacement,
  type PawnBody, type PawnPhysicsContext, type PawnStepResult,
} from "./pawnBody";
import { slideAlongSurface } from "./pawnStepUp";

function waterEntryVelocity(velocity: Vector3, context: PawnPhysicsContext): Vector3 {
  const { speed, horizontalFactor, threshold } = context.rules.pawn.waterEntry;
  const slowsOnEntry = velocity.z < 0 && velocity.z > threshold;
  return slowsOnEntry ? float32Vector({ ...velocity, z: speed - horizontalFactor * horizontalLength(velocity) }) : velocity;
}

export function fallPawn(context: PawnPhysicsContext, body: PawnBody, tickSeconds: number): PawnStepResult {
  const { world, rules, surroundings } = context;
  const previousVelocity = body.velocity;
  const nextVelocity = float32Vector({
    x: previousVelocity.x, y: previousVelocity.y, z: Math.max(-rules.pawn.terminalVelocity, previousVelocity.z + rules.pawn.volumeGravity * tickSeconds),
  });
  const delta = float32Vector({
    x: (previousVelocity.x + nextVelocity.x) * tickSeconds / 2, y: (previousVelocity.y + nextVelocity.y) * tickSeconds / 2,
    z: (previousVelocity.z + nextVelocity.z) * tickSeconds / 2,
  });
  const fall = moveActor(world, pawnCylinderAt(body, body.location), delta, rules, surroundings);
  if (isPawnInWater(context, fall.location)) {
    return { body: { ...body, location: fall.location, velocity: waterEntryVelocity(nextVelocity, context), mode: "swimming", floor: null }, unusedSeconds: 0 };
  }
  if (fall.hit === null) return { body: { ...body, location: fall.location, velocity: nextVelocity }, unusedSeconds: 0 };
  if (isWalkableFloorNormal(fall.hit.normal, rules)) {
    const landedBody: PawnBody = {
      ...body, location: fall.location, velocity: { x: nextVelocity.x, y: nextVelocity.y, z: 0 }, mode: "walking", floor: fall.hit.primitive, restsInFloorBand: false,
    };
    return { body: landedBody, unusedSeconds: tickSeconds * (1 - fall.hit.time) };
  }
  const location = slideAlongSurface(context, body, fall.location, safeNormal(delta, rules), delta, fall.hit.normal, fall.hit.time);
  return { body: { ...body, location, velocity: velocityFromDisplacement(body.location, location, tickSeconds) }, unusedSeconds: 0 };
}
