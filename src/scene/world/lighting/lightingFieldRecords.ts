import { TileLightingDecodeError } from "./tileLightingDecodeError";

export interface LightingFieldValue {
  readonly provenance: string;
  readonly value: unknown;
}

export type LightingFields = ReadonlyMap<string, LightingFieldValue>;

export const unresolvedFieldProvenance = "unresolved";
export const ueZeroFieldProvenance = "ue-zero";

export const isJsonRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

export function requireLightingRecords(condition: boolean, message: string): asserts condition {
  if (!condition) throw new TileLightingDecodeError(`lighting records: ${message}`);
}

export function readLightingFields(list: unknown, label: string): LightingFields {
  requireLightingRecords(Array.isArray(list), `${label} is not a field list.`);
  const fields = new Map<string, LightingFieldValue>();
  (list as unknown[]).forEach((entry, index) => {
    requireLightingRecords(isJsonRecord(entry) && typeof entry.field === "string" && typeof entry.provenance === "string" && Object.hasOwn(entry, "value"),
      `${label}[${index}] is not a field record with field, provenance and value.`);
    fields.set(entry.field as string, { provenance: entry.provenance as string, value: entry.value });
  });
  return fields;
}
