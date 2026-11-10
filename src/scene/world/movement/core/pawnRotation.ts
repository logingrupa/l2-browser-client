import type { Vector3 } from "../../../../shared/math/vector3";
import type { MovementNativeRules } from "./movementRules";

const headingUnitsPerTurn = 65536;
const headingUnitsPerHalfTurn = 32768;
const headingMask = headingUnitsPerTurn - 1;

export function headingOfDirection(direction: Vector3): number {
  return Math.round(Math.atan2(direction.y, direction.x) * headingUnitsPerHalfTurn / Math.PI) & headingMask;
}

export function yawStepForTick(tickSeconds: number, isLocalPlayer: boolean, rules: MovementNativeRules): number {
  return isLocalPlayer ? Math.round(rules.pawn.localPlayerYawRate * tickSeconds) : Math.trunc(rules.pawn.otherPawnYawRate * tickSeconds);
}

export function turnYawTowards(yaw: number, targetHeading: number, maximumStep: number): number {
  const shorterTurn = ((targetHeading - yaw + headingUnitsPerHalfTurn) & headingMask) - headingUnitsPerHalfTurn;
  const step = Math.sign(shorterTurn) * Math.min(Math.abs(shorterTurn), maximumStep);
  return (yaw + step) & headingMask;
}
