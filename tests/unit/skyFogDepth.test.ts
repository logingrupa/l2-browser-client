import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fogFactorExpression, fogUniformNames } from "../../src/materials/ue2/babylon/fragmentChain";
import { FOG_CONSTANTS } from "../../src/materials/ue2/model/constants/fogConstants";

interface SkyFogDepthFixture {
  readonly id: string;
  readonly depthRule: string;
  readonly fogDepth: number;
  readonly fogStart: number;
  readonly fogEnd: number;
  readonly fogColor: readonly [number, number, number];
  readonly factorRealArithmetic: number;
  readonly preFogRGB: readonly [number, number, number];
  readonly resultRGBRealArithmetic: readonly [number, number, number];
}

const { fixtures } = JSON.parse(readFileSync(new URL("../fixtures/environment/sky-fog-depth-rm18-fixtures.json", import.meta.url), "utf8")) as
  { readonly fixtures: readonly SkyFogDepthFixture[] };
const tableFog = fixtures.find(fixture => fixture.depthRule === "table-W-or-vertex-depth")!;
const rangeFog = fixtures.find(fixture => fixture.depthRule === "vertex-range")!;

function shaderFogWeight(viewDepth: number, start: number, end: number): number {
  const expression = fogFactorExpression("ue2ViewDepth").replaceAll(fogUniformNames.range, "range");
  const evaluate = new Function("ue2ViewDepth", "range", "clamp", "max", `return ${expression};`) as
    (depth: number, range: { x: number; y: number; z: number }, clamp: (value: number, low: number, high: number) => number, max: typeof Math.max) => number;
  return evaluate(viewDepth, { x: start, y: end, z: 1 }, (value, low, high) => Math.min(high, Math.max(low, value)), Math.max);
}

describe("sky fog on the shared SkyLevel eye depth (RM-18)", () => {
  it("keeps 0.942865625 of the sky colour at the table-fog depth 571.34375 of SkybackgroundColor point 1331 under the 0 to 10000 level fog", () => {
    const weight = shaderFogWeight(tableFog.fogDepth, tableFog.fogStart, tableFog.fogEnd);
    expect(1 - weight).toBe(tableFog.factorRealArithmetic);
    tableFog.preFogRGB.forEach((channel, index) =>
      expect(channel * (1 - weight) + tableFog.fogColor[index]! * weight).toBeCloseTo(tableFog.resultRGBRealArithmetic[index]!, 9));
  });

  it("takes the forward depth, not the radial range of the vertex range-fog variant, which applies only without table fog", () => {
    expect(1 - shaderFogWeight(rangeFog.fogDepth, rangeFog.fogStart, rangeFog.fogEnd)).toBeCloseTo(rangeFog.factorRealArithmetic, 12);
    expect(rangeFog.fogDepth).toBeGreaterThan(tableFog.fogDepth);
    expect(FOG_CONSTANTS.factor.provenance).toMatch(/FOGTABLEMODE \(0x23\) to 3/);
    expect(FOG_CONSTANTS.factor.status).toBe("unconfirmed");
  });
});
