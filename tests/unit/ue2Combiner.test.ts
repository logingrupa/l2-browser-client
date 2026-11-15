import { describe, expect, it } from "vitest";
import { buildFragmentChain } from "../../src/materials/ue2/babylon/fragmentChain";
import { combineAlpha, combineColour, evaluateColourExpression, routedMaskAlpha, type CombinerOperands } from "../../src/materials/ue2/model/combiner";
import { COMBINER_CONSTANTS } from "../../src/materials/ue2/model/constants/combinerConstants";
import { parseMaterialProgram } from "../../src/materials/ue2/model/materialProgram";
import type { ColourUnits } from "../../src/materials/ue2/model/materialFieldValues";
import { compileMaterialStagePlan, type ColourExpression, type CompiledMaterialStagePlan } from "../../src/materials/ue2/model/stagePlan";
import {
  combinerSwatchCases, combinerSwatchInputRgba, swatchInputRgbaByTextureNode, syntheticCombinerSwatchProgram, syntheticWaterShaderProgram,
  waterShaderSwatchInputRgba, type FixtureProgram,
} from "../support/materialProgramFixture";

const bytes = (...channels: readonly number[]): ColourUnits => [channels[0]! / 255, channels[1]! / 255, channels[2]! / 255, channels[3]! / 255];
const material1 = bytes(...combinerSwatchInputRgba.material1);
const material2 = bytes(...combinerSwatchInputRgba.material2);
const mask = bytes(...combinerSwatchInputRgba.mask);
const maskAlpha = mask[3];
const withMask: CombinerOperands = { material1, material2, firstEmitted: material1, routedMaskAlpha: maskAlpha };
const withoutMask: CombinerOperands = { material1, material2, firstEmitted: material1, routedMaskAlpha: null };
const swappedWithoutMask: CombinerOperands = { material1, material2, firstEmitted: material2, routedMaskAlpha: null };
const blendBytes = (weight: number) => [0, 1, 2].map(channel => combinerSwatchInputRgba.material2[channel]! * weight + combinerSwatchInputRgba.material1[channel]! * (1 - weight));
const material2AddMaterial2AlphaTimesMaterial1 = [0, 1, 2].map(channel => combinerSwatchInputRgba.material2[channel]! + material2[3] * combinerSwatchInputRgba.material1[channel]!);
const withModulateAlphaAddColourCap = true;

function expectColourBytes(colour: readonly number[], expectedBytes: readonly number[]): void {
  colour.forEach((channel, index) => expect(channel * 255).toBeCloseTo(Math.min(255, Math.max(0, expectedBytes[index]!)), 6));
}

function compiledPlan(program: FixtureProgram): CompiledMaterialStagePlan {
  const plan = compileMaterialStagePlan(parseMaterialProgram(JSON.parse(JSON.stringify(program))));
  if (plan.status !== "compiled") throw new Error(`program did not compile: ${plan.reasons.join(", ")}`);
  return plan;
}

function samplerTexelsOf(plan: CompiledMaterialStagePlan): ColourUnits[] {
  return plan.samplers.map(sampler => bytes(...swatchInputRgbaByTextureNode[sampler.textureNode]!));
}

