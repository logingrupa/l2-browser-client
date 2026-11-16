import type { RandomStream } from "../../../shared/random";
import type { ColourUnits } from "./materialFieldValues";
import { programNode, type MaterialProgram } from "./materialProgram";
import { colourSourceValue, textureCoordinateChainMatrix, type TextureCoordinateMatrix } from "./modifiers";
import type { CompiledMaterialStagePlan } from "./stagePlan";
import { selectTextureFrame } from "./textureFrames";

export interface MaterialFrameState {
  readonly status: "evaluated";
  readonly samplerMatrices: readonly TextureCoordinateMatrix[];
  readonly samplerFrameIndices: readonly number[];
  readonly colourSourceValues: readonly ColourUnits[];
}

export type MaterialFrameEvaluation = MaterialFrameState | { readonly status: "unported"; readonly reason: string };

export function evaluateMaterialFrame(program: MaterialProgram, plan: CompiledMaterialStagePlan, levelSeconds: number, jitterStream: RandomStream): MaterialFrameEvaluation {
  const samplerMatrices: TextureCoordinateMatrix[] = [];
  for (const sampler of plan.samplers) {
    const context = { levelSeconds, textureWidth: sampler.width, textureHeight: sampler.height, jitterStream };
    const evaluation = textureCoordinateChainMatrix(program, sampler.textureCoordinateModifiers, context);
    if (evaluation.status === "unported") return evaluation;
    samplerMatrices.push(evaluation.matrix);
  }
  const samplerFrameIndices = plan.samplers.map(sampler =>
    selectTextureFrame({ frameCount: sampler.frameNodes.length, maximumFrameRate: sampler.maximumFrameRate }, levelSeconds).index);
  const colourSourceValues = plan.colourSources.map(source => colourSourceValue(programNode(program, source.node), levelSeconds));
  return { status: "evaluated", samplerMatrices, samplerFrameIndices, colourSourceValues };
}

export type ColourUnitsRgb = readonly [red: number, green: number, blue: number];

export function colorModifierColourSourceIndices(plan: CompiledMaterialStagePlan, nodeId: string): number[] {
  return plan.colourSources.flatMap((source, index) => source.kind === "color-modifier" && source.node === nodeId ? [index] : []);
}

export function withColourSourceRgb(frame: MaterialFrameState, rgbByColourSourceIndex: ReadonlyMap<number, ColourUnitsRgb>): MaterialFrameState {
  if (rgbByColourSourceIndex.size === 0) return frame;
  return { ...frame, colourSourceValues: frame.colourSourceValues.map((colour, index) => {
    const rgb = rgbByColourSourceIndex.get(index);
    return rgb === undefined ? colour : [rgb[0], rgb[1], rgb[2], colour[3]];
  }) };
}
