import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fogFactorExpression, fogUniformNames } from "../../src/materials/ue2/babylon/fragmentChain";
import { blendFactorsForMaterial } from "../../src/materials/ue2/model/blendTable";
import type { BlendFactor, FogFamily } from "../../src/materials/ue2/model/constants/blendFactorTypes";
import { FOG_CONSTANTS } from "../../src/materials/ue2/model/constants/fogConstants";
import { fogTargetColour, type FogState } from "../../src/materials/ue2/model/fog";
import { parseMaterialProgram } from "../../src/materials/ue2/model/materialProgram";
import { environmentFogBaseline } from "../../src/scene/world/cameraEnvironment";
import { convertedEnvironmentFogRanges } from "../support/fogWorkedCaseFixture";
import { enumValue, field, nodeReference, programOf, reviewedNode, swatchTextureNode, swatchTexturePng, textureImageFor } from "../support/materialProgramFixture";

interface PassStateRow {
  readonly ordinal: number;
  readonly hasOpacityMaterial: boolean;
  readonly srcBlend: number;
  readonly destBlend: number;
  readonly fogOverride: number;
  readonly fogBGRA: readonly number[];
}

interface SharedSkyFixtures {
  readonly fogCrossCheck: { readonly materialRGB: readonly number[]; readonly fogRGB: readonly number[]; readonly depth: number; readonly fogWeight: number;
    readonly unquantizedRGB: readonly number[]; readonly observedRGB: readonly number[] };
  readonly outputBlendingPasses: readonly PassStateRow[];
  readonly frameBufferBlendingPasses: readonly PassStateRow[];
}

const fixtures = JSON.parse(readFileSync(new URL("../fixtures/environment/shared-sky-rm21-fixtures.json", import.meta.url), "utf8")) as SharedSkyFixtures;
const skyFogDepthFixtures = JSON.parse(readFileSync(new URL("../fixtures/environment/sky-fog-depth-rm18-fixtures.json", import.meta.url), "utf8")) as
  { readonly fixtures: readonly { readonly depthRule: string; readonly fogStart: number; readonly fogEnd: number }[] };
const tableFogRange = skyFogDepthFixtures.fixtures.find(fixture => fixture.depthRule === "table-W-or-vertex-depth")!;
const d3dBlendFactors: Readonly<Record<number, BlendFactor>> = { 1: "zero", 2: "one", 3: "source-colour", 4: "inverse-source-colour", 5: "source-alpha",
  6: "inverse-source-alpha", 9: "destination-colour" };
const image = textureImageFor(swatchTexturePng());
const byteMaximum = 255;

function familyOfPass(row: PassStateRow): FogFamily {
  if (row.fogOverride === 0) return "fog-colour";
  return row.fogBGRA.slice(0, 3).every(channel => channel === FOG_CONSTANTS.neutralGreyByte.runtimeDefault) ? "neutral-grey" : "black";
}

function rootProgram(rootClass: "Engine.Shader" | "Engine.FinalBlend", row: PassStateRow) {
  const fields = rootClass === "Engine.Shader"
    ? [field("Diffuse", nodeReference("Synthetic.Texture")), field("Opacity", row.hasOpacityMaterial ? nodeReference("Synthetic.Texture") : null),
      field("OutputBlending", enumValue(row.ordinal, `OB_${row.ordinal}`))]
    : [field("Material", nodeReference("Synthetic.Texture")), field("FrameBufferBlending", enumValue(row.ordinal, `FB_${row.ordinal}`))];
  return parseMaterialProgram(JSON.parse(JSON.stringify(programOf("Synthetic.Root", [reviewedNode("Synthetic.Root", rootClass, fields),
    swatchTextureNode("Synthetic.Texture", image)]))));
}

function shaderFogWeight(viewDepth: number, start: number, end: number): number {
  const expression = fogFactorExpression("ue2ViewDepth").replaceAll(fogUniformNames.range, "range");
  const evaluate = new Function("ue2ViewDepth", "range", "clamp", "max", `return ${expression};`) as
    (depth: number, range: { x: number; y: number; z: number }, clamp: (value: number, low: number, high: number) => number, max: typeof Math.max) => number;
  return evaluate(viewDepth, { x: start, y: end, z: 1 }, (value, low, high) => Math.min(high, Math.max(low, value)), Math.max);
}

function levelFog(colour: readonly number[], start: number, end: number): FogState {
  return { enabled: true, source: "local-fog-list", colour: [colour[0]! / byteMaximum, colour[1]! / byteMaximum, colour[2]! / byteMaximum],
    startSourceUnits: start, endSourceUnits: end };
}