describe("Combiner colour operations", () => {
  it.each([
    ["with a Mask", withMask, 0, [128, 64, 255]],
    ["with a Mask", withMask, 1, [255, 128, 200]],
    ["with a Mask", withMask, 3, [383, 192, 455]],
    ["with a Mask", withMask, 4, [127, 64, -55]],
    ["with a Mask", withMask, 5, blendBytes(maskAlpha)],
    ["with a Mask", withMask, 6, material2AddMaterial2AlphaTimesMaterial1],
    ["with a Mask", withMask, 7, [128, 64, 255]],
    ["without a Mask", withoutMask, 0, [128, 64, 255]],
    ["without a Mask", withoutMask, 1, [255, 128, 200]],
    ["without a Mask", withoutMask, 3, [383, 192, 455]],
    ["without a Mask", withoutMask, 4, [127, 64, -55]],
    ["without a Mask", withoutMask, 5, blendBytes(material1[3])],
    ["without a Mask", withoutMask, 6, material2AddMaterial2AlphaTimesMaterial1],
    ["without a Mask", withoutMask, 7, [128, 64, 255]],
    ["swapped without a Mask", swappedWithoutMask, 5, blendBytes(material2[3])],
    ["swapped without a Mask", swappedWithoutMask, 6, material2AddMaterial2AlphaTimesMaterial1],
    ["swapped without a Mask", swappedWithoutMask, 7, [255, 128, 200]],
  ] as const)("%s, operation %i gives the DB-1 byte result", (_, operands, operation, expectedBytes) => {
    expectColourBytes(combineColour(operation, operands, 1, withModulateAlphaAddColourCap), expectedBytes);
  });

  it("multiplies by 1, 2 under Modulate2X and 4 under Modulate4X, clamping in the byte domain", () => {
    const dark = bytes(40, 40, 40, 255);
    const darkOperands: CombinerOperands = { material1: dark, material2: dark, firstEmitted: dark, routedMaskAlpha: null };
    expect(combineColour(2, withoutMask, 2, withModulateAlphaAddColourCap)[0]).toBe(1);
    expect(combineColour(2, withoutMask, 2, withModulateAlphaAddColourCap)[1] * 255).toBeCloseTo((64 / 255) * (128 / 255) * 2 * 255, 6);
    expect(combineColour(2, darkOperands, 4, withModulateAlphaAddColourCap)[0] * 255).toBeCloseTo((40 / 255) * (40 / 255) * 4 * 255, 6);
    expect(combineColour(2, darkOperands, 1, withModulateAlphaAddColourCap)[0] * 255).toBeCloseTo((40 / 255) * (40 / 255) * 255, 6);
  });

  it("adds Material1 and Material2 for operation 6 without D3DTEXOPCAPS_MODULATEALPHA_ADDCOLOR", () => {
    expectColourBytes(combineColour(6, withMask, 1, false), [383, 192, 455]);
  });

  it("routes the Mask alpha and its complement with InvertMask", () => {
    expect(routedMaskAlpha(mask, false)).toBeCloseTo(30 / 255, 9);
    expect(routedMaskAlpha(mask, true)).toBeCloseTo(225 / 255, 9);
  });

  it("refuses an operation outside the table", () => {
    expect(() => combineColour(8, withMask, 1, withModulateAlphaAddColourCap)).toThrow(RangeError);
    expect(() => combineAlpha(5, withMask)).toThrow(RangeError);
  });
});

describe("Combiner alpha operations", () => {
  it.each([
    ["with a Mask", withMask, 30 / 255],
    ["with an inverted Mask", { ...withMask, routedMaskAlpha: routedMaskAlpha(mask, true) }, 225 / 255],
    ["without a Mask", withoutMask, 200 / 255],
    ["swapped without a Mask", swappedWithoutMask, 100 / 255],
  ] as const)("operation 0 %s keeps the prepared alpha", (_, operands, expected) => {
    expect(combineAlpha(0, operands)).toBeCloseTo(expected, 9);
  });

  it.each([withMask, withoutMask, swappedWithoutMask].flatMap(operands => [
    [operands, 1, (200 / 255) * (100 / 255)],
    [operands, 2, 1],
    [operands, 3, 200 / 255],
    [operands, 4, 100 / 255],
  ] as const))("operation %#: alpha operation %i reads Material1 and Material2 alpha", (operands, operation, expected) => {
    expect(combineAlpha(operation, operands)).toBeCloseTo(expected, 9);
  });
});

