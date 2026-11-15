import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";

export type FixtureFieldValue = null | boolean | number | string | { readonly [member: string]: FixtureFieldValue } | readonly FixtureFieldValue[];

export interface FixtureProgramField {
  field: string;
  declaredType: string | null;
  declaringClass: string | null;
  provenance: "authored" | "class-default" | "ue-zero";
  status: "typed" | "raw" | "unported" | "unconfirmed";
  value: FixtureFieldValue;
}

export interface FixtureTextureImage { path: string; sha256: string; bytes: number }

export interface FixtureProgramNode {
  id: string;
  class: string;
  status: "reviewed" | "unported" | "preserved-data";
  gapReasons: string[];
  fields: FixtureProgramField[];
  image?: FixtureTextureImage;
}

export interface FixtureProgram {
  schemaVersion: 1;
  kind: "ue2-material-program";
  graphSha256: string;
  root: string;
  nodes: FixtureProgramNode[];
  gapReasons: string[];
}

export interface FixtureStoreFile { readonly storePath: string; readonly bytes: Uint8Array }

export const swatchTextureRgba = [200, 100, 50, 255] as const;
export const syntheticGraphSha256 = "5e".repeat(32);
const swatchTextureSize = 4;
const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function field(name: string, value: FixtureFieldValue, provenance: FixtureProgramField["provenance"] = "authored",
  status: FixtureProgramField["status"] = "typed"): FixtureProgramField {
  return { field: name, declaredType: null, declaringClass: null, provenance, status, value };
}

export const enumValue = (ordinal: number, name: string) => ({ ordinal, name });
export const nodeReference = (node: string) => ({ node });
export const rawStruct = (structName: string, rawHex: string) => ({ rawHex, propertyType: 10, structName });

export function reviewedNode(id: string, nodeClass: string, fields: FixtureProgramField[], image?: FixtureTextureImage): FixtureProgramNode {
  return image ? { id, class: nodeClass, status: "reviewed", gapReasons: [], fields, image } : { id, class: nodeClass, status: "reviewed", gapReasons: [], fields };
}

export function unportedNode(id: string, nodeClass: string): FixtureProgramNode {
  return { id, class: nodeClass, status: "unported", gapReasons: [`material-class-unported:${nodeClass}`], fields: [] };
}

export function programOf(root: string, nodes: FixtureProgramNode[]): FixtureProgram {
  return { schemaVersion: 1, kind: "ue2-material-program", graphSha256: syntheticGraphSha256, root, nodes,
    gapReasons: [...new Set(nodes.flatMap(node => node.gapReasons))].sort() };
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const value of bytes) {
    crc ^= value;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  chunk.set(Buffer.from(type, "ascii"), 4);
  chunk.set(data, 8);
  view.setUint32(8 + data.length, crc32(chunk.subarray(4, 8 + data.length)));
  return chunk;
}

export function encodeSolidRgbaPng(width: number, height: number, rgba: readonly number[]): Uint8Array {
  const header = new Uint8Array(13);
  const headerView = new DataView(header.buffer);
  headerView.setUint32(0, width);
  headerView.setUint32(4, height);
  header.set([8, 6, 0, 0, 0], 8);
  const rows = new Uint8Array((width * 4 + 1) * height);
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) rows.set(rgba, row * (width * 4 + 1) + 1 + column * 4);
  }
  const parts = [Uint8Array.from(pngSignature), pngChunk("IHDR", header), pngChunk("IDAT", deflateSync(rows)), pngChunk("IEND", new Uint8Array())];
  return Uint8Array.from(parts.flatMap(part => [...part]));
}

function sortedKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedKeys);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, sortedKeys((value as Record<string, unknown>)[key])]));
  }
  return value;
}

export function canonicalProgramBytes(program: FixtureProgram): Uint8Array {
  return Buffer.from(`${JSON.stringify(sortedKeys(program), null, 2)}\n`, "utf8");
}

export function textureImageFor(pngBytes: Uint8Array): FixtureTextureImage {
  const sha256 = sha256Hex(pngBytes);
  return { path: `/l2/native-material-textures/${sha256}/texture.png`, sha256, bytes: pngBytes.length };
}

