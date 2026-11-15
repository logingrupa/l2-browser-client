import { BLEND_CONSTANTS, type NamedBlendPair } from "./constants/blendConstants";
import type { BlendFactorPair, FogFamily } from "./constants/blendFactorTypes";
import { FOG_CONSTANTS } from "./constants/fogConstants";
import { readEnumOrdinal, readNumberField, readReferenceField } from "./materialFieldValues";
import { MaterialProgramError, programField, programNode, type MaterialProgram, type MaterialProgramNode } from "./materialProgram";

export type BlendSource = "final-blend" | "shader" | "texture" | "non-blending-root";

export interface ResolvedMaterialBlend {
  readonly status: "resolved";
  readonly source: BlendSource;
  readonly sourceNode: string;
  readonly modeName: string;
  readonly pair: BlendFactorPair;
  readonly colourWrite: boolean;
  readonly depthWrite: boolean;
  readonly depthTest: boolean;
  readonly twoSided: boolean;
  readonly alphaTest: boolean;
  readonly alphaReference: number;
  readonly fogFamily: FogFamily;
  readonly constantIds: readonly string[];
}

export interface UnresolvedMaterialBlend {
  readonly status: "diagnostic";
  readonly sourceNode: string;
  readonly reason: string;
}

export type MaterialBlend = ResolvedMaterialBlend | UnresolvedMaterialBlend;

export interface ParticleDrawStyleBlend {
  readonly drawStyle: number;
  readonly modeName: string;
  readonly pair: BlendFactorPair;
  readonly alphaPair: BlendFactorPair;
  readonly referencePair: BlendFactorPair;
  readonly fogFamily: FogFamily;
  readonly constantIds: readonly string[];
}

const modifierInnerField = "Material";
const modifierClasses = new Set([
  "Engine.ColorModifier", "Engine.TexPanner", "Engine.TexRotator", "Engine.TexOscillator", "Engine.TexScaler", "Engine.TexEnvMap", "Engine.TexCoordSource",
]);
const invisiblePair: BlendFactorPair = { source: "zero", destination: "one" };
const maximumModifierDepth = 128;

function optionalBoolean(node: MaterialProgramNode, fieldName: string): boolean | null {
  const field = programField(node, fieldName);
  if (field === null || field.value === null) return null;
  if (typeof field.value !== "boolean") throw new MaterialProgramError(`Material blend: ${node.id}.${fieldName} is not a boolean.`);
  return field.value;
}

function writesColour(pair: BlendFactorPair): boolean {
  return !(pair.source === invisiblePair.source && pair.destination === invisiblePair.destination);
}

function diagnostic(sourceNode: string, reason: string): UnresolvedMaterialBlend {
  return { status: "diagnostic", sourceNode, reason };
}

function tableEntry(table: readonly NamedBlendPair[], ordinal: number): NamedBlendPair | undefined {
  return table[ordinal];
}

function alphaTestOf(node: MaterialProgramNode): { alphaTest: boolean; alphaReference: number } {
  return { alphaTest: optionalBoolean(node, "AlphaTest") ?? false, alphaReference: readNumberField(node, "AlphaRef") };
}

function finalBlendState(node: MaterialProgramNode, twoSidedFromModifiers: boolean): MaterialBlend {
  const ordinal = readEnumOrdinal(node, "FrameBufferBlending");
  const entry = tableEntry(BLEND_CONSTANTS.finalBlendPairs.runtimeDefault, ordinal);
  const fogFamily = FOG_CONSTANTS.materialFamilies.runtimeDefault.finalBlend[ordinal];
  if (!entry || fogFamily === undefined) return diagnostic(node.id, `material-blend-ordinal-unknown:FrameBufferBlending=${ordinal}`);
  if (entry.pair === null || fogFamily === null) return diagnostic(node.id, "material-feature-unported:FrameBufferBlending");
  const ruleDepthWrite = ordinal === 0;
  return {
    status: "resolved", source: "final-blend", sourceNode: node.id, modeName: entry.name, pair: entry.pair, colourWrite: writesColour(entry.pair),
    depthWrite: optionalBoolean(node, "ZWrite") ?? ruleDepthWrite, depthTest: optionalBoolean(node, "ZTest") ?? true,
    twoSided: twoSidedFromModifiers || (optionalBoolean(node, "TwoSided") ?? false), ...alphaTestOf(node), fogFamily,
    constantIds: [BLEND_CONSTANTS.finalBlendPairs.id, BLEND_CONSTANTS.depthWriteRule.id, FOG_CONSTANTS.materialFamilies.id],
  };
}

