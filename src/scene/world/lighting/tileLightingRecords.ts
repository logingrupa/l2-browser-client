import type { CameraZoneFogRecord } from "../../../materials/ue2/babylon/material";
import { TileLightingDecodeError } from "./tileLightingDecodeError";

export interface TileLightingZone {
  readonly zoneIndex: number;
  readonly fog: CameraZoneFogRecord | null;
  readonly unresolvedReason: string | null;
}

export interface WorldEnvironmentProgram {
  readonly startTimeHours: number;
  readonly timeRatio: number;
  readonly environmentTypes: readonly number[];
  readonly unresolved: readonly string[];
}

export interface TileLightingRecords {
  readonly zones: readonly TileLightingZone[];
  readonly environmentProgram: WorldEnvironmentProgram;
  readonly fogInfoCount: number;
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

function readZone(value: unknown, position: number): TileLightingZone {
  const label = `zones[${position}]`;
  requireRecords(isRecord(value) && Number.isSafeInteger(value.zoneIndex) && Array.isArray(value.distanceFog), `${label} has no zoneIndex and distanceFog list.`);
  const zoneIndex = value.zoneIndex as number;
  const fields = new Map((value.distanceFog as unknown[]).map((entry, index) => readFieldRecord(entry, `${label}.distanceFog[${index}]`)).map(entry => [entry.field, entry]));
  const sunAffect = readFieldRecord(value.sunAffect, `${label}.sunAffect`);
  const unresolvedField = [...zoneFogFields.map(field => fields.get(field)), sunAffect].find(entry => entry === undefined || entry.provenance === unresolvedProvenance);
  if (unresolvedField !== undefined) {
    return { zoneIndex, fog: null, unresolvedReason: `lighting-zone-fog-unresolved:${zoneIndex}:${unresolvedField?.field ?? "missing"}` };
  }
  const enabled = fields.get("bDistanceFog")!.value, start = fields.get("DistanceFogStart")!.value, end = fields.get("DistanceFogEnd")!.value;
  requireRecords(typeof sunAffect.value === "boolean" || sunAffect.value === null, `${label} bSunAffect is not a boolean.`);
  requireRecords(typeof enabled === "boolean" || enabled === null, `${label} bDistanceFog is not a boolean.`);
  if (enabled !== true) return { zoneIndex, fog: { distanceFog: false, sunAffected: sunAffect.value === true, fog: null }, unresolvedReason: null };
  requireRecords(typeof start === "number" && typeof end === "number" && Number.isFinite(start) && Number.isFinite(end), `${label} fog range is not two numbers.`);
  return { zoneIndex, unresolvedReason: null, fog: { distanceFog: true, sunAffected: sunAffect.value === true,
    fog: { colourBytes: readFogColourBytes(fields.get("DistanceFogColor")!.value, label), startSourceUnits: start, endSourceUnits: end } } };
}

function setupNumber(setupValues: Record<string, unknown>, key: string): number {
  const entry = setupValues[key];
  requireRecords(isRecord(entry) && typeof entry.value === "number" && Number.isFinite(entry.value), `environment program setup value ${key} is not a number.`);
  return entry.value as number;
}

function readEnvironmentProgram(value: unknown): WorldEnvironmentProgram {
  requireRecords(isRecord(value) && isRecord(value.setupValues) && Array.isArray(value.environmentTypes) && Array.isArray(value.unresolved),
    "environmentProgram needs setupValues, environmentTypes and unresolved.");
  const startTimeHours = setupNumber(value.setupValues, "StartTime"), timeRatio = setupNumber(value.setupValues, "TimeRatio");
  requireRecords(startTimeHours >= 0 && startTimeHours < 24, `environment program StartTime ${startTimeHours} is outside [0, 24).`);
  requireRecords(timeRatio > 0, `environment program TimeRatio ${timeRatio} must be positive.`);
  const environmentTypes = value.environmentTypes.map((entry, index) => {
    requireRecords(isRecord(entry) && Number.isSafeInteger(entry.environmentType), `environmentTypes[${index}] has no integer environmentType.`);
    return entry.environmentType as number;
  });
  requireRecords(value.unresolved.every(entry => typeof entry === "string"), "environment program unresolved must list reasons.");
  return { startTimeHours, timeRatio, environmentTypes, unresolved: value.unresolved as string[] };
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
  return { zones, environmentProgram: readEnvironmentProgram(document.environmentProgram), fogInfoCount: document.fogInfos.length,
    waterVolumeCount: document.waterVolumes.length };
}
