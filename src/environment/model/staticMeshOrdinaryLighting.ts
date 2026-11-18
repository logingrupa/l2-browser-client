import { absoluteFloat32 } from "./lightmapRebuild/nativeFloatOperations";
import { resolvedResult, type LightmapRebuildResult, type NativeVector3 } from "./lightmapRebuild/lightmapRebuildTypes";
import { fColorFromPlane, saturatingAddBgra, type BgraBytes } from "./nativeColourBytes";
import type { NativePlane } from "./nativePlane";
import { STATIC_MESH_ORDINARY_LIGHTING_CONSTANTS } from "./staticMeshOrdinaryLightingEngineConstants";

export type StaticMeshLightSampler =
  | { readonly effect: "point"; readonly position: NativeVector3; readonly radius: number }
  | { readonly effect: "spot"; readonly position: NativeVector3; readonly radius: number; readonly direction: NativeVector3; readonly cone: number };

export interface StaticMeshOrdinaryLight {
  readonly colour: NativePlane;
  readonly sampler: StaticMeshLightSampler;
}

export interface StaticMeshVertexSample {
  readonly worldPosition: NativeVector3;
  readonly worldNormal: NativeVector3;
}

export type UnportedStaticMeshLightEffectReason = `static-mesh-light-effect-unported:${number}`;

const { pointFalloffCubicScale, pointFalloffSquareScale, pointFalloffOffset, coneUnitScale, scaleGlowGain } = STATIC_MESH_ORDINARY_LIGHTING_CONSTANTS;
const pointLightEffect = 0;
const spotLightEffect = 12;
const darkContribution: BgraBytes = [0, 0, 0, 0];

export function staticMeshLightSamplerEffect(lightEffect: number): LightmapRebuildResult<StaticMeshLightSampler["effect"], UnportedStaticMeshLightEffectReason> {
  if (lightEffect === pointLightEffect) return resolvedResult("point");
  if (lightEffect === spotLightEffect) return resolvedResult("spot");
  return { status: "unresolved", reason: `static-mesh-light-effect-unported:${lightEffect}` };
}

function pointAttenuation(distance: number, radius: number, delta: NativeVector3, normal: NativeVector3): number {
  const dot = Math.fround((delta[1] * normal[1] + normal[0] * delta[0]) + delta[2] * normal[2]);
  if (dot <= 0 || distance > radius) return 0;
  const unitDistance = Math.fround(distance / radius);
  const falloff = Math.fround((((pointFalloffCubicScale.value * unitDistance) * unitDistance) * unitDistance
    - (pointFalloffSquareScale.value * unitDistance) * unitDistance) + pointFalloffOffset.value);
  const incidence = absoluteFloat32(Math.fround(dot / radius));
  return Math.fround((incidence * (falloff / unitDistance)) * pointFalloffCubicScale.value);
}

function spotConeRamp(sampler: Extract<StaticMeshLightSampler, { effect: "spot" }>, delta: NativeVector3, distanceSquared: number, distance: number): number {
  const coneCosine = Math.fround(1 - sampler.cone * coneUnitScale.value);
  const inverseConeWidth = Math.fround(1 / (1 - coneCosine));
  const toVertex: NativeVector3 = [Math.fround(-delta[0]), Math.fround(-delta[1]), Math.fround(-delta[2])];
  const { direction } = sampler;
  const alignment = Math.fround((direction[1] * toVertex[1] + toVertex[0] * direction[0]) + direction[2] * toVertex[2]);
  if (alignment <= 0 || Math.fround(coneCosine * coneCosine) * distanceSquared >= Math.fround(alignment * alignment)) return 0;
  const bias = Math.fround(inverseConeWidth * coneCosine);
  const ramp = Math.fround((inverseConeWidth * alignment) / distance - bias);
  return Math.fround(ramp * ramp);
}

export function staticMeshLightSampleIntensity(sampler: StaticMeshLightSampler, sample: StaticMeshVertexSample): number {
  const { position } = sampler, { worldPosition, worldNormal } = sample;
  const delta: NativeVector3 = [Math.fround(position[0] - worldPosition[0]), Math.fround(position[1] - worldPosition[1]), Math.fround(position[2] - worldPosition[2])];
  const distanceSquared = Math.fround((delta[0] * delta[0] + delta[1] * delta[1]) + delta[2] * delta[2]);
  const distance = Math.fround(Math.sqrt(distanceSquared));
  const attenuation = pointAttenuation(distance, sampler.radius, delta, worldNormal);
  if (sampler.effect === "point" || attenuation <= 0) return attenuation;
  return Math.fround(attenuation * spotConeRamp(sampler, delta, distanceSquared, distance));
}

export function staticMeshOrdinaryLightGain(scaleGlow: number): number {
  return Math.fround(Math.fround(scaleGlow) * scaleGlowGain.value);
}

export function staticMeshOrdinaryLightContribution(colour: NativePlane, gain: number, intensity: number): BgraBytes {
  const channel = (component: number) => Math.fround(Math.fround(component * gain) * intensity);
  return fColorFromPlane([channel(colour[0]), channel(colour[1]), channel(colour[2]), 0]);
}

export function staticMeshOrdinaryVertexColour(lights: readonly StaticMeshOrdinaryLight[], gain: number, sample: StaticMeshVertexSample): BgraBytes {
  return lights.reduce((colour, light) => saturatingAddBgra(colour, staticMeshOrdinaryLightContribution(light.colour, gain,
    staticMeshLightSampleIntensity(light.sampler, sample))), darkContribution);
}