function shaderState(node: MaterialProgramNode, twoSidedFromModifiers: boolean): MaterialBlend {
  const ordinal = readEnumOrdinal(node, "OutputBlending");
  const interludeEntry = BLEND_CONSTANTS.outputBlendingInterludePairs.runtimeDefault[ordinal];
  const referenceEntry = tableEntry(BLEND_CONSTANTS.outputBlendingPairs.runtimeDefault, ordinal);
  const fogFamily = FOG_CONSTANTS.materialFamilies.runtimeDefault.outputBlending[ordinal];
  const entry = interludeEntry ?? referenceEntry;
  if (!entry || entry.pair === null || fogFamily === undefined) return diagnostic(node.id, `material-blend-ordinal-unknown:OutputBlending=${ordinal}`);
  const hasOpacity = readReferenceField(node, "Opacity").kind !== "none";
  const normalWithOpacity = ordinal === 0 && hasOpacity;
  const masked = ordinal === 1;
  const pair = normalWithOpacity ? BLEND_CONSTANTS.normalWithOpacityPair.runtimeDefault : entry.pair;
  const authoredAlphaTest = alphaTestOf(node);
  const constantIds: string[] = [interludeEntry ? BLEND_CONSTANTS.outputBlendingInterludePairs.id : BLEND_CONSTANTS.outputBlendingPairs.id,
    BLEND_CONSTANTS.depthWriteRule.id, FOG_CONSTANTS.materialFamilies.id];
  if (normalWithOpacity) constantIds.push(BLEND_CONSTANTS.normalWithOpacityPair.id);
  if (masked) constantIds.push(BLEND_CONSTANTS.maskedAlphaReference.id);
  return {
    status: "resolved", source: "shader", sourceNode: node.id, modeName: entry.name, pair, colourWrite: writesColour(pair),
    depthWrite: (ordinal === 0 && !hasOpacity) || masked, depthTest: true,
    twoSided: twoSidedFromModifiers || (optionalBoolean(node, "TwoSided") ?? false),
    alphaTest: masked || authoredAlphaTest.alphaTest,
    alphaReference: masked ? BLEND_CONSTANTS.maskedAlphaReference.runtimeDefault : authoredAlphaTest.alphaReference,
    fogFamily, constantIds,
  };
}

function textureState(node: MaterialProgramNode, twoSidedFromModifiers: boolean): MaterialBlend {
  const masked = optionalBoolean(node, "bMasked") ?? false;
  const alphaTexture = optionalBoolean(node, "bAlphaTexture") ?? false;
  const pairs = BLEND_CONSTANTS.bareTexturePairs.runtimeDefault;
  const pair = alphaTexture ? pairs.alphaTexture : pairs.opaque;
  return {
    status: "resolved", source: "texture", sourceNode: node.id, modeName: alphaTexture ? "bAlphaTexture" : masked ? "bMasked" : "opaque", pair,
    colourWrite: true, depthWrite: !alphaTexture, depthTest: true, twoSided: twoSidedFromModifiers || (optionalBoolean(node, "bTwoSided") ?? false),
    alphaTest: masked, alphaReference: masked ? BLEND_CONSTANTS.maskedAlphaReference.runtimeDefault : 0,
    fogFamily: FOG_CONSTANTS.materialFamilies.runtimeDefault.nonBlendingRoot,
    constantIds: [BLEND_CONSTANTS.bareTexturePairs.id, BLEND_CONSTANTS.maskedAlphaReference.id, FOG_CONSTANTS.materialFamilies.id],
  };
}

function nonBlendingRootState(node: MaterialProgramNode, twoSidedFromModifiers: boolean): MaterialBlend {
  const pair = BLEND_CONSTANTS.nonBlendingRoot.runtimeDefault;
  return {
    status: "resolved", source: "non-blending-root", sourceNode: node.id, modeName: node.class, pair, colourWrite: true, depthWrite: true, depthTest: true,
    twoSided: twoSidedFromModifiers, alphaTest: false, alphaReference: 0, fogFamily: FOG_CONSTANTS.materialFamilies.runtimeDefault.nonBlendingRoot,
    constantIds: [BLEND_CONSTANTS.nonBlendingRoot.id, FOG_CONSTANTS.materialFamilies.id],
  };
}

export function blendFactorsForMaterial(program: MaterialProgram): MaterialBlend {
  let node = programNode(program, program.root);
  let twoSidedFromModifiers = false;
  for (let depth = 0; depth <= maximumModifierDepth; depth += 1) {
    if (node.status !== "reviewed") return diagnostic(node.id, node.gapReasons[0] ?? `material-class-unported:${node.class}`);
    if (node.class === "Engine.FinalBlend") return finalBlendState(node, twoSidedFromModifiers);
    if (node.class === "Engine.Shader") return shaderState(node, twoSidedFromModifiers);
    if (node.class === "Engine.Texture") return textureState(node, twoSidedFromModifiers);
    if (!modifierClasses.has(node.class)) return nonBlendingRootState(node, twoSidedFromModifiers);
    if (node.class === "Engine.ColorModifier" && optionalBoolean(node, "RenderTwoSided") === true) twoSidedFromModifiers = true;
    const inner = readReferenceField(node, modifierInnerField);
    if (inner.kind === "none") return diagnostic(node.id, `material-reference-absent:${node.id}.${modifierInnerField}`);
    if (inner.kind === "external") return diagnostic(node.id, `material-reference-external:${inner.object}`);
    node = programNode(program, inner.nodeId);
  }
  return diagnostic(program.root, `material-modifier-chain-exceeds:${maximumModifierDepth}`);
}

export function blendFactorsForParticleDrawStyle(drawStyle: number): ParticleDrawStyleBlend {
  const shipped = BLEND_CONSTANTS.particleDrawStylePairs.runtimeDefault[drawStyle];
  const reference = BLEND_CONSTANTS.particleDrawStylePairs.value[drawStyle];
  const fogFamily = FOG_CONSTANTS.particleFamilies.runtimeDefault[drawStyle];
  if (!Number.isInteger(drawStyle) || !shipped?.pair || !reference?.pair || fogFamily === undefined) {
    throw new RangeError(`Particle draw style ${drawStyle} has no blend table row.`);
  }
  return {
    drawStyle, modeName: shipped.name, pair: shipped.pair, alphaPair: BLEND_CONSTANTS.particleAlphaPair.runtimeDefault, referencePair: reference.pair, fogFamily,
    constantIds: [BLEND_CONSTANTS.particleDrawStylePairs.id, BLEND_CONSTANTS.particleAlphaPair.id, FOG_CONSTANTS.particleFamilies.id],
  };
}
