export const REVIEWED_MATERIAL_CLASSES = [
  "Engine.Shader", "Engine.Combiner", "Engine.FinalBlend", "Engine.ColorModifier", "Engine.FadeColor", "Engine.ConstantColor",
  "Engine.TexPanner", "Engine.TexRotator", "Engine.TexOscillator", "Engine.TexScaler", "Engine.TexEnvMap", "Engine.TexCoordSource",
  "Engine.MaterialSequence", "Engine.Texture",
] as const;

export type ReviewedMaterialClass = (typeof REVIEWED_MATERIAL_CLASSES)[number];
export type MaterialFieldProvenance = "authored" | "class-default" | "ue-zero";
export type MaterialFieldStatus = "typed" | "raw" | "unported" | "unconfirmed";
export type MaterialNodeStatus = "reviewed" | "unported" | "preserved-data";

export interface MaterialEnumValue { readonly ordinal: number; readonly name: string }
export interface MaterialNodeReference { readonly node: string }
export interface MaterialExternalReference { readonly externalObject: string }
export interface MaterialRawStruct { readonly rawHex: string; readonly propertyType: number; readonly structName: string | null }

export type MaterialFieldValue =
  | null
  | boolean
  | number
  | string
  | MaterialEnumValue
  | MaterialNodeReference
  | MaterialExternalReference
  | MaterialRawStruct
  | readonly MaterialFieldValue[]
  | { readonly [member: string]: MaterialFieldValue };

export interface MaterialProgramField {
  readonly field: string;
  readonly declaredType: string | null;
  readonly declaringClass: string | null;
  readonly provenance: MaterialFieldProvenance;
  readonly status: MaterialFieldStatus;
  readonly value: MaterialFieldValue;
}

export interface MaterialTextureImage { readonly path: string; readonly sha256: string; readonly bytes: number }

export interface MaterialProgramNode {
  readonly id: string;
  readonly class: string;
  readonly status: MaterialNodeStatus;
  readonly gapReasons: readonly string[];
  readonly fields: readonly MaterialProgramField[];
  readonly image: MaterialTextureImage | null;
}

export interface MaterialProgram {
  readonly schemaVersion: 1;
  readonly kind: "ue2-material-program";
  readonly graphSha256: string;
  readonly root: string;
  readonly nodes: readonly MaterialProgramNode[];
  readonly gapReasons: readonly string[];
}

export class MaterialProgramError extends Error {
  override readonly name = "MaterialProgramError";
}

const sha256Pattern = /^[a-f0-9]{64}$/;
const nativeResourcePathPattern = /^\/l2\/(?:[A-Za-z0-9_-][A-Za-z0-9._-]*\/)*[A-Za-z0-9_-][A-Za-z0-9._-]*$/;
const materialClassUnportedPrefix = "material-class-unported:";
const fieldProvenances: readonly MaterialFieldProvenance[] = ["authored", "class-default", "ue-zero"];
const fieldStatuses: readonly MaterialFieldStatus[] = ["typed", "raw", "unported", "unconfirmed"];
const nodeStatuses: readonly MaterialNodeStatus[] = ["reviewed", "unported", "preserved-data"];
const maximumProgramNodes = 128;
const maximumTextureImageBytes = 32 * 1024 * 1024;

type JsonRecord = Readonly<Record<string, unknown>>;

const unrealNameIdentity = (name: string) => name.toLowerCase();

function requireProgram(condition: unknown, message: string): asserts condition {
  if (!condition) throw new MaterialProgramError(`Material program: ${message}`);
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, label: string): JsonRecord {
  requireProgram(isRecord(value), `${label} must be an object.`);
  return value;
}

function requireText(value: unknown, label: string): string {
  requireProgram(typeof value === "string" && value.length > 0, `${label} must be a non-empty string.`);
  return value;
}

function requireTextList(value: unknown, label: string): readonly string[] {
  requireProgram(Array.isArray(value), `${label} must be a list.`);
  return value.map((item, index) => requireText(item, `${label}[${index}]`));
}

function requireMember<Member extends string>(value: unknown, members: readonly Member[], label: string): Member {
  requireProgram(typeof value === "string" && (members as readonly string[]).includes(value), `${label} ${JSON.stringify(value)} is not one of ${members.join(", ")}.`);
  return value as Member;
}

function readFieldValue(value: unknown, label: string, depth: number): MaterialFieldValue {
  requireProgram(depth <= 8, `${label} nests deeper than 8 levels.`);
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") {
    requireProgram(Number.isFinite(value), `${label} must be a finite number.`);
    return value;
  }
  if (Array.isArray(value)) return value.map((item, index) => readFieldValue(item, `${label}[${index}]`, depth + 1));
  const record = requireRecord(value, label);
  return Object.fromEntries(Object.entries(record).map(([member, memberValue]) => [member, readFieldValue(memberValue, `${label}.${member}`, depth + 1)]));
}

