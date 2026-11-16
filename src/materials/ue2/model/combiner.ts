import { COMBINER_CONSTANTS } from "./constants/combinerConstants";
import type { ColourUnits } from "./materialFieldValues";
import type { ColourExpression } from "./stagePlan";

export type ColourChannels = readonly [number, number, number];

export interface ColourExpressionInputs {
  readonly samplerTexels: readonly ColourUnits[];
  readonly colourSourceValues: readonly ColourUnits[];
  readonly usesDiffuseAlpha: boolean;
}

export interface CombinerOperands {
  readonly material1: ColourUnits;
  readonly material2: ColourUnits;
  readonly firstEmitted: ColourUnits;
  readonly routedMaskAlpha: number | null;
}

const maskChannelIndex: Record<typeof COMBINER_CONSTANTS.maskChannel.runtimeDefault, number> = { alpha: 3 };
const white: ColourUnits = [1, 1, 1, 1];
const [resultMinimum, resultMaximum] = COMBINER_CONSTANTS.resultClamp.runtimeDefault;

function clampUnit(value: number): number {
  return Math.min(resultMaximum, Math.max(resultMinimum, value));
}

function channels(colour: ColourUnits): ColourChannels {
  return [colour[0], colour[1], colour[2]];
}

function perChannel(left: ColourChannels, right: ColourChannels, operation: (leftChannel: number, rightChannel: number) => number): ColourChannels {
  return [operation(left[0], right[0]), operation(left[1], right[1]), operation(left[2], right[2])];
}

export function routedMaskAlpha(mask: ColourUnits, maskAlphaComplemented: boolean): number {
  const value = mask[maskChannelIndex[COMBINER_CONSTANTS.maskChannel.runtimeDefault]]!;
  return maskAlphaComplemented ? 1 - value : value;
}

function withComplementedAlpha(colour: ColourUnits): ColourUnits {
  return [colour[0], colour[1], colour[2], 1 - colour[3]];
}

function preparedAlpha(operands: CombinerOperands): number {
  return operands.routedMaskAlpha ?? operands.firstEmitted[3];
}

export function combineColour(operation: number, operands: CombinerOperands, colourMultiplier: 1 | 2 | 4, modulateAlphaAddColourCap: boolean): ColourChannels {
  const material1 = channels(operands.material1), material2 = channels(operands.material2);
  const unclamped = ((): ColourChannels => {
    switch (operation) {
      case 0: return material1;
      case 1: return material2;
      case 2: return perChannel(material1, material2, (left, right) => left * right * colourMultiplier);
      case 3: return perChannel(material1, material2, (left, right) => left + right);
      case 4: return perChannel(material1, material2, (left, right) => right - left);
      case 5: {
        const weight = preparedAlpha(operands);
        return perChannel(material1, material2, (left, right) => right * weight + left * (1 - weight));
      }
      case 6: {
        const material2Alpha = operands.material2[3];
        return modulateAlphaAddColourCap
          ? perChannel(material1, material2, (left, right) => right + material2Alpha * left)
          : perChannel(material1, material2, (left, right) => left + right);
      }
      case 7: return channels(operands.firstEmitted);
      default: throw new RangeError(`Combiner colour operation ${operation} is not in the operation table.`);
    }
  })();
  return [clampUnit(unclamped[0]), clampUnit(unclamped[1]), clampUnit(unclamped[2])];
}

export function combineAlpha(operation: number, operands: CombinerOperands): number {
  switch (operation) {
    case 0: return clampUnit(preparedAlpha(operands));
    case 1: return clampUnit(operands.material1[3] * operands.material2[3]);
    case 2: return clampUnit(operands.material1[3] + operands.material2[3]);
    case 3: return clampUnit(operands.material1[3]);
    case 4: return clampUnit(operands.material2[3]);
    default: throw new RangeError(`Combiner alpha operation ${operation} is not in the operation table.`);
  }
}

function requireInput(values: readonly ColourUnits[], index: number, label: string): ColourUnits {
  const value = values[index];
  if (!value) throw new RangeError(`Colour expression reads ${label} ${index}, which the inputs do not hold.`);
  return value;
}

function evaluateShader(expression: Extract<ColourExpression, { kind: "shader" }>, inputs: ColourExpressionInputs): ColourUnits {
  const diffuse = evaluateColourExpression(expression.diffuse, inputs);
  const opacity = expression.opacity ? evaluateColourExpression(expression.opacity, { ...inputs, usesDiffuseAlpha: true }) : null;
  let colour = channels(diffuse);
  let alpha = opacity ? opacity[3] : inputs.usesDiffuseAlpha ? diffuse[3] : 1;
  if (expression.specular) {
    const specular = channels(evaluateColourExpression(expression.specular, { ...inputs, usesDiffuseAlpha: false }));
    const specularMask = expression.specularityMask ? evaluateColourExpression(expression.specularityMask, { ...inputs, usesDiffuseAlpha: true })[3] : 1;
    colour = perChannel(colour, specular, (left, right) => left + specularMask * right);
  } else if (expression.selfIllumination && expression.selfIlluminationMask) {
    const selfIllumination = channels(evaluateColourExpression(expression.selfIllumination, { ...inputs, usesDiffuseAlpha: false }));
    const selfIlluminationMask = evaluateColourExpression(expression.selfIlluminationMask, { ...inputs, usesDiffuseAlpha: true })[3];
    colour = perChannel(colour, selfIllumination, (left, right) => left + (right - left) * selfIlluminationMask);
    alpha = selfIlluminationMask;
  }
  return [colour[0], colour[1], colour[2], alpha];
}

export function evaluateColourExpression(expression: ColourExpression, inputs: ColourExpressionInputs): ColourUnits {
  switch (expression.kind) {
    case "white": return white;
    case "colour-source": return requireInput(inputs.colourSourceValues, expression.colourSourceIndex, "colour source");
    case "texture": return requireInput(inputs.samplerTexels, expression.samplerIndex, "sampler");
    case "modulate": {
      const input = evaluateColourExpression(expression.input, inputs);
      const colour = requireInput(inputs.colourSourceValues, expression.colourSourceIndex, "colour source");
      return [input[0] * colour[0], input[1] * colour[1], input[2] * colour[2], expression.alphaBlend ? input[3] * colour[3] : input[3]];
    }
    case "combiner": {
      const nested = { ...inputs, usesDiffuseAlpha: true };
      const material1Value = evaluateColourExpression(expression.material1, nested);
      const material2Value = evaluateColourExpression(expression.material2, nested);
      const material1 = expression.alphaComplementedMaterial === "material1" ? withComplementedAlpha(material1Value) : material1Value;
      const material2 = expression.alphaComplementedMaterial === "material2" ? withComplementedAlpha(material2Value) : material2Value;
      const operands: CombinerOperands = {
        material1, material2, firstEmitted: expression.firstEmittedMaterial === "material2" ? material2 : material1,
        routedMaskAlpha: expression.mask ? routedMaskAlpha(evaluateColourExpression(expression.mask, nested), expression.maskAlphaComplemented) : null,
      };
      const colour = combineColour(expression.colourOperation, operands, expression.colourMultiplier, COMBINER_CONSTANTS.modulateAlphaAddColourCap.runtimeDefault);
      return [colour[0], colour[1], colour[2], combineAlpha(expression.alphaOperation, operands)];
    }
    case "shader": return evaluateShader(expression, inputs);
  }
}
