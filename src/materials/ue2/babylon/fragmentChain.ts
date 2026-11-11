import { COMBINER_CONSTANTS } from "../model/constants/combinerConstants";
import { LIGHTING_CONSTANTS } from "../model/constants/lightingConstants";
import type { MaterialLighting } from "../model/lighting";
import type { ColourExpression, CompiledMaterialStagePlan } from "../model/stagePlan";

export interface FragmentChainSource {
  readonly fragmentSource: string;
  readonly uniforms: readonly string[];
  readonly samplers: readonly string[];
}

export const samplerUniformName = (samplerIndex: number) => `ue2Sampler${samplerIndex}`;
export const textureCoordinateRowUName = (samplerIndex: number) => `ue2CoordinateRowU${samplerIndex}`;
export const textureCoordinateRowVName = (samplerIndex: number) => `ue2CoordinateRowV${samplerIndex}`;
export const colourSourceUniformName = (colourSourceIndex: number) => `ue2Colour${colourSourceIndex}`;
export const fogUniformNames = { range: "ue2FogRange", colour: "ue2FogColour" } as const;

export function fogFactorExpression(viewDepth: string): string {
  const range = fogUniformNames.range;
  return `${range}.z > 0.5 ? clamp((${viewDepth} - ${range}.x) / max(${range}.y - ${range}.x, 0.000001), 0.0, 1.0) : 0.0`;
}

export function foggedColourExpression(colour: string, alpha: string, fogFactor: string): string {
  return `vec4(mix(clamp(${colour}, 0.0, 1.0), ${fogUniformNames.colour}.rgb, ${fogFactor}), clamp(${alpha}, 0.0, 1.0))`;
}
export const lightmapSamplerName = "ue2Lightmap";
export const lightmapCoordinatesVaryingName = "ue2LightmapCoordinates";

const maskChannelSwizzle = { red: "r", green: "g", blue: "b", alpha: "a" } as const;
const glslFloat = (value: number) => (Number.isInteger(value) ? `${value}.0` : `${value}`);

interface ChainBuilder {
  readonly statements: string[];
  nextVariable: number;
}

function declare(builder: ChainBuilder, expression: string): string {
  const name = `ue2Value${builder.nextVariable++}`;
  builder.statements.push(`vec4 ${name} = ${expression};`);
  return name;
}

function maskValue(mask: string, invertMask: boolean): string {
  const channel = maskChannelSwizzle[COMBINER_CONSTANTS.maskChannel.runtimeDefault];
  return invertMask ? `(1.0 - ${mask}.${channel})` : `${mask}.${channel}`;
}

interface EmittedCombiner {
  readonly combineOperation: number;
  readonly alphaOperation: number;
  readonly material1: string;
  readonly material2: string;
  readonly mask: string | null;
  readonly invertMask: boolean;
  readonly modulateMultiplier: number;
}

function combinerColour(combiner: EmittedCombiner): string {
  const { material1, material2, mask } = combiner;
  const maskWeight = mask === null ? null : maskValue(mask, combiner.invertMask);
  switch (combiner.combineOperation) {
    case 0: return `${material1}.rgb`;
    case 1: return `${material2}.rgb`;
    case 2: return `${material1}.rgb * ${material2}.rgb * ${glslFloat(combiner.modulateMultiplier)}`;
    case 3: return `${material1}.rgb + ${material2}.rgb`;
    case 4: return `${material1}.rgb - ${material2}.rgb`;
    case 5: return `${material1}.rgb * ${maskWeight} + ${material2}.rgb * (1.0 - ${maskWeight})`;
    case 6: return `${material1}.rgb + ${material2}.rgb * ${maskWeight}`;
    case 7: return `${mask}.rgb`;
    default: throw new RangeError(`Combiner colour operation ${combiner.combineOperation} has no fragment rule.`);
  }
}

function combinerAlpha(combiner: EmittedCombiner): string {
  const { material1, material2, mask } = combiner;
  switch (combiner.alphaOperation) {
    case 0: return mask === null ? glslFloat(COMBINER_CONSTANTS.missingMaskAlpha.runtimeDefault) : maskValue(mask, combiner.invertMask);
    case 1: return `${material1}.a * ${material2}.a`;
    case 2: return `${material1}.a + ${material2}.a`;
    case 3: return `${material1}.a`;
    case 4: return `${material2}.a`;
    default: throw new RangeError(`Combiner alpha operation ${combiner.alphaOperation} has no fragment rule.`);
  }
}

function emitCombiner(builder: ChainBuilder, expression: Extract<ColourExpression, { kind: "combiner" }>): string {
  const combiner: EmittedCombiner = {
    combineOperation: expression.colourOperation,
    alphaOperation: expression.alphaOperation,
    material1: emitExpression(builder, expression.material1, true),
    material2: emitExpression(builder, expression.material2, true),
    mask: expression.mask ? emitExpression(builder, expression.mask, true) : null,
    invertMask: expression.invertMask,
    modulateMultiplier: expression.colourMultiplier,
  };
  return declare(builder, `clamp(vec4(${combinerColour(combiner)}, ${combinerAlpha(combiner)}), 0.0, 1.0)`);
}

