import { windowIdPattern } from "../../assets/native/nativeCatalogRecords";

export const nativeWindowLayoutKind = "native-window-layout";
export const nativeWindowAnchorProof = "Elbera NWindow af6c3437 proof, unverified on IMPORTA 7c12fb6b";
const maximumNodeDepth = 64;
const maximumNodeCount = 4096;
const maximumAnchorEnum = 9;
const sha256Pattern = /^[a-f0-9]{64}$/;
const serializedTextPattern = /^[\x20-\x7e]{0,254}$/;
const textureReferencePattern = /^[A-Za-z][A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]{2,}){1,3}$/;
const colorPattern = /^#[0-9A-F]{6}$/;
const sizeModes = ["absolute", "relative"] as const;
const parentResolutionSources = ["declaredWindowParent", "commonParent"] as const;
const parentResolutionStatuses = ["resolved", "ambiguous", "missing", "cycle"] as const;
const textAlignments = ["left", "center", "right"] as const;
const textAutoSizeValues = [-1, 0, 1] as const;
const manifestFields = ["kind", "schemaVersion", "windowId", "name", "sourceSha256", "sourceOffset", "root", "textureRefs", "anchorProof"];
const requiredNodeFields = ["name", "type", "width", "height", "x", "y", "sizeMode", "position", "textures", "children", "sourceOffset", "tail"];
const optionalNodeFields = ["parentResolution", "declaredWindowParent", "drawer", "autosize", "insets", "relativeSize", "grid", "textLayout",
  "color", "align", "textId"];

export interface NativeWindowAnchorPosition {
  readonly selfAnchor: number; readonly targetAnchor: number; readonly target: string; readonly offsetX: number; readonly offsetY: number;
}
export interface NativeWindowRelativeSize {
  readonly reference: string; readonly widthRate: number; readonly heightRate: number; readonly widthOffset: number; readonly heightOffset: number;
}
export interface NativeWindowParentResolution {
  readonly name: string;
  readonly source: (typeof parentResolutionSources)[number];
  readonly status: (typeof parentResolutionStatuses)[number];
}
export interface NativeWindowDrawer { readonly direction: number; readonly offset?: number; readonly fixed?: number; readonly owner?: string }
export interface NativeWindowGrid {
  readonly rows: number; readonly capacity: number; readonly cellX: number; readonly cellY: number; readonly gapX: number; readonly gapY: number;
}
export interface NativeWindowTextLayout {
  readonly defaultText: string; readonly autoSize: (typeof textAutoSizeValues)[number]; readonly fontType: number; readonly alignEnum: number;
}
export interface NativeWindowSourceTail { readonly offset: number; readonly end: number; readonly sha256: string }

export interface NativeWindowNode {
  readonly name: string;
  readonly type: string;
  readonly width: number | null;
  readonly height: number | null;
  readonly x: number | null;
  readonly y: number | null;
  readonly sizeMode: (typeof sizeModes)[number] | null;
  readonly position: NativeWindowAnchorPosition | null;
  readonly textures: readonly string[];
  readonly children: readonly NativeWindowNode[];
  readonly sourceOffset: number;
  readonly tail: NativeWindowSourceTail;
  readonly parentResolution?: NativeWindowParentResolution;
  readonly declaredWindowParent?: string | null;
  readonly drawer?: NativeWindowDrawer;
  readonly autosize?: readonly [number, number];
  readonly insets?: readonly [number, number];
  readonly relativeSize?: NativeWindowRelativeSize;
  readonly grid?: NativeWindowGrid;
  readonly textLayout?: NativeWindowTextLayout;
  readonly color?: string;
  readonly align?: (typeof textAlignments)[number];
  readonly textId?: number;
}

export interface NativeWindowManifest {
  readonly kind: typeof nativeWindowLayoutKind;
  readonly schemaVersion: 1;
  readonly windowId: string;
  readonly name: string;
  readonly sourceSha256: string;
  readonly sourceOffset: number;
  readonly root: NativeWindowNode;
  readonly textureRefs: readonly string[];
  readonly anchorProof: typeof nativeWindowAnchorProof;
}

