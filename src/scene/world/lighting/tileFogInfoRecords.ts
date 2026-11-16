import type { EnvironmentFogRanges, FogColourBytes, FogInfoColourKey, FogRangeBounds, L2FogInfoRecord } from "../../../materials/ue2/model/fog";
import { FOG_RANGE_SLOT_COUNT } from "../../../materials/ue2/model/fog";
import { TileLightingDecodeError } from "./tileLightingDecodeError";

export interface DecodedFogInfo {
  readonly exportIndex: number;
  readonly record: L2FogInfoRecord | null;
  readonly unresolvedReason: string | null;
}

interface FogInfoField {
  readonly provenance: string;
  readonly value: unknown;
}

const unresolvedProvenance = "unresolved";
const ueZeroProvenance = "ue-zero";
const fogRangeFields = Array.from({ length: FOG_RANGE_SLOT_COUNT }, (_, slot) => `FogRange${slot + 1}`);
const requiredFogInfoFields = ["Location", "AffectRange", ...fogRangeFields, "Colors"];
const environmentFogSection = "FOG";
const colourChannels = ["R", "G", "B"] as const;
const locationAxes = ["X", "Y", "Z"] as const;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

function requireFogInfo(condition: boolean, label: string, message: string): asserts condition {
  if (!condition) throw new TileLightingDecodeError(`lighting records: ${label} ${message}`);
}

function readRange(field: FogInfoField, label: string): FogRangeBounds {
  if (field.provenance === ueZeroProvenance && field.value === null) return { min: 0, max: 0 };
  const value = field.value;
  requireFogInfo(isRecord(value) && isFiniteNumber(value.Min) && isFiniteNumber(value.Max), label, "is not a Min and Max range.");
  return { min: value.Min, max: value.Max };
}

function readLocation(field: FogInfoField, label: string): L2FogInfoRecord["location"] {
  if (field.provenance === ueZeroProvenance && field.value === null) return { x: 0, y: 0, z: 0 };
  const value = field.value;
  requireFogInfo(isRecord(value) && locationAxes.every(axis => isFiniteNumber(value[axis])), label, "is not an X, Y, Z location.");
  return { x: value.X as number, y: value.Y as number, z: value.Z as number };
}

function readColourKey(value: unknown, label: string): FogInfoColourKey {
  requireFogInfo(isRecord(value) && isFiniteNumber(value.Time) && isRecord(value.FogColor), label, "needs a Time and a FogColor.");
  const fogColor = value.FogColor as Record<string, unknown>;
  const bytes = colourChannels.map(channel => fogColor[channel]);
  requireFogInfo(bytes.every(channel => Number.isInteger(channel) && (channel as number) >= 0 && (channel as number) <= 255), label, "FogColor channels must be bytes.");
  return { time: value.Time, fogColourBytes: bytes as unknown as FogColourBytes };
}

function readColours(field: FogInfoField, label: string): FogInfoColourKey[] {
  if (field.provenance === ueZeroProvenance && field.value === null) return [];
  requireFogInfo(Array.isArray(field.value), label, "is not a colour list.");
  return (field.value as unknown[]).map((entry, position) => readColourKey(entry, `${label}[${position}]`));
}

function readFogInfo(value: unknown, position: number): DecodedFogInfo {
  const label = `fogInfos[${position}]`;
  requireFogInfo(isRecord(value) && Number.isSafeInteger(value.exportIndex) && Array.isArray(value.fields), label, "has no exportIndex and fields list.");
  const exportIndex = value.exportIndex as number;
  const fields = new Map<string, FogInfoField>();
  for (const [index, entry] of (value.fields as unknown[]).entries()) {
    requireFogInfo(isRecord(entry) && typeof entry.field === "string" && typeof entry.provenance === "string" && Object.hasOwn(entry, "value"),
      `${label}.fields[${index}]`, "is not a field record with field, provenance and value.");
    fields.set(entry.field as string, { provenance: entry.provenance as string, value: entry.value });
  }
  const unresolved = requiredFogInfoFields.find(name => fields.get(name) === undefined || fields.get(name)!.provenance === unresolvedProvenance);
  if (unresolved !== undefined) return { exportIndex, record: null, unresolvedReason: `lighting-fog-info-unresolved:${exportIndex}:${unresolved}` };
  const colours = readColours(fields.get("Colors")!, `${label}.Colors`);
  if (colours.some((colour, index) => index > 0 && colour.time <= colours[index - 1]!.time)) {
    return { exportIndex, record: null, unresolvedReason: `lighting-fog-info-colour-times-not-increasing:${exportIndex}` };
  }
  return { exportIndex, unresolvedReason: null, record: {
    exportIndex, location: readLocation(fields.get("Location")!, `${label}.Location`), affectRange: readRange(fields.get("AffectRange")!, `${label}.AffectRange`),
    fogRanges: fogRangeFields.map(name => readRange(fields.get(name)!, `${label}.${name}`)), colours } };
}

export function decodeFogInfos(values: readonly unknown[]): DecodedFogInfo[] {
  return values.map(readFogInfo);
}

function sectionNumber(properties: readonly unknown[], key: string): number | null {
  const property = properties.find(entry => isRecord(entry) && entry.key === key);
  return isRecord(property) && isFiniteNumber(property.value) ? property.value : null;
}

export function decodeEnvironmentFogRanges(setup: unknown): EnvironmentFogRanges | null {
  const sections = isRecord(setup) && Array.isArray(setup.sections) ? setup.sections : [];
  const fog = sections.find(section => isRecord(section) && section.section === environmentFogSection);
  if (!isRecord(fog) || !Array.isArray(fog.properties)) return null;
  const properties = fog.properties as unknown[];
  const read = (prefix: string) => Array.from({ length: FOG_RANGE_SLOT_COUNT }, (_, slot) => sectionNumber(properties, `${prefix}${slot + 1}`));
  const startRanges = read("StartRange"), endRanges = read("EndRange");
  if ([...startRanges, ...endRanges].some(value => value === null)) return null;
  return { startRanges: startRanges as number[], endRanges: endRanges as number[] };
}
