import type { CameraZoneFogRecord } from "../../../materials/ue2/babylon/material";
import {
  isJsonRecord, readLightingFields, requireLightingRecords, unresolvedFieldProvenance, type LightingFieldValue, type LightingFields,
} from "./lightingFieldRecords";
import { decodeFogInfos, type DecodedFogInfo } from "./tileFogInfoRecords";
import { TileLightingDecodeError } from "./tileLightingDecodeError";

export type ZoneFogBlendTime =
  | { readonly status: "staged"; readonly seconds: number }
  | { readonly status: "unstaged"; readonly reason: string };

export interface TileLightingZone {
  readonly zoneIndex: number;
  readonly fog: CameraZoneFogRecord | null;
  readonly unresolvedReason: string | null;
  readonly distanceFogBlendTime: ZoneFogBlendTime;
}

export interface TileLightingRecords {
  readonly zones: readonly TileLightingZone[];
  readonly fogInfos: readonly DecodedFogInfo[];
  readonly waterVolumeCount: number;
}

export type TileLightingRecordsDocument = Readonly<Record<string, unknown>>;

const recordsKind = "native-tile-lighting-records";
const recordsSchemaVersion = 1;
const distanceFogEnableField = "bDistanceFog";
const distanceFogRangeFields = ["DistanceFogColor", "DistanceFogStart", "DistanceFogEnd"] as const;
const terrainZoneField = "bTerrainZone";
const blendTimeField = "DistanceFogBlendTime";
export const zoneFogBlendTimeUnstagedReason = "fog-zone-blend-time-unstaged";
const fogColourChannels = ["R", "G", "B"] as const;

function readFogColourBytes(value: unknown, label: string): readonly [number, number, number] {
  requireLightingRecords(isJsonRecord(value), `${label} DistanceFogColor is not a colour struct.`);
  const channels = fogColourChannels.map(channel => value[channel]);
  requireLightingRecords(channels.every(channel => Number.isInteger(channel) && (channel as number) >= 0 && (channel as number) <= 255),
    `${label} DistanceFogColor channels must be bytes.`);
  return channels as unknown as readonly [number, number, number];
}

function readTerrainZone(field: LightingFieldValue | undefined, label: string): boolean | null {
  if (field === undefined || field.provenance === unresolvedFieldProvenance) return null;
  requireLightingRecords(typeof field.value === "boolean" || field.value === null, `${label} bTerrainZone is not a boolean.`);
  return field.value === true;
}

function readBlendTime(field: LightingFieldValue | undefined, unresolvedReason: string, label: string): ZoneFogBlendTime {
  if (field === undefined) return { status: "unstaged", reason: zoneFogBlendTimeUnstagedReason };
  if (field.provenance === unresolvedFieldProvenance) return { status: "unstaged", reason: unresolvedReason };
  const seconds = field.value === null ? 0 : field.value;
  requireLightingRecords(typeof seconds === "number" && Number.isFinite(seconds), `${label} DistanceFogBlendTime is not a number.`);
  return { status: "staged", seconds };
}

function readZone(value: unknown, position: number): TileLightingZone {
  const label = `zones[${position}]`;
  requireLightingRecords(isJsonRecord(value) && Number.isSafeInteger(value.zoneIndex) && Array.isArray(value.distanceFog), `${label} has no zoneIndex and distanceFog list.`);
  const zoneIndex = value.zoneIndex as number;
  const fields: LightingFields = readLightingFields(value.distanceFog, `${label}.distanceFog`);
  const isUnresolved = (field: string) => fields.get(field) === undefined || fields.get(field)!.provenance === unresolvedFieldProvenance;
  const unresolvedReason = (field: string) => `lighting-zone-fog-unresolved:${zoneIndex}:${field}`;
  const distanceFogBlendTime = readBlendTime(fields.get(blendTimeField), unresolvedReason(blendTimeField), label);
  if (isUnresolved(distanceFogEnableField)) return { zoneIndex, fog: null, unresolvedReason: unresolvedReason(distanceFogEnableField), distanceFogBlendTime };
  const enabled = fields.get(distanceFogEnableField)!.value;
  requireLightingRecords(typeof enabled === "boolean" || enabled === null, `${label} bDistanceFog is not a boolean.`);
  const terrainZone = readTerrainZone(fields.get(terrainZoneField), label);
  if (enabled !== true) return { zoneIndex, fog: { distanceFog: false, terrainZone, fog: null }, unresolvedReason: null, distanceFogBlendTime };
  if (terrainZone !== false) return { zoneIndex, fog: { distanceFog: true, terrainZone, fog: null }, unresolvedReason: null, distanceFogBlendTime };
  const zoneWithoutRange = (reason: string): TileLightingZone => ({ zoneIndex, fog: { distanceFog: true, terrainZone, fog: null }, unresolvedReason: reason,
    distanceFogBlendTime });
  const unresolvedRangeField = distanceFogRangeFields.find(isUnresolved);
  if (unresolvedRangeField !== undefined) return zoneWithoutRange(unresolvedReason(unresolvedRangeField));
  const start = fields.get("DistanceFogStart")!.value, end = fields.get("DistanceFogEnd")!.value;
  requireLightingRecords(typeof start === "number" && typeof end === "number" && Number.isFinite(start) && Number.isFinite(end), `${label} fog range is not two numbers.`);
  if (end <= start) return zoneWithoutRange(`lighting-zone-fog-range-not-increasing:${zoneIndex}:${start}:${end}`);
  return { zoneIndex, unresolvedReason: null, distanceFogBlendTime, fog: { distanceFog: true, terrainZone,
    fog: { colourBytes: readFogColourBytes(fields.get("DistanceFogColor")!.value, label), startSourceUnits: start, endSourceUnits: end } } };
}

export function readTileLightingRecordsDocument(bytes: Uint8Array): TileLightingRecordsDocument {
  let document: unknown;
  try {
    document = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (error) {
    throw new TileLightingDecodeError(`RECS.canonicalJson is not UTF-8 JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  requireLightingRecords(isJsonRecord(document) && document.kind === recordsKind && document.schemaVersion === recordsSchemaVersion,
    `RECS.canonicalJson must be ${recordsKind} schema ${recordsSchemaVersion}.`);
  return document;
}

export function decodeTileLightingRecords(document: TileLightingRecordsDocument): TileLightingRecords {
  requireLightingRecords(Array.isArray(document.zones) && Array.isArray(document.fogInfos) && Array.isArray(document.waterVolumes),
    "the records need zones, fogInfos and waterVolumes lists.");
  const zones = (document.zones as unknown[]).map(readZone);
  requireLightingRecords(new Set(zones.map(zone => zone.zoneIndex)).size === zones.length, "two zone records share a zoneIndex.");
  return { zones, fogInfos: decodeFogInfos(document.fogInfos), waterVolumeCount: (document.waterVolumes as unknown[]).length };
}
