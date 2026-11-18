import { describe, expect, it } from "vitest";
import { FOG_DISABLED, FOG_UNRESOLVED } from "../../src/materials/ue2/model/fog";
import { cameraEnvironmentGaps, computeCameraEnvironment, type CameraEnvironmentSources } from "../../src/scene/world/cameraEnvironment";
import { collisionWorldFromFixtures, committedMovementRules, fixtureCellId, mixedChunkArrays, waterPhysicsVolume } from "../fixtures/movement/movementCollisionFixtures";
import { decodeTileLighting } from "../../src/scene/world/lighting/decodeTileLighting";
import { frameInZone } from "../support/fogWorkedCaseFixture";
import { fieldRecord, tileLightingArrays, tileLightingModel, tileLightingPayload, tileLightingRecordsDocument } from "../support/tileLightingFixture";
import { shippedEnvironmentFogRanges } from "../support/worldTimeOfDayFixture";

const records = tileLightingModel().records;
const rules = committedMovementRules();
const fogInfoLocation = { x: 28491.390625, y: 110465.5, z: -1361.5125732421875 };
const pawnOutsideFogInfo = { ...fogInfoLocation, x: fogInfoLocation.x + 10000 };
const hazeBytes = [188, 203, 224] as const;

function sources(change: Partial<CameraEnvironmentSources> = {}): CameraEnvironmentSources {
  return { frame: frameInZone(1), cameraSourcePosition: null, referencePawnSourcePosition: pawnOutsideFogInfo, collision: null, records,
    fogEnvironment: { hour: 12, fogRanges: shippedEnvironmentFogRanges, hazeColour: { status: "resolved", value: hazeBytes } }, ...change };
}

describe("computeCameraEnvironment", () => {
  it("takes the camera zone from the visibility frame and, with the local list empty, evaluates its ZoneInfo distance fog range", () => {
    const environment = computeCameraEnvironment(sources());
    expect(environment.cameraZone).toBe(1);
    expect(environment.fog).toEqual({ enabled: true, source: "camera-zone", colour: [95 / 255, 112 / 255, 116 / 255], startSourceUnits: 100,
      endSourceUnits: 20000 });
    expect(environment.gaps).toEqual([cameraEnvironmentGaps.fogInfoRetentionDistanceUnresolved, cameraEnvironmentGaps.waterVolumeUnlinked,
      cameraEnvironmentGaps.volumeQueryUnbound]);
  });

  it("routes an empty list in a terrain zone to the haze colour over the Env.int preset at CR 8", () => {
    expect(computeCameraEnvironment(sources({ frame: frameInZone(3) })).fog).toEqual({ enabled: true, source: "terrain-zone-environment",
      colour: [188 / 255, 203 / 255, 224 / 255], startSourceUnits: 8192, endSourceUnits: 20480 });
  });

  it("keeps fog off in a zone without distance fog and names an unresolved or unknown zone", () => {
    expect(computeCameraEnvironment(sources({ frame: frameInZone(2) })).fog).toEqual({ ...FOG_DISABLED, source: "zone-without-fog" });
    const unresolved = computeCameraEnvironment(sources({ frame: frameInZone(0) }));
    expect(unresolved.fog).toEqual(FOG_DISABLED);
    expect(unresolved.gaps).toContain("lighting-zone-fog-unresolved:0:bDistanceFog");
    const unknown = computeCameraEnvironment(sources({ frame: null }));
    expect(unknown).toMatchObject({ cameraZone: -1, fog: FOG_DISABLED });
    expect(unknown.gaps).toContain(cameraEnvironmentGaps.cameraZoneUnknown);
    expect(computeCameraEnvironment(sources({ frame: frameInZone(9) })).gaps).toContain("lighting-zone-unlisted:9");
  });

  it("names a decoded zone fog range whose end does not pass its start as a gap instead of throwing in the frame loop", () => {
    const document = tileLightingRecordsDocument();
    const distanceFogEnd = document.zones[1]!.distanceFog.find(record => record.field === "DistanceFogEnd")!;
    distanceFogEnd.value = 100;
    const payload = tileLightingPayload(tileLightingArrays(document));
    const flatRecords = decodeTileLighting(payload.assetRecord, payload.payloadBytes).records;
    expect(flatRecords.zones[1]).toEqual({ zoneIndex: 1, fog: { distanceFog: true, terrainZone: false, fog: null },
      unresolvedReason: "lighting-zone-fog-range-not-increasing:1:100:100", distanceFogBlendTime: { status: "unstaged", reason: "fog-zone-blend-time-unstaged" } });
    const environment = computeCameraEnvironment(sources({ records: flatRecords }));
    expect(environment.fog).toEqual(FOG_UNRESOLVED);
    expect(environment.gaps).toContain("lighting-zone-fog-range-not-increasing:1:100:100");
  });

  it("reads a staged DistanceFogBlendTime, names an unresolved one, and routes an ordinary distance fog zone with its blend time", () => {
    const document = tileLightingRecordsDocument();
    document.zones[1]!.distanceFog.push(fieldRecord("DistanceFogBlendTime", 2.5, "authored"));
    document.zones[2]!.distanceFog.push(fieldRecord("DistanceFogBlendTime", null, "unresolved"));
    const payload = tileLightingPayload(tileLightingArrays(document));
    const blendRecords = decodeTileLighting(payload.assetRecord, payload.payloadBytes).records;
    expect(blendRecords.zones[1]!.distanceFogBlendTime).toEqual({ status: "staged", seconds: 2.5 });
    expect(blendRecords.zones[2]!.distanceFogBlendTime).toEqual({ status: "unstaged", reason: "lighting-zone-fog-unresolved:2:DistanceFogBlendTime" });
    expect(computeCameraEnvironment(sources({ frame: frameInZone(1), records: blendRecords })).fogRoute).toEqual({ kind: "empty-list",
      presetPair: [8192, 20480], zone: { kind: "distance-fog-zone", target: { colourBytes: [95, 112, 116], startSourceUnits: 100, endSourceUnits: 20000 },
        blendTime: { status: "staged", seconds: 2.5 } } });
  });

  it("routes a terrain zone to the haze preset even when its unused DistanceFog fields are unresolved or do not increase", () => {
    const document = tileLightingRecordsDocument();
    const terrainZoneFields = document.zones[3]!.distanceFog;
    terrainZoneFields.find(record => record.field === "DistanceFogEnd")!.value = 100;
    const colour = terrainZoneFields.find(record => record.field === "DistanceFogColor")!;
    colour.provenance = "unresolved";
    colour.value = null;
    const payload = tileLightingPayload(tileLightingArrays(document));
    const terrainRecords = decodeTileLighting(payload.assetRecord, payload.payloadBytes).records;
    expect(terrainRecords.zones[3]).toEqual({ zoneIndex: 3, unresolvedReason: null, fog: { distanceFog: true, terrainZone: true, fog: null },
      distanceFogBlendTime: { status: "unstaged", reason: "fog-zone-blend-time-unstaged" } });
    expect(computeCameraEnvironment(sources({ frame: frameInZone(3), records: terrainRecords })).fog)
      .toMatchObject({ source: "terrain-zone-environment", startSourceUnits: 8192, endSourceUnits: 20480 });
  });

  it("finds the physics volume around the camera through volumesContaining and names the missing water flag", () => {
    const world = collisionWorldFromFixtures(mixedChunkArrays(), null);
    const [x, y, z] = waterPhysicsVolume.location;
    const inside = computeCameraEnvironment(sources({ cameraSourcePosition: { x: x + 300, y, z: z + 50 }, collision: { world, rules } }));
    expect(inside.containingVolume).toMatchObject({ cellId: fixtureCellId, volumeIndex: 1, volume: { kind: "physics" } });
    expect(inside.gaps).toContain(cameraEnvironmentGaps.volumeWaterFlagAbsent);
    expect(inside.fog.source).toBe("camera-zone");
    const outside = computeCameraEnvironment(sources({ cameraSourcePosition: { x: x + 380, y, z }, collision: { world, rules } }));
    expect(outside.containingVolume).toBeNull();
    expect(outside.gaps).not.toContain(cameraEnvironmentGaps.volumeWaterFlagAbsent);
  });
});