function emitShader(builder: ChainBuilder, expression: Extract<ColourExpression, { kind: "shader" }>, usesDiffuseAlpha: boolean): string {
  const diffuse = emitExpression(builder, expression.diffuse, usesDiffuseAlpha);
  const opacity = expression.opacity ? emitExpression(builder, expression.opacity, true) : null;
  const alpha = opacity ? `${opacity}.a` : usesDiffuseAlpha ? `${diffuse}.a` : "1.0";
  let shaded = declare(builder, `vec4(${diffuse}.rgb, ${alpha})`);
  if (expression.specular) {
    const specular = emitExpression(builder, expression.specular, false);
    const specularMask = expression.specularityMask ? `${emitExpression(builder, expression.specularityMask, true)}.a` : "1.0";
    shaded = declare(builder, expression.modulateSpecular2X
      ? `vec4(${shaded}.rgb * 2.0 * ${specular}.rgb, ${shaded}.a)`
      : `vec4(${shaded}.rgb + ${specularMask} * ${specular}.rgb, ${shaded}.a)`);
  } else if (expression.selfIllumination && expression.selfIlluminationMask) {
    const selfIllumination = emitExpression(builder, expression.selfIllumination, false);
    const selfIlluminationMask = emitExpression(builder, expression.selfIlluminationMask, true);
    shaded = declare(builder, `vec4(mix(${shaded}.rgb, ${selfIllumination}.rgb, ${selfIlluminationMask}.a), ${selfIlluminationMask}.a)`);
  }
  return shaded;
}

function emitExpression(builder: ChainBuilder, expression: ColourExpression, usesDiffuseAlpha: boolean): string {
  switch (expression.kind) {
    case "white": return declare(builder, "vec4(1.0)");
    case "colour-source": return declare(builder, colourSourceUniformName(expression.colourSourceIndex));
    case "texture": {
      const index = expression.samplerIndex;
      const coordinates = `vec2(dot(${textureCoordinateRowUName(index)}, vec3(ue2TextureCoordinates, 1.0)), dot(${textureCoordinateRowVName(index)}, vec3(ue2TextureCoordinates, 1.0)))`;
      return declare(builder, `texture2D(${samplerUniformName(index)}, ${coordinates})`);
    }
    case "modulate": {
      const input = emitExpression(builder, expression.input, usesDiffuseAlpha);
      const colour = colourSourceUniformName(expression.colourSourceIndex);
      return declare(builder, `vec4(${input}.rgb * ${colour}.rgb, ${expression.alphaBlend ? `${input}.a * ${colour}.a` : `${input}.a`})`);
    }
    case "combiner": return emitCombiner(builder, expression);
    case "shader": return emitShader(builder, expression, usesDiffuseAlpha);
  }
}

function litColour(result: string, lighting: MaterialLighting): string {
  if (lighting === "unlit") return `${result}.rgb`;
  return `${result}.rgb * ${glslFloat(LIGHTING_CONSTANTS.modulate2x.runtimeDefault)} * texture2D(${lightmapSamplerName}, ${lightmapCoordinatesVaryingName}).rgb`;
}

export function buildFragmentChain(plan: CompiledMaterialStagePlan, lighting: MaterialLighting): FragmentChainSource {
  const builder: ChainBuilder = { statements: [], nextVariable: 0 };
  const blend = plan.blend;
  const usesSourceAlpha = blend.alphaTest || [blend.pair.source, blend.pair.destination].some(factor => factor === "source-alpha" || factor === "inverse-source-alpha");
  const result = emitExpression(builder, plan.expression, usesSourceAlpha);
  const samplers = [...plan.samplers.map((_, index) => samplerUniformName(index)), ...(lighting === "lightmap" ? [lightmapSamplerName] : [])];
  const coordinateRows = plan.samplers.flatMap((_, index) => [textureCoordinateRowUName(index), textureCoordinateRowVName(index)]);
  const colourUniforms = plan.colourSources.map((_, index) => colourSourceUniformName(index));
  const alphaTest = blend.alphaTest ? `if (${result}.a < ${glslFloat(blend.alphaReference / 255)}) { discard; }` : "";
  const fragmentSource = [
    "precision highp float;",
    "varying vec2 ue2TextureCoordinates;",
    "varying float ue2ViewDepth;",
    ...(lighting === "lightmap" ? [`varying vec2 ${lightmapCoordinatesVaryingName};`] : []),
    ...samplers.map(name => `uniform sampler2D ${name};`),
    ...coordinateRows.map(name => `uniform vec3 ${name};`),
    ...colourUniforms.map(name => `uniform vec4 ${name};`),
    `uniform vec4 ${fogUniformNames.range};`,
    `uniform vec4 ${fogUniformNames.colour};`,
    "void main() {",
    ...builder.statements.map(statement => `  ${statement}`),
    `  ${alphaTest}`,
    `  float ue2FogFactor = ${fogFactorExpression("ue2ViewDepth")};`,
    `  gl_FragColor = ${foggedColourExpression(litColour(result, lighting), `${result}.a`, "ue2FogFactor")};`,
    "}",
  ].join("\n");
  return { fragmentSource, uniforms: [...coordinateRows, ...colourUniforms, fogUniformNames.range, fogUniformNames.colour], samplers };
}
