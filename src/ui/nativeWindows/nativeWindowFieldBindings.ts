import committedFieldBindingsText from "../../../recipes/data/window-field-bindings.json?raw";
import { windowIdPattern } from "../../assets/native/nativeCatalogRecords";

export type NativeWindowWorldField = "health";
export type NativeWindowMaximumField = "maximumHealth";

export interface NativeWindowFieldBindingSource { readonly document: string; readonly sha256: string; readonly excerpt: string }

export interface NativeWindowFieldBinding {
  readonly windowId: string;
  readonly controlName: string;
  readonly worldField: NativeWindowWorldField | null;
  readonly maximumField: NativeWindowMaximumField | null;
  readonly fillTextureRef: string | null;
  readonly gapReason: string | null;
  readonly status: "unverified";
  readonly source: NativeWindowFieldBindingSource;
}

const bindingRecipeFields = ["schemaVersion", "bindings"];
const bindingFields = ["windowId", "controlName", "worldField", "maximumField", "fillTextureRef", "gapReason", "status", "source"];
const sourceFields = ["document", "sha256", "excerpt"];
const worldFieldPairs: Readonly<Record<NativeWindowWorldField, NativeWindowMaximumField>> = { health: "maximumHealth" };
const absentFieldReasonPattern = /^adapter-field-absent:[a-z][A-Za-z0-9]*$/;
const controlNamePattern = /^[\x21-\x7e]{1,254}$/;
const textureReferencePattern = /^[A-Za-z][A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]{2,}){1,3}$/;
const sha256Pattern = /^[a-f0-9]{64}$/;

type JsonObject = Readonly<Record<string, unknown>>;

function refuse(label: string, problem: string): never {
  throw new Error(`Window field binding recipe ${label} ${problem}.`);
}

function readExactObject(value: unknown, label: string, fields: readonly string[]): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) refuse(label, "must be an object");
  const object = value as JsonObject;
  const keys = Object.keys(object);
  if (keys.length !== fields.length || !fields.every(field => Object.hasOwn(object, field))) refuse(label, `must hold exactly ${fields.join(", ")}`);
  return object;
}

function readPatternText(value: unknown, label: string, pattern: RegExp): string {
  if (typeof value !== "string" || !pattern.test(value)) refuse(label, `must match ${pattern.source}`);
  return value;
}

function readSource(value: unknown, label: string): NativeWindowFieldBindingSource {
  const source = readExactObject(value, label, sourceFields);
  if (typeof source.document !== "string" || source.document === "") refuse(`${label}.document`, "must name the cited document");
  if (typeof source.excerpt !== "string" || source.excerpt === "") refuse(`${label}.excerpt`, "must quote the cited line");
  return { document: source.document, sha256: readPatternText(source.sha256, `${label}.sha256`, sha256Pattern), excerpt: source.excerpt };
}

function readWorldField(value: unknown, label: string): NativeWindowWorldField | null {
  if (value === null) return null;
  if (typeof value !== "string" || !Object.hasOwn(worldFieldPairs, value)) refuse(label, `must be null or one of ${Object.keys(worldFieldPairs).join(", ")}`);
  return value as NativeWindowWorldField;
}

function readBinding(value: unknown, label: string): NativeWindowFieldBinding {
  const binding = readExactObject(value, label, bindingFields);
  const worldField = readWorldField(binding.worldField, `${label}.worldField`);
  const expectedMaximumField = worldField === null ? null : worldFieldPairs[worldField];
  if (binding.maximumField !== expectedMaximumField) refuse(`${label}.maximumField`, `must be ${String(expectedMaximumField)}`);
  const gapReason = binding.gapReason === null ? null : readPatternText(binding.gapReason, `${label}.gapReason`, absentFieldReasonPattern);
  if ((worldField === null) === (gapReason === null)) refuse(label, "must hold either a world field or an adapter-field-absent gap reason");
  if (binding.status !== "unverified") refuse(`${label}.status`, "must be unverified");
  return {
    windowId: readPatternText(binding.windowId, `${label}.windowId`, windowIdPattern),
    controlName: readPatternText(binding.controlName, `${label}.controlName`, controlNamePattern),
    worldField,
    maximumField: expectedMaximumField,
    fillTextureRef: binding.fillTextureRef === null ? null : readPatternText(binding.fillTextureRef, `${label}.fillTextureRef`, textureReferencePattern),
    gapReason,
    status: "unverified",
    source: readSource(binding.source, `${label}.source`),
  };
}

export function readNativeWindowFieldBindings(recipeText: string = committedFieldBindingsText): readonly NativeWindowFieldBinding[] {
  let document: unknown;
  try { document = JSON.parse(recipeText); }
  catch { refuse("text", "is not JSON"); }
  const recipe = readExactObject(document, "document", bindingRecipeFields);
  if (recipe.schemaVersion !== 1) refuse("schemaVersion", "must be 1");
  if (!Array.isArray(recipe.bindings)) refuse("bindings", "must be a list");
  const bindings = recipe.bindings.map((binding, index) => readBinding(binding, `bindings[${index}]`));
  const bindingKeys = bindings.map(binding => `${binding.windowId}\n${binding.controlName}`);
  if (new Set(bindingKeys).size !== bindingKeys.length) refuse("bindings", "must not bind one control twice");
  return bindings;
}
