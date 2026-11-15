import { float32Vector, type Vector3 } from "../../../../shared/math/vector3";
import { ZERO_VELOCITY } from "./pawnBody";
import type { MovementNativeRules } from "./movementRules";

export interface PawnSpeeds {
  readonly walk: number;
  readonly run: number;
  readonly swimWalk: number | null;
  readonly swimRun: number | null;
  readonly flyWalk: number | null;
  readonly flyRun: number | null;
  readonly nonAttackSpeedRate: number;
}

export type PawnSpeedEnvironment = "ground" | "water" | "air";

export interface PawnSpeedQuery {
  readonly speeds: PawnSpeeds;
  readonly environment: PawnSpeedEnvironment;
  readonly runs: boolean;
  readonly moveTimerSeconds: number;
  readonly walkAnimationFramesInMove: number | null;
}

export interface PawnVelocityQuery {
  readonly location: Vector3;
  readonly destination: Vector3;
  readonly offset: number;
  readonly speed: number;
  readonly tickSeconds: number;
  readonly measuresVertical: boolean;
}

export interface PawnArrivalQuery {
  readonly location: Vector3;
  readonly destination: Vector3;
  readonly offset: number;
  readonly measuresVertical: boolean;
}

function walkAndRunSpeeds(speeds: PawnSpeeds, environment: PawnSpeedEnvironment): readonly [number | null, number | null] {
  if (environment === "water") return [speeds.swimWalk, speeds.swimRun];
  if (environment === "air") return [speeds.flyWalk, speeds.flyRun];
  return [speeds.walk, speeds.run];
}

function runStartHasPassed(query: PawnSpeedQuery, rules: MovementNativeRules): boolean {
  if (query.environment !== "ground" || query.walkAnimationFramesInMove === null) return true;
  return query.moveTimerSeconds > query.walkAnimationFramesInMove / rules.pawn.runStartFramesPerSecond;
}

export function currentPawnSpeed(query: PawnSpeedQuery, rules: MovementNativeRules): number | null {
  const [walkSpeed, runSpeed] = walkAndRunSpeeds(query.speeds, query.environment);
  const speed = query.runs && runStartHasPassed(query, rules) ? runSpeed : walkSpeed;
  return speed === null ? null : Math.fround(speed * query.speeds.nonAttackSpeedRate);
}

function offsetToDestination(location: Vector3, destination: Vector3, measuresVertical: boolean): Vector3 {
  return { x: destination.x - location.x, y: destination.y - location.y, z: measuresVertical ? destination.z - location.z : 0 };
}

const lengthOf = (vector: Vector3) => Math.hypot(vector.x, vector.y, vector.z);

export function calculatePawnVelocity(query: PawnVelocityQuery): Vector3 {
  const towardDestination = offsetToDestination(query.location, query.destination, query.measuresVertical);
  const distance = lengthOf(towardDestination);
  if (distance === 0) return ZERO_VELOCITY;
  const magnitude = Math.min(query.speed, Math.max(0, (distance - query.offset) / query.tickSeconds));
  return float32Vector({
    x: towardDestination.x / distance * magnitude, y: towardDestination.y / distance * magnitude, z: towardDestination.z / distance * magnitude,
  });
}

export function hasPawnArrived(query: PawnArrivalQuery, rules: MovementNativeRules): boolean {
  return lengthOf(offsetToDestination(query.location, query.destination, query.measuresVertical)) <= query.offset + rules.pawn.arrivalSlack;
}
