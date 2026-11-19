import { truncateToInt64LowDword } from "../../../shared/math/x87IntegerConversion";
import { DYNAMIC_LIGHT_CONSTANTS } from "./dynamicLightEngineConstants";
import { requireByte, resolvedResult, type LightmapRebuildResult } from "./lightmapRebuildTypes";
import { sineTableSine } from "./rotatorVector";

export type UnportedLightTypeReason = `bsp-rebuild-light-type-unported:${number}`;

export interface LightTypeAnimation {
  readonly lightType: number;
  readonly lightPeriod: number;
  readonly lightPhase: number;
}

const { lightTypeMultipliers, lightType7 } = DYNAMIC_LIGHT_CONSTANTS;

export function lightType7Modulation(lightPeriod: number, lightPhase: number, levelTimeSeconds: number): number {
  const { minimumPeriod, phaseShift, cyclesPerSecond, unitsPerTurn, amplitude, base } = lightType7.value;
  const period = Math.max(minimumPeriod, requireByte(lightPeriod, "LightPeriod"));
  const phaseUnits = requireByte(lightPhase, "LightPhase") << phaseShift;
  const angle = truncateToInt64LowDword(((Math.fround(levelTimeSeconds) * cyclesPerSecond) * unitsPerTurn) / period + phaseUnits);
  return Math.fround(sineTableSine(angle) * amplitude + base);
}

export function lightTypeMultiplier(animation: LightTypeAnimation, levelTimeSeconds: number): LightmapRebuildResult<number, UnportedLightTypeReason> {
  const lightType = requireByte(animation.lightType, "LightType");
  if (lightType === lightTypeMultipliers.value.steady) return resolvedResult(lightTypeMultipliers.value.steadyMultiplier);
  if (lightType === lightTypeMultipliers.value.switchedOff) return resolvedResult(lightTypeMultipliers.value.switchedOffMultiplier);
  if (lightType === lightTypeMultipliers.value.modulated) return resolvedResult(lightType7Modulation(animation.lightPeriod, animation.lightPhase, levelTimeSeconds));
  return { status: "unresolved", reason: `bsp-rebuild-light-type-unported:${lightType}` };
}