export class NativeWindowManifestError extends Error {
  override name = "NativeWindowManifestError";
}

type JsonObject = Readonly<Record<string, unknown>>;

interface NodeParseBudget { nodeCount: number }

function refuse(label: string, problem: string): never {
  throw new NativeWindowManifestError(`Native window manifest ${label} ${problem}.`);
}

function readObject(value: unknown, label: string, requiredFields: readonly string[], optionalFields: readonly string[] = []): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) refuse(label, "must be an object");
  const object = value as JsonObject;
  const missingField = requiredFields.find(field => !Object.hasOwn(object, field));
  if (missingField !== undefined) refuse(label, `is missing ${missingField}`);
  const unknownField = Object.keys(object).find(field => !requiredFields.includes(field) && !optionalFields.includes(field));
  if (unknownField !== undefined) refuse(label, `has unknown field ${unknownField}`);
  return object;
}

function readInteger(value: unknown, label: string, minimum = Number.MIN_SAFE_INTEGER, maximum = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    refuse(label, `must be an integer from ${minimum} to ${maximum}`);
  }
  return value;
}

function readOptionalInteger(value: unknown, label: string): number | null {
  return value === null ? null : readInteger(value, label);
}

function readFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) refuse(label, "must be a finite number");
  return value;
}

function readText(value: unknown, label: string, pattern: RegExp = serializedTextPattern): string {
  if (typeof value !== "string" || !pattern.test(value)) refuse(label, `must match ${pattern.source}`);
  return value;
}

function readName(value: unknown, label: string): string {
  const text = readText(value, label);
  if (text === "") refuse(label, "must not be empty");
  return text;
}

function readChoice<Choice extends string | number>(value: unknown, choices: readonly Choice[], label: string): Choice {
  if (!choices.includes(value as Choice)) refuse(label, `must be one of ${choices.join(", ")}`);
  return value as Choice;
}

function readSha256(value: unknown, label: string): string {
  return readText(value, label, sha256Pattern);
}

function readNumberPair(value: unknown, label: string, readElement: (element: unknown, elementLabel: string) => number): readonly [number, number] {
  if (!Array.isArray(value) || value.length !== 2) refuse(label, "must be a pair");
  return [readElement(value[0], `${label}[0]`), readElement(value[1], `${label}[1]`)];
}

function readAnchorPosition(value: unknown, label: string): NativeWindowAnchorPosition | null {
  if (value === null) return null;
  const position = readObject(value, label, ["selfAnchor", "targetAnchor", "target", "offsetX", "offsetY"]);
  return {
    selfAnchor: readInteger(position.selfAnchor, `${label}.selfAnchor`, 0, maximumAnchorEnum),
    targetAnchor: readInteger(position.targetAnchor, `${label}.targetAnchor`, 0, maximumAnchorEnum),
    target: readText(position.target, `${label}.target`),
    offsetX: readInteger(position.offsetX, `${label}.offsetX`),
    offsetY: readInteger(position.offsetY, `${label}.offsetY`),
  };
}

function readRelativeSize(value: unknown, label: string): NativeWindowRelativeSize {
  const size = readObject(value, label, ["reference", "widthRate", "heightRate", "widthOffset", "heightOffset"]);
  return {
    reference: readText(size.reference, `${label}.reference`),
    widthRate: readFiniteNumber(size.widthRate, `${label}.widthRate`),
    heightRate: readFiniteNumber(size.heightRate, `${label}.heightRate`),
    widthOffset: readInteger(size.widthOffset, `${label}.widthOffset`),
    heightOffset: readInteger(size.heightOffset, `${label}.heightOffset`),
  };
}

function readParentResolution(value: unknown, label: string): NativeWindowParentResolution {
  const resolution = readObject(value, label, ["name", "source", "status"]);
  return {
    name: readName(resolution.name, `${label}.name`),
    source: readChoice(resolution.source, parentResolutionSources, `${label}.source`),
    status: readChoice(resolution.status, parentResolutionStatuses, `${label}.status`),
  };
}