describe("the combiner swatch programs of the GPU pixel oracle", () => {
  it("cover every colour operation 0-7, every alpha operation 0-4, Mask=None and the swapped order", () => {
    expect([...new Set(combinerSwatchCases.map(swatchCase => swatchCase.colourOperation))].sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect([...new Set(combinerSwatchCases.map(swatchCase => swatchCase.alphaOperation))].sort()).toEqual([0, 1, 2, 3, 4]);
    expect(combinerSwatchCases.filter(swatchCase => swatchCase.mask === "none" && swatchCase.material2 === "nested-combiner").map(swatchCase => swatchCase.colourOperation)).toEqual([5, 6, 7]);
  });

  it.each(combinerSwatchCases)("compile colour operation $colourOperation, alpha operation $alphaOperation, mask $mask, Material2 $material2 to the CPU combiner result", swatchCase => {
    const plan = compiledPlan(syntheticCombinerSwatchProgram(swatchCase));
    const evaluated = evaluateColourExpression(plan.expression, { samplerTexels: samplerTexelsOf(plan), colourSourceValues: [], usesDiffuseAlpha: false });
    const operands: CombinerOperands = {
      material1, material2, firstEmitted: swatchCase.material2 === "nested-combiner" ? material2 : material1,
      routedMaskAlpha: swatchCase.mask === "mask-texture" ? maskAlpha : null,
    };
    const colour = combineColour(swatchCase.colourOperation, operands, swatchCase.modulate2X ? 2 : 1, withModulateAlphaAddColourCap);
    evaluated.forEach((channel, index) => expect(channel).toBeCloseTo([...colour, combineAlpha(swatchCase.alphaOperation, operands)][index]!, 12));
  });

  it("emit the combiner clamp bounds from the combiner.result-clamp row", () => {
    const plan = compiledPlan(syntheticCombinerSwatchProgram(combinerSwatchCases[3]!));
    const [resultMinimum, resultMaximum] = COMBINER_CONSTANTS.resultClamp.runtimeDefault;
    const combinerStatement = buildFragmentChain(plan, "unlit").fragmentSource.split("\n").find(line => line.includes("= clamp(vec4("));
    expect(combinerStatement).toMatch(/^\s*vec4 ue2Value\d+ = clamp\(vec4\(.+\), /);
    expect(combinerStatement?.endsWith(`, ${resultMinimum.toFixed(1)}, ${resultMaximum.toFixed(1)});`)).toBe(true);
  });
});

describe("the WaterShader01 five-stage chain", () => {
  const oceanS = bytes(...waterShaderSwatchInputRgba.oceanS);
  const oscillator = bytes(...waterShaderSwatchInputRgba.TexOscillator0);
  const base = bytes(...waterShaderSwatchInputRgba.base1);
  const rgbOf = (colour: ColourUnits) => [colour[0], colour[1], colour[2]];

  it("blends SRCALPHA, INVSRCALPHA without depth write and evaluates to the DB-1 water arithmetic", () => {
    const plan = compiledPlan(syntheticWaterShaderProgram());
    expect(plan.blend).toMatchObject({ source: "shader", pair: { source: "source-alpha", destination: "inverse-source-alpha" }, depthWrite: false });
    const inputs = { samplerTexels: samplerTexelsOf(plan), colourSourceValues: [], usesDiffuseAlpha: true };
    const shader = plan.expression as Extract<ColourExpression, { kind: "shader" }>;
    const reflection = shader.diffuse as Extract<ColourExpression, { kind: "combiner" }>;
    const com = reflection.material2 as Extract<ColourExpression, { kind: "combiner" }>;
    const stage0Colour = rgbOf(oceanS), stage0Alpha = oceanS[3];
    const stage1Colour = stage0Colour.map((channel, index) => channel * oscillator[index]!), stage1Alpha = stage0Alpha;
    const stage2Colour = stage1Colour.map((channel, index) => channel + base[index]!), stage2Alpha = base[3] * stage1Alpha;
    const stage3Colour = stage2Colour.map((channel, index) => channel + stage2Alpha * oscillator[index]!), stage3Alpha = oscillator[3] * stage2Alpha;
    const stage4Colour = stage3Colour, stage4Alpha = base[3];
    const stages: readonly [ColourExpression, readonly number[]][] = [
      [com.material1, [...stage1Colour, stage1Alpha]],
      [com, [...stage2Colour, stage2Alpha]],
      [reflection, [...stage3Colour, stage3Alpha]],
      [shader, [...stage4Colour, stage4Alpha]],
    ];
    for (const [expression, expected] of stages) {
      evaluateColourExpression(expression, inputs).forEach((channel, index) => expect(channel).toBeCloseTo(expected[index]!, 12));
    }
    expect(stage4Colour.every(channel => channel < 1)).toBe(true);
  });
});

describe("combiner constants rows", () => {
  it("name the DB-1 replay of D3DDrv.dll for the corrected mask channel and operation forms and drop the missing-mask alpha", () => {
    for (const row of [COMBINER_CONSTANTS.maskChannel, COMBINER_CONSTANTS.maskNamedOperations, COMBINER_CONSTANTS.operationForms]) {
      expect(row.status).toBe("corrected-interlude");
      expect(row.interludeEvidence).toMatch(/^D3DDrv\.dll 05622dde .*0x10014a24.*DB-1 combiner-stage-semantics cb9b11ac, replayed 2026-11-15/);
    }
    expect(COMBINER_CONSTANTS.maskChannel.runtimeDefault).toBe("alpha");
    expect(COMBINER_CONSTANTS.firstEmittedMaterial.status).toBe("confirmed-interlude");
    expect(COMBINER_CONSTANTS.modulateAlphaAddColourCap).toMatchObject({ runtimeDefault: true, status: "unconfirmed" });
    expect(COMBINER_CONSTANTS.resultClamp.status).toBe("unconfirmed");
    expect(Object.keys(COMBINER_CONSTANTS)).not.toContain("missingMaskAlpha");
  });
});

describe("evaluateColourExpression", () => {
  it("runs a Shader over a Combiner of a texture and a colour source like the fragment chain", () => {
    const texel = bytes(100, 150, 200, 128);
    const constant = bytes(255, 128, 64, 255);
    const result = evaluateColourExpression({
      kind: "shader",
      diffuse: { kind: "combiner", colourOperation: 2, alphaOperation: 3, colourMultiplier: 2, invertMask: false, firstEmittedMaterial: "material2",
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
