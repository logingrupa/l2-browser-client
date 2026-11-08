import { describe, expect, it } from "vitest";
import { combineAlpha, combineColour, combinerMaskValue, evaluateColourExpression } from "../../src/materials/ue2/model/combiner";
import type { ColourUnits } from "../../src/materials/ue2/model/materialFieldValues";

const bytes = (...channels: number[]): ColourUnits => channels.map(channel => channel / 255) as unknown as ColourUnits;
const first = bytes(128, 64, 255, 200);
const second = bytes(255, 128, 200, 100);
const mask = bytes(10, 51, 90, 30);
const greenMask = 51 / 255;

describe("Combiner colour operations", () => {
  it.each([
    [0, [128, 64, 255]],
    [1, [255, 128, 200]],
    [3, [255, 192, 255]],
    [4, [0, 0, 55]],
    [5, [128 * greenMask + 255 * (1 - greenMask), 64 * greenMask + 128 * (1 - greenMask), 255 * greenMask + 200 * (1 - greenMask)]],
    [6, [128 + 255 * greenMask, 64 + 128 * greenMask, 255]],
    [7, [10, 51, 90]],
  ])("operation %i gives its documented byte result", (operation, expectedBytes) => {
    const colour = combineColour(operation, first, second, combinerMaskValue(mask, false), mask, 1);
    colour.forEach((channel, index) => expect(channel * 255).toBeCloseTo(Math.min(255, expectedBytes[index]!), 6));
  });

  it("multiplies and doubles under Modulate2X, clamping in the byte domain", () => {
    const colour = combineColour(2, first, second, null, null, 2);
    expect(colour[0]).toBe(1);
    expect(colour[1] * 255).toBeCloseTo((64 / 255) * (128 / 255) * 2 * 255, 6);
    expect(colour[2]).toBe(1);
    expect(combineColour(2, bytes(40, 40, 40, 255), bytes(40, 40, 40, 255), null, null, 4)[0] * 255).toBeCloseTo((40 / 255) * (40 / 255) * 4 * 255, 6);
    expect(combineColour(2, bytes(40, 40, 40, 255), bytes(40, 40, 40, 255), null, null, 1)[0] * 255).toBeCloseTo((40 / 255) * (40 / 255) * 255, 6);
  });

  it("reads the mask from the green channel and inverts it with InvertMask", () => {
    expect(combinerMaskValue(mask, false)).toBeCloseTo(greenMask, 9);
    expect(combinerMaskValue(mask, true)).toBeCloseTo(1 - greenMask, 9);
  });

  it("refuses an operation outside the table", () => {
    expect(() => combineColour(8, first, second, null, null, 1)).toThrow(RangeError);
    expect(() => combineAlpha(5, first, second, null)).toThrow(RangeError);
  });
});

describe("Combiner alpha operations", () => {
  it.each([
    [0, greenMask],
    [1, (200 / 255) * (100 / 255)],
    [2, 1],
    [3, 200 / 255],
    [4, 100 / 255],
  ])("operation %i gives its documented result", (operation, expected) => {
    expect(combineAlpha(operation, first, second, combinerMaskValue(mask, false))).toBeCloseTo(expected, 9);
  });

  it("gives alpha 0 for AO_Use_Mask without a Mask", () => {
    expect(combineAlpha(0, first, second, null)).toBe(0);
  });
});

describe("evaluateColourExpression", () => {
  it("runs a Shader over a Combiner of a texture and a colour source like the fragment chain", () => {
    const texel = bytes(100, 150, 200, 128);
    const constant = bytes(255, 128, 64, 255);
    const result = evaluateColourExpression({
      kind: "shader",
      diffuse: { kind: "combiner", colourOperation: 2, alphaOperation: 3, colourMultiplier: 2, invertMask: false,
        material1: { kind: "texture", samplerIndex: 0 }, material2: { kind: "colour-source", colourSourceIndex: 0 }, mask: null },
      opacity: null, specular: null, specularityMask: null, selfIllumination: null, selfIlluminationMask: null, modulateSpecular2X: false,
    }, { samplerTexels: [texel], colourSourceValues: [constant], usesDiffuseAlpha: true });
    expect(result[0] * 255).toBeCloseTo(200, 6);
    expect(result[1] * 255).toBeCloseTo((150 / 255) * (128 / 255) * 2 * 255, 6);
    expect(result[2] * 255).toBeCloseTo((200 / 255) * (64 / 255) * 2 * 255, 6);
    expect(result[3]).toBeCloseTo(128 / 255, 9);
  });

  it("drops the diffuse alpha when the blend reads no source alpha and takes the opacity alpha when present", () => {
    const shader = (opacity: boolean) => ({
      kind: "shader" as const, diffuse: { kind: "texture" as const, samplerIndex: 0 },
      opacity: opacity ? { kind: "colour-source" as const, colourSourceIndex: 0 } : null,
      specular: null, specularityMask: null, selfIllumination: null, selfIlluminationMask: null, modulateSpecular2X: false,
    });
    const inputs = { samplerTexels: [bytes(10, 20, 30, 40)], colourSourceValues: [bytes(0, 0, 0, 90)] };
    expect(evaluateColourExpression(shader(false), { ...inputs, usesDiffuseAlpha: false })[3]).toBe(1);
    expect(evaluateColourExpression(shader(true), { ...inputs, usesDiffuseAlpha: false })[3]).toBeCloseTo(90 / 255, 9);
  });
});
