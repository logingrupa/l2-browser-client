import { COMBINER_CONSTANTS } from "./constants/combinerConstants";
import type { ColourUnits } from "./materialFieldValues";
import type { ColourExpression } from "./stagePlan";

export type ColourChannels = readonly [number, number, number];

export interface ColourExpressionInputs {
  readonly samplerTexels: readonly ColourUnits[];
  readonly colourSourceValues: readonly ColourUnits[];
  readonly usesDiffuseAlpha: boolean;
}

const maskChannelIndex = { red: 0, green: 1, blue: 2, alpha: 3 } as const;
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

export function combinerMaskValue(mask: ColourUnits, invertMask: boolean): number {
  const value = mask[maskChannelIndex[COMBINER_CONSTANTS.maskChannel.runtimeDefault]];
  return invertMask ? 1 - value : value;
}

function requireMask<Value>(value: Value | null, operation: number): Value {
  if (value === null) throw new RangeError(`Combiner colour operation ${operation} reads a Mask the Combiner does not have.`);
  return value;
}

export function combineColour(operation: number, first: ColourUnits, second: ColourUnits, maskValue: number | null, maskColour: ColourUnits | null,
  colourMultiplier: 1 | 2 | 4): ColourChannels {
  const firstColour = channels(first), secondColour = channels(second);
  const unclamped = ((): ColourChannels => {
    switch (operation) {
      case 0: return firstColour;
      case 1: return secondColour;
      case 2: return perChannel(firstColour, secondColour, (left, right) => left * right * colourMultiplier);
      case 3: return perChannel(firstColour, secondColour, (left, right) => left + right);
      case 4: return perChannel(firstColour, secondColour, (left, right) => left - right);
      case 5: {
        const mask = requireMask(maskValue, operation);
        return perChannel(firstColour, secondColour, (left, right) => left * mask + right * (1 - mask));
      }
      case 6: {
        const mask = requireMask(maskValue, operation);
        return perChannel(firstColour, secondColour, (left, right) => left + right * mask);
      }
      case 7: return channels(requireMask(maskColour, operation));
      default: throw new RangeError(`Combiner colour operation ${operation} is not in the operation table.`);
    }
  })();
  return [clampUnit(unclamped[0]), clampUnit(unclamped[1]), clampUnit(unclamped[2])];
}

export function combineAlpha(operation: number, first: ColourUnits, second: ColourUnits, maskValue: number | null): number {
  switch (operation) {
    case 0: return clampUnit(maskValue ?? COMBINER_CONSTANTS.missingMaskAlpha.runtimeDefault);
    case 1: return clampUnit(first[3] * second[3]);
    case 2: return clampUnit(first[3] + second[3]);
    case 3: return clampUnit(first[3]);
    case 4: return clampUnit(second[3]);
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
    colour = expression.modulateSpecular2X ? perChannel(colour, specular, (left, right) => left * 2 * right) : perChannel(colour, specular, (left, right) => left + specularMask * right);
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
      const first = evaluateColourExpression(expression.material1, nested);
      const second = evaluateColourExpression(expression.material2, nested);
      const maskColour = expression.mask ? evaluateColourExpression(expression.mask, nested) : null;
      const maskValue = maskColour ? combinerMaskValue(maskColour, expression.invertMask) : null;
      const colour = combineColour(expression.colourOperation, first, second, maskValue, maskColour, expression.colourMultiplier);
      return [colour[0], colour[1], colour[2], combineAlpha(expression.alphaOperation, first, second, maskValue)];
    }
    case "shader": return evaluateShader(expression, inputs);
  }
}
