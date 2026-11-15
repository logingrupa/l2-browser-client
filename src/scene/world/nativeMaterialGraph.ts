import { sha256, type AssetPackage, type AssetPackageFile } from "../../assets/package/readAssetPackage";

type RecordValue = Record<string, unknown>;
export interface NativeFlameColor { readonly bgraHex: string; readonly rgbaBytes: readonly [number, number, number, number]; }
export interface NativeFlameTexture {
  readonly object: string; readonly width: number; readonly height: number; readonly format: number;
  readonly uClampMode: number; readonly vClampMode: number;
  readonly image: AssetPackageFile; readonly rawExport: AssetPackageFile;
  readonly dds: AssetPackageFile | null;
  readonly mips: readonly (AssetPackageFile & { level: number; width: number; height: number })[];
}
export interface NativeFlameShader {
  readonly slot: 0 | 1; readonly object: string; readonly diffuse: string;
  readonly outputBlending: number; readonly twoSided: boolean;
  readonly zWrite: boolean; readonly alphaTest: boolean; readonly alphaRef: number;
}
export interface NativeFlamePlan {
  readonly modelId: string; readonly sourceMesh: string; readonly graph: AssetPackageFile;
  readonly billboard: boolean; readonly shaders: readonly [NativeFlameShader, NativeFlameShader];
  readonly animation: { readonly frames: readonly NativeFlameTexture[]; readonly minFrameRate: number; readonly maxFrameRate: number; readonly totalFrameNum: number };
  readonly glow: NativeFlameTexture;
  readonly fade: { readonly object: string; readonly color1: NativeFlameColor; readonly color2: NativeFlameColor; readonly colorFadeType: number; readonly fadePeriod: number; readonly fadePhase: number };
  readonly combiner: { readonly object: string; readonly material1: string; readonly material2: string; readonly mask: null; readonly combineOperation: number; readonly alphaOperation: number; readonly modulate2X: boolean; readonly modulate4X: boolean; readonly invertMask: boolean };
  /** Verified package resources; no decoded images, GPU objects or mutable clock. */
  readonly resources: ReadonlyMap<string, Uint8Array>;
  /** Original records, including authored-vs-omitted fields, are retained separately. */
  readonly provenance: { readonly graph: RecordValue; readonly classes: ReadonlyMap<string, RecordValue>; readonly nodes: ReadonlyMap<string, RecordValue> };
}