function readDrawer(value: unknown, label: string): NativeWindowDrawer {
  const drawer = readObject(value, label, ["direction"], ["offset", "fixed", "owner"]);
  const direction = readInteger(drawer.direction, `${label}.direction`);
  if (direction === 0) {
    if (Object.keys(drawer).length !== 1) refuse(label, "with direction 0 must hold only its direction");
    return { direction };
  }
  readObject(value, label, ["direction", "offset", "fixed", "owner"]);
  return {
    direction,
    offset: readInteger(drawer.offset, `${label}.offset`),
    fixed: readInteger(drawer.fixed, `${label}.fixed`),
    owner: readText(drawer.owner, `${label}.owner`),
  };
}

function readGrid(value: unknown, label: string): NativeWindowGrid {
  const grid = readObject(value, label, ["rows", "capacity", "cellX", "cellY", "gapX", "gapY"]);
  return {
    rows: readFiniteNumber(grid.rows, `${label}.rows`), capacity: readFiniteNumber(grid.capacity, `${label}.capacity`),
    cellX: readInteger(grid.cellX, `${label}.cellX`), cellY: readInteger(grid.cellY, `${label}.cellY`),
    gapX: readInteger(grid.gapX, `${label}.gapX`), gapY: readInteger(grid.gapY, `${label}.gapY`),
  };
}

function readTextLayout(value: unknown, label: string): NativeWindowTextLayout {
  const layout = readObject(value, label, ["defaultText", "autoSize", "fontType", "alignEnum"]);
  return {
    defaultText: readText(layout.defaultText, `${label}.defaultText`),
    autoSize: readChoice(layout.autoSize, textAutoSizeValues, `${label}.autoSize`),
    fontType: readInteger(layout.fontType, `${label}.fontType`),
    alignEnum: readInteger(layout.alignEnum, `${label}.alignEnum`),
  };
}

function readSourceTail(value: unknown, label: string): NativeWindowSourceTail {
  const tail = readObject(value, label, ["offset", "end", "sha256"]);
  const offset = readInteger(tail.offset, `${label}.offset`, 0);
  const end = readInteger(tail.end, `${label}.end`, 0);
  if (offset > end) refuse(label, "offset must not be greater than its end");
  return { offset, end, sha256: readSha256(tail.sha256, `${label}.sha256`) };
}

function readTextureReferences(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value)) refuse(label, "must be a list");
  const references = value.map((reference, index) => readText(reference, `${label}[${index}]`, textureReferencePattern));
  if (new Set(references).size !== references.length) refuse(label, "must not repeat a reference");
  return references;
}

function readOptionalNodeFields(node: JsonObject, label: string): Partial<NativeWindowNode> {
  const optional: { -readonly [Field in keyof NativeWindowNode]?: NativeWindowNode[Field] } = {};
  if (Object.hasOwn(node, "parentResolution")) optional.parentResolution = readParentResolution(node.parentResolution, `${label}.parentResolution`);
  if (Object.hasOwn(node, "declaredWindowParent")) {
    optional.declaredWindowParent = node.declaredWindowParent === null ? null : readText(node.declaredWindowParent, `${label}.declaredWindowParent`);
  }
  if (Object.hasOwn(node, "drawer")) optional.drawer = readDrawer(node.drawer, `${label}.drawer`);
  if (Object.hasOwn(node, "autosize")) optional.autosize = readNumberPair(node.autosize, `${label}.autosize`, readFiniteNumber);
  if (Object.hasOwn(node, "insets")) optional.insets = readNumberPair(node.insets, `${label}.insets`, (element, elementLabel) => readInteger(element, elementLabel));
  if (Object.hasOwn(node, "relativeSize")) optional.relativeSize = readRelativeSize(node.relativeSize, `${label}.relativeSize`);
  if (Object.hasOwn(node, "grid")) optional.grid = readGrid(node.grid, `${label}.grid`);
  if (Object.hasOwn(node, "textLayout")) optional.textLayout = readTextLayout(node.textLayout, `${label}.textLayout`);
  if (Object.hasOwn(node, "color")) optional.color = readText(node.color, `${label}.color`, colorPattern);
  if (Object.hasOwn(node, "align")) optional.align = readChoice(node.align, textAlignments, `${label}.align`);
  if (Object.hasOwn(node, "textId")) optional.textId = readInteger(node.textId, `${label}.textId`);
  return optional;
}

