import { ROTATOR_CONSTANTS, rotatorSineFromTable } from "../../../shared/math/rotator";
import type { Vector3 } from "../../../shared/math/vector3";
import { PARTICLE_CONSTANTS } from "./emitterConstants";
import type { Rotator } from "./emitterRecords";

export interface RotatorAxes {
  readonly forward: Vector3;
  readonly right: Vector3;
  readonly up: Vector3;
}

const quarterTurnUnits = ROTATOR_CONSTANTS.unitsPerTurn.runtimeDefault / 4;
const sineTableLength = ROTATOR_CONSTANTS.sineTableLength.runtimeDefault;
const rotatorUnitsPerSineTableEntry = ROTATOR_CONSTANTS.unitsPerTurn.runtimeDefault / sineTableLength;
const spinUnitsPerTurn = PARTICLE_CONSTANTS.spinUnitsPerTurn.runtimeDefault;

export const IDENTITY_ROTATOR: Rotator = { pitch: 0, yaw: 0, roll: 0 };

export function rotatorAxes(rotator: Rotator): RotatorAxes {
  const sine = (units: number) => rotatorSineFromTable(units), cosine = (units: number) => rotatorSineFromTable(units + quarterTurnUnits);
  const sinePitch = sine(rotator.pitch), cosinePitch = cosine(rotator.pitch);
  const sineYaw = sine(rotator.yaw), cosineYaw = cosine(rotator.yaw);
  const sineRoll = sine(rotator.roll), cosineRoll = cosine(rotator.roll);
  return {
    forward: { x: cosinePitch * cosineYaw, y: cosinePitch * sineYaw, z: sinePitch },
    right: { x: sineRoll * sinePitch * cosineYaw - cosineRoll * sineYaw, y: sineRoll * sinePitch * sineYaw + cosineRoll * cosineYaw, z: -sineRoll * cosinePitch },
    up: { x: -(cosineRoll * sinePitch * cosineYaw + sineRoll * sineYaw), y: cosineYaw * sineRoll - cosineRoll * sinePitch * sineYaw, z: cosineRoll * cosinePitch },
  };
}

export function rotateByAxes(vector: Vector3, axes: RotatorAxes): Vector3 {
  return {
    x: vector.x * axes.forward.x + vector.y * axes.right.x + vector.z * axes.up.x,
    y: vector.x * axes.forward.y + vector.y * axes.right.y + vector.z * axes.up.y,
    z: vector.x * axes.forward.z + vector.y * axes.right.z + vector.z * axes.up.z,
  };
}

export function rotateByRotators(vector: Vector3, outerRotator: Rotator, innerRotator: Rotator): Vector3 {
  return rotateByAxes(rotateByAxes(vector, rotatorAxes(innerRotator)), rotatorAxes(outerRotator));
}

function quantizedRevolutionRadians(turnsThisStep: number): number {
  const angleUnits = Math.trunc(turnsThisStep * spinUnitsPerTurn);
  const tableIndex = Math.floor(angleUnits / rotatorUnitsPerSineTableEntry) & (sineTableLength - 1);
  return tableIndex * 2 * Math.PI / sineTableLength;
}

export function revolveAboutAxes(offset: Vector3, turnsThisStep: Vector3): Vector3 {
  const aboutX = quantizedRevolutionRadians(turnsThisStep.x), aboutY = quantizedRevolutionRadians(turnsThisStep.y), aboutZ = quantizedRevolutionRadians(turnsThisStep.z);
  const afterX = { x: offset.x, y: offset.y * Math.cos(aboutX) - offset.z * Math.sin(aboutX), z: offset.y * Math.sin(aboutX) + offset.z * Math.cos(aboutX) };
  const afterY = { x: afterX.x * Math.cos(aboutY) + afterX.z * Math.sin(aboutY), y: afterX.y, z: -afterX.x * Math.sin(aboutY) + afterX.z * Math.cos(aboutY) };
  return { x: afterY.x * Math.cos(aboutZ) - afterY.y * Math.sin(aboutZ), y: afterY.x * Math.sin(aboutZ) + afterY.y * Math.cos(aboutZ), z: afterY.z };
}
