import { dotProduct, float32Scaled, float32Vector, type Vector3 } from "../../../../shared/math/vector3";
import { moveActor, type MoveActorHit } from "./moveActor";
import type { MovementNativeRules } from "./movementRules";
import {
  pawnCylinderAt, physicsVolumeGravityDirection, safeNormal, velocityFromDisplacement, type PawnBody, type PawnPhysicsContext, type PawnStepResult,
} from "./pawnBody";
import { slideAlongSurface, stepUpPawn } from "./pawnStepUp";

function hitsWallInLevelFlight(rules: MovementNativeRules, hit: MoveActorHit, gravityDirection: Vector3, float32Velocity: Vector3): boolean {
  const { flyingStepWallZ, flyingLevelDotMinimum, flyingLevelDotMaximum } = rules.pawn;
  const velocityAlongGravity = Math.fround(dotProduct(gravityDirection, safeNormal(float32Velocity, rules)));
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
  const gravityDirection = physicsVolumeGravityDirection(rules);
  const desiredDirection = safeNormal(flightDelta, rules);
  if (hitsWallInLevelFlight(rules, flight.hit, gravityDirection, float32Velocity)) {
    const remainingDelta = float32Scaled(flightDelta, Math.fround(1 - flight.hit.time));
    const location = stepUpPawn(context, body, flight.location, gravityDirection, desiredDirection, remainingDelta, flight.hit);
    const oldLocationWithoutStepUp = { ...oldLocation, z: Math.fround(oldLocation.z - flight.location.z + location.z) };
    return flownPawn(body, location, oldLocationWithoutStepUp, deltaTime);
  }
  const location = slideAlongSurface(context, body, flight.location, desiredDirection, flightDelta, flight.hit.normal, flight.hit.time);
  return flownPawn(body, location, oldLocation, deltaTime);
}
