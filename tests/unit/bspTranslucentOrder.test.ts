import { describe, expect, it } from "vitest";
import { TypedPayloadError } from "../../src/shared/typedPayload";
import { BspVisibilityDecodeError, decodeBspVisibility } from "../../src/scene/world/bspVisibility/core/decodeBspVisibility";
import { locateZone } from "../../src/scene/world/bspVisibility/core/locateZone";
import { createTileVisibilityFrameSource, translucentSectionRangesOf } from "../../src/scene/world/bspVisibility/core/tileVisibilityFrame";
import { orderTranslucentSections } from "../../src/scene/world/bspVisibility/core/translucentOrder";
import type { ViewPose } from "../../src/scene/world/bspVisibility/core/viewFrustum";
import {
  threeRoomPortalX, threeRoomSections, threeRoomVisibilityArrays, threeRoomVisibilityModel, threeRoomVisibilityPayload, threeRoomWallX, threeRoomZones,
} from "../support/bspVisibilityFixture";
import type { TypedPayloadFixtureArray } from "../support/typedPayloadFixture";

const mostVisibleLimits = { portalRange: Infinity, portalDepthCap: Infinity, staticMeshRange: Infinity, emitterRange: Infinity };
const at = (x: number) => ({ x, y: 0, z: 0 });
const poseAt = (x: number): ViewPose => ({ position: at(x), forward: { x: 1, y: 0, z: 0 }, up: { x: 0, y: 0, z: 1 }, verticalFieldOfView: Math.PI / 3,
  aspectRatio: 2, near: 10, far: Infinity });

function replaceArray(name: string, values: number[]): TypedPayloadFixtureArray[] {
  return threeRoomVisibilityArrays().map(array => array.name === name ? { ...array, values } : array);
}

function decodeArrays(arrays: readonly TypedPayloadFixtureArray[]) {
  const payload = threeRoomVisibilityPayload(arrays);
  return decodeBspVisibility(payload.assetRecord, payload.payloadBytes);
}

describe("decodeBspVisibility", () => {
  it("decodes the three-room resource with one section per chunk primitive", () => {
    const model = threeRoomVisibilityModel();
    expect(model).toMatchObject({ nodeCount: 5, leafCount: 4, zoneCount: 4 });
    expect([...model.sections.chunk]).toEqual([0, 1]);
    expect([...model.nodeRange]).toEqual([-1, -1, 0, 1, 2]);
    expect(model.members.count).toBe(5);
  });

  it("refuses a resource whose counts disagree", () => {
    expect(() => decodeArrays(replaceArray("NODE.back", [-1, -1, -1, -1]))).toThrow(BspVisibilityDecodeError);
    expect(() => decodeArrays(replaceArray("NODE.back", [-1, -1, -1, -1]))).toThrow(/NODE\.back holds 4 values; the counts need 5/);
    expect(() => decodeArrays(replaceArray("MEMB.leafStart", [0, 1, 2, 3, 4]))).toThrow(/MEMB\.leafStart holds 5 values/);
  });

  it("refuses a resource whose units are not source", () => {
    const payload = threeRoomVisibilityPayload();
    expect(() => decodeBspVisibility({ ...payload.assetRecord, units: "metres" }, payload.payloadBytes)).toThrow(TypedPayloadError);
  });

  it("refuses an index outside its table and a node graph that is not a tree", () => {
    expect(() => decodeArrays(replaceArray("NODE.front", [1, 4, -1, -1, 5]))).toThrow(/NODE\.front\[4\] = 5 is outside/);
    expect(() => decodeArrays(replaceArray("NODE.front", [1, 4, -1, -1, 0]))).toThrow(/node 0 is reached twice/);
    expect(() => decodeArrays(replaceArray("LEAF.zone", [1, 2, 3, 4]))).toThrow(/LEAF\.zone\[3\] = 4 is not below 4/);
    expect(() => decodeArrays(replaceArray("RNGE.node", [2, 2, 4]))).toThrow(/node 2 has two index ranges/);
  });
});

