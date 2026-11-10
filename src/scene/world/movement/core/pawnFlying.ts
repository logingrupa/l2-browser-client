import { dotProduct, float32Scaled, float32Vector, type Vector3 } from "../../../../shared/math/vector3";
import { moveActor, type MoveActorHit } from "./moveActor";
import type { MovementNativeRules } from "./movementRules";
import { pawnCylinderAt, unitDirection, velocityFromDisplacement, type PawnBody, type PawnPhysicsContext, type PawnStepResult } from "./pawnBody";
import { slideAlongSurface, stepUpPawn } from "./pawnStepUp";

function physicsVolumeGravityDirection(rules: MovementNativeRules): Vector3 {
  return { x: 0, y: 0, z: rules.pawn.volumeGravity > 0 ? 1 : -1 };
}

function hitsWallInLevelFlight(rules: MovementNativeRules, hit: MoveActorHit, float32Velocity: Vector3): boolean {
  const { flyingStepWallZ, flyingLevelDotMinimum, flyingLevelDotMaximum } = rules.pawn;
  const velocityAlongGravity = Math.fround(dotProduct(physicsVolumeGravityDirection(rules), unitDirection(float32Velocity)));
  return Math.abs(hit.normal.z) < flyingStepWallZ && velocityAlongGravity < flyingLevelDotMaximum && velocityAlongGravity > flyingLevelDotMinimum;
}

function flownPawn(body: PawnBody, location: Vector3, oldLocation: Vector3, deltaTime: number): PawnStepResult {
  return { body: { ...body, location, velocity: velocityFromDisplacement(oldLocation, location, deltaTime) }, unusedSeconds: 0 };
}

export function flyPawn(context: PawnPhysicsContext, body: PawnBody, velocity: Vector3, tickSeconds: number): PawnStepResult {
  const { world, rules, surroundings } = context;
  const deltaTime = Math.fround(tickSeconds);
  const oldLocation = float32Vector(body.location);
  const float32Velocity = float32Vector(velocity);
  const flightDelta = float32Scaled(float32Velocity, deltaTime);
  const flight = moveActor(world, pawnCylinderAt(body, oldLocation), flightDelta, rules, surroundings);
  if (flight.hit === null) return flownPawn(body, flight.location, oldLocation, deltaTime);
  const desiredDirection = unitDirection(flightDelta);
  if (hitsWallInLevelFlight(rules, flight.hit, float32Velocity)) {
    const remainingDelta = float32Scaled(flightDelta, Math.fround(1 - flight.hit.time));
    const location = stepUpPawn(context, body, flight.location, desiredDirection, remainingDelta, flight.hit);
    const oldLocationWithoutStepUp = { ...oldLocation, z: Math.fround(oldLocation.z - flight.location.z + location.z) };
    return flownPawn(body, location, oldLocationWithoutStepUp, deltaTime);
  }
  const location = slideAlongSurface(context, body, flight.location, desiredDirection, flightDelta, flight.hit.normal, flight.hit);
  return flownPawn(body, location, oldLocation, deltaTime);
}