export function swatchTexturePng(): Uint8Array {
  return encodeSolidRgbaPng(swatchTextureSize, swatchTextureSize, swatchTextureRgba);
}

export function swatchTextureNode(id: string, image: FixtureTextureImage, size = swatchTextureSize): FixtureProgramNode {
  return reviewedNode(id, "Engine.Texture", [
    field("USize", size), field("VSize", size), field("UClampMode", enumValue(0, "TC_Wrap"), "ue-zero"),
    field("VClampMode", enumValue(0, "TC_Wrap"), "ue-zero"), field("bMasked", false, "ue-zero"), field("bAlphaTexture", false, "ue-zero"),
    field("AnimNext", null, "ue-zero"), field("MaxFrameRate", 0, "ue-zero"),
  ], image);
}

function overwritingFinalBlendNode(id: string, material: string): FixtureProgramNode {
  return reviewedNode(id, "Engine.FinalBlend", [
    field("Material", nodeReference(material)), field("FrameBufferBlending", enumValue(0, "FB_Overwrite"), "ue-zero"),
    field("ZWrite", true, "class-default"), field("ZTest", true, "class-default"), field("AlphaTest", false, "ue-zero"),
    field("TwoSided", false, "ue-zero"), field("AlphaRef", 0, "ue-zero"),
  ]);
}

export function syntheticSwatchProgram(image: FixtureTextureImage): FixtureProgram {
  return programOf("SyntheticSwatch.SwatchFinalBlend", [
    overwritingFinalBlendNode("SyntheticSwatch.SwatchFinalBlend", "SyntheticSwatch.SwatchShader"),
    reviewedNode("SyntheticSwatch.SwatchShader", "Engine.Shader", [
      field("Diffuse", nodeReference("SyntheticSwatch.SwatchTexture")), field("Opacity", null, "ue-zero"),
      field("OutputBlending", enumValue(0, "OB_Normal"), "ue-zero"), field("TwoSided", false, "ue-zero"), field("DetailScale", 8, "class-default"),
    ]),
    swatchTextureNode("SyntheticSwatch.SwatchTexture", image),
  ]);
}

export function syntheticUnportedProgram(): FixtureProgram {
  return programOf("SyntheticSwatch.TriggeredOscillator", [unportedNode("SyntheticSwatch.TriggeredOscillator", "Engine.TexOscillatorTriggered")]);
}

export const combinerSwatchInputRgba = {
  material1: [128, 64, 255, 200],
  material2: [255, 128, 200, 100],
  mask: [10, 51, 90, 30],
} as const;

export const waterShaderSwatchInputRgba = {
  oceanS: [102, 153, 51, 204],
  TexOscillator0: [51, 102, 153, 153],
  base1: [25, 51, 76, 128],
} as const;

export type CombinerSwatchInput = keyof typeof combinerSwatchInputRgba;
type WaterShaderSwatchInput = keyof typeof waterShaderSwatchInputRgba;

export interface CombinerSwatchCase {
  readonly colourOperation: number;
  readonly alphaOperation: number;
  readonly modulate2X: boolean;
  readonly mask: "mask-texture" | "none";
  readonly material2: "texture" | "nested-combiner";
}

const combinerColourOperationCount = 8;
const combinerAlphaOperationCount = 5;
const combinerSwatchInputs = Object.keys(combinerSwatchInputRgba) as CombinerSwatchInput[];
const waterShaderSwatchInputs = Object.keys(waterShaderSwatchInputRgba) as WaterShaderSwatchInput[];
const combinerSwatchInputNodeId = (input: CombinerSwatchInput) => `SyntheticCombinerSwatch.${input}`;
const waterShaderSwatchNodeId = (name: string) => `SyntheticWaterSwatch.${name}`;
const nestedMaterial2NodeId = "SyntheticCombinerSwatch.nestedMaterial2";
const multiplyColourOperation = 2;
const useMaskAlphaOperation = 0;
const maskReadingColourOperations = [5, 6, 7] as const;

