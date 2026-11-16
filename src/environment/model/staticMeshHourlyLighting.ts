import { HOURLY_LIGHTING_CONSTANTS } from "./hourlyLightingEngineConstants";
import { fColorFromPlane, type BgraBytes } from "./nativeColourBytes";
import { ENVIRONMENT_ENGINE_CONSTANTS } from "./nativeEnvironmentEngineConstants";
import { scalePlane, type NativePlane } from "./nativePlane";
import { blendAdjacentHourlyKeys, type HourlyKeyBlend } from "./sampleNativeTimeTables";

export type StaticMeshHourlyPath = "shader-visibility" | "cpu-rebuild";
export type StaticMeshHourlyEntry = "previous" | "next";

const { staticMeshHourKeyHalfStep, staticMeshCpuEntryScale: cpuEntryScale, staticMeshAuthoredColourDivisor } = HOURLY_LIGHTING_CONSTANTS;
const { hoursPerDay } = ENVIRONMENT_ENGINE_CONSTANTS;
const bitsPerByte = 8;

function requireEntryCount(entryCount: number): void {
  if (!Number.isSafeInteger(entryCount) || entryCount < 1) throw new RangeError(`Static mesh hourly entry count ${entryCount} must be a positive integer.`);
}

export function staticMeshHourKey(index: number, entryCount: number): number {
  const count = Math.fround(entryCount);
  return Math.fround((index * hoursPerDay.value) / count + (hoursPerDay.value / count) * staticMeshHourKeyHalfStep.value);
}

export function staticMeshPreviousEntryIndex(entryCount: number, hour: number): number {
  requireEntryCount(entryCount);
  const entryHour = Math.fround(hour);
  let previous = entryCount - 1;
  for (let index = 0; index < entryCount; index += 1) {
    if (entryHour < staticMeshHourKey(index, entryCount)) break;
    previous = index;
  }
  return previous;
}

export function staticMeshHourlyEntryBlend(entryCount: number, hour: number): HourlyKeyBlend {
  const keys = Array.from({ length: entryCount }, (_, index) => staticMeshHourKey(index, entryCount));
  return blendAdjacentHourlyKeys(keys, staticMeshPreviousEntryIndex(entryCount, hour), hour);
}

export function staticMeshVertexVisible(visibilityMask: Uint8Array, vertexIndex: number): boolean {
  const maskByte = visibilityMask[Math.floor(vertexIndex / bitsPerByte)];
  if (!Number.isSafeInteger(vertexIndex) || vertexIndex < 0 || maskByte === undefined) {
    throw new RangeError(`Static mesh vertex ${vertexIndex} is outside the ${visibilityMask.length}-byte visibility mask.`);
  }
  return ((maskByte >> (vertexIndex % bitsPerByte)) & 1) === 1;
}

export function staticMeshShaderVisibility(previousContributes: boolean, nextContributes: boolean, weight: number): number {
  let visibility = 0;
  if (previousContributes) visibility = Math.fround(visibility + (1 - weight));
  if (nextContributes) visibility = Math.fround(visibility + weight);
  return visibility;
}

export function staticMeshHourlyPath(actorShaderLightingFlag: boolean, gl2ShaderEnabled: boolean): StaticMeshHourlyPath {
  return actorShaderLightingFlag && gl2ShaderEnabled ? "shader-visibility" : "cpu-rebuild";
}

export function staticMeshCpuEntryScale(weight: number, entry: StaticMeshHourlyEntry): number {
  return Math.fround((entry === "previous" ? 1 - weight : weight) * cpuEntryScale.value);
}

export function staticMeshCpuVertexContribution(sampleIntensity: number, staticSunPlane: NativePlane, entryScale: number): BgraBytes {
  const scaledPlane = scalePlane(staticSunPlane, entryScale);
  const intensity = Math.fround(sampleIntensity);
  return fColorFromPlane([Math.fround(intensity * scaledPlane[0]), Math.fround(intensity * scaledPlane[1]), Math.fround(intensity * scaledPlane[2]), 0]);
}

export function staticMeshInstanceColourWithAuthored(instanceColour: BgraBytes, authoredColour: BgraBytes, meshColourSelectorSet: boolean): BgraBytes {
  const modulated = (channel: 0 | 1 | 2) => meshColourSelectorSet
    ? Math.trunc((instanceColour[channel] * authoredColour[channel]) / staticMeshAuthoredColourDivisor.value) : instanceColour[channel];
  return [modulated(0), modulated(1), modulated(2), authoredColour[3]];
}
