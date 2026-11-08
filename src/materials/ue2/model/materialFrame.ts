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
    selectTextureFrame({ kind: "anim-next", frameCount: sampler.frameNodes.length, maximumFrameRate: sampler.maximumFrameRate }, levelSeconds).index);
  const colourSourceValues = plan.colourSources.map(source => colourSourceValue(programNode(program, source.node), levelSeconds));
  return { status: "evaluated", samplerMatrices, samplerFrameIndices, colourSourceValues };
}
