import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { dynamicLightColour, type DynamicLightColourSource, type DynamicLightEnvironment } from "../../src/environment/model/lightmapRebuild/dynamicLightColour";
import { lightType7Modulation, lightTypeMultiplier } from "../../src/environment/model/lightmapRebuild/lightTypeMultiplier";
import { fGetHsv } from "../../src/environment/model/fGetHsv";
import { scalePlane } from "../../src/environment/model/nativePlane";

interface LightType7Fixture {
  readonly input: { readonly controlWord: string; readonly LightPeriod: number; readonly LightPhase: number; readonly levelTimeSeconds: number };
  readonly outputF32: number;
}

const lightType7Fixtures = (JSON.parse(readFileSync(new URL("../fixtures/db16/dynamic-light-small-native.json", import.meta.url), "utf8")) as {
  readonly lightType7Fixtures: readonly LightType7Fixture[];
}).lightType7Fixtures;

const staticLight = (lightType: number): DynamicLightColourSource => ({
  lightType, lightPeriod: 32, lightPhase: 0, lightHue: 26, lightSaturation: 150, lightBrightness: 70, sunlightColour: false,
});
const environment: DynamicLightEnvironment = { tables: new Map(), blend: { oldType: 3, targetType: 3, weight: 1 }, hour: 6, levelBrightness: 1, levelTimeSeconds: 1 };

describe("LightType 7 modulation block 0x106749ce against native CW 0x027f runs", () => {
  it("covers periods 32, 30 and 0 and phase 64 at four level times", () => {
    expect(lightType7Fixtures).toHaveLength(16);
  });

  it.each(lightType7Fixtures.map(fixture => [fixture.input.LightPeriod, fixture.input.LightPhase, fixture.input.levelTimeSeconds, fixture] as const))(
    "period %s phase %s at %s seconds", (_period, _phase, _seconds, fixture) => {
      expect(lightType7Modulation(fixture.input.LightPeriod, fixture.input.LightPhase, fixture.input.levelTimeSeconds)).toBe(fixture.outputF32);
    });
});

describe("FDynamicLight::Update light type multiplier", () => {
  it("keeps LightType 1 at 1, switches LightType 6 off and modulates LightType 7", () => {
    expect(lightTypeMultiplier({ lightType: 1, lightPeriod: 0, lightPhase: 0 }, 10)).toEqual({ status: "resolved", value: 1 });
    expect(lightTypeMultiplier({ lightType: 6, lightPeriod: 0, lightPhase: 0 }, 10)).toEqual({ status: "resolved", value: 0 });
    expect(lightTypeMultiplier({ lightType: 7, lightPeriod: 32, lightPhase: 0 }, 1)).toEqual({ status: "resolved", value: lightType7Modulation(32, 0, 1) });
  });

  it.each([0, 2, 3, 4, 5, 8, 9, 10, 11, 12])("leaves LightType %s unresolved", lightType => {
    expect(lightTypeMultiplier({ lightType, lightPeriod: 0, lightPhase: 0 }, 0)).toEqual({ status: "unresolved", reason: `bsp-rebuild-light-type-unported:${lightType}` });
  });

  it("refuses a LightType that is not a byte", () => {
    expect(() => lightTypeMultiplier({ lightType: 256, lightPeriod: 0, lightPhase: 0 }, 0)).toThrow(RangeError);
  });
});

describe("FDynamicLight::Update static colour branch", () => {
  it("scales FGetHSV(LightHue, LightSaturation, 255) by f32(LightBrightness / 255), then the type multiplier, then LevelInfo Brightness", () => {
    const base = fGetHsv(26, 150, 255);
    const expected = scalePlane(scalePlane(scalePlane(base, Math.fround(70 / 255)), lightType7Modulation(32, 0, 1)), Math.fround(0.75));
    expect(dynamicLightColour(staticLight(7), { ...environment, levelBrightness: 0.75 })).toEqual({ status: "resolved", value: expected });
  });

  it("reports the light type gap before any colour", () => {
    expect(dynamicLightColour(staticLight(2), environment)).toEqual({ status: "unresolved", reason: "bsp-rebuild-light-type-unported:2" });
  });
});
