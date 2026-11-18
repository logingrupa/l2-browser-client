import type { CameraZoneFogRecord } from "../../../materials/ue2/babylon/material";
import { decodeFogInfos, type DecodedFogInfo } from "./tileFogInfoRecords";
import { TileLightingDecodeError } from "./tileLightingDecodeError";

export interface TileLightingZone {
  readonly zoneIndex: number;
  readonly fog: CameraZoneFogRecord | null;
  readonly unresolvedReason: string | null;
}

export interface TileLightingRecords {
  readonly zones: readonly TileLightingZone[];
  readonly fogInfos: readonly DecodedFogInfo[];
  readonly waterVolumeCount: number;
}

interface FieldRecord {
  readonly field: string;
  readonly provenance: string;
  readonly value: unknown;
}

const recordsKind = "native-tile-lighting-records";
const recordsSchemaVersion = 1;
const unresolvedProvenance = "unresolved";
const zoneFogFields = ["bDistanceFog", "DistanceFogColor", "DistanceFogStart", "DistanceFogEnd"] as const;
const terrainZoneField = "bTerrainZone";
const fogColourChannels = ["R", "G", "B"] as const;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function requireRecords(condition: boolean, message: string): asserts condition {
  if (!condition) throw new TileLightingDecodeError(`lighting records: ${message}`);
}

function readFieldRecord(value: unknown, label: string): FieldRecord {
  requireRecords(isRecord(value) && typeof value.field === "string" && typeof value.provenance === "string" && Object.hasOwn(value, "value"),
    `${label} is not a field record with field, provenance and value.`);
  return { field: value.field as string, provenance: value.provenance as string, value: value.value };
}

function readFogColourBytes(value: unknown, label: string): readonly [number, number, number] {
  requireRecords(isRecord(value), `${label} DistanceFogColor is not a colour struct.`);
  const channels = fogColourChannels.map(channel => value[channel]);
  requireRecords(channels.every(channel => Number.isInteger(channel) && (channel as number) >= 0 && (channel as number) <= 255),
    `${label} DistanceFogColor channels must be bytes.`);
  return channels as unknown as readonly [number, number, number];
}

function readTerrainZone(field: FieldRecord | undefined, label: string): boolean | null {
  if (field === undefined || field.provenance === unresolvedProvenance) return null;
  requireRecords(typeof field.value === "boolean" || field.value === null, `${label} bTerrainZone is not a boolean.`);
  return field.value === true;
}

function readZone(value: unknown, position: number): TileLightingZone {
  const label = `zones[${position}]`;
  requireRecords(isRecord(value) && Number.isSafeInteger(value.zoneIndex) && Array.isArray(value.distanceFog), `${label} has no zoneIndex and distanceFog list.`);
  const zoneIndex = value.zoneIndex as number;
  const fields = new Map((value.distanceFog as unknown[]).map((entry, index) => readFieldRecord(entry, `${label}.distanceFog[${index}]`)).map(entry => [entry.field, entry]));
  const unresolvedField = zoneFogFields.find(field => fields.get(field) === undefined || fields.get(field)!.provenance === unresolvedProvenance);
  if (unresolvedField !== undefined) return { zoneIndex, fog: null, unresolvedReason: `lighting-zone-fog-unresolved:${zoneIndex}:${unresolvedField}` };
  const enabled = fields.get("bDistanceFog")!.value, start = fields.get("DistanceFogStart")!.value, end = fields.get("DistanceFogEnd")!.value;
  requireRecords(typeof enabled === "boolean" || enabled === null, `${label} bDistanceFog is not a boolean.`);
  const terrainZone = readTerrainZone(fields.get(terrainZoneField), label);
  if (enabled !== true) return { zoneIndex, fog: { distanceFog: false, terrainZone, fog: null }, unresolvedReason: null };
  requireRecords(typeof start === "number" && typeof end === "number" && Number.isFinite(start) && Number.isFinite(end), `${label} fog range is not two numbers.`);
  if (end <= start) return { zoneIndex, fog: null, unresolvedReason: `lighting-zone-fog-range-not-increasing:${zoneIndex}:${start}:${end}` };
  return { zoneIndex, unresolvedReason: null, fog: { distanceFog: true, terrainZone,
    fog: { colourBytes: readFogColourBytes(fields.get("DistanceFogColor")!.value, label), startSourceUnits: start, endSourceUnits: end } } };
}

export function decodeTileLightingRecords(bytes: Uint8Array): TileLightingRecords {
  let document: unknown;
  try {
    document = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (error) {
    throw new TileLightingDecodeError(`RECS.canonicalJson is not UTF-8 JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  requireRecords(isRecord(document) && document.kind === recordsKind && document.schemaVersion === recordsSchemaVersion,
    `RECS.canonicalJson must be ${recordsKind} schema ${recordsSchemaVersion}.`);
  requireRecords(Array.isArray(document.zones) && Array.isArray(document.fogInfos) && Array.isArray(document.waterVolumes),
    "the records need zones, fogInfos and waterVolumes lists.");
  const zones = document.zones.map(readZone);
  requireRecords(new Set(zones.map(zone => zone.zoneIndex)).size === zones.length, "two zone records share a zoneIndex.");
  return { zones, fogInfos: decodeFogInfos(document.fogInfos), waterVolumeCount: document.waterVolumes.length };
}
