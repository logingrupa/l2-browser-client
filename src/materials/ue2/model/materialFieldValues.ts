import { COLOUR_CONSTANTS } from "./constants/combinerConstants";
import { MaterialProgramError, programField, type MaterialFieldValue, type MaterialProgramNode } from "./materialProgram";

export type ColourUnits = readonly [number, number, number, number];
export interface RotatorUnits { readonly pitch: number; readonly yaw: number; readonly roll: number }
export type MaterialReference =
  | { readonly kind: "none" }
  | { readonly kind: "node"; readonly nodeId: string }
  | { readonly kind: "external"; readonly object: string };

const rotatorStructBytes = 12;
const colourStructBytes = 4;
const colourChannelNames = ["R", "G", "B", "A"] as const;

function fieldError(node: MaterialProgramNode, fieldName: string, message: string): MaterialProgramError {
  return new MaterialProgramError(`Material program: ${node.id}.${fieldName} ${message}`);
}

function isValueRecord(value: MaterialFieldValue): value is { readonly [member: string]: MaterialFieldValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function declaredValue(node: MaterialProgramNode, fieldName: string): MaterialFieldValue | undefined {
  return programField(node, fieldName)?.value;
}

export function readBooleanField(node: MaterialProgramNode, fieldName: string): boolean {
  const value = declaredValue(node, fieldName);
  if (value === undefined || value === null) return false;
  if (typeof value !== "boolean") throw fieldError(node, fieldName, "is not a boolean.");
  return value;
}

export function readNumberField(node: MaterialProgramNode, fieldName: string): number {
  const value = declaredValue(node, fieldName);
  if (value === undefined || value === null) return 0;
  if (typeof value !== "number") throw fieldError(node, fieldName, "is not a number.");
  return value;
}

export function readEnumOrdinal(node: MaterialProgramNode, fieldName: string): number {
  const value = declaredValue(node, fieldName);
  if (value === undefined || value === null) return 0;
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (isValueRecord(value) && typeof value.ordinal === "number" && Number.isInteger(value.ordinal)) return value.ordinal;
  throw fieldError(node, fieldName, "is not an enum value.");
}

export function readReferenceField(node: MaterialProgramNode, fieldName: string): MaterialReference {
  const value = declaredValue(node, fieldName);
  if (value === undefined || value === null) return { kind: "none" };
  if (isValueRecord(value) && typeof value.node === "string") return { kind: "node", nodeId: value.node };
  if (isValueRecord(value) && typeof value.externalObject === "string") return { kind: "external", object: value.externalObject };
  throw fieldError(node, fieldName, "is not an object reference.");
}

function rawStructBytes(node: MaterialProgramNode, fieldName: string, value: MaterialFieldValue, structName: string, length: number): Uint8Array | null {
  if (!isValueRecord(value) || typeof value.rawHex !== "string") return null;
  const rawHex = value.rawHex;
  if (value.structName !== structName) throw fieldError(node, fieldName, `holds a ${String(value.structName)} struct, not ${structName}.`);
  if (!/^(?:[0-9a-f]{2})*$/i.test(rawHex) || rawHex.length !== length * 2) throw fieldError(node, fieldName, `raw ${structName} is not ${length} bytes.`);
  return Uint8Array.from({ length }, (_, index) => Number.parseInt(rawHex.slice(index * 2, index * 2 + 2), 16));
}

export function readRotatorField(node: MaterialProgramNode, fieldName: string): RotatorUnits {
  const value = declaredValue(node, fieldName);
  if (value === undefined || value === null) return { pitch: 0, yaw: 0, roll: 0 };
  const bytes = rawStructBytes(node, fieldName, value, "Rotator", rotatorStructBytes);
  if (bytes) {
    const view = new DataView(bytes.buffer);
    return { pitch: view.getInt32(0, true), yaw: view.getInt32(4, true), roll: view.getInt32(8, true) };
  }
  if (isValueRecord(value) && [value.Pitch, value.Yaw, value.Roll].every(member => member === undefined || typeof member === "number")) {
    return { pitch: (value.Pitch as number | undefined) ?? 0, yaw: (value.Yaw as number | undefined) ?? 0, roll: (value.Roll as number | undefined) ?? 0 };
  }
  throw fieldError(node, fieldName, "is not a Rotator.");
}

export function readColourField(node: MaterialProgramNode, fieldName: string): ColourUnits {
  const value = declaredValue(node, fieldName);
  if (value === undefined || value === null) return [0, 0, 0, 0];
  const bytes = rawStructBytes(node, fieldName, value, "Color", colourStructBytes);
  const byteOrder = COLOUR_CONSTANTS.byteOrder.runtimeDefault;
  if (bytes) {
    const channel = (name: (typeof colourChannelNames)[number]) => bytes[byteOrder.indexOf(name)]! / 255;
    return [channel("R"), channel("G"), channel("B"), channel("A")];
  }
  if (isValueRecord(value) && colourChannelNames.every(name => value[name] === undefined || typeof value[name] === "number")) {
    const channel = (name: (typeof colourChannelNames)[number]) => ((value[name] as number | undefined) ?? 0) / 255;
    return [channel("R"), channel("G"), channel("B"), channel("A")];
  }
  throw fieldError(node, fieldName, "is not a Color.");
}

export function fieldIsUnported(node: MaterialProgramNode, fieldName: string): boolean {
  const field = programField(node, fieldName);
  return field !== null && (field.status === "unported" || field.status === "unconfirmed");
}
