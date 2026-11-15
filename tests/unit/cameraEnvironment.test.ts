import { describe, expect, it } from "vitest";
import { FOG_DISABLED } from "../../src/materials/ue2/babylon/material";
import type { TileVisibilityFrame } from "../../src/scene/world/bspVisibility/core/tileVisibilityFrame";
import { zoneSetOf } from "../../src/scene/world/bspVisibility/core/zoneSet";
import { cameraEnvironmentGaps, computeCameraEnvironment } from "../../src/scene/world/cameraEnvironment";
import { collisionWorldFromFixtures, committedMovementRules, fixtureCellId, mixedChunkArrays, waterPhysicsVolume } from "../fixtures/movement/movementCollisionFixtures";
import { decodeTileLighting } from "../../src/scene/world/lighting/decodeTileLighting";
import { tileLightingArrays, tileLightingModel, tileLightingPayload, tileLightingRecordsDocument } from "../support/tileLightingFixture";

const records = tileLightingModel().records;
const rules = committedMovementRules();

function frameInZone(cameraZone: number): TileVisibilityFrame {
  return { culling: false, cameraLeaf: 0, cameraZone, outdoorView: false, visibleZones: zoneSetOf(cameraZone < 0 ? 0 : cameraZone), visibleZoneCount: 1, openedPortalCount: 0,
    skyZones: [], sectionVisible: new Uint8Array(0), memberVisible: new Uint8Array(0), terrainVisible: true, translucentOrder: new Map() };
}

describe("computeCameraEnvironment", () => {
  it("takes the camera zone from the visibility frame and evaluates its distance fog through the library, fogEnd included", () => {
    const environment = computeCameraEnvironment({ frame: frameInZone(1), cameraSourcePosition: null, collision: null, records });
    expect(environment.cameraZone).toBe(1);
    expect(environment.fog).toEqual({ enabled: true, source: "camera-zone", colour: [95 / 255, 112 / 255, 116 / 255], startSourceUnits: 100,
      endSourceUnits: 20000, fogEnd: 20000 });
    expect(environment.gaps).toEqual([cameraEnvironmentGaps.environmentPresetUnselected, cameraEnvironmentGaps.fogInfoRangeUnparsed,
      cameraEnvironmentGaps.waterVolumeUnlinked, cameraEnvironmentGaps.volumeQueryUnbound]);
  });

  it("keeps fog off in a sun-affected zone without distance fog and names an unresolved or unknown zone", () => {
    expect(computeCameraEnvironment({ frame: frameInZone(2), cameraSourcePosition: null, collision: null, records }).fog).toEqual(FOG_DISABLED);
    const unresolved = computeCameraEnvironment({ frame: frameInZone(0), cameraSourcePosition: null, collision: null, records });
    expect(unresolved.fog).toEqual(FOG_DISABLED);
    expect(unresolved.gaps).toContain("lighting-zone-fog-unresolved:0:bDistanceFog");
    const unknown = computeCameraEnvironment({ frame: null, cameraSourcePosition: null, collision: null, records });
    expect(unknown).toMatchObject({ cameraZone: -1, fog: FOG_DISABLED });
    expect(unknown.gaps).toContain(cameraEnvironmentGaps.cameraZoneUnknown);
    expect(computeCameraEnvironment({ frame: frameInZone(9), cameraSourcePosition: null, collision: null, records }).gaps).toContain("lighting-zone-unlisted:9");
  });

  it("names a decoded zone fog range whose end does not pass its start as a gap instead of throwing in the frame loop", () => {
    const document = tileLightingRecordsDocument();
    const distanceFogEnd = document.zones[1]!.distanceFog.find(record => record.field === "DistanceFogEnd")!;
    distanceFogEnd.value = 100;
    const payload = tileLightingPayload(tileLightingArrays(document));
    const flatRecords = decodeTileLighting(payload.assetRecord, payload.payloadBytes).records;
    expect(flatRecords.zones[1]).toEqual({ zoneIndex: 1, fog: null, unresolvedReason: "lighting-zone-fog-range-not-increasing:1:100:100" });
    const environment = computeCameraEnvironment({ frame: frameInZone(1), cameraSourcePosition: null, collision: null, records: flatRecords });
    expect(environment.fog).toEqual(FOG_DISABLED);
    expect(environment.gaps).toContain("lighting-zone-fog-range-not-increasing:1:100:100");
  });

  it("finds the physics volume around the camera through volumesContaining and names the missing water flag", () => {
    const world = collisionWorldFromFixtures(mixedChunkArrays(), null);
    const [x, y, z] = waterPhysicsVolume.location;
    const inside = computeCameraEnvironment({ frame: frameInZone(1), cameraSourcePosition: { x: x + 300, y, z: z + 50 }, collision: { world, rules }, records });
    expect(inside.containingVolume).toMatchObject({ cellId: fixtureCellId, volumeIndex: 1, volume: { kind: "physics" } });
    expect(inside.gaps).toContain(cameraEnvironmentGaps.volumeWaterFlagAbsent);
    expect(inside.fog.source).toBe("camera-zone");
    const outside = computeCameraEnvironment({ frame: frameInZone(1), cameraSourcePosition: { x: x + 380, y, z }, collision: { world, rules }, records });
    expect(outside.containingVolume).toBeNull();
    expect(outside.gaps).not.toContain(cameraEnvironmentGaps.volumeWaterFlagAbsent);
  });
});
