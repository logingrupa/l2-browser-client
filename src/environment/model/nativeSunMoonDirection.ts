import { ENVIRONMENT_ENGINE_CONSTANTS } from "./nativeEnvironmentEngineConstants";

export interface CelestialAngles {
  readonly theta: number;
  readonly phi: number;
  readonly zeroedThirdOutput: 0;
}

export type CelestialBody = "sun" | "moon";

const { sunTheta, moonTheta, celestialBodyHours, degreesToRadians, hoursPerDay } = ENVIRONMENT_ENGINE_CONSTANTS;

function phiRadians(phiDegrees: number): number {
  return Math.fround(Math.fround(phiDegrees) * degreesToRadians.value);
}

function sunThetaAtHour(hour: number): number {
  const { rangeStart, morning, radiansPerHour, quarterTurn, wrapEnd, belowHorizon } = sunTheta.value;
  if (rangeStart <= hour && hour < hoursPerDay.value) return Math.fround((hour - morning) * radiansPerHour - quarterTurn);
  if (hour < wrapEnd) return Math.fround((hour + hoursPerDay.value - morning) * radiansPerHour - quarterTurn);
  return belowHorizon;
}

function moonThetaAtHour(hour: number): number {
  const { hiddenStart, hiddenEnd, origin, radiansPerHour, quarterTurn, belowHorizon } = moonTheta.value;
  if (hiddenStart <= hour && hour < hiddenEnd) return belowHorizon;
  return Math.fround((hour - origin) * radiansPerHour - quarterTurn);
}

export function sunAngles(hour: number, phiDegrees: number): CelestialAngles {
  return { theta: sunThetaAtHour(Math.fround(hour)), phi: phiRadians(phiDegrees), zeroedThirdOutput: 0 };
}

export function moonAngles(hour: number, phiDegrees: number): CelestialAngles {
  return { theta: moonThetaAtHour(Math.fround(hour)), phi: phiRadians(phiDegrees), zeroedThirdOutput: 0 };
}

export function celestialBodyAtHour(hour: number): CelestialBody {
  const fractionalHour = Math.fround(hour);
  return celestialBodyHours.value.sunStart <= fractionalHour && fractionalHour < celestialBodyHours.value.sunEnd ? "sun" : "moon";
}
