import { float32Scaled, type Vector3 } from "../../../../shared/math/vector3";
import { moveActor, type MoveActorHit } from "./moveActor";
import { pawnCylinderAt, slideAlongPlane, unitDirection, type PawnBody, type PawnPhysicsContext, type PawnStepResult } from "./pawnBody";
import { slideAlongSurface } from "./pawnStepUp";

function isLevelFlightIntoWall(context: PawnPhysicsContext, direction: Vector3, hit: MoveActorHit, gravityDirectionZ: number): boolean {
  const { flyingStepWallZ, flyingLevelDotMinimum, flyingLevelDotMaximum } = context.rules.pawn;
  const alongGravity = direction.z * gravityDirectionZ;
  return Math.abs(hit.normal.z) < flyingStepWallZ && alongGravity > flyingLevelDotMinimum && alongGravity < flyingLevelDotMaximum;
}

function stepOverWhileFlying(context: PawnPhysicsContext, body: PawnBody, location: Vector3, remainingDelta: Vector3, gravityDirectionZ: number): Vector3 {
  const { world, rules, surroundings } = context;
  const moveFrom = (start: Vector3, delta: Vector3) => moveActor(world, pawnCylinderAt(body, start), delta, rules, surroundings);
  const stepHeight = rules.pawn.maxStepHeight;
  const lifted = moveFrom(location, { x: 0, y: 0, z: -gravityDirectionZ * stepHeight }).location;
  const across = moveFrom(lifted, remainingDelta);
  const slid = across.hit === null ? across.location : moveFrom(across.location, slideAlongPlane(remainingDelta, across.hit.normal, 1 - across.hit.time)).location;
  return moveFrom(slid, { x: 0, y: 0, z: gravityDirectionZ * stepHeight }).location;
}

export function flyPawn(context: PawnPhysicsContext, body: PawnBody, velocity: Vector3, tickSeconds: number): PawnStepResult {
  const { world, rules, surroundings } = context;
  const delta = float32Scaled(velocity, tickSeconds);
  const flight = moveActor(world, pawnCylinderAt(body, body.location), delta, rules, surroundings);
  const flyingBody = (location: Vector3): PawnStepResult => ({ body: { ...body, location, velocity, mode: "flying", floor: null, restsInFloorBand: false }, unusedSeconds: 0 });
  if (flight.hit === null) return flyingBody(flight.location);
  const direction = unitDirection(delta);
  const gravityDirectionZ = Math.sign(rules.pawn.volumeGravity);
  if (isLevelFlightIntoWall(context, direction, flight.hit, gravityDirectionZ)) {
    return flyingBody(stepOverWhileFlying(context, body, flight.location, float32Scaled(delta, 1 - flight.hit.time), gravityDirectionZ));
  }
  return flyingBody(slideAlongSurface(context, body, flight.location, direction, delta, flight.hit.normal, flight.hit));
}
