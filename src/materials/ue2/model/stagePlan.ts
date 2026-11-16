import { COMBINER_CONSTANTS } from "./constants/combinerConstants";
import { blendFactorsForMaterial, type MaterialBlend, type ResolvedMaterialBlend } from "./blendTable";
import { fieldIsUnported, readBooleanField, readEnumOrdinal, readNumberField, readReferenceField, type MaterialReference } from "./materialFieldValues";
import { fadeColourGapReason } from "./modifiers";
import { programNode, TEXTURE_COORDINATE_MODIFIER_CLASSES, type MaterialProgram, type MaterialProgramNode, type MaterialTextureImage } from "./materialProgram";

export type ColourSourceKind = "constant-colour" | "fade-colour" | "color-modifier";

type CombinerMaterialSlot = "material1" | "material2";

export type ColourExpression =
  | { readonly kind: "texture"; readonly samplerIndex: number }
  | { readonly kind: "white" }
  | { readonly kind: "colour-source"; readonly colourSourceIndex: number }
  | { readonly kind: "modulate"; readonly input: ColourExpression; readonly colourSourceIndex: number; readonly alphaBlend: boolean }
  | {
      readonly kind: "combiner";
      readonly colourOperation: number;
      readonly alphaOperation: number;
      readonly colourMultiplier: 1 | 2 | 4;
      readonly firstEmittedMaterial: CombinerMaterialSlot;
      readonly alphaComplementedMaterial: CombinerMaterialSlot | null;
      readonly maskAlphaComplemented: boolean;
      readonly material1: ColourExpression;
      readonly material2: ColourExpression;
      readonly mask: ColourExpression | null;
    }
  | {
      readonly kind: "shader";
      readonly diffuse: ColourExpression;
      readonly opacity: ColourExpression | null;
      readonly specular: ColourExpression | null;
      readonly specularityMask: ColourExpression | null;
      readonly selfIllumination: ColourExpression | null;
      readonly selfIlluminationMask: ColourExpression | null;
    };

export interface MaterialSampler {
  readonly textureNode: string;
  readonly frameNodes: readonly string[];
  readonly frameImages: readonly MaterialTextureImage[];
  readonly maximumFrameRate: number;
  readonly textureCoordinateModifiers: readonly string[];
  readonly clampU: boolean;
  readonly clampV: boolean;
  readonly width: number;
  readonly height: number;
  readonly frameSizes: readonly MaterialTextureSize[];
}

export interface MaterialTextureSize { readonly width: number; readonly height: number }

export interface MaterialColourSource { readonly node: string; readonly kind: ColourSourceKind }

export interface CompiledMaterialStagePlan {
  readonly status: "compiled";
  readonly root: string;
  readonly expression: ColourExpression;
  readonly samplers: readonly MaterialSampler[];
  readonly colourSources: readonly MaterialColourSource[];
  readonly blend: ResolvedMaterialBlend;
}

export interface DiagnosticMaterialStagePlan {
  readonly status: "diagnostic";
  readonly root: string;
  readonly reasons: readonly string[];
  readonly unportedClass: string | null;
  readonly blend: MaterialBlend;
}

export type MaterialStagePlan = CompiledMaterialStagePlan | DiagnosticMaterialStagePlan;

const textureCoordinateModifierClasses = new Set<string>(TEXTURE_COORDINATE_MODIFIER_CLASSES);
const clampModeOrdinal = 1;
const maximumCompileDepth = 64;
const maximumAnimationFrames = 256;

interface CompileState {
  readonly program: MaterialProgram;
  readonly samplers: MaterialSampler[];
  readonly colourSources: MaterialColourSource[];
  readonly reasons: string[];
  readonly nodesBeingCompiled: Set<string>;
  readonly compiledExpressions: Map<string, ColourExpression>;
  unportedClass: string | null;
}

function fail(state: CompileState, reason: string): ColourExpression {
  if (!state.reasons.includes(reason)) state.reasons.push(reason);
  return { kind: "white" };
}

function isReviewedTexture(node: MaterialProgramNode): boolean {
  return node.status === "reviewed" && node.class === "Engine.Texture";
}

function animationFrames(state: CompileState, first: MaterialProgramNode): MaterialProgramNode[] | null {
  const frames = [first];
  let reference = readReferenceField(first, "AnimNext");
  while (reference.kind !== "none") {
    if (reference.kind === "external") {
      fail(state, `material-reference-external:${reference.object}`);
      return null;
    }
    const nextNodeId = reference.nodeId;
    if (nextNodeId === first.id) return frames;
    if (frames.some(frame => frame.id === nextNodeId) || frames.length >= maximumAnimationFrames) {
      fail(state, `texture-animation-chain-unclosed:${first.id}`);
      return null;
    }
    const nextFrame = programNode(state.program, nextNodeId);
    frames.push(nextFrame);
    if (!isReviewedTexture(nextFrame)) return frames;
    reference = readReferenceField(nextFrame, "AnimNext");
  }
  return frames;
}

