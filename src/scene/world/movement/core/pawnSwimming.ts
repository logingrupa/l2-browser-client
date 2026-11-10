import { float32Scaled, float32Vector, type Vector3 } from "../../../../shared/math/vector3";
import { moveActor } from "./moveActor";
import { horizontalLength, isPawnInWater, pawnCylinderAt, unitDirection, type PawnBody, type PawnPhysicsContext, type PawnStepResult } from "./pawnBody";
import { slideAlongSurface } from "./pawnStepUp";

function waterExitVelocity(velocity: Vector3, context: PawnPhysicsContext): Vector3 {
  const { speed, horizontalFactor, threshold } = context.rules.pawn.waterExit;
  const risesOnExit = velocity.z > 0 && velocity.z < threshold;
  return risesOnExit ? float32Vector({ ...velocity, z: speed + horizontalFactor * horizontalLength(velocity) }) : velocity;
}

export function swimPawn(context: PawnPhysicsContext, body: PawnBody, velocity: Vector3, tickSeconds: number): PawnStepResult {
  const { world, rules, surroundings } = context;
  const delta = float32Scaled(velocity, tickSeconds);
  const swim = moveActor(world, pawnCylinderAt(body, body.location), delta, rules, surroundings);
  const location = swim.hit === null ? swim.location : slideAlongSurface(context, body, swim.location, unitDirection(delta), delta, swim.hit.normal, swim.hit);
  if (isPawnInWater(context, location)) return { body: { ...body, location, velocity, mode: "swimming", floor: null, restsInFloorBand: false }, unusedSeconds: 0 };
  return { body: { ...body, location, velocity: waterExitVelocity(velocity, context), mode: "falling", floor: null, restsInFloorBand: false }, unusedSeconds: 0 };
}
