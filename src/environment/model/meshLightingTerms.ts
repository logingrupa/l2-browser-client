import { HOURLY_LIGHTING_CONSTANTS } from "./hourlyLightingEngineConstants";
import type { RgbaBytes } from "./nativeColourBytes";
import { scalePlane, type NativePlane } from "./nativePlane";
import type { RgbBytes } from "./sampleNativeTimeTables";
import { lowByte, truncateToInt32 } from "./x87IntegerConversion";

export type AmbientLight<Reason extends string> =
  | { readonly status: "resolved"; readonly value: RgbaBytes }
  | { readonly status: "unresolved"; readonly reason: Reason };

export interface StaticMeshAmbientInputs {
  readonly hourlyAmbient: RgbBytes;
  readonly actorSunAffect: boolean;
  readonly selectedLevelOfDetail: number;
  readonly hasStaticMeshInstance: boolean;
  readonly staticSunPlane: NativePlane;
}

export interface DynamicLightActor {
  readonly hourlyFlag: boolean;
  readonly kind: number;
}

export type DynamicLightColourType = 0 | 1;

export type DynamicLightDiffuse =
  | { readonly status: "resolved"; readonly value: NativePlane }
  | { readonly status: "unresolved"; readonly reason: "dynamic-light-point-spot-attenuation-unresolved" };

const {
  staticMeshSunTermScale, staticMeshSunTermLevelOfDetail, dynamicLightBrightnessDivisor, dynamicLightUnhourlyKinds, dynamicLightHalvedColourType,
  dynamicLightHalvingDivisor, directionalLightEffect, directionalLightScale, directionalModulatedLightScales,
} = HOURLY_LIGHTING_CONSTANTS;
const opaqueAlpha = 255;
const byteMaximum = 255;

function halvedAmbient(ambient: RgbBytes): RgbaBytes {
  return [ambient[0] >> 1, ambient[1] >> 1, ambient[2] >> 1, opaqueAlpha];
}

function sunTermChannel(halvedChannel: number, sunChannel: number): number {
  return Math.min(byteMaximum, lowByte(truncateToInt32(sunChannel * staticMeshSunTermScale.value)) + halvedChannel);
}

export function staticMeshAmbientLight(inputs: StaticMeshAmbientInputs): AmbientLight<"static-mesh-unhourly-ambient-unresolved"> {
  if (!inputs.actorSunAffect) return { status: "unresolved", reason: "static-mesh-unhourly-ambient-unresolved" };
  const halved = halvedAmbient(inputs.hourlyAmbient);
  if (inputs.hasStaticMeshInstance || inputs.selectedLevelOfDetail !== staticMeshSunTermLevelOfDetail.value) return { status: "resolved", value: halved };
  const plane = inputs.staticSunPlane;
  return { status: "resolved", value: [sunTermChannel(halved[0], plane[0]), sunTermChannel(halved[1], plane[1]), sunTermChannel(halved[2], plane[2]), opaqueAlpha] };
}

export function actorAmbientLight(hourlyAmbient: RgbBytes, actorSunAffect: boolean): AmbientLight<"actor-unhourly-ambient-unresolved"> {
  return actorSunAffect ? { status: "resolved", value: halvedAmbient(hourlyAmbient) } : { status: "unresolved", reason: "actor-unhourly-ambient-unresolved" };
}

export function dynamicLightUsesHourlyPlanes(lightActor: DynamicLightActor, environmentManagerPresent: boolean): boolean {
  return lightActor.hourlyFlag && environmentManagerPresent && !(dynamicLightUnhourlyKinds.value as readonly number[]).includes(lightActor.kind);
}

export function dynamicLightPlane(baseColour: NativePlane, brightness: number, temporalLightFactor: number, levelBrightness: number): NativePlane {
  const brightnessFraction = Math.fround(brightness / dynamicLightBrightnessDivisor.value);
  return scalePlane(scalePlane(scalePlane(baseColour, brightnessFraction), Math.fround(temporalLightFactor)), Math.fround(levelBrightness));
}

export function dynamicLightDiffuse(lightColour: NativePlane, colourType: DynamicLightColourType, lightEffect: number, modulationFlag: boolean): DynamicLightDiffuse {
  if (lightEffect !== directionalLightEffect.value) return { status: "unresolved", reason: "dynamic-light-point-spot-attenuation-unresolved" };
  const colour = colourType === dynamicLightHalvedColourType.value ? lightColour.map(channel => Math.fround(channel / dynamicLightHalvingDivisor.value)) : lightColour;
  const { first, second } = directionalModulatedLightScales.value;
  const scaled = (channel: number) => Math.fround(modulationFlag ? channel * first * second : channel * directionalLightScale.value);
  return { status: "resolved", value: [scaled(colour[0]!), scaled(colour[1]!), scaled(colour[2]!), 0] };
}
