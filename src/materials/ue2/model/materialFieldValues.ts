import { COLOUR_CONSTANTS } from "./constants/combinerConstants";
import { MaterialProgramError, programField, type MaterialFieldValue, type MaterialProgramNode } from "./materialProgram";

export type ColourUnits = readonly [number, number, number, number];
export interface RotatorUnits { readonly pitch: number; readonly yaw: number; readonly roll: number }
export type MaterialReference =
  | { readonly kind: "none" }
  | { readonly kind: "node"; readonly nodeId: string }
  | { readonly kind: "external"; readonly object: string };

type SetFieldValue = Exclude<MaterialFieldValue, null>;
type RefuseField = (message: string) => never;
type MaterialFieldReader<Value> = (node: MaterialProgramNode, fieldName: string) => Value;

const rotatorStructBytes = 12;
const colourStructBytes = 4;
const colourChannelNames = ["R", "G", "B", "A"] as const;

function isValueRecord(value: MaterialFieldValue): value is { readonly [member: string]: MaterialFieldValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function typedFieldReader<Value>(unsetPropertyValue: () => Value, decodeSetValue: (value: SetFieldValue, refuse: RefuseField) => Value): MaterialFieldReader<Value> {
  return (node, fieldName) => {
    const setValue = programField(node, fieldName)?.value ?? null;
    if (setValue === null) return unsetPropertyValue();
    return decodeSetValue(setValue, message => { throw new MaterialProgramError(`Material program: ${node.id}.${fieldName} ${message}`); });
  };
}

function rawStructBytes(value: SetFieldValue, structName: string, length: number, refuse: RefuseField): Uint8Array | null {
  if (!isValueRecord(value) || typeof value.rawHex !== "string") return null;
  const rawHex = value.rawHex;
  if (value.structName !== structName) refuse(`holds a ${String(value.structName)} struct, not ${structName}.`);
  if (!/^(?:[0-9a-f]{2})*$/i.test(rawHex) || rawHex.length !== length * 2) refuse(`raw ${structName} is not ${length} bytes.`);
  return Uint8Array.from({ length }, (_, index) => Number.parseInt(rawHex.slice(index * 2, index * 2 + 2), 16));
}

export const readBooleanField = typedFieldReader(() => false, (value, refuse) => typeof value === "boolean" ? value : refuse("is not a boolean."));

export const readNumberField = typedFieldReader(() => 0, (value, refuse) => typeof value === "number" ? value : refuse("is not a number."));

export const readEnumOrdinal = typedFieldReader(() => 0, (value, refuse) => {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (isValueRecord(value) && typeof value.ordinal === "number" && Number.isInteger(value.ordinal)) return value.ordinal;
  return refuse("is not an enum value.");
});

export const readEnumName = typedFieldReader<string | null>(() => null,
  (value, refuse) => isValueRecord(value) && typeof value.name === "string" ? value.name : refuse("is not a named enum value."));

export const readReferenceField = typedFieldReader<MaterialReference>(() => ({ kind: "none" }), (value, refuse) => {
  if (isValueRecord(value) && typeof value.node === "string") return { kind: "node", nodeId: value.node };
  if (isValueRecord(value) && typeof value.externalObject === "string") return { kind: "external", object: value.externalObject };
  return refuse("is not an object reference.");
});

export const readRotatorField = typedFieldReader<RotatorUnits>(() => ({ pitch: 0, yaw: 0, roll: 0 }), (value, refuse) => {
  const bytes = rawStructBytes(value, "Rotator", rotatorStructBytes, refuse);
  if (bytes) {
    const view = new DataView(bytes.buffer);
    return { pitch: view.getInt32(0, true), yaw: view.getInt32(4, true), roll: view.getInt32(8, true) };
  }
  if (isValueRecord(value) && [value.Pitch, value.Yaw, value.Roll].every(member => member === undefined || typeof member === "number")) {
    return { pitch: (value.Pitch as number | undefined) ?? 0, yaw: (value.Yaw as number | undefined) ?? 0, roll: (value.Roll as number | undefined) ?? 0 };
  }
  return refuse("is not a Rotator.");
});

export const readColourField = typedFieldReader<ColourUnits>(() => [0, 0, 0, 0], (value, refuse) => {
  const bytes = rawStructBytes(value, "Color", colourStructBytes, refuse);
  const byteOrder = COLOUR_CONSTANTS.byteOrder.runtimeDefault;
  if (bytes) {
    const channel = (name: (typeof colourChannelNames)[number]) => bytes[byteOrder.indexOf(name)]! / 255;
    return [channel("R"), channel("G"), channel("B"), channel("A")];
  }
  if (isValueRecord(value) && colourChannelNames.every(name => value[name] === undefined || typeof value[name] === "number")) {
    const channel = (name: (typeof colourChannelNames)[number]) => ((value[name] as number | undefined) ?? 0) / 255;
    return [channel("R"), channel("G"), channel("B"), channel("A")];
  }
  return refuse("is not a Color.");
});

export function fieldIsUnported(node: MaterialProgramNode, fieldName: string): boolean {
  const field = programField(node, fieldName);
  return field !== null && (field.status === "unported" || field.status === "unconfirmed");
}
