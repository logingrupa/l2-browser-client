import { decodeBspVisibility, type BspVisibilityModel } from "../../src/scene/world/bspVisibility/core/decodeBspVisibility";
import { goldenTypedPayloadMetadata, writeTypedPayloadFixture, type TypedPayloadFixture, type TypedPayloadFixtureArray } from "./typedPayloadFixture";

export const threeRoomZones = { outside: 0, camera: 1, throughPortal: 2, behindWall: 3 } as const;
export const threeRoomSections = { translucentWalls: 0, behindWallFloor: 1 } as const;
export const threeRoomMembers = {
  emitterInCameraRoom: { member: 0, exportIndex: 100 },
  emitterBehindWall: { member: 1, exportIndex: 101 },
  meshBehindWall: { member: 2, exportIndex: 200 },
  skyMeshBehindWall: { member: 3, exportIndex: 201 },
  unboundedMesh: { member: 4, exportIndex: 202 },
} as const;
export const threeRoomPortalX = 0;
export const threeRoomWallX = 1000;

const zoneBit = (zone: number) => 2 ** zone;
const allZoneWords = [0xffffffff, 0xffffffff];
const zoneWords = (...zones: number[]) => [zones.reduce((set, zone) => set | zoneBit(zone), 0) >>> 0, 0];

export function threeRoomVisibilityArrays(): TypedPayloadFixtureArray[] {
  const { outside, camera, throughPortal, behindWall } = threeRoomZones;
  return [
    { name: "NODE.plane", type: "float32", values: [1, 0, 0, threeRoomPortalX, 1, 0, 0, threeRoomWallX, 1, 0, 0, threeRoomPortalX, 1, 0, 0, threeRoomWallX,
      1, 0, 0, 2000] },
    { name: "NODE.front", type: "int32", values: [1, 4, -1, -1, -1] },
    { name: "NODE.back", type: "int32", values: [-1, -1, -1, -1, -1] },
    { name: "NODE.coplanar", type: "int32", values: [2, 3, -1, -1, -1] },
    { name: "NODE.leaf", type: "int32", values: [0, -1, 1, -1, -1, -1, -1, -1, 2, 3] },
    { name: "NODE.zone", type: "uint8", values: [camera, throughPortal, throughPortal, behindWall, camera, throughPortal, throughPortal, behindWall,
      behindWall, behindWall] },
    { name: "NODE.zoneSet", type: "uint32", values: [...zoneWords(camera, throughPortal, behindWall), ...zoneWords(throughPortal, behindWall), 0, 0, 0, 0,
      ...zoneWords(behindWall)] },
    { name: "NODE.renderBound", type: "int32", values: [-1, -1, -1, -1, 0] },
    { name: "NODE.sphere", type: "float32", values: [0, 0, 0, 100, 1000, 0, 0, 100, 0, 0, 0, 100, 1000, 0, 0, 100, 2000, 0, 0, 100] },
    { name: "BNDS.box", type: "float32", values: [1500, -100, -100, 2500, 100, 100] },
    { name: "BNDS.valid", type: "uint8", values: [1] },
    { name: "LEAF.zone", type: "uint8", values: [camera, throughPortal, behindWall, behindWall] },
    { name: "LEAF.pvs", type: "uint32", values: [...allZoneWords, ...allZoneWords, ...allZoneWords, ...allZoneWords] },
    { name: "ZONE.connectivity", type: "uint32", values: [...zoneWords(outside), ...zoneWords(camera, throughPortal), ...zoneWords(camera, throughPortal, behindWall),
      ...zoneWords(throughPortal, behindWall)] },
    { name: "ZONE.visibility", type: "uint32", values: [0, 0, 0, 0, 0, 0, 0, 0] },
    { name: "ZONE.class", type: "uint8", values: [9, 0, 0, 2] },
    { name: "PORT.node", type: "int32", values: [0] },
    { name: "RNGE.chunk", type: "int32", values: [0, 0, 1] },
    { name: "RNGE.node", type: "int32", values: [2, 3, 4] },
    { name: "RNGE.primitive", type: "int32", values: [0, 0, 0] },
    { name: "RNGE.firstIndex", type: "int32", values: [0, 3, 0] },
    { name: "RNGE.indexCount", type: "int32", values: [3, 3, 3] },
    { name: "MEMB.kind", type: "uint8", values: [1, 1, 0, 0, 0] },
    { name: "MEMB.exportIndex", type: "int32", values: [100, 101, 200, 201, 202] },
    { name: "MEMB.flags", type: "uint8", values: [0, 0, 0, 1, 2] },
    { name: "MEMB.center", type: "float32", values: [-500, 0, 0, 1500, 0, 0, 1500, 0, 0, 1500, 0, 0, 0, 0, 0] },
    { name: "MEMB.zoneSet", type: "uint32", values: [...zoneWords(camera), ...zoneWords(behindWall), ...zoneWords(behindWall), ...zoneWords(behindWall), 0, 0] },
    { name: "MEMB.leafStart", type: "uint32", values: [0, 1, 2, 3, 4, 4] },
    { name: "MEMB.leaves", type: "int32", values: [0, 2, 2, 2] },
  ];
}

export function threeRoomVisibilityPayload(arrays: readonly TypedPayloadFixtureArray[] = threeRoomVisibilityArrays()): TypedPayloadFixture {
  return writeTypedPayloadFixture(arrays, goldenTypedPayloadMetadata);
}

export function threeRoomVisibilityModel(): BspVisibilityModel {
  const payload = threeRoomVisibilityPayload();
  return decodeBspVisibility(payload.assetRecord, payload.payloadBytes);
}