const combinerSwatchCasesWithMaskTexture: readonly CombinerSwatchCase[] = Array.from({ length: combinerColourOperationCount }, (_, colourOperation) => ({
  colourOperation, alphaOperation: colourOperation % combinerAlphaOperationCount, modulate2X: colourOperation === multiplyColourOperation,
  mask: "mask-texture", material2: "texture",
}));

const combinerSwatchCasesWithoutMask: readonly CombinerSwatchCase[] = maskReadingColourOperations.flatMap(colourOperation =>
  (["texture", "nested-combiner"] as const).map(material2 => ({ colourOperation, alphaOperation: useMaskAlphaOperation, modulate2X: false, mask: "none" as const, material2 })));

export const combinerSwatchCases: readonly CombinerSwatchCase[] = [...combinerSwatchCasesWithMaskTexture, ...combinerSwatchCasesWithoutMask];

function combinerSwatchCaseName(swatchCase: CombinerSwatchCase): string {
  return `colour-${swatchCase.colourOperation}-alpha-${swatchCase.alphaOperation}-mask-${swatchCase.mask}-material2-${swatchCase.material2}`;
}

export const swatchInputRgbaByTextureNode: Readonly<Record<string, readonly number[]>> = {
  ...Object.fromEntries(combinerSwatchInputs.map(input => [combinerSwatchInputNodeId(input), combinerSwatchInputRgba[input]])),
  ...Object.fromEntries(waterShaderSwatchInputs.map(input => [waterShaderSwatchNodeId(input), waterShaderSwatchInputRgba[input]])),
};

function solidInputPng(rgba: readonly number[]): Uint8Array {
  return encodeSolidRgbaPng(1, 1, rgba);
}

function combinerNodeWithoutMask(id: string, colourOperation: number, alphaOperation: number, material1: string, material2: string): FixtureProgramNode {
  return reviewedNode(id, "Engine.Combiner", [
    field("CombineOperation", enumValue(colourOperation, `CO_${colourOperation}`)), field("AlphaOperation", enumValue(alphaOperation, `AO_${alphaOperation}`)),
    field("Material1", nodeReference(material1)), field("Material2", nodeReference(material2)),
    field("Mask", null, "ue-zero"), field("InvertMask", false, "ue-zero"), field("Modulate2X", false, "ue-zero"), field("Modulate4X", false, "ue-zero"),
  ]);
}

export function syntheticCombinerSwatchProgram(swatchCase: CombinerSwatchCase): FixtureProgram {
  const nestedMaterial2 = swatchCase.material2 === "nested-combiner";
  return programOf("SyntheticCombinerSwatch.Overwrite", [
    overwritingFinalBlendNode("SyntheticCombinerSwatch.Overwrite", "SyntheticCombinerSwatch.Combiner"),
    reviewedNode("SyntheticCombinerSwatch.Combiner", "Engine.Combiner", [
      field("CombineOperation", enumValue(swatchCase.colourOperation, `CO_${swatchCase.colourOperation}`)),
      field("AlphaOperation", enumValue(swatchCase.alphaOperation, `AO_${swatchCase.alphaOperation}`)),
      field("Material1", nodeReference(combinerSwatchInputNodeId("material1"))),
      field("Material2", nodeReference(nestedMaterial2 ? nestedMaterial2NodeId : combinerSwatchInputNodeId("material2"))),
      swatchCase.mask === "mask-texture" ? field("Mask", nodeReference(combinerSwatchInputNodeId("mask"))) : field("Mask", null, "ue-zero"),
      field("InvertMask", false, "ue-zero"), field("Modulate2X", swatchCase.modulate2X), field("Modulate4X", false, "ue-zero"),
    ]),
    ...(nestedMaterial2 ? [combinerNodeWithoutMask(nestedMaterial2NodeId, 0, 3, combinerSwatchInputNodeId("material2"), combinerSwatchInputNodeId("material1"))] : []),
    ...combinerSwatchInputs.map(input => swatchTextureNode(combinerSwatchInputNodeId(input), textureImageFor(solidInputPng(combinerSwatchInputRgba[input])), 1)),
  ]);
}