describe("locateZone", () => {
  const model = threeRoomVisibilityModel();

  it("sends a point exactly on a plane to the front child", () => {
    expect(locateZone(model, at(threeRoomPortalX))).toEqual({ leaf: 1, zone: threeRoomZones.throughPortal });
    expect(locateZone(model, at(threeRoomWallX))).toEqual({ leaf: 2, zone: threeRoomZones.behindWall });
  });

  it("finds the zone of each room", () => {
    expect(locateZone(model, at(-500)).zone).toBe(threeRoomZones.camera);
    expect(locateZone(model, at(500)).zone).toBe(threeRoomZones.throughPortal);
    expect(locateZone(model, at(1500)).zone).toBe(threeRoomZones.behindWall);
  });

  it("returns the last node's leaf on the point's side even when that leaf is INDEX_NONE, as UModel::PointRegion does", () => {
    const solidFront = decodeArrays(replaceArray("NODE.leaf", [0, -1, 1, -1, -1, -1, -1, -1, 2, -1]));
    expect(locateZone(solidFront, at(2500))).toEqual({ leaf: -1, zone: threeRoomZones.behindWall });
  });

  it("takes the zone from the last node's side rather than from the leaf", () => {
    const { camera, throughPortal, behindWall } = threeRoomZones;
    const leafZoneDiffers = decodeArrays(replaceArray("LEAF.zone", [camera, throughPortal, camera, behindWall]));
    expect(locateZone(leafZoneDiffers, at(1500))).toEqual({ leaf: 2, zone: behindWall });
  });
});

describe("translucentOrder", () => {
  const model = threeRoomVisibilityModel();
  const translucentRanges = translucentSectionRangesOf(model, [threeRoomSections.translucentWalls]);
  const drawnNodes = (cameraX: number) =>
    [...orderTranslucentSections(model, at(cameraX), translucentRanges).get(threeRoomSections.translucentWalls)!].map(range => model.ranges.node[range]);

  it("sorts two translucent node ranges of one section back to front for a camera on either side", () => {
    expect(drawnNodes(-500)).toEqual([3, 2]);
    expect(drawnNodes(2000)).toEqual([2, 3]);
    expect(drawnNodes(800)).toEqual([2, 3]);
  });

  it("orders nothing when the tile has no translucent section", () => {
    expect(orderTranslucentSections(model, at(-500), new Map()).size).toBe(0);
  });

  it("draws a coplanar chain from its last member back to its head for a camera on either side", () => {
    const chainModel = decodeArrays(replaceArray("RNGE.node", [0, 2, 4]));
    const chainRanges = translucentSectionRangesOf(chainModel, [threeRoomSections.translucentWalls]);
    const chainNodes = (cameraX: number) =>
      [...orderTranslucentSections(chainModel, at(cameraX), chainRanges).get(threeRoomSections.translucentWalls)!].map(range => chainModel.ranges.node[range]);
    expect(chainNodes(-500)).toEqual([2, 0]);
    expect(chainNodes(2000)).toEqual([2, 0]);
  });
});

describe("tile visibility frame source", () => {
  it("reports the camera zone, every zone visible while culling is off, and reuses a frame for an unchanged float32 pose", () => {
    const model = threeRoomVisibilityModel();
    const source = createTileVisibilityFrameSource(model, mostVisibleLimits);
    source.setTranslucentSections([threeRoomSections.translucentWalls]);
    const first = source.frame(poseAt(-500), false);
    expect(first).toMatchObject({ culling: false, cameraZone: threeRoomZones.camera, visibleZoneCount: 4, skyZones: [threeRoomZones.behindWall] });
    expect([...first.sectionVisible]).toEqual([1, 1]);
    expect(source.frame(poseAt(-500 + 1e-9), false)).toBe(first);
    expect(source.frame(poseAt(500), false).cameraZone).toBe(threeRoomZones.throughPortal);
    expect({ computed: source.computedFrameCount, hits: source.cacheHitCount }).toEqual({ computed: 2, hits: 1 });
  });

  it("orders only the translucent sections it was given and recomputes the frame when that set changes", () => {
    const model = threeRoomVisibilityModel();
    const source = createTileVisibilityFrameSource(model, mostVisibleLimits);
    expect(source.frame(poseAt(-500), false).translucentOrder.size).toBe(0);
    source.setTranslucentSections([threeRoomSections.translucentWalls]);
    const withTranslucentWalls = source.frame(poseAt(-500), false);
    expect([...withTranslucentWalls.translucentOrder.keys()]).toEqual([threeRoomSections.translucentWalls]);
    source.setTranslucentSections([]);
    expect(source.frame(poseAt(-500), false).translucentOrder.size).toBe(0);
    expect(source.computedFrameCount).toBe(3);
  });
});
