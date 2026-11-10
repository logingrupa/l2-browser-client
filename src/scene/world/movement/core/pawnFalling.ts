import { float32Vector } from "../../../../shared/math/vector3";
import { moveActor } from "./moveActor";
import {
  isWalkableFloorNormal, pawnCylinderAt, slideAlongPlane, velocityFromDisplacement, type PawnBody, type PawnPhysicsContext, type PawnStepResult,
} from "./pawnBody";

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
  if (fall.hit === null) return { body: { ...body, location: fall.location, velocity: nextVelocity }, unusedSeconds: 0 };
  if (isWalkableFloorNormal(fall.hit.normal, rules)) {
    const landedBody: PawnBody = {
      ...body, location: fall.location, velocity: { x: nextVelocity.x, y: nextVelocity.y, z: 0 }, mode: "walking", floor: fall.hit.primitive, restsInFloorBand: false,
    };
    return { body: landedBody, unusedSeconds: tickSeconds * (1 - fall.hit.time) };
  }
  const slideDelta = slideAlongPlane(delta, fall.hit.normal, 1 - fall.hit.time);
  const slide = moveActor(world, pawnCylinderAt(body, fall.location), slideDelta, rules, surroundings);
  return { body: { ...body, location: slide.location, velocity: velocityFromDisplacement(body.location, slide.location, tickSeconds) }, unusedSeconds: 0 };
}
