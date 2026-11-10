import { describe, expect, it } from "vitest";
import { committedBspVisibilityRules, parseBspVisibilityRules } from "../../src/scene/world/bspVisibility/bspVisibilityRules";
import { decodeBspVisibility } from "../../src/scene/world/bspVisibility/core/decodeBspVisibility";
import { computeTileVisibilityFrame, type TileVisibilityLimits } from "../../src/scene/world/bspVisibility/core/tileVisibilityFrame";
import { boxOutsideFrustum, createViewFrustum, sphereInsideFrustum, type ViewPose } from "../../src/scene/world/bspVisibility/core/viewFrustum";
import { zoneSetMembers } from "../../src/scene/world/bspVisibility/core/zoneSet";
import { threeRoomMembers, threeRoomSections, threeRoomVisibilityArrays, threeRoomVisibilityModel, threeRoomVisibilityPayload, threeRoomZones } from "../support/bspVisibilityFixture";

const mostVisible: TileVisibilityLimits = { portalRange: Infinity, portalDepthCap: Infinity, staticMeshRange: Infinity, emitterRange: Infinity };
const facingPositiveX = { x: 1, y: 0, z: 0 };
const facingNegativeX = { x: -1, y: 0, z: 0 };
const pose = (x: number, forward = facingPositiveX): ViewPose => ({ position: { x, y: 0, z: 0 }, forward, up: { x: 0, y: 0, z: 1 },
  verticalFieldOfView: Math.PI / 3, aspectRatio: 16 / 9, near: 10, far: Infinity });
const model = threeRoomVisibilityModel();
const culledFrame = (viewPose: ViewPose, limits = mostVisible) => computeTileVisibilityFrame(model, new Map(), viewPose, true, limits);
const visibleZones = (viewPose: ViewPose, limits = mostVisible) => zoneSetMembers(culledFrame(viewPose, limits).visibleZones, model.zoneCount);

describe("view frustum", () => {
  const frustum = createViewFrustum({ ...pose(0), far: 1000 });

  it("keeps a sphere on the view axis and drops one behind the camera or past the far plane", () => {
    expect(sphereInsideFrustum(frustum, { x: 500, y: 0, z: 0 }, 1)).toBe(true);
    expect(sphereInsideFrustum(frustum, { x: -500, y: 0, z: 0 }, 1)).toBe(false);
    expect(sphereInsideFrustum(frustum, { x: 1500, y: 0, z: 0 }, 1)).toBe(false);
    expect(sphereInsideFrustum(frustum, { x: -50, y: 0, z: 0 }, 100)).toBe(true);
  });

  it("finds a box wholly outside one plane", () => {
    expect(boxOutsideFrustum(frustum, { x: -900, y: -10, z: -10 }, { x: -800, y: 10, z: 10 })).toBe(true);
    expect(boxOutsideFrustum(frustum, { x: 100, y: -10, z: -10 }, { x: 200, y: 10, z: 10 })).toBe(false);
    expect(boxOutsideFrustum(frustum, { x: 100, y: 5000, z: -10 }, { x: 200, y: 6000, z: 10 })).toBe(true);
  });
});