function readNode(value: unknown, label: string, depth: number, budget: NodeParseBudget): NativeWindowNode {
  if (depth > maximumNodeDepth) refuse(label, `nests deeper than ${maximumNodeDepth} levels`);
  budget.nodeCount += 1;
  if (budget.nodeCount > maximumNodeCount) refuse(label, `exceeds ${maximumNodeCount} nodes`);
  const node = readObject(value, label, requiredNodeFields, optionalNodeFields);
  if (!Array.isArray(node.children)) refuse(`${label}.children`, "must be a list");
  return {
    name: readName(node.name, `${label}.name`),
    type: readName(node.type, `${label}.type`),
    width: readOptionalInteger(node.width, `${label}.width`),
    height: readOptionalInteger(node.height, `${label}.height`),
    x: readOptionalInteger(node.x, `${label}.x`),
    y: readOptionalInteger(node.y, `${label}.y`),
    sizeMode: node.sizeMode === null ? null : readChoice(node.sizeMode, sizeModes, `${label}.sizeMode`),
    position: readAnchorPosition(node.position, `${label}.position`),
    textures: readTextureReferences(node.textures, `${label}.textures`),
    sourceOffset: readInteger(node.sourceOffset, `${label}.sourceOffset`, 0),
    tail: readSourceTail(node.tail, `${label}.tail`),
    ...readOptionalNodeFields(node, label),
    children: node.children.map((child, index) => readNode(child, `${label}.children[${index}]`, depth + 1, budget)),
  };
}

function textureReferencesInTreeOrder(root: NativeWindowNode): readonly string[] {
  const references = new Set<string>();
  const pending: NativeWindowNode[] = [root];
  while (pending.length) {
    const node = pending.pop()!;
    node.textures.forEach(reference => references.add(reference));
    pending.push(...[...node.children].reverse());
  }
  return [...references];
}

export function parseNativeWindowManifest(input: unknown): NativeWindowManifest {
  const manifest = readObject(input, "document", manifestFields);
  if (manifest.kind !== nativeWindowLayoutKind) refuse("kind", `must be ${nativeWindowLayoutKind}`);
  if (manifest.schemaVersion !== 1) refuse("schemaVersion", "must be 1");
  if (manifest.anchorProof !== nativeWindowAnchorProof) refuse("anchorProof", `must be "${nativeWindowAnchorProof}"`);
  const windowId = readText(manifest.windowId, "windowId", windowIdPattern);
  const name = readName(manifest.name, "name");
  if (windowId.split("#")[0] !== name) refuse("windowId", `must be the window name ${name} or ${name}#<ordinal>`);
  const sourceOffset = readInteger(manifest.sourceOffset, "sourceOffset", 0);
  const root = readNode(manifest.root, "root", 1, { nodeCount: 0 });
  if (root.name !== name || root.sourceOffset !== sourceOffset) refuse("root", "must be the named window at the manifest source offset");
  const textureRefs = readTextureReferences(manifest.textureRefs, "textureRefs");
  if (textureRefs.join("\n") !== textureReferencesInTreeOrder(root).join("\n")) refuse("textureRefs", "must list every node texture once in tree order");
  return {
    kind: nativeWindowLayoutKind, schemaVersion: 1, windowId, name, sourceSha256: readSha256(manifest.sourceSha256, "sourceSha256"),
    sourceOffset, root, textureRefs, anchorProof: nativeWindowAnchorProof,
  };
}
