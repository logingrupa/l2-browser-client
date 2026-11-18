import type { FogColourBytes, FogInfoColourKey, FogRangeBounds, L2FogInfoRecord } from "../../../materials/ue2/model/fog";
import { FOG_RANGE_SLOT_COUNT } from "../../../materials/ue2/model/fog";
import { isJsonRecord, readLightingFields, requireLightingRecords, ueZeroFieldProvenance, unresolvedFieldProvenance, type LightingFieldValue } from "./lightingFieldRecords";

export interface DecodedFogInfo {
  readonly exportIndex: number;
  readonly record: L2FogInfoRecord | null;
  readonly unresolvedReason: string | null;
}

const fogRangeFields = Array.from({ length: FOG_RANGE_SLOT_COUNT }, (_, slot) => `FogRange${slot + 1}`);
const requiredFogInfoFields = ["Location", "AffectRange", "TextureDistance", ...fogRangeFields, "Colors"];
const colourChannels = ["R", "G", "B"] as const;
const locationAxes = ["X", "Y", "Z"] as const;

const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

function readRange(field: LightingFieldValue, label: string): FogRangeBounds {
  if (field.provenance === ueZeroFieldProvenance && field.value === null) return { min: 0, max: 0 };
  const value = field.value;
  requireLightingRecords(isJsonRecord(value) && isFiniteNumber(value.Min) && isFiniteNumber(value.Max), `${label} is not a Min and Max range.`);
  return { min: value.Min, max: value.Max };
}

function readTextureDistance(field: LightingFieldValue, label: string): number {
  if (field.provenance === ueZeroFieldProvenance && field.value === null) return 0;
  requireLightingRecords(isFiniteNumber(field.value), `${label} is not a finite distance.`);
  return field.value;
}

function readLocation(field: LightingFieldValue, label: string): L2FogInfoRecord["sourceLocation"] {
  if (field.provenance === ueZeroFieldProvenance && field.value === null) return { x: 0, y: 0, z: 0 };
  const value = field.value;
  requireLightingRecords(isJsonRecord(value) && locationAxes.every(axis => isFiniteNumber(value[axis])), `${label} is not an X, Y, Z location.`);
  return { x: value.X as number, y: value.Y as number, z: value.Z as number };
}

function readColourKey(value: unknown, label: string): FogInfoColourKey {
  requireLightingRecords(isJsonRecord(value) && isFiniteNumber(value.Time) && isJsonRecord(value.FogColor), `${label} needs a Time and a FogColor.`);
  const fogColor = value.FogColor as Record<string, unknown>;
  const bytes = colourChannels.map(channel => fogColor[channel]);
  requireLightingRecords(bytes.every(channel => Number.isInteger(channel) && (channel as number) >= 0 && (channel as number) <= 255), `${label} FogColor channels must be bytes.`);
  return { time: value.Time, fogColourBytes: bytes as unknown as FogColourBytes };
}

function readColours(field: LightingFieldValue, label: string): FogInfoColourKey[] {
  if (field.provenance === ueZeroFieldProvenance && field.value === null) return [];
  requireLightingRecords(Array.isArray(field.value), `${label} is not a colour list.`);
  return (field.value as unknown[]).map((entry, position) => readColourKey(entry, `${label}[${position}]`));
}

function readFogInfo(value: unknown, position: number): DecodedFogInfo {
  const label = `fogInfos[${position}]`;
  requireLightingRecords(isJsonRecord(value) && Number.isSafeInteger(value.exportIndex) && Array.isArray(value.fields), `${label} has no exportIndex and fields list.`);
  const exportIndex = value.exportIndex as number;
  const fields = readLightingFields(value.fields, `${label}.fields`);
  const unresolved = requiredFogInfoFields.find(name => fields.get(name) === undefined || fields.get(name)!.provenance === unresolvedFieldProvenance);
  if (unresolved !== undefined) return { exportIndex, record: null, unresolvedReason: `lighting-fog-info-unresolved:${exportIndex}:${unresolved}` };
  const colours = readColours(fields.get("Colors")!, `${label}.Colors`);
  if (colours.some((colour, index) => index > 0 && colour.time <= colours[index - 1]!.time)) {
    return { exportIndex, record: null, unresolvedReason: `lighting-fog-info-colour-times-not-increasing:${exportIndex}` };
  }
  return { exportIndex, unresolvedReason: null, record: {
    exportIndex, sourceLocation: readLocation(fields.get("Location")!, `${label}.Location`), affectRange: readRange(fields.get("AffectRange")!, `${label}.AffectRange`),
    textureDistance: readTextureDistance(fields.get("TextureDistance")!, `${label}.TextureDistance`),
    fogRanges: fogRangeFields.map(name => readRange(fields.get(name)!, `${label}.${name}`)), colours } };
}

export function decodeFogInfos(values: readonly unknown[]): DecodedFogInfo[] {
  return values.map(readFogInfo);
}
