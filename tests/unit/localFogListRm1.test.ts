import { describe, expect, it } from "vitest";
import { skyLayerColour } from "../../src/environment/model/nativeEnvironmentColours";
import { fogInfoWeight } from "../../src/materials/ue2/model/fog";
import { cameraEnvironmentGaps, computeCameraEnvironment } from "../../src/scene/world/cameraEnvironment";
import type { TileLightingRecords } from "../../src/scene/world/lighting/tileLightingRecords";
import { readDayNightLoadedTables } from "../support/dayNightFixtures";
import { convertedEnvironmentFogRanges, decodedFogWorkedCaseRecords, fogWorkedCaseTileRecords, frameInZone, zoneIndexOfActor } from "../support/fogWorkedCaseFixture";

const rm1Hour = 12.3;
const rm1Pawn = { x: 9181.81, y: 119378.66, z: -3673.31 };
const tileRecords = fogWorkedCaseTileRecords("20_21");
const records = decodedFogWorkedCaseRecords(tileRecords);
const cameraZone = zoneIndexOfActor(tileRecords, "20_21.ZoneInfo40");
const fogEnvironment = { hour: rm1Hour, fogRanges: convertedEnvironmentFogRanges(),
  hazeColour: skyLayerColour(readDayNightLoadedTables(), { oldType: 0, targetType: 0, weight: 0 }, "HazeringColor", rm1Hour) };

function environmentOf(fogRecords: TileLightingRecords) {
  return computeCameraEnvironment({ frame: frameInZone(cameraZone), cameraSourcePosition: null, referencePawnSourcePosition: rm1Pawn, collision: null,
    records: fogRecords, fogEnvironment, skySceneRoute: null });
}

function weightOf(object: string): { readonly distance: number; readonly weight: number } {
  const exportIndex = tileRecords.fogInfos.find(fogInfo => fogInfo.object === object)!.exportIndex;
  const fogInfo = records.fogInfos.find(entry => entry.exportIndex === exportIndex)!.record!;
  const { x, y, z } = fogInfo.sourceLocation;
  const distance = Math.hypot(x - rm1Pawn.x, y - rm1Pawn.y, z - rm1Pawn.z);
  return { distance, weight: fogInfoWeight(fogInfo.affectRange, distance, fogInfo.colours.length) };
}

describe("20_21 local L2FogInfo list at the RM-1 pawn, the RM-1 enabled call", () => {
  it("decodes all 88 converted L2FogInfo actors and weights only L2FogInfo99 (1) and L2FogInfo89 (0.1491227)", () => {
    expect(records.fogInfos).toHaveLength(88);
    expect(records.fogInfos.every(fogInfo => fogInfo.unresolvedReason === null)).toBe(true);
    const weighted = tileRecords.fogInfos.map(fogInfo => ({ object: fogInfo.object, ...weightOf(fogInfo.object) })).filter(entry => entry.weight > 0);
    expect(weighted.map(entry => entry.object).sort()).toEqual(["20_21.L2FogInfo89", "20_21.L2FogInfo99"]);
    expect(weightOf("20_21.L2FogInfo99")).toMatchObject({ weight: 1 });
    expect(weightOf("20_21.L2FogInfo99").distance).toBeCloseTo(2353.5, 1);
    expect(weightOf("20_21.L2FogInfo89").distance).toBeCloseTo(3850.9, 1);
    expect(weightOf("20_21.L2FogInfo89").weight).toBeCloseTo(0.1491227, 5);
  });

  it("blends 107,114,97 at 0 to 10000 at hour 12.30 and CR 8, the same in export order and in reverse, with no order gap", () => {
    const reversed = { ...records, fogInfos: [...records.fogInfos].reverse() };
    for (const fogRecords of [records, reversed]) {
      const environment = environmentOf(fogRecords);
      expect(environment.fog).toEqual({ enabled: true, source: "local-fog-list", colour: [107 / 255, 114 / 255, 97 / 255],
        startSourceUnits: 0, endSourceUnits: 10000, fogEnd: 10000 });
      expect(environment.gaps).not.toContain(cameraEnvironmentGaps.fogInfoListOrderAssumed);
      expect(environment.gaps).not.toContain(cameraEnvironmentGaps.fogInfoRetentionDistanceUnresolved);
      expect(environment.gaps).toContain(cameraEnvironmentGaps.fogTransitionUnported);
    }
    const bgra = [...environmentOf(records).fog.colour].reverse().map(channel => Math.round(channel * 255));
    expect(bgra).toEqual([97, 114, 107]);
  });

  it("names the absent reference pawn instead of measuring the fade from the camera", () => {
    const environment = computeCameraEnvironment({ frame: frameInZone(cameraZone), cameraSourcePosition: rm1Pawn, referencePawnSourcePosition: null, collision: null,
      records, fogEnvironment, skySceneRoute: null });
    expect(environment.fog.source).toBe("unresolved");
    expect(environment.gaps).toContain(cameraEnvironmentGaps.fogInfoReferencePawnAbsent);
  });
});
