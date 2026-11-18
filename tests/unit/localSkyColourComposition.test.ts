import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { composeLocalSkyColour } from "../../src/environment/model/localSkyColourComposition";
import { environmentColour, skyLayerColour } from "../../src/environment/model/nativeEnvironmentColours";
import type { RgbBytes } from "../../src/environment/model/sampleNativeTimeTables";
import type { SkyEnvironmentSection } from "../../src/environment/parseNativeTimeTables";
import { FOG_CONSTANTS } from "../../src/materials/ue2/model/constants/fogConstants";
import { evaluateLocalFogList, type WeightedFogInfo } from "../../src/materials/ue2/model/fog";
import { environmentFogBaseline } from "../../src/scene/world/cameraEnvironment";
import { convertedEnvironmentFogRanges, decodedFogWorkedCaseRecords, fogWorkedCaseTileRecords } from "../support/fogWorkedCaseFixture";
import { dayNightTimeTables } from "../support/worldTimeOfDayFixture";

interface SkyColourSet {
  readonly SkyColor: RgbBytes;
  readonly CloudColor: readonly RgbBytes[];
  readonly HazeRingColor: readonly RgbBytes[];
}

interface LocalSkyOverrideActor {
  readonly actor: string;
  readonly exportIndex: number;
  readonly referencePoint: readonly [number, number, number];
  readonly hour: number;
  readonly nativeSpatialWeight: number;
  readonly runningRGB: SkyColourSet;
}

const { localSkyOverride } = JSON.parse(readFileSync(new URL("../fixtures/environment/shared-sky-rm21-fixtures.json", import.meta.url), "utf8")) as
  { readonly localSkyOverride: { readonly baselineRGB: SkyColourSet; readonly finalRGB: SkyColourSet; readonly actors: readonly LocalSkyOverrideActor[] } };
const [firstActor] = localSkyOverride.actors;
const hour = firstActor!.hour;
const [x, y, z] = firstActor!.referencePoint;
const skySections: readonly { readonly section: SkyEnvironmentSection; readonly pick: (colours: SkyColourSet) => RgbBytes }[] = [
  { section: "SkyBoxColor", pick: colours => colours.SkyColor },
  { section: "HazeringColor", pick: colours => colours.HazeRingColor[0]! },
  { section: "CloudColor1", pick: colours => colours.CloudColor[0]! },
  { section: "CloudColor2", pick: colours => colours.CloudColor[1]! },
  { section: "CloudColor3", pick: colours => colours.CloudColor[2]! },
];

function retainedAt20_21(): readonly WeightedFogInfo[] {
  const records = decodedFogWorkedCaseRecords(fogWorkedCaseTileRecords("20_21"));
  const fogInfos = records.fogInfos.flatMap(fogInfo => fogInfo.record === null ? [] : [fogInfo.record]);
  const terrainClipRange = FOG_CONSTANTS.terrainClipRange.runtimeDefault;
  return evaluateLocalFogList(fogInfos, environmentFogBaseline(convertedEnvironmentFogRanges(), terrainClipRange),
    { hour, terrainClipRange, referencePosition: { x, y, z } }).retained;
}

function composedSet(fogInfos: readonly WeightedFogInfo[], base: SkyColourSet = localSkyOverride.baselineRGB): RgbBytes[] {
  return skySections.map(({ section, pick }) => composeLocalSkyColour(pick(base), section, fogInfos, hour));
}

describe("local L2FogInfo sky colours before fog (Engine 0x1065e940, RM-21)", () => {
  it("starts from the shipped time-table colours at hour 12.30: sky 66,124,176, clouds 255,255,255 then black, haze 188,203,224", () => {
    const { tables } = dayNightTimeTables(), settled = { oldType: 0, targetType: 0, weight: 0 };
    expect(environmentColour(tables, settled, "SkyBoxColor", hour)).toEqual({ status: "resolved", value: localSkyOverride.baselineRGB.SkyColor });
    expect(skyLayerColour(tables, settled, "HazeringColor", hour)).toEqual({ status: "resolved", value: localSkyOverride.baselineRGB.HazeRingColor[0] });
    expect(skyLayerColour(tables, settled, "CloudColor1", hour)).toEqual({ status: "resolved", value: localSkyOverride.baselineRGB.CloudColor[0] });
  });

  it("retains L2FogInfo100, 89 and 99 at the 20_21 north reference point with the native spatial weights to six places (double distance, not f32)", () => {
    const retained = retainedAt20_21();
    expect(retained.map(({ fogInfo }) => fogInfo.exportIndex)).toEqual(localSkyOverride.actors.map(actor => actor.exportIndex));
    retained.forEach(({ weight }, index) => expect(weight).toBeCloseTo(localSkyOverride.actors[index]!.nativeSpatialWeight, 6));
  });

  it("composes SkybackgroundColor 132,146,131, Cloud_Final 111,132,129, StarField 0,0,0 and HazeRing_Final 133,126,103, matching every running step", () => {
    const retained = retainedAt20_21();
    retained.forEach((_, index) => expect(composedSet(retained.slice(0, index + 1))).toEqual(composedSet([], localSkyOverride.actors[index]!.runningRGB)));
    expect(composedSet(retained)).toEqual(skySections.map(({ pick }) => pick(localSkyOverride.finalRGB)));
  });

  it("gives the same colours with 99 and 89 in either order", () => {
    const [first, second, third] = retainedAt20_21();
    expect(composedSet([first!, third!, second!])).toEqual(composedSet([first!, second!, third!]));
  });

  it("keeps the table colours with no retained L2FogInfo, as at 15_22", () => {
    expect(decodedFogWorkedCaseRecords(fogWorkedCaseTileRecords("15_22")).fogInfos).toEqual([]);
    expect(composedSet([])).toEqual(skySections.map(({ pick }) => pick(localSkyOverride.baselineRGB)));
  });

  it("skips a cloud slot past the fog actor's own CloudColor count", () => {
    const [first] = retainedAt20_21();
    expect(first!.fogInfo.colours.every(key => key.cloudColourBytes.length === 1)).toBe(true);
    expect(composeLocalSkyColour([255, 255, 255], "CloudColor2", [first!], hour)).toEqual([255, 255, 255]);
  });
});
