import type { FogFamily } from "./constants/blendFactorTypes";
import { FOG_CONSTANTS } from "./constants/fogConstants";

export type FogColourBytes = readonly [number, number, number];
export type FogSourceName = "volume" | "local-fog-list" | "camera-zone";

export interface FogRangeRecord {
  readonly colourBytes: FogColourBytes;
  readonly startSourceUnits: number;
  readonly endSourceUnits: number;
}

export interface CameraZoneFogRecord {
  readonly distanceFog: boolean;
  readonly fog: FogRangeRecord | null;
}

export interface FogInputs {
  readonly volume: FogRangeRecord | null;
  readonly localFogList: FogRangeRecord | null;
  readonly cameraZone: CameraZoneFogRecord | null;
}

export interface FogState {
  readonly enabled: boolean;
  readonly source: FogSourceName | "none" | "zone-without-fog";
  readonly colour: readonly [number, number, number];
  readonly startSourceUnits: number;
  readonly endSourceUnits: number;
  readonly fogEnd: number | null;
}

export interface FogRangeBounds {
  readonly min: number;
  readonly max: number;
}

export interface FogInfoColourKey {
  readonly time: number;
  readonly fogColourBytes: FogColourBytes;
}

export interface L2FogInfoRecord {
  readonly exportIndex: number;
  readonly location: { readonly x: number; readonly y: number; readonly z: number };
  readonly affectRange: FogRangeBounds;
  readonly fogRanges: readonly FogRangeBounds[];
  readonly colours: readonly FogInfoColourKey[];
}

export interface EnvironmentFogRanges {
  readonly startRanges: readonly number[];
  readonly endRanges: readonly number[];
}

export interface LocalFogListInputs {
  readonly hour: number;
  readonly terrainClipRange: number;
  readonly referencePosition: { readonly x: number; readonly y: number; readonly z: number };
}

export const FOG_DISABLED: FogState = { enabled: false, source: "none", colour: [0, 0, 0], startSourceUnits: 0, endSourceUnits: 0, fogEnd: null };
export const FOG_RANGE_SLOT_COUNT = 5;

const hoursPerDay = 24;
const fogRangeSlotFloors = [5, 6, 7, 8] as const;
const unmatchedHourColour: FogColourBytes = [0, 0, 0];

function requireFogRange(record: FogRangeRecord, source: FogSourceName): void {
  if (!record.colourBytes.every(channel => Number.isInteger(channel) && channel >= 0 && channel <= 255)) {
    throw new RangeError(`Fog ${source} colour must be three bytes.`);
  }
  if (!Number.isFinite(record.startSourceUnits) || !Number.isFinite(record.endSourceUnits) || record.endSourceUnits <= record.startSourceUnits) {
    throw new RangeError(`Fog ${source} range ${record.startSourceUnits} to ${record.endSourceUnits} must be finite and increasing.`);
  }
}

function enabledFog(record: FogRangeRecord, source: FogSourceName): FogState {
  requireFogRange(record, source);
  return {
    enabled: true, source, colour: [record.colourBytes[0] / 255, record.colourBytes[1] / 255, record.colourBytes[2] / 255],
    startSourceUnits: record.startSourceUnits, endSourceUnits: record.endSourceUnits, fogEnd: record.endSourceUnits,
  };
}

export function evaluateFogState(inputs: FogInputs): FogState {
  if (inputs.volume) return enabledFog(inputs.volume, "volume");
  if (inputs.localFogList) return enabledFog(inputs.localFogList, "local-fog-list");
  if (inputs.cameraZone === null) return FOG_DISABLED;
  if (!inputs.cameraZone.distanceFog) return { ...FOG_DISABLED, source: "zone-without-fog" };
  if (inputs.cameraZone.fog === null) throw new RangeError("A camera zone with distance fog needs its fog range.");
  return enabledFog(inputs.cameraZone.fog, "camera-zone");
}

export function fogRangeSlot(terrainClipRange: number): number {
  const slot = fogRangeSlotFloors.findIndex(floor => terrainClipRange < floor);
  return slot < 0 ? fogRangeSlotFloors.length : slot;
}

export function fogInfoColourAtHour(colours: readonly FogInfoColourKey[], hour: number): FogColourBytes {
  const normalisedHour = ((hour % hoursPerDay) + hoursPerDay) % hoursPerDay;
  for (let index = 0; index < colours.length; index++) {
    const current = colours[index]!, next = colours[(index + 1) % colours.length]!;
    const nextTime = index + 1 === colours.length ? next.time + hoursPerDay : next.time;
    if (current.time <= normalisedHour && normalisedHour <= nextTime) {
      const amount = (hour - current.time) / (nextTime - current.time);
      return current.fogColourBytes.map((channel, position) => Math.trunc(channel + amount * (next.fogColourBytes[position]! - channel))) as unknown as FogColourBytes;
    }
  }
  return unmatchedHourColour;
}

export function fogInfoWeight(affectRange: FogRangeBounds, distance: number, colourCount: number): number {
  if (colourCount < 2 || distance >= affectRange.max) return 0;
  if (distance < affectRange.min) return 1;
  return (affectRange.max - distance) / (affectRange.max - affectRange.min);
}

export function environmentFogBaseline(ranges: EnvironmentFogRanges, terrainClipRange: number): FogRangeRecord {
  const slot = fogRangeSlot(terrainClipRange), unit = FOG_CONSTANTS.rangeUnit.runtimeDefault, grey = FOG_CONSTANTS.neutralGreyByte.runtimeDefault;
  return { colourBytes: [grey, grey, grey], startSourceUnits: ranges.startRanges[slot]! * unit, endSourceUnits: ranges.endRanges[slot]! * unit };
}

export function localFogListRecord(fogInfos: readonly L2FogInfoRecord[], baseline: FogRangeRecord, inputs: LocalFogListInputs): FogRangeRecord {
  const slot = fogRangeSlot(inputs.terrainClipRange);
  let start = baseline.startSourceUnits, end = baseline.endSourceUnits;
  let colour: FogColourBytes = baseline.colourBytes;
  for (const fogInfo of fogInfos) {
    const { x, y, z } = inputs.referencePosition;
    const distance = Math.hypot(fogInfo.location.x - x, fogInfo.location.y - y, fogInfo.location.z - z);
    const weight = fogInfoWeight(fogInfo.affectRange, distance, fogInfo.colours.length);
    const range = fogInfo.fogRanges[slot]!, target = fogInfoColourAtHour(fogInfo.colours, inputs.hour);
    start += weight * (range.min - start);
    end += weight * (range.max - end);
    colour = colour.map((channel, position) => Math.trunc(channel + weight * (target[position]! - channel))) as unknown as FogColourBytes;
  }
  return { colourBytes: colour, startSourceUnits: start, endSourceUnits: end };
}

export function fogTargetColour(family: FogFamily, state: FogState): readonly [number, number, number] | null {
  if (!state.enabled) return null;
  switch (family) {
    case "fog-colour": return state.colour;
    case "black": return [0, 0, 0];
    case "neutral-grey": {
      const grey = FOG_CONSTANTS.neutralGreyByte.runtimeDefault / 255;
      return [grey, grey, grey];
    }
    case "none": return null;
  }
}