const SOURCE = "FX_E_S.Flameset.Default_Flame01", PREFIX = "FX_E_T.Flameset.";
const ENGINE = "9b04ff5cb4258e84dfa8efbdd85d9121f3bdcb5822a9a21ca69d200d05a69761";
const CORE = "de5f0ee0a773327bce13c96622fd3c654cff7db88b9be065d1232590c140fda0";
const TEXTURES = "cbc082f0f042dbd57f7bd3e1410e6afa05e6b08ef40b9891efbf70e69a2db78c";
// Zero initialization is used only with these reviewed class declarations and
// their verified inheritance/default records. It is not a generic UE evaluator.
const CLASSES: Readonly<Record<string, readonly [string | null, string]>> = {
  "Core.Object": [null, "86ebb2596fb5cbdb473112aa72a58dff940c540bb52637491b2c5339eb800354"],
  "Engine.Material": ["Core.Object", "66372b1d6af4bf524b34a9c2edf9c60d22e5b9c0b798bc61f3f0a62f949ac059"],
  "Engine.RenderedMaterial": ["Engine.Material", "50159b639419b0510f8d299e76ba8108fb5b80ee1804fb55d8e410d4eb11c164"],
  "Engine.BitmapMaterial": ["Engine.RenderedMaterial", "5951d394edb45b30a1b0f3ca76cad36349453d8b6d7a703342ba2fbc7f7b76fa"],
  "Engine.Texture": ["Engine.BitmapMaterial", "9395a836360f669c566a65d6f3e176b20dbdcb905d12358f0bb518a292ff08e8"],
  "Engine.Shader": ["Engine.RenderedMaterial", "0775aa7613601625beb58dbf99cf912d43804634d66cc2ad37b80fcc97fa8365"],
  "Engine.Combiner": ["Engine.Material", "f250d0192483a7702de581cd6bde0d67fb70dc6e46c403bdf08559b3d1b387e4"],
  "Engine.ConstantMaterial": ["Engine.RenderedMaterial", "9c52c3744bd1b4dfb17e0a1214b7e8b5e6fb7cd1ce285254b60fa8b8b21f0a7b"],
  "Engine.FadeColor": ["Engine.ConstantMaterial", "e1dc46abe380030d9586cc0cefa74c406c2af96fbae1fcc6dbe998581296d296"],
};
const object = (value: unknown): value is RecordValue => typeof value === "object" && value !== null && !Array.isArray(value);
function fail(message: string): never { throw new Error(`Native flame graph: ${message}`); }
function record(value: unknown, label: string): RecordValue { return object(value) ? value : fail(`${label} must be an object.`); }
function list(value: unknown, limit: number, label: string): unknown[] { return Array.isArray(value) && value.length <= limit ? value : fail(`${label} is missing or oversized.`); }
function string(value: unknown, label: string): string { return typeof value === "string" && value.length > 0 && value.length <= 512 ? value : fail(`${label} must be a string.`); }
function number(value: unknown, label: string): number { return typeof value === "number" && Number.isFinite(value) ? value : fail(`${label} must be finite.`); }
function integer(value: unknown, low: number, high: number, label: string): number {
  const result = number(value, label); return Number.isSafeInteger(result) && result >= low && result <= high ? result : fail(`${label} is out of range.`);
}
function equal(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) && Array.isArray(right)) return left.length === right.length && left.every((value, index) => equal(value, right[index]));
  if (object(left) && object(right)) return Object.keys(left).length === Object.keys(right).length && Object.keys(left).every(key => Object.hasOwn(right, key) && equal(left[key], right[key]));
  return left === right;
}
function reference(value: unknown, label: string): string | null {
  if (value === null || value === undefined) return null;
  return string(record(value, label).object, `${label}.object`);
}
function bytesHex(bytes: Uint8Array): string { return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join(""); }
function compactIndex(bytes: Uint8Array): number {
  if (!bytes.length || bytes.length > 5) return fail("invalid object index payload.");
  let value = bytes[0]! & 63, shift = 6, more = (bytes[0]! & 64) !== 0;
  for (let index = 1; index < bytes.length; index++) {
    if (!more) fail("object index has trailing bytes.");
    const byte = bytes[index]!; value += (byte & 127) * 2 ** shift; shift += 7; more = (byte & 128) !== 0;
  }
  if (more) fail("object index is truncated."); return bytes[0]! & 128 ? -value : value;
}

/** Prepare only the retained Default_Flame01 graph. This establishes a data
 * contract, not native renderer equivalence. The caller obtains the package
 * through readAssetPackage and verifies its outer archive identity separately. */
