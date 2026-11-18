import { isJsonRecord, readLightingFields, requireLightingRecords, type LightingFields } from "./lightingFieldRecords";
import type { TileLightingRecordsDocument } from "./tileLightingRecords";

export interface TileLightActorRecord {
  readonly exportIndex: number;
  readonly object: string;
  readonly actorClass: string;
  readonly fields: LightingFields;
}

export interface TileLevelInfoRecord {
  readonly exportIndex: number;
  readonly fields: LightingFields;
}

export interface RebuildZoneAmbient {
  readonly zoneIndex: number;
  readonly ambient: LightingFields;
  readonly levelInfoFallback: boolean;
}

export interface LightmapRebuildActors {
  readonly lights: readonly TileLightActorRecord[];
  readonly levelInfos: readonly TileLevelInfoRecord[];
  readonly zoneAmbients: readonly RebuildZoneAmbient[];
}

function readLightActor(value: unknown, position: number): TileLightActorRecord {
  const label = `lights[${position}]`;
  requireLightingRecords(isJsonRecord(value) && Number.isSafeInteger(value.exportIndex) && typeof value.object === "string" && typeof value.actorClass === "string",
    `${label} has no exportIndex, object and actorClass.`);
  return { exportIndex: value.exportIndex as number, object: value.object as string, actorClass: value.actorClass as string,
    fields: readLightingFields(value.fields, `${label}.fields`) };
}

function readLevelInfo(value: unknown, position: number): TileLevelInfoRecord {
  const label = `levelInfos[${position}]`;
  requireLightingRecords(isJsonRecord(value) && Number.isSafeInteger(value.exportIndex), `${label} has no exportIndex.`);
  return { exportIndex: value.exportIndex as number, fields: readLightingFields(value.fields, `${label}.fields`) };
}

function readZoneAmbient(value: unknown, position: number): RebuildZoneAmbient {
  const label = `zones[${position}]`;
  requireLightingRecords(isJsonRecord(value) && Number.isSafeInteger(value.zoneIndex) && typeof value.levelInfoFallback === "boolean",
    `${label} has no zoneIndex and levelInfoFallback.`);
  return { zoneIndex: value.zoneIndex as number, levelInfoFallback: value.levelInfoFallback as boolean, ambient: readLightingFields(value.ambient, `${label}.ambient`) };
}

export function decodeLightmapRebuildActors(document: TileLightingRecordsDocument): LightmapRebuildActors {
  requireLightingRecords(Array.isArray(document.lights) && Array.isArray(document.levelInfos) && Array.isArray(document.zones),
    "lightmap rebuild inputs need the lights, levelInfos and zones lists.");
  return { lights: (document.lights as unknown[]).map(readLightActor), levelInfos: (document.levelInfos as unknown[]).map(readLevelInfo),
    zoneAmbients: (document.zones as unknown[]).map(readZoneAmbient) };
}
