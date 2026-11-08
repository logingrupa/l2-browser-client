import { COMBINER_CONSTANTS } from "../model/constants/combinerConstants";
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

function combinerColour(operation: number, first: string, second: string, mask: string | null, multiplier: number, invertMask: boolean): string {
  const m = mask === null ? null : maskValue(mask, invertMask);
  switch (operation) {
    case 0: return `${first}.rgb`;
    case 1: return `${second}.rgb`;
    case 2: return `${first}.rgb * ${second}.rgb * ${glslFloat(multiplier)}`;
    case 3: return `${first}.rgb + ${second}.rgb`;
    case 4: return `${first}.rgb - ${second}.rgb`;
    case 5: return `${first}.rgb * ${m} + ${second}.rgb * (1.0 - ${m})`;
    case 6: return `${first}.rgb + ${second}.rgb * ${m}`;
    case 7: return `${mask}.rgb`;
    default: throw new RangeError(`Combiner colour operation ${operation} has no fragment rule.`);
  }
}

function combinerAlpha(operation: number, first: string, second: string, mask: string | null, invertMask: boolean): string {
  switch (operation) {
    case 0: return mask === null ? glslFloat(COMBINER_CONSTANTS.missingMaskAlpha.runtimeDefault) : maskValue(mask, invertMask);
    case 1: return `${first}.a * ${second}.a`;
    case 2: return `${first}.a + ${second}.a`;
    case 3: return `${first}.a`;
    case 4: return `${second}.a`;
    default: throw new RangeError(`Combiner alpha operation ${operation} has no fragment rule.`);
  }
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
    case "combiner": {
      const first = emitExpression(builder, expression.material1, true);
      const second = emitExpression(builder, expression.material2, true);
      const mask = expression.mask ? emitExpression(builder, expression.mask, true) : null;
      const colour = combinerColour(expression.colourOperation, first, second, mask, expression.colourMultiplier, expression.invertMask);
      const alpha = combinerAlpha(expression.alphaOperation, first, second, mask, expression.invertMask);
      return declare(builder, `clamp(vec4(${colour}, ${alpha}), 0.0, 1.0)`);
    }
    case "shader": return emitShader(builder, expression, usesDiffuseAlpha);
  }
}

export function buildFragmentChain(plan: CompiledMaterialStagePlan): FragmentChainSource {
  const builder: ChainBuilder = { statements: [], nextVariable: 0 };
  const blend = plan.blend;
  const usesSourceAlpha = blend.alphaTest || [blend.pair.source, blend.pair.destination].some(factor => factor === "source-alpha" || factor === "inverse-source-alpha");
  const result = emitExpression(builder, plan.expression, usesSourceAlpha);
  const samplers = plan.samplers.map((_, index) => samplerUniformName(index));
  const coordinateRows = plan.samplers.flatMap((_, index) => [textureCoordinateRowUName(index), textureCoordinateRowVName(index)]);
  const colourUniforms = plan.colourSources.map((_, index) => colourSourceUniformName(index));
  const alphaTest = blend.alphaTest ? `if (${result}.a < ${glslFloat(blend.alphaReference / 255)}) { discard; }` : "";
  const fragmentSource = [
    "precision highp float;",
    "varying vec2 ue2TextureCoordinates;",
    "varying float ue2ViewDepth;",
    ...samplers.map(name => `uniform sampler2D ${name};`),
    ...coordinateRows.map(name => `uniform vec3 ${name};`),
    ...colourUniforms.map(name => `uniform vec4 ${name};`),
    `uniform vec4 ${fogUniformNames.range};`,
    `uniform vec4 ${fogUniformNames.colour};`,
    "void main() {",
    ...builder.statements.map(statement => `  ${statement}`),
    `  ${alphaTest}`,
    `  float ue2FogFactor = ${fogUniformNames.range}.z > 0.5 ? clamp((ue2ViewDepth - ${fogUniformNames.range}.x) / max(${fogUniformNames.range}.y - ${fogUniformNames.range}.x, 0.000001), 0.0, 1.0) : 0.0;`,
    `  gl_FragColor = vec4(mix(clamp(${result}.rgb, 0.0, 1.0), ${fogUniformNames.colour}.rgb, ue2FogFactor), clamp(${result}.a, 0.0, 1.0));`,
    "}",
  ].join("\n");
  return { fragmentSource, uniforms: [...coordinateRows, ...colourUniforms, fogUniformNames.range, fogUniformNames.colour], samplers };
}
