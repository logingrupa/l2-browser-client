import { fGetHsv } from "./fGetHsv";
import { ENVIRONMENT_ENGINE_CONSTANTS } from "./nativeEnvironmentEngineConstants";
import { lerpPlanes, scalePlane, type NativePlane } from "./nativePlane";

export interface NativeTimeColourRow {
  readonly time: number;
  readonly red: number;
  readonly green: number;
  readonly blue: number;
}

export interface NativeTimeHsvRow {
  readonly time: number;
  readonly hue: number;
  readonly saturation: number;
  readonly brightness: number;
}

export interface NativeTimeScaleRow {
  readonly time: number;
  readonly scale: number;
}

export type RgbBytes = readonly [red: number, green: number, blue: number];

export type TimeScaleSample =
  | { readonly status: "sampled"; readonly value: number }
  | { readonly status: "unwritten" }
  | { readonly status: "unresolved"; readonly reason: "time-scale-read-past-table" };

export interface TerrainIntensityMapBlend {
  readonly index: number;
  readonly nextIndex: number;
  readonly weight: number;
}

const { byteMaximum, hoursPerDay } = ENVIRONMENT_ENGINE_CONSTANTS;
const byteMask = 0xff;

function firstBracketBeforeLastRow(rows: readonly { readonly time: number }[], hour: number): number | null {
  for (let index = 0; index < rows.length - 1; index += 1) {
    if (rows[index]!.time <= hour && hour < rows[index + 1]!.time) return index;
  }
  return null;
}

function bracketWeight(from: number, to: number, hour: number): number {
  return Math.fround((hour - from) / Math.fround(to - from));
}

export function interpolateByteChannel(from: number, to: number, weight: number): number {
  return Math.trunc(from + (to - from) * weight) & byteMask;
}

export function sampleTimeColour(rows: readonly NativeTimeColourRow[], hour: number): RgbBytes | null {
  const index = firstBracketBeforeLastRow(rows, hour);
  if (index === null) return null;
  const from = rows[index]!, to = rows[index + 1]!;
  const weight = bracketWeight(from.time, to.time, hour);
  return [interpolateByteChannel(from.red, to.red, weight), interpolateByteChannel(from.green, to.green, weight), interpolateByteChannel(from.blue, to.blue, weight)];
}

export function sampleTimeHsv(rows: readonly NativeTimeHsvRow[], hour: number): NativePlane | null {
  const index = firstBracketBeforeLastRow(rows, hour);
  if (index === null) return null;
  const from = rows[index]!, to = rows[index + 1]!;
  const weight = bracketWeight(from.time, to.time, hour);
  const plane = lerpPlanes(fGetHsv(from.hue, from.saturation, byteMaximum.value), fGetHsv(to.hue, to.saturation, byteMaximum.value), weight);
  const brightness = Math.fround(Math.fround((to.brightness - from.brightness) * weight + from.brightness) / byteMaximum.value);
  return scalePlane(plane, brightness);
}

export function sampleTimeScale(rows: readonly NativeTimeScaleRow[], hour: number): TimeScaleSample {
  for (let index = 0; index < rows.length; index += 1) {
    if (!(rows[index]!.time <= hour)) continue;
    const to = rows[index + 1];
    if (to === undefined) return { status: "unresolved", reason: "time-scale-read-past-table" };
    if (!(hour < to.time)) continue;
    const from = rows[index]!;
    const weight = bracketWeight(from.time, to.time, hour);
    return { status: "sampled", value: Math.fround((to.scale - from.scale) * weight + from.scale) };
  }
  return { status: "unwritten" };
}

export function shadowMapIndexAtHour(mapTimes: readonly number[], hour: number): number {
  let normalisedHour = Math.fround(hour);
  while (normalisedHour < 0) normalisedHour = Math.fround(normalisedHour + hoursPerDay.value);
  while (normalisedHour >= hoursPerDay.value) normalisedHour = Math.fround(normalisedHour - hoursPerDay.value);
  for (let index = 0; index < mapTimes.length - 1; index += 1) {
    if (mapTimes[index]! <= normalisedHour && normalisedHour < mapTimes[index + 1]!) return index;
  }
  return mapTimes.length - 1;
}

export function terrainIntensityMapBlend(mapTimes: readonly number[], hour: number): TerrainIntensityMapBlend {
  if (mapTimes.length === 0) throw new RangeError("Terrain intensity map blending needs at least one map time.");
  const index = shadowMapIndexAtHour(mapTimes, hour);
  const nextIndex = (index + 1) % mapTimes.length;
  const fromTime = mapTimes[index]!;
  let toTime = mapTimes[nextIndex]!;
  while (toTime < fromTime) toTime = Math.fround(toTime + hoursPerDay.value);
  let unwrappedHour = Math.fround(hour);
  while (unwrappedHour < fromTime) unwrappedHour = Math.fround(unwrappedHour + hoursPerDay.value);
  return { index, nextIndex, weight: Math.fround((unwrappedHour - fromTime) / (toTime - fromTime)) };
}