function foggedSource(materialRgb: readonly number[], family: FogFamily, fog: FogState, depth: number): number[] {
  const weight = shaderFogWeight(depth, fog.startSourceUnits, fog.endSourceUnits), target = fogTargetColour(family, fog)!;
  return materialRgb.map((channel, index) => channel * (1 - weight) + target[index]! * byteMaximum * weight);
}

describe("per-pass fog colour from D3DDrv 0x1000ae10 and 0x1000f4a0 (RM-21)", () => {
  it.each(fixtures.outputBlendingPasses.map(row => [row.ordinal, row.hasOpacityMaterial, row] as const))(
    "Shader OutputBlending %i (Opacity %s) draws the native pair and fog family", (_ordinal, _opacity, row) => {
      expect(blendFactorsForMaterial(rootProgram("Engine.Shader", row))).toMatchObject({ status: "resolved",
        pair: { source: d3dBlendFactors[row.srcBlend], destination: d3dBlendFactors[row.destBlend] }, fogFamily: familyOfPass(row) });
    });

  it.each(fixtures.frameBufferBlendingPasses.map(row => [row.ordinal, row] as const))(
    "FinalBlend FrameBufferBlending %i draws the native pair and fog family", (_ordinal, row) => {
      expect(blendFactorsForMaterial(rootProgram("Engine.FinalBlend", row))).toMatchObject({ status: "resolved",
        pair: { source: d3dBlendFactors[row.srcBlend], destination: d3dBlendFactors[row.destBlend] }, fogFamily: familyOfPass(row) });
    });

  it("confirms the fog family table and the neutral grey byte 127 from the RM-21 pass builders", () => {
    expect(FOG_CONSTANTS.materialFamilies).toMatchObject({ status: "confirmed-interlude",
      interludeEvidence: "D3DDrv.dll 05622dde 0x1000ae10 (branch 0x1000c7f7), 0x1000f4a0 (branch 0x1000f4e2), fog override gate 0x100263a0" });
    expect(FOG_CONSTANTS.neutralGreyByte).toMatchObject({ status: "confirmed-interlude", runtimeDefault: 127 });
  });
});

describe("pass equations on the shared sky fog depth (RM-21)", () => {
  const { fogCrossCheck } = fixtures;
  const fog = levelFog(fogCrossCheck.fogRGB, tableFogRange.fogStart, tableFogRange.fogEnd);

  it("fogs the 20_21 background 132,146,131 toward 107,114,97 at depth 571.34375 to the first GPU readback 131,144,129 (rounded to bytes)", () => {
    expect(shaderFogWeight(fogCrossCheck.depth, tableFogRange.fogStart, tableFogRange.fogEnd)).toBe(fogCrossCheck.fogWeight);
    const fogged = foggedSource(fogCrossCheck.materialRGB, "fog-colour", fog, fogCrossCheck.depth);
    fogged.forEach((channel, index) => expect(channel).toBeCloseTo(fogCrossCheck.unquantizedRGB[index]!, 9));
    expect(fogged.map(Math.round)).toEqual(fogCrossCheck.observedRGB);
  });

  it("adds OutputBlending 3 and FrameBufferBlending 6 with black fog as clamp(dst + f * C), with no fog colour term", () => {
    const source = foggedSource([200, 100, 50], "black", fog, fogCrossCheck.depth), keep = 1 - fogCrossCheck.fogWeight;
    source.forEach((channel, index) => expect(channel).toBeCloseTo([200, 100, 50][index]! * keep, 9));
    expect(blendFactorsForMaterial(rootProgram("Engine.FinalBlend", fixtures.frameBufferBlendingPasses[6]!))).toMatchObject({ fogFamily: "black" });
  });

  it("fogs OutputBlending 2 toward 127/255 so the 2 * src * dst modulate stays neutral at full fog", () => {
    const source = foggedSource([255, 0, 64], "neutral-grey", fog, tableFogRange.fogEnd);
    expect(source).toEqual([127, 127, 127]);
  });

  it("gives the 15_22 terrain fog 8192 to 20480 weight 0 at the sky depth", () => {
    const terrainFog = environmentFogBaseline(convertedEnvironmentFogRanges(), FOG_CONSTANTS.terrainClipRange.runtimeDefault);
    expect([terrainFog.startSourceUnits, terrainFog.endSourceUnits]).toEqual([8192, 20480]);
    expect(shaderFogWeight(fogCrossCheck.depth, terrainFog.startSourceUnits, terrainFog.endSourceUnits)).toBe(0);
  });
});