export async function prepareNativeFlameGraph(asset: AssetPackage): Promise<NativeFlamePlan> {
  if (asset.manifest.id !== `interlude:${SOURCE}` || asset.manifest.kind !== "model" || asset.manifest.source.object !== SOURCE ||
      asset.manifest.source.sha256 !== "259ed78d45a1ac4780cd3f8eb34c2907cac0e702518dc39c78d81825d6e00a98") fail("model source identity differs.");
  if (asset.manifest.files.length > 255 || asset.files.size !== asset.manifest.files.length) fail("resource inventory differs.");
  const inventory = new Map<string, AssetPackageFile>(), resources = new Map<string, Uint8Array>();
  for (const file of asset.manifest.files) {
    if (inventory.has(file.path) || !/^native-materials\/[A-Za-z0-9._/-]+$|^(?:model\.glb|provenance\.json)$/.test(file.path) || file.path.split("/").some(part => part === "." || part === ".." || !part)) fail("resource path is unsupported or duplicated.");
    const bytes = asset.files.get(file.path);
    if (!bytes || bytes.length !== file.bytes || await sha256(bytes) !== file.sha256) fail(`resource hash/length differs: ${file.path}.`);
    inventory.set(file.path, { ...file }); resources.set(file.path, bytes);
  }
  function resource(path: unknown, expected?: RecordValue): AssetPackageFile {
    const file = inventory.get(string(path, "resource path"));
    if (!file || expected && (expected.sha256 !== file.sha256 || expected.bytes !== undefined && expected.bytes !== file.bytes)) fail(`resource dependency differs: ${String(path)}.`);
    return file;
  }
  function descriptor(value: unknown): AssetPackageFile { const data = record(value, "resource descriptor"); return resource(data.file, data); }
  function json(path: string): RecordValue {
    const file = resource(path); if (file.bytes > 1024 * 1024) fail(`JSON is oversized: ${path}.`);
    try { return record(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(resources.get(path)!)), path); }
    catch (error) { return fail(`invalid JSON ${path}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  const graphFile = resource("native-materials/graph.json"), graph = json(graphFile.path);
  if (graph.schemaVersion !== 1 || graph.kind !== "native-material-graph" || graph.sourceMesh !== SOURCE || graph.policy !== "preserve-native-graph") fail("graph identity/schema differs.");
  const rootNames = [`${PREFIX}Default_Flame_Final`, `${PREFIX}de_fire_glow_shader`] as const;
  const roots = list(graph.roots, 2, "roots");
  if (roots.length !== 2 || roots.some((value, slot) => { const root = record(value, "root"); return root.slot !== slot || root.object !== rootNames[slot]; })) fail("root slots differ.");
  const classNames = list(graph.classDefinitions, 9, "class definitions");
  if (classNames.length !== 9 || new Set(classNames).size !== 9 || classNames.some(name => typeof name !== "string" || !Object.hasOwn(CLASSES, name))) fail("class definitions differ.");
  const classes = new Map<string, RecordValue>(), defaults = new Map<string, RecordValue>();
  for (const name of classNames as string[]) {
    const declaration = json(`native-materials/source/classes/${name}.json`), evidence = CLASSES[name]!;
    const source = record(declaration.source, `${name} source`);
    if (declaration.schemaVersion !== 1 || declaration.object !== name || declaration.nativeSuperClass !== evidence[0] || source.object !== name || source.class !== "Class" || source.classObject !== "Core.Class" || source.packageSha256 !== (name === "Core.Object" ? CORE : ENGINE) ||
        declaration.sourceScript !== `native-materials/source/classes/${name}.uc` || declaration.sourceScriptSha256 !== evidence[1]) fail(`class source differs: ${name}.`);
    resource(declaration.sourceScript, { sha256: evidence[1] });
    const raw = resource(declaration.rawExport);
    if (raw.path !== `native-materials/source/classes/${name}.bin` || raw.bytes !== source.sourceBytes || list(declaration.unparsed, 0, "class unparsed defaults").length) fail(`class export/defaults differ: ${name}.`);
    // These authored defaults are stated by the pinned scripts above. Check the
    // extracted records against them before applying inheritance or UE zeros.
    const authored = name === "Engine.Material" ? { DefaultMaterial: { class: "Texture", object: "Engine.DefaultTexture" } }
      : name === "Engine.Shader" ? { DetailScale: 8 }
      : name === "Engine.Texture" ? { DetailScale: 8, LODSet: 1, MaxColor: { A: 255, B: 255, G: 255, R: 255 }, MipZero: { A: 0, B: 64, G: 128, R: 64 } } : {};
    if (!equal(declaration.properties, authored)) fail(`class authored defaults differ: ${name}.`);
    record(declaration.effectiveProperties, `${name} effective defaults`);
    classes.set(name, declaration);
  }
  function inherited(name: string): RecordValue {
    const prior = defaults.get(name); if (prior) return prior;
    const declaration = classes.get(name)!, parent = CLASSES[name]![0];
    const result = { ...(parent ? inherited(parent) : {}), ...record(declaration.properties, "class defaults") };
    if (!equal(result, declaration.effectiveProperties)) fail(`class default inheritance differs: ${name}.`);
    defaults.set(name, result); return result;
  }
  for (const name of classes.keys()) inherited(name);
  const nodes = new Map<string, RecordValue>();
  for (const value of list(graph.nodes, 64, "nodes")) {
    const node = record(value, "node"), source = record(node.source, "node source"), name = string(source.object, "node object");
    if (nodes.has(name) || source.reference !== name || source.resolution !== "exact-qualified-object" ||
        source.packageSha256 !== (name.startsWith("Engine.") ? ENGINE : TEXTURES)) fail(`node source differs: ${name}.`);
    integer(source.exportIndex, 1, Number.MAX_SAFE_INTEGER, "source export index");
    if (node.classDefinition === undefined ? name !== "Engine.Palette135" || source.classObject !== "Engine.Palette" : !classes.has(String(node.classDefinition)) || node.classDefinition !== source.classObject) fail(`node class differs: ${name}.`);
    const raw = descriptor(node.rawExport);
    if (raw.bytes !== source.sourceBytes) fail(`node export length differs: ${name}.`);
    const properties = record(node.properties, `${name} properties`), tags = list(node.propertyTags, 128, "property tags"), seen = new Set<string>();
    const rawBytes = resources.get(raw.path)!, sourceOffset = integer(source.sourceOffset, 0, Number.MAX_SAFE_INTEGER, "source offset");
    for (const value of tags) {
      const tag = record(value, "property tag"), field = string(tag.name, "property name"), arrayIndex = tag.arrayIndex === null ? 0 : integer(tag.arrayIndex, 0, 127, "array index");
      const key = `${field}:${arrayIndex}`; if (seen.has(key)) fail(`duplicate property tag: ${name}.${key}.`); seen.add(key);
      const hex = tag.payloadHex; if (typeof hex !== "string" || !/^(?:[a-f0-9]{2})*$/.test(hex)) fail("invalid property payload.");
      const offset = integer(tag.payloadOffset, sourceOffset, sourceOffset + rawBytes.length, "property offset") - sourceOffset;
      let header = integer(tag.offset, sourceOffset, sourceOffset + rawBytes.length - 1, "property header") - sourceOffset;
      let more = (rawBytes[header++]! & 64) !== 0;
      while (more && header < offset) more = (rawBytes[header++]! & 128) !== 0;
      const info = rawBytes[header];
      if (more || header >= offset || info === undefined || (info & 15) !== tag.type) fail(`property header differs: ${name}.${field}.`);
      if (bytesHex(rawBytes.subarray(offset, offset + hex.length / 2)) !== hex) fail(`property bytes differ: ${name}.${field}.`);
      const payload = rawBytes.subarray(offset, offset + hex.length / 2), view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
      const property = Array.isArray(properties[field]) ? properties[field][arrayIndex] : properties[field];
      if (tag.type === 5) {
        const target = record(tag.value, "reference tag");
        if (compactIndex(payload) !== target.index || reference(property, field) !== (target.object ?? null)) fail(`property reference differs: ${name}.${field}.`);
      } else if (tag.type === 10 && tag.structName === "Color") {
        if (!equal(property, { struct: "Color", type: 10, unparsedHex: hex })) fail(`property color differs: ${name}.${field}.`);
      } else {
        const decoded = tag.type === 1 && payload.length === 1 ? payload[0]
          : tag.type === 2 && payload.length === 4 ? view.getInt32(0, true)
          : tag.type === 4 && payload.length === 4 ? view.getFloat32(0, true)
          : tag.type === 3 && payload.length === 0 ? (info & 128) !== 0 : fail(`unsupported property encoding: ${name}.${field}.`);
        if (!equal(property, tag.value) || !equal(decoded, tag.value)) fail(`property value differs: ${name}.${field}.`);
      }
    }
    if (Object.keys(properties).some(field => !seen.has(`${field}:0`))) fail(`property lacks source tag: ${name}.`);
    nodes.set(name, node);
  }
  for (const [name, current] of nodes) for (const value of current.propertyTags as unknown[]) {
    const tag = record(value, "property tag"); if (tag.type !== 5) continue;
    const target = record(tag.value, "reference tag");
    if (target.object === null && target.index === 0) continue;
    const dependency = nodes.get(String(target.object));
    if (!dependency) fail(`missing source dependency: ${String(target.object)}.`);
    const source = record(dependency.source, "dependency source");
    if (target.index !== source.exportIndex || source.packageSha256 !== record(current.source, "node source").packageSha256) fail(`reference export identity differs: ${name}.${String(tag.name)}.`);
  }
  function node(name: string, type: string): RecordValue {
    const result = nodes.get(name); if (!result || result.classDefinition !== type) fail(`missing ${type} dependency: ${name}.`); return result;
  }
  function values(name: string, type: string, allowed: string[]): RecordValue {
    const current = node(name, type), own = record(current.properties, `${name} properties`);
    const result = { ...inherited(type), ...own };
    if (Object.keys(result).some(key => !allowed.includes(key))) fail(`unknown active property: ${name}.`);
    return result;
  }
  const base = ["DefaultMaterial", "FallbackMaterial"];
  const scalar = (values: RecordValue, key: string) => number(values[key] === undefined ? 0 : values[key], key);
  const flag = (values: RecordValue, key: string) => values[key] === undefined ? false : typeof values[key] === "boolean" ? values[key] as boolean : fail(`${key} must be boolean.`);
  const ref = (values: RecordValue, key: string) => reference(values[key], key);
  function expectedRef(values: RecordValue, key: string, expected: string | null): void { if (ref(values, key) !== expected) fail(`unsupported ${key} dependency.`); }
  function inactive(values: RecordValue, refs: string[], flags: string[]): void {
    for (const key of refs) expectedRef(values, key, null);
    for (const key of flags) if (flag(values, key)) fail(`unsupported active ${key}.`);
  }
  const shader = (slot: 0 | 1): NativeFlameShader => {
    const name = rootNames[slot], data = values(name, "Engine.Shader", [...base, "DetailScale", "Diffuse", "OutputBlending", "TwoSided", "ZWrite", "AlphaTest", "AlphaRef", "Opacity", "Specular", "SpecularityMask", "SelfIllumination", "SelfIlluminationMask", "Detail", "NormalMap", "Wireframe", "ModulateStaticLighting2X", "PerformLightingOnSpecularPass", "TreatAsTwoSided"]);
    const diffuse = `${PREFIX}${slot === 0 ? "de_fire_0000" : "de_fire_glow_s"}`; expectedRef(data, "Diffuse", diffuse);
    expectedRef(data, "DefaultMaterial", "Engine.DefaultTexture");
    inactive(data, ["FallbackMaterial", "Opacity", "Specular", "SpecularityMask", "SelfIllumination", "SelfIlluminationMask", "Detail", "NormalMap"], ["Wireframe", "ModulateStaticLighting2X", "PerformLightingOnSpecularPass", "TreatAsTwoSided", "ZWrite", "AlphaTest"]);
    const outputBlending = scalar(data, "OutputBlending"); if (outputBlending !== (slot === 0 ? 5 : 3)) fail("unsupported shader blending operation.");
    return { slot, object: name, diffuse, outputBlending, twoSided: flag(data, "TwoSided"), zWrite: flag(data, "ZWrite"), alphaTest: flag(data, "AlphaTest"), alphaRef: integer(data.AlphaRef ?? 0, 0, 255, "AlphaRef") };
  };
  const shaders = [shader(0), shader(1)] as const;
  const combinerName = `${PREFIX}de_fire_glow_s`, glowName = `${PREFIX}de_fire_glow`, fadeName = `${PREFIX}FadeColor0`;
  const combine = values(combinerName, "Engine.Combiner", [...base, "CombineOperation", "AlphaOperation", "Material1", "Material2", "Mask", "Modulate2X", "Modulate4X", "InvertMask"]);
  expectedRef(combine, "Material1", glowName); expectedRef(combine, "Material2", fadeName); expectedRef(combine, "DefaultMaterial", "Engine.DefaultTexture");
  inactive(combine, ["Mask", "FallbackMaterial"], ["Modulate4X", "InvertMask"]);
  if (scalar(combine, "CombineOperation") !== 2 || scalar(combine, "AlphaOperation") !== 0) fail("unsupported combiner operation.");
  const combiner = { object: combinerName, material1: glowName, material2: fadeName, mask: null, combineOperation: scalar(combine, "CombineOperation"), alphaOperation: scalar(combine, "AlphaOperation"), modulate2X: flag(combine, "Modulate2X"), modulate4X: flag(combine, "Modulate4X"), invertMask: flag(combine, "InvertMask") };
  const fadeData = values(fadeName, "Engine.FadeColor", [...base, "Color1", "Color2", "ColorFadeType", "FadePeriod", "FadePhase"]);
  expectedRef(fadeData, "DefaultMaterial", "Engine.DefaultTexture"); expectedRef(fadeData, "FallbackMaterial", glowName);
  function color(value: unknown): NativeFlameColor {
    // Native serialized FColor is BGRA. Do not turn zero alpha into opaque.
    const data = record(value, "Color"), hex = data.unparsedHex;
    if (data.struct !== "Color" || data.type !== 10 || typeof hex !== "string" || !/^[a-f0-9]{8}$/.test(hex)) fail("unsupported source Color layout.");
    const bytes = [0, 2, 4, 6].map(index => Number.parseInt(hex.slice(index, index + 2), 16));
    return { bgraHex: hex, rgbaBytes: [bytes[2]!, bytes[1]!, bytes[0]!, bytes[3]!] };
  }
  const fade = { object: fadeName, color1: color(fadeData.Color1), color2: color(fadeData.Color2), colorFadeType: scalar(fadeData, "ColorFadeType"), fadePeriod: scalar(fadeData, "FadePeriod"), fadePhase: scalar(fadeData, "FadePhase") };
  if (fade.colorFadeType !== 1 || fade.fadePeriod <= 0) fail("unsupported fade operation/period.");
  function texture(name: string): { texture: NativeFlameTexture; data: RecordValue } {
    const current = node(name, "Engine.Texture"), data = values(name, "Engine.Texture", [...base, "DetailScale", "LODSet", "MaxColor", "MipZero", "InternalTime", "Format", "UBits", "VBits", "USize", "VSize", "UClamp", "VClamp", "UClampMode", "VClampMode", "AnimNext", "MinFrameRate", "MaxFrameRate", "TotalFrameNum", "Detail", "bMasked", "bAlphaTexture", "bTwoSided"]);
    expectedRef(data, "DefaultMaterial", "Engine.DefaultTexture"); inactive(data, ["FallbackMaterial", "Detail"], ["bMasked", "bAlphaTexture", "bTwoSided"]);
    const width = integer(data.USize, 1, 8192, "USize"), height = integer(data.VSize, 1, 8192, "VSize"), format = integer(data.Format, 0, 11, "Format");
    if (2 ** integer(data.UBits, 0, 13, "UBits") !== width || 2 ** integer(data.VBits, 0, 13, "VBits") !== height || data.UClamp !== width || data.VClamp !== height || format !== (name === glowName ? 8 : 3)) fail("texture dimensions/format differ.");
    const image = descriptor(current.image), rawExport = descriptor(current.rawExport), bytes = resources.get(image.path)!, view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes.length < 33 || bytesHex(bytes.subarray(0, 8)) !== "89504e470d0a1a0a" || view.getUint32(8) !== 13 || bytesHex(bytes.subarray(12, 16)) !== "49484452" || view.getUint32(16) !== width || view.getUint32(20) !== height) fail("PNG dimensions/header differ.");
    const ddsInfo = record(current.dds, "DDS status"), native = record(current.nativeTextureSource, "native texture source");
    const dds = ddsInfo.status === "available" ? resource(ddsInfo.file, ddsInfo) : null;
    const mips: (AssetPackageFile & { level: number; width: number; height: number })[] = [];
    if (native.status === "preserved") {
      const nativePath = string(native.manifest, "native texture manifest"), metadata = json(nativePath), source = record(metadata.source, "native texture source identity");
      if (metadata.kind !== "native-texture-source" || metadata.schemaVersion !== 1 || source.object !== name || source.packageSha256 !== TEXTURES || source.sourceExportSha256 !== rawExport.sha256 || record(metadata.format, "native format").id !== format) fail("native texture source differs.");
      const directory = nativePath.slice(0, nativePath.lastIndexOf("/") + 1);
      for (const value of list(metadata.mips, 16, "native mips")) {
        const mip = record(value, "native mip"), level = mips.length, file = resource(`${directory}${string(mip.file, "mip file")}`, { sha256: mip.sha256, bytes: mip.sourceBytes });
        if (mip.level !== level || mip.width !== Math.max(1, width >> level) || mip.height !== Math.max(1, height >> level)) fail("native mip dimensions/order differ.");
        const original = resources.get(rawExport.path)!, origin = integer(source.sourceOffset, 0, Number.MAX_SAFE_INTEGER, "texture source offset");
        const start = integer(mip.sourceOffset, origin, origin + original.length, "mip source offset") - origin;
        const blockBytes = Math.max(1, Math.ceil((mip.width as number) / 4)) * Math.max(1, Math.ceil((mip.height as number) / 4)) * (format === 8 ? 16 : 8);
        if (file.bytes !== blockBytes || bytesHex(original.subarray(start, start + file.bytes)) !== bytesHex(resources.get(file.path)!)) fail("native mip bytes differ from the original export.");
        mips.push({ ...file, level, width: mip.width as number, height: mip.height as number });
      }
      if (!mips.length || mips.length !== metadata.mipCount || mips.length !== native.mips || mips.reduce((sum, mip) => sum + mip.bytes, 0) !== native.nativeMipBytes) fail("native mip inventory differs.");
    } else if (name !== glowName || native.status !== "unsupported-layout" || native.originalExportRetained !== true) fail("unsupported native texture preservation state.");
    return { texture: { object: name, width, height, format, uClampMode: integer(data.UClampMode ?? 0, 0, 1, "UClampMode"), vClampMode: integer(data.VClampMode ?? 0, 0, 1, "VClampMode"), image, rawExport, dds, mips }, data };
  }
  const frames: NativeFlameTexture[] = [], visited = new Set<string>(); let next: string | null = `${PREFIX}de_fire_0000`, first: RecordValue | undefined;
  while (next !== null) {
    if (frames.length >= 64 || visited.has(next) || next !== `${PREFIX}de_fire_${String(frames.length).padStart(4, "0")}`) fail("AnimNext chain is cyclic or differs.");
    visited.add(next); const result = texture(next); first ??= result.data;
    if (frames.length && (result.texture.width !== frames[0]!.width || result.texture.height !== frames[0]!.height)) fail("animation frame dimensions differ.");
    frames.push(result.texture); next = ref(result.data, "AnimNext");
  }
  const totalFrameNum = integer(first!.TotalFrameNum ?? 0, 1, 64, "TotalFrameNum"); if (frames.length !== totalFrameNum) fail("AnimNext count differs from TotalFrameNum.");
  const animation = { frames, minFrameRate: scalar(first!, "MinFrameRate"), maxFrameRate: scalar(first!, "MaxFrameRate"), totalFrameNum };
  const glowResult = texture(glowName); if (ref(glowResult.data, "AnimNext") !== null) fail("unsupported animated glow dependency.");
  const edges = list(graph.edges, 256, "edges"), actualEdges = new Set<string>(), expectedEdges = new Set<string>();
  for (const [name, current] of nodes) {
    for (const [field, value] of Object.entries(record(current.properties, "node properties"))) if (object(value) && typeof value.object === "string") expectedEdges.add(`${name}|${field}|${value.object}`);
    if (typeof current.classDefinition === "string") for (const [field, value] of Object.entries(inherited(current.classDefinition))) if (object(value) && typeof value.object === "string") expectedEdges.add(`${name}|inherited.${field}|${value.object}`);
  }
  for (const value of edges) {
    const edge = record(value, "edge"), from = string(edge.from, "edge source"), to = string(edge.to, "edge target"), key = `${from}|${string(edge.field, "edge field")}|${to}`;
    if (!nodes.has(from) || !nodes.has(to) || actualEdges.has(key)) fail("edge dependency is missing or duplicated."); actualEdges.add(key);
  }
  if (actualEdges.size !== expectedEdges.size || [...expectedEdges].some(edge => !actualEdges.has(edge))) fail("graph edges differ from source dependencies.");
  const billboardTags = list(graph.nativeMeshPropertyTags, 16, "mesh tags").map(value => record(value, "mesh tag")).filter(tag => tag.name === "bUseBillBoard");
  if (billboardTags.length !== 1 || billboardTags[0]!.type !== 3 || billboardTags[0]!.status !== "decoded" || typeof billboardTags[0]!.value !== "boolean") fail("mesh billboard source tag is missing or ambiguous.");
  return { modelId: asset.manifest.id, sourceMesh: SOURCE, graph: graphFile, billboard: billboardTags[0]!.value as boolean, shaders, animation, glow: glowResult.texture, fade, combiner, resources, provenance: { graph, classes, nodes } };
}