function waterShaderSwatchNodes(): FixtureProgramNode[] {
  const waterCombiner = (name: string, colourOperation: number, alphaOperation: number, material1: string, material2: string) =>
    combinerNodeWithoutMask(waterShaderSwatchNodeId(name), colourOperation, alphaOperation, waterShaderSwatchNodeId(material1), waterShaderSwatchNodeId(material2));
  return [
    reviewedNode(waterShaderSwatchNodeId("WaterShader01"), "Engine.Shader", [
      field("Diffuse", nodeReference(waterShaderSwatchNodeId("reflection"))), field("Opacity", nodeReference(waterShaderSwatchNodeId("base1"))),
      field("OutputBlending", enumValue(0, "OB_Normal"), "ue-zero"), field("TwoSided", false, "ue-zero"),
    ]),
    waterCombiner("reflection", 6, 1, "TexOscillator0", "com"),
    waterCombiner("com", 3, 1, "ocn_s", "base1"),
    waterCombiner("ocn_s", 2, 0, "oceanS", "TexOscillator0"),
    ...waterShaderSwatchInputs.map(input => swatchTextureNode(waterShaderSwatchNodeId(input), textureImageFor(solidInputPng(waterShaderSwatchInputRgba[input])), 1)),
  ];
}

export function syntheticWaterShaderProgram(): FixtureProgram {
  return programOf(waterShaderSwatchNodeId("WaterShader01"), waterShaderSwatchNodes());
}

function syntheticWaterShaderSwatchProgram(): FixtureProgram {
  const overwriteId = waterShaderSwatchNodeId("Overwrite");
  return programOf(overwriteId, [overwritingFinalBlendNode(overwriteId, waterShaderSwatchNodeId("WaterShader01")), ...waterShaderSwatchNodes()]);
}

export interface CombinerSwatchFixture { readonly name: string; readonly program: FixtureProgram; readonly materialId: string }

function combinerSwatchFixtureFiles(): { readonly files: FixtureStoreFile[]; readonly combinerSwatches: CombinerSwatchFixture[] } {
  const inputRgba = [...combinerSwatchInputs.map(input => combinerSwatchInputRgba[input]), ...waterShaderSwatchInputs.map(input => waterShaderSwatchInputRgba[input])];
  const files: FixtureStoreFile[] = inputRgba.map(rgba => {
    const png = solidInputPng(rgba);
    return { storePath: textureImageFor(png).path, bytes: png };
  });
  const swatchPrograms = [
    ...combinerSwatchCases.map(swatchCase => ({ name: combinerSwatchCaseName(swatchCase), program: syntheticCombinerSwatchProgram(swatchCase) })),
    { name: "water-shader-01", program: syntheticWaterShaderSwatchProgram() },
  ];
  const combinerSwatches = swatchPrograms.map(({ name, program }) => {
    const bytes = canonicalProgramBytes(program);
    const materialId = sha256Hex(bytes);
    files.push({ storePath: `/l2/native-materials/${materialId}/program.json`, bytes });
    return { name, program, materialId };
  });
  return { files, combinerSwatches };
}

export function materialSwatchFixtureFiles(): {
  readonly files: readonly FixtureStoreFile[]; readonly swatchMaterialId: string; readonly unportedMaterialId: string; readonly combinerSwatches: readonly CombinerSwatchFixture[];
} {
  const png = swatchTexturePng();
  const image = textureImageFor(png);
  const swatchBytes = canonicalProgramBytes(syntheticSwatchProgram(image));
  const unportedBytes = canonicalProgramBytes(syntheticUnportedProgram());
  const swatchMaterialId = sha256Hex(swatchBytes);
  const unportedMaterialId = sha256Hex(unportedBytes);
  const combiner = combinerSwatchFixtureFiles();
  return {
    swatchMaterialId, unportedMaterialId, combinerSwatches: combiner.combinerSwatches,
    files: [
      { storePath: image.path, bytes: png },
      { storePath: `/l2/native-materials/${swatchMaterialId}/program.json`, bytes: swatchBytes },
      { storePath: `/l2/native-materials/${unportedMaterialId}/program.json`, bytes: unportedBytes },
      ...combiner.files,
    ],
  };
}
