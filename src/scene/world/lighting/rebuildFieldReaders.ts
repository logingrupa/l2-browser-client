import { resolvedResult, type LightmapRebuildResult, type NativeVector3 } from "../../../environment/model/lightmapRebuild/lightmapRebuildTypes";
import type { RotatorUnits } from "../../../shared/math/rotator";
import { isJsonRecord, requireLightingRecords, ueZeroFieldProvenance, unresolvedFieldProvenance, type LightingFields } from "./lightingFieldRecords";

export type RebuildFieldResult<Value> = LightmapRebuildResult<Value, string>;

export interface RebuildFieldOwner {
  readonly fields: LightingFields;
  readonly reasonPrefix: string;
  readonly label: string;
}

const vectorAxes = ["X", "Y", "Z"] as const;
const rotatorAxes = ["Pitch", "Yaw", "Roll"] as const;
const byteMaximum = 0xff;
const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

function readTypedField<Value>(owner: RebuildFieldOwner, field: string, zero: Value, parse: (value: unknown) => Value | undefined, kind: string): RebuildFieldResult<Value> {
  const entry = owner.fields.get(field);
  if (entry === undefined) return { status: "unresolved", reason: `${owner.reasonPrefix}-field-missing:${field}` };
  if (entry.provenance === unresolvedFieldProvenance) return { status: "unresolved", reason: `${owner.reasonPrefix}-field-unresolved:${field}` };
  if (entry.provenance === ueZeroFieldProvenance && entry.value === null) return resolvedResult(zero);
  const parsed = parse(entry.value);
  requireLightingRecords(parsed !== undefined, `${owner.label} ${field} = ${JSON.stringify(entry.value)} is not ${kind}.`);
  return resolvedResult(parsed as Value);
}

export function readNumberField(owner: RebuildFieldOwner, field: string): RebuildFieldResult<number> {
  return readTypedField(owner, field, 0, value => isFiniteNumber(value) ? value : undefined, "a finite number");
}

export function readByteField(owner: RebuildFieldOwner, field: string): RebuildFieldResult<number> {
  return readTypedField(owner, field, 0, value => Number.isInteger(value) && (value as number) >= 0 && (value as number) <= byteMaximum ? value as number : undefined, "a byte");
}

export function readBooleanField(owner: RebuildFieldOwner, field: string): RebuildFieldResult<boolean> {
  return readTypedField(owner, field, false, value => typeof value === "boolean" ? value : undefined, "a boolean");
}

export function readVectorField(owner: RebuildFieldOwner, field: string): RebuildFieldResult<NativeVector3> {
  return readTypedField<NativeVector3>(owner, field, [0, 0, 0], value => isJsonRecord(value) && vectorAxes.every(axis => isFiniteNumber(value[axis]))
    ? [Math.fround(value.X as number), Math.fround(value.Y as number), Math.fround(value.Z as number)] : undefined, "an X, Y, Z vector");
}

export function readRotatorField(owner: RebuildFieldOwner, field: string): RebuildFieldResult<RotatorUnits> {
  return readTypedField<RotatorUnits>(owner, field, { pitch: 0, yaw: 0, roll: 0 }, value => isJsonRecord(value) && rotatorAxes.every(axis => Number.isSafeInteger(value[axis]))
    ? { pitch: value.Pitch as number, yaw: value.Yaw as number, roll: value.Roll as number } : undefined, "a Pitch, Yaw, Roll rotator");
}

export function allFieldsResolved<Values extends Record<string, unknown>>(results: { readonly [Name in keyof Values]: RebuildFieldResult<Values[Name]> }):
  RebuildFieldResult<Values> {
  const values: Record<string, unknown> = {};
  for (const [name, result] of Object.entries(results) as [string, RebuildFieldResult<unknown>][]) {
    if (result.status !== "resolved") return result;
    values[name] = result.value;
  }
  return resolvedResult(values as Values);
}
