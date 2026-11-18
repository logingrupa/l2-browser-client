import type { Vector3 } from "../../shared/math/vector3";
import { HOURLY_LIGHTING_CONSTANTS } from "./hourlyLightingEngineConstants";
import { fColorFromPlane, saturatingAddBgra, type BgraBytes } from "./nativeColourBytes";
import { ENVIRONMENT_ENGINE_CONSTANTS } from "./nativeEnvironmentEngineConstants";
import type { NativePlane } from "./nativePlane";
import { blendAdjacentHourlyKeys, type HourlyKeyBlend, type RgbBytes } from "./sampleNativeTimeTables";

export type NativeLocalToWorldRows = readonly [Vector3, Vector3, Vector3];

export interface StaticMeshHourlyEntryContribution {
  readonly contributes: boolean;
  readonly weight: number;
}

const { staticMeshHourKeyHalfStep, staticMeshSampleIntensityScale, staticMeshHourlyLightScale } = HOURLY_LIGHTING_CONSTANTS;
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

export function staticMeshWorldNormal(localToWorld: NativeLocalToWorldRows, localNormal: Vector3): Vector3 {
  const [xAxis, yAxis, zAxis] = localToWorld;
  const transformed = {
    x: Math.fround(localNormal.x * xAxis.x + localNormal.y * yAxis.x + localNormal.z * zAxis.x),
    y: Math.fround(localNormal.x * xAxis.y + localNormal.y * yAxis.y + localNormal.z * zAxis.y),
    z: Math.fround(localNormal.x * xAxis.z + localNormal.y * yAxis.z + localNormal.z * zAxis.z),
  };
  const squaredLength = Math.fround(transformed.x * transformed.x + transformed.y * transformed.y + transformed.z * transformed.z);
  const inverseLength = Math.fround(1 / Math.sqrt(squaredLength));
  return { x: Math.fround(transformed.x * inverseLength), y: Math.fround(transformed.y * inverseLength), z: Math.fround(transformed.z * inverseLength) };
}

export function staticMeshSampleIntensity(worldNormal: Vector3, lightDirection: Vector3): number {
  const dot = worldNormal.x * lightDirection.x + worldNormal.y * lightDirection.y + worldNormal.z * lightDirection.z;
  return Math.max(0, Math.fround(dot * staticMeshSampleIntensityScale.value));
}

export function staticMeshHourlyEntryContributions(blend: HourlyKeyBlend, previousContributes: boolean, nextContributes: boolean):
  readonly [StaticMeshHourlyEntryContribution, StaticMeshHourlyEntryContribution] {
  return [{ contributes: previousContributes, weight: Math.fround(1 - blend.weight) }, { contributes: nextContributes, weight: blend.weight }];
}

export function staticMeshHourlyInstanceColour(sampleIntensity: number, entries: readonly StaticMeshHourlyEntryContribution[], staticSunPlane: NativePlane,
  ordinaryColour: BgraBytes): RgbBytes {
  let hourlyColour: BgraBytes = [0, 0, 0, 0];
  for (const entry of entries) {
    if (!entry.contributes) continue;
    const scale = sampleIntensity * staticMeshHourlyLightScale.value * entry.weight;
    const scaledPlane: NativePlane = [Math.fround(scale * staticSunPlane[0]), Math.fround(scale * staticSunPlane[1]), Math.fround(scale * staticSunPlane[2]),
      Math.fround(scale * staticSunPlane[3])];
    hourlyColour = saturatingAddBgra(hourlyColour, fColorFromPlane(scaledPlane));
  }
  const colour = saturatingAddBgra(ordinaryColour, hourlyColour);
  return [colour[2], colour[1], colour[0]];
}

export function staticMeshShaderVisibility(previousContributes: boolean, nextContributes: boolean, weight: number): number {
  let visibility = 0;
  if (previousContributes) visibility = Math.fround(visibility + (1 - weight));
  if (nextContributes) visibility = Math.fround(visibility + weight);
  return visibility;
}
