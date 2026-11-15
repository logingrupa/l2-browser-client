import type { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { blendFactorsForParticleDrawStyle, type ParticleDrawStyleBlend } from "../model/blendTable";
import type { FogState } from "../model/fog";
import { babylonBlendStateForPair, blendFactorPairKey, type BabylonBlendState } from "./blendState";
import { bindFogUniforms } from "./fogUniforms";
import { fogFactorExpression, foggedColourExpression, fogUniformNames } from "./fragmentChain";

export interface ParticleFragmentChain {
  readonly blend: ParticleDrawStyleBlend;
  readonly babylonBlend: BabylonBlendState;
  readonly fragmentFunctionSource: string;
  readonly fragmentFunctionName: "ue2ParticleFragment";
  readonly uniforms: readonly string[];
  bindFog(material: ShaderMaterial, fog: FogState): void;
}

const particleFragmentFunctionSource = [
  `uniform vec4 ${fogUniformNames.range};`,
  `uniform vec4 ${fogUniformNames.colour};`,
  "vec4 ue2ParticleFragment(vec4 sourceColour, float viewDepth) {",
  `  float fogFactor = ${fogFactorExpression("viewDepth")};`,
  `  return ${foggedColourExpression("sourceColour.rgb", "sourceColour.a", "fogFactor")};`,
  "}",
].join("\n");

export function particleFragmentChain(drawStyle: number): ParticleFragmentChain {
  const blend = blendFactorsForParticleDrawStyle(drawStyle);
  const babylonBlend = babylonBlendStateForPair(blend.pair);
  if (!babylonBlend) throw new RangeError(`Particle draw style ${drawStyle} pair ${blendFactorPairKey(blend.pair)} has no Babylon blend state.`);
  return {
    blend, babylonBlend, fragmentFunctionSource: particleFragmentFunctionSource, fragmentFunctionName: "ue2ParticleFragment",
    uniforms: [fogUniformNames.range, fogUniformNames.colour],
    bindFog: (material, fog) => bindFogUniforms(material, blend.fogFamily, fog),
  };
}