function compileTexture(state: CompileState, node: MaterialProgramNode, modifiers: readonly string[]): ColourExpression {
  const frames = animationFrames(state, node);
  if (!frames) return { kind: "white" };
  const unreviewedFrame = frames.find(frame => !isReviewedTexture(frame));
  if (unreviewedFrame) return fail(state, `texture-animation-frame-unreviewed:${unreviewedFrame.id}`);
  const missingImage = frames.find(frame => frame.image === null);
  if (missingImage) return fail(state, `texture-image-absent:${missingImage.id}`);
  const samplerIndex = state.samplers.length;
  state.samplers.push({
    textureNode: node.id, frameNodes: frames.map(frame => frame.id), frameImages: frames.map(frame => frame.image!),
    maximumFrameRate: readNumberField(node, "MaxFrameRate"), textureCoordinateModifiers: modifiers,
    clampU: readEnumOrdinal(node, "UClampMode") === clampModeOrdinal, clampV: readEnumOrdinal(node, "VClampMode") === clampModeOrdinal,
    width: readNumberField(node, "USize"), height: readNumberField(node, "VSize"),
    frameSizes: frames.map(frame => ({ width: readNumberField(frame, "USize"), height: readNumberField(frame, "VSize") })),
  });
  return { kind: "texture", samplerIndex };
}

function addColourSource(state: CompileState, node: MaterialProgramNode, kind: ColourSourceKind): number {
  state.colourSources.push({ node: node.id, kind });
  return state.colourSources.length - 1;
}

function compileReference(state: CompileState, owner: MaterialProgramNode, fieldName: string, modifiers: readonly string[], depth: number): ColourExpression | null {
  const reference: MaterialReference = readReferenceField(owner, fieldName);
  if (reference.kind === "none") return null;
  if (reference.kind === "external") return fail(state, `material-reference-external:${reference.object}`);
  return compileNode(state, programNode(state.program, reference.nodeId), modifiers, depth + 1);
}

function compileRequired(state: CompileState, owner: MaterialProgramNode, fieldName: string, modifiers: readonly string[], depth: number): ColourExpression {
  return compileReference(state, owner, fieldName, modifiers, depth) ?? fail(state, `material-reference-absent:${owner.id}.${fieldName}`);
}

function compileShader(state: CompileState, node: MaterialProgramNode, modifiers: readonly string[], depth: number): ColourExpression {
  if (readReferenceField(node, "Detail").kind !== "none") fail(state, "material-feature-unported:Detail");
  return {
    kind: "shader",
    diffuse: compileRequired(state, node, "Diffuse", modifiers, depth),
    opacity: compileReference(state, node, "Opacity", modifiers, depth),
    specular: compileReference(state, node, "Specular", modifiers, depth),
    specularityMask: compileReference(state, node, "SpecularityMask", modifiers, depth),
    selfIllumination: compileReference(state, node, "SelfIllumination", modifiers, depth),
    selfIlluminationMask: compileReference(state, node, "SelfIlluminationMask", modifiers, depth),
  };
}

const combinerColourOperationCount = 8;
const combinerAlphaOperationCount = 5;
const absentCombinerMaterial: ColourExpression = { kind: COMBINER_CONSTANTS.absentMaterial.runtimeDefault };

function maskAliasedMaterial(node: MaterialProgramNode): CombinerMaterialSlot | null {
  const mask = readReferenceField(node, "Mask");
  if (mask.kind !== "node") return null;
  const maskIsField = (fieldName: string) => {
    const material = readReferenceField(node, fieldName);
    return material.kind === "node" && material.nodeId === mask.nodeId;
  };
  if (maskIsField("Material1")) return "material1";
  if (maskIsField("Material2")) return "material2";
  return null;
}

function firstEmittedMaterial(material1: ColourExpression, material2: ColourExpression, invertMask: boolean, maskAlias: CombinerMaterialSlot | null): CombinerMaterialSlot {
  const material1IsBitmap = material1.kind === "texture", material2IsBitmap = material2.kind === "texture";
  if (material1IsBitmap && !material2IsBitmap) return "material2";
  if (material1IsBitmap && material2IsBitmap && invertMask && maskAlias === "material2") return "material2";
  return "material1";
}

