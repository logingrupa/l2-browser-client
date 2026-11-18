import { describe, expect, it } from "vitest";
import { skyLayerColour } from "../../src/environment/model/nativeEnvironmentColours";
import { FOG_UNRESOLVED } from "../../src/materials/ue2/model/fog";
import { cameraEnvironmentGaps, computeCameraEnvironment, type FogEnvironment } from "../../src/scene/world/cameraEnvironment";
import { readDayNightLoadedTables } from "../support/dayNightFixtures";
import { convertedEnvironmentFogRanges, decodedFogWorkedCaseRecords, fogWorkedCaseTileRecords, frameInZone, zoneIndexOfActor } from "../support/fogWorkedCaseFixture";

const rm1Hour = 12.078453;
const settledType0 = { oldType: 0, targetType: 0, weight: 0 };
const tables = readDayNightLoadedTables();
const fogEnvironment: FogEnvironment = { hour: rm1Hour, fogRanges: convertedEnvironmentFogRanges(),
  hazeColour: skyLayerColour(tables, settledType0, "HazeringColor", rm1Hour) };
const tileRecords = fogWorkedCaseTileRecords("15_22");
const zoneInfo0 = zoneIndexOfActor(tileRecords, "15_22.ZoneInfo0");

function environmentOf(records = decodedFogWorkedCaseRecords(tileRecords), environment = fogEnvironment) {
  return computeCameraEnvironment({ frame: frameInZone(zoneInfo0), cameraSourcePosition: null, referencePawnSourcePosition: null, collision: null, records,
    fogEnvironment: environment, skySceneRoute: null });
}

function withTerrainFlagRecords(provenance: string, value: unknown) {
  const changed = fogWorkedCaseTileRecords("15_22");
  const zone = changed.zones.find(record => record.zoneIndex === zoneInfo0)!;
  zone.distanceFog = zone.distanceFog.map(field => field.field === "bTerrainZone" ? { ...field, provenance, value } : field);
  return changed;
}

const withTerrainFlag = (provenance: string, value: unknown) => decodedFogWorkedCaseRecords(withTerrainFlagRecords(provenance, value));

describe("15_22 terrain zone fog, the RM-1 enabled call", () => {
  it("reads ZoneInfo0 from the converter zone records with bTerrainZone, bDistanceFog and DistanceFogEnd 15000 and no L2FogInfo", () => {
    const records = decodedFogWorkedCaseRecords(tileRecords);
    expect(records.fogInfos).toEqual([]);
    expect(records.zones.find(zone => zone.zoneIndex === zoneInfo0)).toEqual({ zoneIndex: zoneInfo0, unresolvedReason: null,
      fog: { distanceFog: true, terrainZone: true, fog: null } });
    expect(decodedFogWorkedCaseRecords(withTerrainFlagRecords("authored", false)).zones.find(zone => zone.zoneIndex === zoneInfo0)!.fog)
      .toEqual({ distanceFog: true, terrainZone: false, fog: { colourBytes: [128, 128, 128], startSourceUnits: 3000, endSourceUnits: 15000 } });
  });

  it("takes the timeenv0 HazeringColor at hour 12.078453 over the Env.int FogRange5 preset at CR 8: 188,203,224 at 8192 to 20480", () => {
    const environment = environmentOf();
    expect(environment.fog).toEqual({ enabled: true, source: "terrain-zone-environment", colour: [188 / 255, 203 / 255, 224 / 255],
      startSourceUnits: 8192, endSourceUnits: 20480, fogEnd: 20480 });
    const bgra = [...environment.fog.colour].reverse().map(channel => Math.round(channel * 255));
    expect(bgra).toEqual([224, 203, 188]);
    expect(environment.gaps).toEqual([cameraEnvironmentGaps.fogTransitionUnported, cameraEnvironmentGaps.volumeQueryUnbound]);
  });

  it("falls back to the ZoneInfo 3000 to 15000 grey 128 without bTerrainZone, and its alpha 0 colour keeps fog enabled", () => {
    const environment = environmentOf(withTerrainFlag("ue-zero", null));
    expect(environment.fog).toEqual({ enabled: true, source: "camera-zone", colour: [128 / 255, 128 / 255, 128 / 255],
      startSourceUnits: 3000, endSourceUnits: 15000, fogEnd: 15000 });
    expect(tileRecords.zones.find(zone => zone.zoneIndex === zoneInfo0)!.distanceFog.find(field => field.field === "DistanceFogColor")!.value)
      .toMatchObject({ A: 0 });
  });

  it("names an unresolved terrain flag or a haze colour in transition instead of drawing grey", () => {
    const unresolvedFlag = environmentOf(withTerrainFlag("unresolved", null));
    expect(unresolvedFlag.fog).toEqual(FOG_UNRESOLVED);
    expect(unresolvedFlag.gaps).toContain(`lighting-zone-terrain-flag-unresolved:${zoneInfo0}`);
    const transition = environmentOf(undefined, { ...fogEnvironment, hazeColour: skyLayerColour(tables, { oldType: 0, targetType: 3, weight: 0.5 }, "HazeringColor", rm1Hour) });
    expect(transition.fog).toEqual(FOG_UNRESOLVED);
    expect(transition.gaps).toContain("fog-terrain-zone-haze-unresolved:env-color-transition-unresolved");
  });
});
