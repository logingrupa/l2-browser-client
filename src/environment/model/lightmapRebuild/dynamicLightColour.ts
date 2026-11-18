import { fGetHsv } from "../fGetHsv";
import { ENVIRONMENT_ENGINE_CONSTANTS } from "../nativeEnvironmentEngineConstants";
import type { NativeEnvironmentBlend } from "../nativeEnvironmentManager";
import type { NativeEnvironmentTables } from "../nativeEnvironmentTypeTables";
import { scalePlane, zeroPlane, type NativePlane } from "../nativePlane";
import { sampleTimeHsv } from "../sampleNativeTimeTables";
import { resolvedResult, type LightmapRebuildResult } from "./lightmapRebuildTypes";
import { lightTypeMultiplier, type LightTypeAnimation, type UnportedLightTypeReason } from "./lightTypeMultiplier";

export interface DynamicLightColourSource extends LightTypeAnimation {
  readonly lightHue: number;
  readonly lightSaturation: number;
  readonly lightBrightness: number;
  readonly sunlightColour: boolean;
}

export interface DynamicLightEnvironment {
  readonly tables: NativeEnvironmentTables;
  readonly blend: NativeEnvironmentBlend;
  readonly hour: number;
  readonly levelBrightness: number;
  readonly levelTimeSeconds: number;
}

export type DynamicLightColourReason = UnportedLightTypeReason | "bsp-rebuild-sunlight-colour-environment-blend-unported";

const { byteMaximum } = ENVIRONMENT_ENGINE_CONSTANTS;
const verifiedSunlightEnvironmentType = 0;

function staticLightPlane(light: DynamicLightColourSource): NativePlane {
  const base = fGetHsv(light.lightHue, light.lightSaturation, byteMaximum.value);
  return scalePlane(base, Math.fround(Math.fround(light.lightBrightness) / byteMaximum.value));
}

function sunlightPlane(environment: DynamicLightEnvironment): LightmapRebuildResult<NativePlane, DynamicLightColourReason> {
  const { tables, blend, hour } = environment;
  if (blend.oldType !== verifiedSunlightEnvironmentType || blend.targetType !== verifiedSunlightEnvironmentType) {
    return { status: "unresolved", reason: "bsp-rebuild-sunlight-colour-environment-blend-unported" };
  }
  return resolvedResult(sampleTimeHsv(tables.get(verifiedSunlightEnvironmentType)?.hsv.HSVActorLight ?? [], Math.fround(hour)) ?? zeroPlane);
}

export function dynamicLightColour(light: DynamicLightColourSource, environment: DynamicLightEnvironment): LightmapRebuildResult<NativePlane, DynamicLightColourReason> {
  const multiplier = lightTypeMultiplier(light, environment.levelTimeSeconds);
  if (multiplier.status !== "resolved") return multiplier;
  const brightnessPlane = light.sunlightColour ? sunlightPlane(environment) : resolvedResult(staticLightPlane(light));
  if (brightnessPlane.status !== "resolved") return brightnessPlane;
  return resolvedResult(scalePlane(scalePlane(brightnessPlane.value, multiplier.value), Math.fround(environment.levelBrightness)));
}
