import { rotatorAxes, rotatorSineFromTable, type RotatorUnits } from "../../shared/math/rotator";
import type { Vector3 } from "../../shared/math/vector3";
import type { ReferenceConstantRow } from "../../shared/referenceConstant";
import type { DayPart } from "./nativeEnvironmentManager";
import { moonAngles, sunAngles } from "./nativeSunMoonDirection";
import { truncateToInt32 } from "../../shared/math/x87IntegerConversion";

export interface NativeSunLightDirectionInputs {
  readonly hour: number;
  readonly dayPart: DayPart;
  readonly phiDegrees: number;
  readonly slopeSunAngleDegrees: number;
}

export interface NativeSunLightDirection {
  readonly body: "sun" | "moon";
  readonly rotation: RotatorUnits;
  readonly direction: Vector3;
}

const celestialAnswer = "DB-10 environment-transition-sun-moon.json celestial part, pseudocode from the Engine.dll 4dd2f63c and Core.dll 9462f87a corpus";

export const SUN_LIGHT_DIRECTION_CONSTANTS = {
  moonDayPart: { id: "lighting.sun-light-moon-day-part", value: 3,
    provenance: `${celestialAnswer}: ANMovableSunLight::Tick 0x105d8150 takes GetMoonModifierInfo when manager.dayPart == 3, otherwise GetSunModifierInfo`,
    status: "confirmed-interlude", interludeEvidence: "Engine.dll 4dd2f63c ANMovableSunLight::Tick 0x105d8150", runtimeDefault: 3 },
  slopeUnitsPerHalfTurn: { id: "lighting.sun-light-slope-units-per-half-turn", value: { units: 32768, degrees: 180, mask: 65535 },
    provenance: `${celestialAnswer}: RotateAngleAxis 0x1010f8b0 angle A = (trunc(slope degrees) * 32768 / 180 by signed division toward zero) & 65535, read through GMath.SinTab`,
    status: "confirmed-interlude", interludeEvidence: "Core.dll 9462f87a FVector::RotateAngleAxis 0x1010f8b0, _ftol2 0x107a6660", runtimeDefault: { units: 32768, degrees: 180, mask: 65535 } },
  slopeSignFlipped: { id: "lighting.sun-light-slope-sign-flipped", value: false,
    provenance: `${celestialAnswer} C-live-slope-sign: the Tick multiplies SlopeSunAngle by -1 when Engine global 0x10c51050 is nonzero; the live value is unresolved. RM-10 runtime-lighting-rm10.json static fixtures (rotation -9194, 24675 at hour 12.3) were built with the slope unflipped`,
    status: "unconfirmed", interludeEvidence: null, runtimeDefault: false },
  rotationUnitsPerHalfTurn: { id: "lighting.vector-rotation-units-per-half-turn", value: 32768,
    provenance: `${celestialAnswer}: FVector::Rotation 0x1014d5c0 Yaw = trunc(atan2(y, x) * 32768 / pi), Pitch = trunc(atan2(z, sqrt(x * x + y * y)) * 32768 / pi), Roll = 0`,
    status: "confirmed-interlude", interludeEvidence: "Core.dll 9462f87a FVector::Rotation 0x1014d5c0", runtimeDefault: 32768 },
} as const satisfies Record<string, ReferenceConstantRow<unknown>>;

const { moonDayPart, slopeUnitsPerHalfTurn, slopeSignFlipped, rotationUnitsPerHalfTurn } = SUN_LIGHT_DIRECTION_CONSTANTS;
const rotatorUnitsPerQuarterTurn = 16384;

function slopeRotationUnits(slopeSunAngleDegrees: number): number {
  const signedDegrees = slopeSignFlipped.value ? -slopeSunAngleDegrees : slopeSunAngleDegrees;
  const { units, degrees, mask } = slopeUnitsPerHalfTurn.value;
  return Math.trunc(truncateToInt32(signedDegrees) * units / degrees) & mask;
}

function tiltedAboutX(vector: Vector3, slopeUnits: number): Vector3 {
  const sine = rotatorSineFromTable(slopeUnits), cosine = rotatorSineFromTable(slopeUnits + rotatorUnitsPerQuarterTurn);
  const oneMinusCosine = Math.fround(1 - cosine);
  return { x: Math.fround(Math.fround(oneMinusCosine + cosine) * vector.x), y: Math.fround(cosine * vector.y - sine * vector.z),
    z: Math.fround(sine * vector.y + cosine * vector.z) };
}

function rotationOfVector(vector: Vector3): RotatorUnits {
  const unitsPerRadian = rotationUnitsPerHalfTurn.value / Math.PI;
  return { pitch: truncateToInt32(Math.atan2(vector.z, Math.sqrt(vector.x * vector.x + vector.y * vector.y)) * unitsPerRadian),
    yaw: truncateToInt32(Math.atan2(vector.y, vector.x) * unitsPerRadian), roll: 0 };
}

export function nativeSunLightDirection(inputs: NativeSunLightDirectionInputs): NativeSunLightDirection {
  const body = inputs.dayPart === moonDayPart.value ? "moon" : "sun";
  const { theta, phi } = body === "moon" ? moonAngles(inputs.hour, inputs.phiDegrees) : sunAngles(inputs.hour, inputs.phiDegrees);
  const spherical = { x: Math.fround(Math.sin(theta) * Math.cos(phi)), y: Math.fround(Math.sin(theta) * Math.sin(phi)), z: Math.fround(Math.cos(theta)) };
  const tilted = tiltedAboutX(spherical, slopeRotationUnits(inputs.slopeSunAngleDegrees));
  const rotation = rotationOfVector({ x: -tilted.x, y: -tilted.y, z: -tilted.z });
  const forward = rotatorAxes(rotation).forward;
  return { body, rotation, direction: { x: Math.fround(forward.x), y: Math.fround(forward.y), z: Math.fround(forward.z) } };
}