function readProgramField(value: unknown, label: string): MaterialProgramField {
  const record = requireRecord(value, label);
  const field = requireText(record.field, `${label}.field`);
  requireProgram(record.provenance !== undefined, `${label} (${field}) has no provenance.`);
  return {
    field,
    declaredType: record.declaredType === null ? null : requireText(record.declaredType, `${label}.declaredType`),
    declaringClass: record.declaringClass === null ? null : requireText(record.declaringClass, `${label}.declaringClass`),
    provenance: requireMember(record.provenance, fieldProvenances, `${label}.provenance`),
    status: requireMember(record.status, fieldStatuses, `${label}.status`),
    value: readFieldValue(record.value, `${label}.value`, 0),
  };
}

function readTextureImage(value: unknown, label: string): MaterialTextureImage | null {
  if (value === undefined || value === null) return null;
  const record = requireRecord(value, label);
  const path = requireText(record.path, `${label}.path`);
  requireProgram(nativeResourcePathPattern.test(path), `${label}.path ${path} is not a native resource path.`);
  requireProgram(typeof record.sha256 === "string" && sha256Pattern.test(record.sha256), `${label}.sha256 is not a SHA-256 texture reference.`);
  requireProgram(Number.isSafeInteger(record.bytes) && (record.bytes as number) > 0 && (record.bytes as number) <= maximumTextureImageBytes,
    `${label}.bytes must be a positive size up to ${maximumTextureImageBytes}.`);
  return { path, sha256: record.sha256, bytes: record.bytes as number };
}

function readProgramNode(value: unknown, index: number): MaterialProgramNode {
  const label = `nodes[${index}]`;
  const record = requireRecord(value, label);
  const id = requireText(record.id, `${label}.id`);
  const nodeClass = requireText(record.class, `${label}.class`);
  const status = requireMember(record.status, nodeStatuses, `${label}.status`);
  const gapReasons = requireTextList(record.gapReasons, `${label}.gapReasons`);
  requireProgram(Array.isArray(record.fields), `${label}.fields must be a list.`);
  const fields = record.fields.map((field, fieldIndex) => readProgramField(field, `${id}.fields[${fieldIndex}]`));
  if (status === "reviewed") {
    requireProgram((REVIEWED_MATERIAL_CLASSES as readonly string[]).includes(nodeClass), `${id} is reviewed but its class ${nodeClass} is unknown.`);
  }
  if (status === "unported") {
    requireProgram(gapReasons.includes(`${materialClassUnportedPrefix}${nodeClass}`), `${id} is unported without ${materialClassUnportedPrefix}${nodeClass}.`);
    requireProgram(fields.length === 0, `${id} is unported but carries typed fields.`);
  }
  const image = readTextureImage(record.image, `${id}.image`);
  requireProgram(image === null || nodeClass === "Engine.Texture", `${id} of ${nodeClass} carries a texture image.`);
  requireProgram(new Set(fields.map(field => unrealNameIdentity(field.field))).size === fields.length, `${id} repeats a field.`);
  return { id, class: nodeClass, status, gapReasons, fields, image };
}

function requireResolvedReferences(value: MaterialFieldValue, nodeIds: ReadonlySet<string>, label: string): void {
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => requireResolvedReferences(item, nodeIds, `${label}[${index}]`));
    return;
  }
  const record = value as Readonly<Record<string, MaterialFieldValue>>;
  if (typeof record.node === "string" && Object.keys(record).length === 1) {
    requireProgram(nodeIds.has(record.node), `${label} references ${record.node}, which the program does not hold.`);
    return;
  }
  for (const [member, memberValue] of Object.entries(record)) requireResolvedReferences(memberValue, nodeIds, `${label}.${member}`);
}

export function parseMaterialProgram(programDocument: unknown): MaterialProgram {
  const record = requireRecord(programDocument, "program");
  requireProgram(record.schemaVersion === 1, `schemaVersion ${String(record.schemaVersion)} is not 1.`);
  requireProgram(record.kind === "ue2-material-program", `kind ${String(record.kind)} is not ue2-material-program.`);
  requireProgram(typeof record.graphSha256 === "string" && sha256Pattern.test(record.graphSha256), "graphSha256 is not a SHA-256.");
  const root = requireText(record.root, "root");
  requireProgram(Array.isArray(record.nodes) && record.nodes.length > 0 && record.nodes.length <= maximumProgramNodes,
    `nodes must hold 1 to ${maximumProgramNodes} entries.`);
  const nodes = record.nodes.map(readProgramNode);
  const nodeIds = new Set(nodes.map(node => node.id));
  requireProgram(nodeIds.size === nodes.length, "two nodes share an id.");
  requireProgram(nodeIds.has(root), `root ${root} is not a program node.`);
  for (const node of nodes) for (const field of node.fields) requireResolvedReferences(field.value, nodeIds, `${node.id}.${field.field}`);
  return { schemaVersion: 1, kind: "ue2-material-program", graphSha256: record.graphSha256, root, nodes, gapReasons: requireTextList(record.gapReasons, "gapReasons") };
}

export function programNode(program: MaterialProgram, nodeId: string): MaterialProgramNode {
  const node = program.nodes.find(candidate => candidate.id === nodeId);
  if (!node) throw new MaterialProgramError(`Material program: no node ${nodeId}.`);
  return node;
}

export function programField(node: MaterialProgramNode, fieldName: string): MaterialProgramField | null {
  return node.fields.find(field => unrealNameIdentity(field.field) === unrealNameIdentity(fieldName)) ?? null;
}
