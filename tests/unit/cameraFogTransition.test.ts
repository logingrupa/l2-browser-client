import { describe, expect, it } from "vitest";
import { FOG_DISABLED, type FogRangeRecord, type FogState } from "../../src/materials/ue2/model/fog";
import type { CameraEnvironment, CameraFogRoute } from "../../src/scene/world/cameraEnvironment";
import { createCameraFogTransition } from "../../src/scene/world/cameraFogTransition";

const presetPair = [8192, 20480] as const;
const localTarget: FogRangeRecord = { colourBytes: [107, 114, 97], startSourceUnits: 0, endSourceUnits: 10000 };
const changedLocalTarget: FogRangeRecord = { colourBytes: [30, 50, 200], startSourceUnits: 1000, endSourceUnits: 5000 };
const zoneTarget: FogRangeRecord = { colourBytes: [128, 128, 128], startSourceUnits: 3000, endSourceUnits: 15000 };
const haze = [188, 203, 224] as const;

function enabledFog(record: FogRangeRecord, source: FogState["source"]): FogState {
  return { enabled: true, source, colour: [record.colourBytes[0] / 255, record.colourBytes[1] / 255, record.colourBytes[2] / 255],
    startSourceUnits: record.startSourceUnits, endSourceUnits: record.endSourceUnits };
}

function environment(fog: FogState, fogRoute: CameraFogRoute): CameraEnvironment {
  return { cameraZone: 1, containingVolume: null, fog, fogRoute, skyFog: { route: "inherit-level", fog, gaps: [] },
    retainedFogInfos: { status: "listed", hour: 12, fogInfos: [] }, gaps: [] };
}

const local = (target = localTarget) => environment(enabledFog(target, "local-fog-list"), { kind: "local-list", target });
const terrainZone = () => environment(enabledFog({ colourBytes: haze, startSourceUnits: presetPair[0], endSourceUnits: presetPair[1] }, "terrain-zone-environment"),
  { kind: "empty-list", presetPair, zone: { kind: "terrain-zone", hazeColour: haze } });
const distanceFogZone = (blendTime: { status: "staged"; seconds: number } | { status: "unstaged"; reason: string }) =>
  environment(enabledFog(zoneTarget, "camera-zone"), { kind: "empty-list", presetPair, zone: { kind: "distance-fog-zone", target: zoneTarget, blendTime } });
const bytesOf = (fog: FogState) => fog.colour.map(channel => Math.round(channel * 255));

describe("camera fog transition restart gates (0x1065f3a3 local list, 0x1065f5f8 empty list)", () => {
  it("seeds the first local frame, restarts with FogSpeed on entry and keeps the timer when the local target changes", () => {
    const transition = createCameraFogTransition(1);
    expect(bytesOf(transition.advance(local(), 0).fog)).toEqual([107, 114, 97]);
    expect(transition.inspection()).toMatchObject({ route: "local-list", lastRestart: "FogSpeed", previousLocal: true,
      state: { remaining: 1, duration: 1 }, initialState: { status: "unresolved", reason: "fog-transition-initial-state-unresolved" },
      scope: { status: "unresolved", reason: "fog-transition-per-tile-not-per-scene" } });
    const changed = transition.advance(local(changedLocalTarget), 0.25);
    expect(transition.inspection().state).toMatchObject({ remaining: 0.75, oldColourBgra: [97, 114, 107, 0] });
    expect(bytesOf(changed.fog)).toEqual([87, 98, 122]);
    expect(changed.skyFog.fog).toBe(changed.fog);
  });

  it("restarts toward the Env.int preset with FogSpeed when the local list empties into a terrain zone", () => {
    const transition = createCameraFogTransition(1);
    transition.advance(local(), 0);
    transition.advance(local(), 1);
    const leaving = transition.advance(terrainZone(), 0.5);
    expect(transition.inspection()).toMatchObject({ route: "empty-list", lastRestart: "FogSpeed", previousLocal: false, previousTerrainZone: true,
      state: { targetStart: 8192, targetEnd: 20480, remaining: 0.5 } });
    expect([leaving.fog.startSourceUnits, leaving.fog.endSourceUnits]).toEqual([4096, 15240]);
    expect(bytesOf(leaving.fog)).toEqual([147, 158, 160]);
  });

  it("restarts with the zone DistanceFogBlendTime when leaving a terrain zone for an ordinary distance fog zone, and snaps with a gap when it is unstaged", () => {
    const staged = createCameraFogTransition(1);
    staged.advance(terrainZone(), 0);
    staged.advance(distanceFogZone({ status: "staged", seconds: 4 }), 1);
    expect(staged.inspection()).toMatchObject({ lastRestart: "DistanceFogBlendTime", state: { duration: 4, remaining: 3 } });
    const unstaged = createCameraFogTransition(1);
    unstaged.advance(terrainZone(), 0);
    const snapped = unstaged.advance(distanceFogZone({ status: "unstaged", reason: "fog-zone-blend-time-unstaged" }), 0.016);
    expect(unstaged.inspection()).toMatchObject({ lastRestart: "fog-zone-blend-time-unstaged", state: { remaining: 0 } });
    expect(bytesOf(snapped.fog)).toEqual([128, 128, 128]);
    expect(snapped.gaps).toContain("fog-zone-blend-time-unstaged");
  });

  it("does not restart an ordinary zone's own target changes, and passes the volume route and a disabled fog through untouched", () => {
    const transition = createCameraFogTransition(1);
    transition.advance(distanceFogZone({ status: "staged", seconds: 4 }), 0);
    transition.advance(distanceFogZone({ status: "staged", seconds: 4 }), 0.5);
    expect(transition.inspection()).toMatchObject({ lastRestart: "FogSpeed", previousTerrainZone: false });
    const bypassed = environment(enabledFog(zoneTarget, "volume"), { kind: "bypass" });
    expect(transition.advance(bypassed, 0.5)).toBe(bypassed);
    const withoutFog = environment(FOG_DISABLED, { kind: "empty-list", presetPair, zone: { kind: "without-fog" } });
    expect(transition.advance(withoutFog, 0.5).fog).toBe(FOG_DISABLED);
  });
});
