import { describe, expect, it } from "vitest";
import {
  environmentColour, environmentLightPlane, environmentScale, skyLayerColour,
} from "../../src/environment/model/nativeEnvironmentColours";
import type { NativeEnvironmentBlend } from "../../src/environment/model/nativeEnvironmentManager";
import {
  blackStartColourSections, hsvLightSections, scaleSections, skyLayerColourSections, type NativeEnvironmentTables, type NativeEnvironmentTypeTables,
} from "../../src/environment/model/nativeEnvironmentTypeTables";
import type { NativeTimeColourRow } from "../../src/environment/model/sampleNativeTimeTables";

function typeTables(colourRows: readonly NativeTimeColourRow[]): NativeEnvironmentTypeTables {
  return {
    colour: Object.fromEntries([...blackStartColourSections, ...skyLayerColourSections].map(section => [section, colourRows])) as NativeEnvironmentTypeTables["colour"],
    hsv: Object.fromEntries(hsvLightSections.map(section => [section, []])) as unknown as NativeEnvironmentTypeTables["hsv"],
    scale: Object.fromEntries(scaleSections.map(section => [section, [{ time: 0, scale: 1 }, { time: 24, scale: 3 }]])) as unknown as NativeEnvironmentTypeTables["scale"],
  };
}

const constantRows = (red: number, green: number, blue: number): readonly NativeTimeColourRow[] =>
  [{ time: 0, red, green, blue }, { time: 24, red, green, blue }];
const tables: NativeEnvironmentTables = new Map([[0, typeTables(constantRows(100, 100, 100))], [1, typeTables(constantRows(0, 51, 200))]]);
const settled = (environmentType: number, weight: number): NativeEnvironmentBlend => ({ oldType: environmentType, targetType: environmentType, weight });
const transition: NativeEnvironmentBlend = { oldType: 0, targetType: 1, weight: 0.5 };

describe("GetEnvColor 0x10515a70 steady branches", () => {
  it("returns the default sample for a settled type 0, whatever the weight", () => {
    expect(environmentColour(tables, settled(0, 0.3), "SkyBoxColor", 12)).toEqual({ status: "resolved", value: [100, 100, 100] });
  });

  it("returns default + (target - default) * weight, truncated, for another settled type", () => {
    expect(environmentColour(tables, settled(1, 0.5), "SkyBoxColor", 12)).toEqual({ status: "resolved", value: [50, 75, 150] });
  });

  it("blends toward black for a settled type with no table", () => {
    expect(environmentColour(tables, settled(5, 1), "ActorAmbient", 12)).toEqual({ status: "resolved", value: [0, 0, 0] });
  });

  it("starts from black when the hour has no bracket", () => {
    expect(environmentColour(tables, settled(0, 1), "SunColor", 24)).toEqual({ status: "resolved", value: [0, 0, 0] });
  });

  it("reports the transition branch as unresolved for every getter", () => {
    const gap = { status: "unresolved", reason: "env-color-transition-unresolved" };
    expect(environmentColour(tables, transition, "SkyBoxColor", 12)).toEqual(gap);
    expect(skyLayerColour(tables, transition, "CloudColor2", 12)).toEqual(gap);
    expect(environmentLightPlane(tables, transition, "HSVActorLight", 12)).toEqual(gap);
    expect(environmentScale(tables, transition, "SunScale", 12)).toEqual(gap);
  });
});

describe("sky layer, plane and scale getters", () => {
  it("samples haze and cloud tables like the sky inside the table", () => {
    expect(skyLayerColour(tables, settled(1, 1), "HazeringColor", 6)).toEqual({ status: "resolved", value: [0, 51, 200] });
  });

  it("reports an unbracketed haze or cloud hour as unresolved because its start colour is not audited", () => {
    expect(skyLayerColour(tables, settled(0, 1), "CloudColor1", 25)).toEqual({ status: "unresolved", reason: "sky-layer-start-colour-unresolved" });
  });

  it("starts light planes at zero when no row brackets the hour", () => {
    expect(environmentLightPlane(tables, settled(0, 1), "HSVTerrainLight", 12)).toEqual({ status: "resolved", value: [0, 0, 0, 0] });
  });

  it("reads scale from the settled target table only", () => {
    expect(environmentScale(tables, settled(1, 0.1), "MoonScale", 12)).toEqual({ status: "sampled", value: 2 });
    expect(environmentScale(tables, settled(9, 1), "SunScale", 12)).toEqual({ status: "unwritten" });
  });
});