describe("portal walk", () => {
  it("shows the zone through the open portal and never the zone behind the wall", () => {
    const frame = culledFrame(pose(-500));
    expect(zoneSetMembers(frame.visibleZones, model.zoneCount)).toEqual([threeRoomZones.camera, threeRoomZones.throughPortal]);
    expect(frame).toMatchObject({ cameraZone: threeRoomZones.camera, outdoorView: false, openedPortalCount: 1, visibleZoneCount: 2,
      skyZones: [threeRoomZones.behindWall], terrainVisible: false });
    expect([...frame.sectionVisible]).toEqual([1, 0]);
  });

  it("closes the portal when the view turns away from it", () => {
    expect(visibleZones(pose(-500, facingNegativeX))).toEqual([threeRoomZones.camera]);
    expect([...culledFrame(pose(-500, facingNegativeX)).sectionVisible]).toEqual([0, 0]);
    expect(visibleZones(pose(500))).toEqual([threeRoomZones.throughPortal]);
    expect(visibleZones(pose(500, facingNegativeX))).toEqual([threeRoomZones.camera, threeRoomZones.throughPortal]);
  });

  it("bounds the walk by the depth and range rows and runs an unsourced limit at its most-visible value", () => {
    expect(visibleZones(pose(-500), { ...mostVisible, portalDepthCap: 1 })).toEqual([threeRoomZones.camera]);
    expect(visibleZones(pose(-500), { ...mostVisible, portalRange: 300 })).toEqual([threeRoomZones.camera]);
    expect(visibleZones(pose(-500), { ...mostVisible, portalRange: 400 })).toEqual([threeRoomZones.camera, threeRoomZones.throughPortal]);
    expect(committedBspVisibilityRules.limits).toEqual(mostVisible);
    expect(committedBspVisibilityRules.limitRules.map(rule => [rule.id, rule.status]))
      .toEqual([["portal-range", "unknown"], ["portal-depth-cap", "unconfirmed"], ["static-mesh-range", "unknown"], ["emitter-clipping-range", "unconfirmed"]]);
  });

  it("refuses a recipe whose limit row is missing or not a positive number", () => {
    expect(() => parseBspVisibilityRules({ schemaVersion: 1, rows: [] })).toThrow(/has no portal-range row/);
    const rows = ["portal-range", "portal-depth-cap", "static-mesh-range", "emitter-clipping-range"]
      .map(id => ({ id, status: "unconfirmed", runtimeDefault: id === "portal-depth-cap" ? -4 : "infinity" }));
    expect(() => parseBspVisibilityRules({ schemaVersion: 1, rows })).toThrow(/portal-depth-cap runtimeDefault must be/);
  });

  it("uses the outdoor view for a camera in solid space", () => {
    const arrays = threeRoomVisibilityArrays().map(array => array.name === "NODE.leaf" ? { ...array, values: [0, -1, 1, -1, -1, -1, -1, -1, -1, -1] } : array)
      .map(array => array.name === "MEMB.leaves" ? { ...array, values: [0, 1, 1, 1] } : array);
    const payload = threeRoomVisibilityPayload(arrays);
    const solidModel = decodeBspVisibility(payload.assetRecord, payload.payloadBytes);
    const frame = computeTileVisibilityFrame(solidModel, new Map(), pose(2500), true, mostVisible);
    expect(frame).toMatchObject({ cameraLeaf: -1, cameraZone: threeRoomZones.behindWall, outdoorView: true, terrainVisible: true });
    expect(zoneSetMembers(frame.visibleZones, solidModel.zoneCount)).toEqual([threeRoomZones.outside]);
    expect([...frame.sectionVisible]).toEqual([0, 0]);
  });
});

describe("member gating", () => {
  const { emitterInCameraRoom, emitterBehindWall, meshBehindWall, skyMeshBehindWall, unboundedMesh } = threeRoomMembers;

  it("gates map emitters by zone while the emitter range row is infinity", () => {
    const visible = culledFrame(pose(-500)).memberVisible;
    expect(visible[emitterInCameraRoom.member]).toBe(1);
    expect(visible[emitterBehindWall.member]).toBe(0);
    expect(visible[meshBehindWall.member]).toBe(0);
    expect(visible[skyMeshBehindWall.member]).toBe(1);
    expect(visible[unboundedMesh.member]).toBe(1);
  });

  it("applies a finite emitter range on the horizontal distance with a strict test", () => {
    expect(culledFrame(pose(-400), { ...mostVisible, emitterRange: 100 }).memberVisible[emitterInCameraRoom.member]).toBe(0);
    expect(culledFrame(pose(-450), { ...mostVisible, emitterRange: 100 }).memberVisible[emitterInCameraRoom.member]).toBe(1);
  });

  it("keeps every section, member and terrain visible with culling off", () => {
    const frame = computeTileVisibilityFrame(model, new Map(), pose(-500, facingNegativeX), false, mostVisible);
    expect([...frame.sectionVisible]).toEqual([1, 1]);
    expect([...frame.memberVisible]).toEqual([1, 1, 1, 1, 1]);
    expect(frame).toMatchObject({ culling: false, terrainVisible: true, visibleZoneCount: model.zoneCount, cameraZone: threeRoomZones.camera });
  });

  it("orders only the translucent sections that stay visible", () => {
    const ranges = new Map([[threeRoomSections.translucentWalls, Int32Array.from([0, 1])]]);
    expect(computeTileVisibilityFrame(model, ranges, pose(-500), true, mostVisible).translucentOrder.size).toBe(1);
    expect(computeTileVisibilityFrame(model, ranges, pose(-500, facingNegativeX), true, mostVisible).translucentOrder.size).toBe(0);
  });
});
