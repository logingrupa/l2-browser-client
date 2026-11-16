import { ENVIRONMENT_ENGINE_CONSTANTS } from "./nativeEnvironmentEngineConstants";
import type { NativeEnvironmentBlend } from "./nativeEnvironmentManager";
import type { BlackStartColourSection, HsvLightSection, NativeEnvironmentTables, NativeTimeColourSection, ScaleSection, SkyLayerColourSection } from "./nativeEnvironmentTypeTables";
import { lerpPlanes, zeroPlane, type NativePlane } from "./nativePlane";
import { interpolateByteChannel, sampleTimeColour, sampleTimeHsv, sampleTimeScale, type RgbBytes, type TimeScaleSample } from "./sampleNativeTimeTables";

export type EnvironmentTransitionGap = { readonly status: "unresolved"; readonly reason: "env-color-transition-unresolved" };
export type EnvironmentResult<Value, Reason extends string = never> =
  | { readonly status: "resolved"; readonly value: Value }
  | EnvironmentTransitionGap
  | { readonly status: "unresolved"; readonly reason: Reason };

const { fogBaselineColour } = ENVIRONMENT_ENGINE_CONSTANTS;
const defaultEnvironmentType = 0;
const blackStart: RgbBytes = [0, 0, 0];
const transitionGap: EnvironmentTransitionGap = { status: "unresolved", reason: "env-color-transition-unresolved" };

export const nativeFogBaseline = {
  colour: fogBaselineColour.value,
  localHourFog: { status: "unresolved", reason: "local-hour-fog-unresolved" },
} as const;

function resolved<Value>(value: Value): { readonly status: "resolved"; readonly value: Value } {
  return { status: "resolved", value };
}

function settledEnvironmentValue<Value>(blend: NativeEnvironmentBlend, sampleType: (environmentType: number) => Value,
  mix: (defaultValue: Value, targetValue: Value, weight: number) => Value): EnvironmentResult<Value> {
  if (blend.oldType !== blend.targetType) return transitionGap;
  const defaultValue = sampleType(defaultEnvironmentType);
  if (blend.targetType === defaultEnvironmentType) return resolved(defaultValue);
  return resolved(mix(defaultValue, sampleType(blend.targetType), blend.weight));
}

function mixBytes(defaultColour: RgbBytes, targetColour: RgbBytes, weight: number): RgbBytes {
  return [interpolateByteChannel(defaultColour[0], targetColour[0], weight), interpolateByteChannel(defaultColour[1], targetColour[1], weight),
    interpolateByteChannel(defaultColour[2], targetColour[2], weight)];
}

function sampleColour(tables: NativeEnvironmentTables, environmentType: number, section: NativeTimeColourSection, hour: number): RgbBytes | null {
  return sampleTimeColour(tables.get(environmentType)?.colour[section] ?? [], hour);
}

export function environmentColour(tables: NativeEnvironmentTables, blend: NativeEnvironmentBlend, section: BlackStartColourSection,
  hour: number): EnvironmentResult<RgbBytes> {
  return settledEnvironmentValue(blend, environmentType => sampleColour(tables, environmentType, section, hour) ?? blackStart, mixBytes);
}

export function skyLayerColour(tables: NativeEnvironmentTables, blend: NativeEnvironmentBlend, section: SkyLayerColourSection,
  hour: number): EnvironmentResult<RgbBytes, "sky-layer-start-colour-unresolved"> {
  const result = settledEnvironmentValue(blend, environmentType => sampleColour(tables, environmentType, section, hour),
    (defaultColour, targetColour, weight) => defaultColour === null || targetColour === null ? null : mixBytes(defaultColour, targetColour, weight));
  if (result.status === "unresolved") return result;
  return result.value === null ? { status: "unresolved", reason: "sky-layer-start-colour-unresolved" } : resolved(result.value);
}

export function environmentLightPlane(tables: NativeEnvironmentTables, blend: NativeEnvironmentBlend, section: HsvLightSection,
  hour: number): EnvironmentResult<NativePlane> {
  return settledEnvironmentValue(blend, environmentType => sampleTimeHsv(tables.get(environmentType)?.hsv[section] ?? [], hour) ?? zeroPlane, lerpPlanes);
}

export function environmentScale(tables: NativeEnvironmentTables, blend: NativeEnvironmentBlend, section: ScaleSection,
  hour: number): TimeScaleSample | EnvironmentTransitionGap {
  if (blend.oldType !== blend.targetType) return transitionGap;
  return sampleTimeScale(tables.get(blend.targetType)?.scale[section] ?? [], hour);
}