describe("sky scene fog", () => {
  it("inherits the level fog under the shared-sky route of the shipped l2.ini and names the unstaged SkyLevel geometry", () => {
    const environment = computeCameraEnvironment(sources({ frame: frameInZone(1) }));
    expect(environment.fog.source).toBe("camera-zone");
    expect(environment.skyFog).toEqual({ route: "inherit-level", fog: environment.fog });
  });

  it("hands the sky colour writer the retained L2FogInfo list with its weights and hour, or the missing fog reference pawn", () => {
    const [fogInfo] = records.fogInfos;
    expect(computeCameraEnvironment(sources({ referencePawnSourcePosition: fogInfoLocation })).retainedFogInfos)
      .toEqual({ status: "listed", hour: 12, fogInfos: [{ fogInfo: fogInfo!.record, weight: 1 }] });
    expect(computeCameraEnvironment(sources()).retainedFogInfos).toEqual({ status: "listed", hour: 12, fogInfos: [] });
    expect(computeCameraEnvironment(sources({ referencePawnSourcePosition: null })).retainedFogInfos)
      .toEqual({ status: "unresolved", reason: cameraEnvironmentGaps.fogInfoReferencePawnAbsent });
  });

  it("hands the sky colour writer an unresolved list naming the gap when an L2FogInfo record is unresolved, instead of dropping it", () => {
    const unresolvedReason = "lighting-fog-info-unresolved:9237:FogRange3";
    const withUnresolved = { ...records, fogInfos: [...records.fogInfos, { exportIndex: 9237, record: null, unresolvedReason }] };
    const environment = computeCameraEnvironment(sources({ records: withUnresolved, referencePawnSourcePosition: fogInfoLocation }));
    expect(environment.retainedFogInfos).toEqual({ status: "unresolved", reason: unresolvedReason });
    expect(environment.gaps).toContain(unresolvedReason);
  });
});
