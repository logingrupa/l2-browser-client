import { DYNAMIC_LIGHT_CONSTANTS } from "./dynamicLightEngineConstants";

const { worldLightRadiusOffset, worldLightRadiusScale } = DYNAMIC_LIGHT_CONSTANTS;

export function worldLightRadius(lightRadius: number): number {
  return Math.fround((Math.fround(lightRadius) + worldLightRadiusOffset.value) * worldLightRadiusScale.value);
}
