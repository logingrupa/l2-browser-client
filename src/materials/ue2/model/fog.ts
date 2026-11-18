import type { FogFamily } from "./constants/blendFactorTypes";
import { FOG_CONSTANTS } from "./constants/fogConstants";

export type FogColourBytes = readonly [number, number, number];
export type FogSourceName = "volume" | "local-fog-list" | "terrain-zone-environment" | "camera-zone";

export interface FogRangeRecord {
  readonly colourBytes: FogColourBytes;
  readonly startSourceUnits: number;
  readonly endSourceUnits: number;
}

export interface CameraZoneFogRecord {
  readonly distanceFog: boolean;
  readonly terrainZone: boolean | null;
  readonly fog: FogRangeRecord | null;
}

export type LocalFogList =
  | { readonly status: "empty" }
  | { readonly status: "blended"; readonly record: FogRangeRecord }
  | { readonly status: "unresolved" };

export type TerrainZoneEnvironmentFog =
  | { readonly status: "resolved"; readonly record: FogRangeRecord }
  | { readonly status: "unresolved" };

export interface FogInputs {
  readonly volume: FogRangeRecord | null;
  readonly localFogList: LocalFogList;
  readonly cameraZone: CameraZoneFogRecord | null;
  readonly terrainZoneEnvironment: TerrainZoneEnvironmentFog;
}

export interface FogState {
  readonly enabled: boolean;
  readonly source: FogSourceName | "none" | "zone-without-fog" | "unresolved";
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

export interface FogSourcePosition {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface L2FogInfoRecord {
  readonly exportIndex: number;
  readonly sourceLocation: FogSourcePosition;
  readonly affectRange: FogRangeBounds;
  readonly textureDistance: number;
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
  readonly referencePosition: FogSourcePosition;
}

export interface LocalFogListEvaluation {
  readonly list: LocalFogList;
  readonly retentionDistanceDecides: boolean;
  readonly orderCanChangeResult: boolean;
}

export const FOG_DISABLED: FogState = { enabled: false, source: "none", colour: [0, 0, 0], startSourceUnits: 0, endSourceUnits: 0, fogEnd: null };
export const FOG_UNRESOLVED: FogState = { ...FOG_DISABLED, source: "unresolved" };
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
  if (inputs.localFogList.status === "blended") return enabledFog(inputs.localFogList.record, "local-fog-list");
  if (inputs.localFogList.status === "unresolved") return FOG_UNRESOLVED;
  const zone = inputs.cameraZone;
  if (zone === null) return FOG_DISABLED;
  if (!zone.distanceFog) return { ...FOG_DISABLED, source: "zone-without-fog" };
  if (zone.terrainZone === null) return FOG_UNRESOLVED;
  if (zone.terrainZone) {
    const environment = inputs.terrainZoneEnvironment;
    return environment.status === "resolved" ? enabledFog(environment.record, "terrain-zone-environment") : FOG_UNRESOLVED;
  }
  if (zone.fog === null) throw new RangeError("A camera zone with distance fog needs its fog range.");
  return enabledFog(zone.fog, "camera-zone");
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

export function environmentFogPreset(ranges: EnvironmentFogRanges, terrainClipRange: number, colourBytes: FogColourBytes): FogRangeRecord {
  const slot = fogRangeSlot(terrainClipRange), unit = FOG_CONSTANTS.rangeUnit.runtimeDefault;
  return { colourBytes, startSourceUnits: ranges.startRanges[slot]! * unit, endSourceUnits: ranges.endRanges[slot]! * unit };
}

interface FogInfoContribution {
  readonly fogInfo: L2FogInfoRecord;
  readonly distance: number;
  readonly weight: number;
  readonly range: FogRangeBounds;
  readonly target: FogColourBytes;
}

function fogInfoContribution(fogInfo: L2FogInfoRecord, inputs: LocalFogListInputs, slot: number): FogInfoContribution {
  const { x, y, z } = inputs.referencePosition;
  const distance = Math.hypot(fogInfo.sourceLocation.x - x, fogInfo.sourceLocation.y - y, fogInfo.sourceLocation.z - z);
  return { fogInfo, distance, weight: fogInfoWeight(fogInfo.affectRange, distance, fogInfo.colours.length), range: fogInfo.fogRanges[slot]!,
    target: fogInfoColourAtHour(fogInfo.colours, inputs.hour) };
}

function sameTarget(first: FogInfoContribution, second: FogInfoContribution): boolean {
  return first.range.min === second.range.min && first.range.max === second.range.max && first.target.every((channel, position) => channel === second.target[position]);
}

function orderCanChangeResult(contributing: readonly FogInfoContribution[]): boolean {
  if (contributing.length < 2) return false;
  const partialCount = contributing.filter(contribution => contribution.weight < 1).length;
  return partialCount >= 2 || contributing.some(contribution => !sameTarget(contribution, contributing[0]!));
}

function blendLocalFogList(contributions: readonly Pick<FogInfoContribution, "weight" | "range" | "target">[], baseline: FogRangeRecord): FogRangeRecord {
  let start = baseline.startSourceUnits, end = baseline.endSourceUnits;
  let colour: FogColourBytes = baseline.colourBytes;
  for (const { weight, range, target } of contributions) {
    start += weight * (range.min - start);
    end += weight * (range.max - end);
    colour = colour.map((channel, position) => Math.trunc(channel + weight * (target[position]! - channel))) as unknown as FogColourBytes;
  }
  return { colourBytes: colour, startSourceUnits: start, endSourceUnits: end };
}

export function evaluateLocalFogList(fogInfos: readonly L2FogInfoRecord[], baseline: FogRangeRecord, inputs: LocalFogListInputs): LocalFogListEvaluation {
  const slot = fogRangeSlot(inputs.terrainClipRange);
  const contributions = fogInfos.map(fogInfo => fogInfoContribution(fogInfo, inputs, slot));
  const retained = contributions.filter(contribution => contribution.distance <= contribution.fogInfo.affectRange.max
    || contribution.distance < contribution.fogInfo.textureDistance);
  const retentionDistanceDecides = contributions.length > 0 && !contributions.some(contribution => contribution.distance <= contribution.fogInfo.affectRange.max);
  const contributing = retained.filter(contribution => contribution.weight > 0);
  const list: LocalFogList = retained.length === 0 ? { status: "empty" }
    : { status: "blended", record: blendLocalFogList(retained, baseline) };
  return { list, retentionDistanceDecides, orderCanChangeResult: orderCanChangeResult(contributing) };
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