function compileCombiner(state: CompileState, node: MaterialProgramNode, modifiers: readonly string[], depth: number): ColourExpression {
  const colourOperation = readEnumOrdinal(node, "CombineOperation");
  const alphaOperation = readEnumOrdinal(node, "AlphaOperation");
  if (colourOperation >= combinerColourOperationCount) return fail(state, `material-combiner-operation-unknown:CombineOperation=${colourOperation}`);
  if (alphaOperation >= combinerAlphaOperationCount) return fail(state, `material-combiner-operation-unknown:AlphaOperation=${alphaOperation}`);
  const material1 = compileReference(state, node, "Material1", modifiers, depth) ?? absentCombinerMaterial;
  const material2 = compileReference(state, node, "Material2", modifiers, depth) ?? absentCombinerMaterial;
  const mask = compileReference(state, node, "Mask", modifiers, depth);
  const invertMask = readBooleanField(node, "InvertMask");
  const maskAlias = maskAliasedMaterial(node);
  const firstEmitted = firstEmittedMaterial(material1, material2, invertMask, maskAlias);
  return {
    kind: "combiner",
    colourOperation,
    alphaOperation,
    colourMultiplier: readBooleanField(node, "Modulate4X") ? 4 : readBooleanField(node, "Modulate2X") ? 2 : 1,
    firstEmittedMaterial: firstEmitted,
    alphaComplementedMaterial: invertMask && maskAlias === firstEmitted ? firstEmitted : null,
    maskAlphaComplemented: invertMask && mask !== null && (maskAlias !== null || mask.kind !== "colour-source"),
    material1,
    material2,
    mask,
  };
}

function compileMaterialSequence(state: CompileState, node: MaterialProgramNode): ColourExpression {
  if (fieldIsUnported(node, "TriggerAction")) return fail(state, "material-feature-unported:TriggerAction");
  if (fieldIsUnported(node, "SequenceItems")) return fail(state, "material-feature-unported:SequenceItems");
  return fail(state, `material-sequence-items-untyped:${node.id}`);
}

function compileNode(state: CompileState, node: MaterialProgramNode, modifiers: readonly string[], depth: number): ColourExpression {
  if (depth > maximumCompileDepth) return fail(state, `material-graph-depth-exceeds:${maximumCompileDepth}`);
  if (state.nodesBeingCompiled.has(node.id)) return fail(state, `material-graph-cycle:${node.id}`);
  const expressionKey = JSON.stringify([node.id, ...modifiers]);
  const compiledExpression = state.compiledExpressions.get(expressionKey);
  if (compiledExpression) return compiledExpression;
  state.nodesBeingCompiled.add(node.id);
  const expression = compileNodeExpression(state, node, modifiers, depth);
  state.nodesBeingCompiled.delete(node.id);
  state.compiledExpressions.set(expressionKey, expression);
  return expression;
}

function compileNodeExpression(state: CompileState, node: MaterialProgramNode, modifiers: readonly string[], depth: number): ColourExpression {
  if (node.status !== "reviewed") {
    state.unportedClass ??= node.class;
    for (const reason of node.gapReasons) fail(state, reason);
    return fail(state, `material-class-unported:${node.class}`);
  }
  const blockingFeature = node.gapReasons.find(reason => reason.startsWith("material-feature-unported:"));
  if (blockingFeature) return fail(state, blockingFeature);
  if (textureCoordinateModifierClasses.has(node.class)) return compileRequired(state, node, "Material", [...modifiers, node.id], depth);
  switch (node.class) {
    case "Engine.FinalBlend": return compileRequired(state, node, "Material", modifiers, depth);
    case "Engine.Shader": return compileShader(state, node, modifiers, depth);
    case "Engine.Texture": return compileTexture(state, node, modifiers);
    case "Engine.Combiner": return compileCombiner(state, node, modifiers, depth);
    case "Engine.ConstantColor": return { kind: "colour-source", colourSourceIndex: addColourSource(state, node, "constant-colour") };
    case "Engine.FadeColor": {
      const fadeGapReason = fadeColourGapReason(node);
      if (fadeGapReason !== null) return fail(state, fadeGapReason);
      return { kind: "colour-source", colourSourceIndex: addColourSource(state, node, "fade-colour") };
    }
    case "Engine.ColorModifier": {
      const colourSourceIndex = addColourSource(state, node, "color-modifier");
      return { kind: "modulate", input: compileRequired(state, node, "Material", modifiers, depth), colourSourceIndex, alphaBlend: readBooleanField(node, "AlphaBlend") };
    }
    case "Engine.MaterialSequence": return compileMaterialSequence(state, node);
    default: return fail(state, `material-class-unported:${node.class}`);
  }
}

export function compileMaterialStagePlan(program: MaterialProgram): MaterialStagePlan {
  const blend = blendFactorsForMaterial(program);
  const state: CompileState = { program, samplers: [], colourSources: [], reasons: [], nodesBeingCompiled: new Set(), compiledExpressions: new Map(), unportedClass: null };
  const expression = compileNode(state, programNode(program, program.root), [], 0);
  if (blend.status === "diagnostic" && !state.reasons.includes(blend.reason)) state.reasons.unshift(blend.reason);
  if (state.reasons.length > 0 || blend.status === "diagnostic") {
    return { status: "diagnostic", root: program.root, reasons: state.reasons, unportedClass: state.unportedClass, blend };
  }
  return { status: "compiled", root: program.root, expression, samplers: state.samplers, colourSources: state.colourSources, blend };
}
