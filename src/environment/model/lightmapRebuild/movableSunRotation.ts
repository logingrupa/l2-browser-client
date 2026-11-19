import type { RotatorUnits } from "../../../shared/math/rotator";
import type { DayPart } from "../nativeEnvironmentManager";
import { moonAngles, sunAngles } from "../nativeSunMoonDirection";
import { truncateToInt32 } from "../../../shared/math/x87IntegerConversion";
import { DYNAMIC_LIGHT_CONSTANTS } from "./dynamicLightEngineConstants";
import type { NativeVector3 } from "./lightmapRebuildTypes";
import { sineTableCosine, sineTableSine } from "./rotatorVector";

export interface MovableSunTickInput {
  readonly hour: number;
  readonly dayPart: DayPart;
  readonly celestialPhiDegrees: number;
  readonly slopeSunAngle: number;
  readonly frozen: boolean;
}

const {
  vectorRotationUnitsPerTurn, vectorRotationRadiansPerTurn, movableSunNegation, movableSunSlopeShift, movableSunSlopeDivisor, movableSunAngleMask,
} = DYNAMIC_LIGHT_CONSTANTS;
const nightDayPart: DayPart = 3;
const slopeRotationAxis: NativeVector3 = [1, 0, 0];

function rotateAngleAxis(vector: NativeVector3, angle: number, axis: NativeVector3): NativeVector3 {
  const sine = sineTableSine(angle), cosine = sineTableCosine(angle);
  const [axisX, axisY, axisZ] = axis;
  const productXY = Math.fround(axisY * axisX), productYZ = Math.fround(axisZ * axisY), productXZ = Math.fround(axisZ * axisX);
  const sineX = Math.fround(axisX * sine), sineY = Math.fround(axisY * sine), sineZ = Math.fround(axisZ * sine);
  const oneMinusCosine = Math.fround(1 - cosine);
  const squareX = Math.fround(axisX * axisX), squareY = Math.fround(axisY * axisY), squareZ = Math.fround(axisZ * axisZ);
  const [x, y, z] = vector;
  return [
    Math.fround(((squareX * oneMinusCosine + cosine) * x + (oneMinusCosine * productXY - sineZ) * y) + (oneMinusCosine * productXZ + sineY) * z),
    Math.fround(((squareY * oneMinusCosine + cosine) * y + (oneMinusCosine * productXY + sineZ) * x) + (oneMinusCosine * productYZ - sineX) * z),
    Math.fround(((oneMinusCosine * productYZ + sineX) * y + (oneMinusCosine * productXZ - sineY) * x) + (squareZ * oneMinusCosine + cosine) * z),
  ];
}

function radiansToRotationUnits(radians: number): number {
  return truncateToInt32((radians * vectorRotationUnitsPerTurn.value) / vectorRotationRadiansPerTurn.value) | 0;
}

function vectorRotation([x, y, z]: NativeVector3): RotatorUnits {
  const horizontalLength = Math.sqrt(x * x + y * y);
  return { pitch: radiansToRotationUnits(Math.atan2(z, horizontalLength)), yaw: radiansToRotationUnits(Math.atan2(y, x)), roll: 0 };
}

function celestialDirection({ hour, dayPart, celestialPhiDegrees }: MovableSunTickInput): NativeVector3 {
  const angles = dayPart === nightDayPart ? moonAngles(hour, celestialPhiDegrees) : sunAngles(hour, celestialPhiDegrees);
  const sineTheta = Math.sin(angles.theta);
  return [Math.fround(Math.cos(angles.phi) * sineTheta), Math.fround(Math.sin(angles.phi) * sineTheta), Math.fround(Math.cos(angles.theta))];
}

function slopeRotationAngle({ slopeSunAngle, frozen }: MovableSunTickInput): number {
  const slope = frozen ? Math.fround(Math.fround(slopeSunAngle) * movableSunNegation.value) : Math.fround(slopeSunAngle);
  const shiftedDegrees = truncateToInt32(slope) << movableSunSlopeShift.value;
  return Math.trunc(shiftedDegrees / movableSunSlopeDivisor.value) & movableSunAngleMask.value;
}

export function movableSunRotation(input: MovableSunTickInput): RotatorUnits {
  const rotated = rotateAngleAxis(celestialDirection(input), slopeRotationAngle(input), slopeRotationAxis);
  return vectorRotation([Math.fround(rotated[0] * movableSunNegation.value), Math.fround(rotated[1] * movableSunNegation.value),
    Math.fround(rotated[2] * movableSunNegation.value)]);
}
