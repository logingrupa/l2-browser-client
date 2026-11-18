import { decodeTileLighting, type TileLightingModel } from "../../src/scene/world/lighting/decodeTileLighting";
import { goldenTypedPayloadMetadata, writeTypedPayloadFixture, type TypedPayloadFixture, type TypedPayloadFixtureArray } from "./typedPayloadFixture";

export const hourSetSlotCount = 8;
const pageRevision = 3;
const pageMipEdges = [8, 4] as const;
const dxt1BytesOfEdge = (edge: number) => (edge / 4) * (edge / 4) * 8;

export function solidDxt1Blocks(edge: number, rgb565: number): number[] {
  const block = [rgb565 & 0xff, rgb565 >> 8, rgb565 & 0xff, rgb565 >> 8, 0, 0, 0, 0];
  return Array.from({ length: dxt1BytesOfEdge(edge) / 8 }, () => block).flat();
}

function pageTexels(rgb565: number): number[] {
  return pageMipEdges.flatMap(edge => solidDxt1Blocks(edge, rgb565));
}

function fieldRecord(field: string, value: unknown, provenance = "authored") {
  return { declaringClass: "Engine.ZoneInfo", field, provenance, value };
}

const fogInfoField = (field: string, value: unknown, provenance = "authored") => ({ declaringClass: "Engine.L2FogInfo", field, provenance, value });
const fogColourKey = (time: number, red: number, green: number, blue: number) => ({ Time: time, FogColor: { R: red, G: green, B: blue, A: 0 } });

export const fogInfo9236FogColourKeys = [fogColourKey(0, 70, 83, 83), fogColourKey(5, 70, 83, 83), fogColourKey(6, 107, 114, 97), fogColourKey(7, 107, 114, 97),
  fogColourKey(19, 107, 114, 97), fogColourKey(20, 107, 114, 97), fogColourKey(23, 116, 112, 95)];

export function fogInfo9236Record() {
  return { exportIndex: 9236, object: "20_21.L2FogInfo46", actorClass: "Engine.L2FogInfo", baseClass: "Engine.L2FogInfo", zone: 1, fields: [
    fogInfoField("AffectRange", { Max: 4000, Min: 3000 }),
    ...[2000, 4000, 6000, 8000, 10000].map((maximum, slot) => fogInfoField(`FogRange${slot + 1}`, { Max: maximum, Min: 0 })),
    fogInfoField("TextureDistance", null, "ue-zero"), fogInfoField("Colors", fogInfo9236FogColourKeys), fogInfoField("CloudTexture", null, "ue-zero"),
    fogInfoField("Location", { X: 28491.390625, Y: 110465.5, Z: -1361.5125732421875 }),
  ] };
}

export function tileLightingRecordsDocument() {
  const zone = (zoneIndex: number, provenance: string, distanceFog: boolean, terrainZone = false) => ({ zoneIndex, unresolved: provenance === "unresolved",
    distanceFog: [fieldRecord("bDistanceFog", provenance === "unresolved" ? null : distanceFog, provenance),
      fieldRecord("bTerrainZone", provenance === "unresolved" ? null : terrainZone, provenance),
      fieldRecord("DistanceFogColor", provenance === "unresolved" ? null : { R: 95, G: 112, B: 116, A: 0 }, provenance),
      fieldRecord("DistanceFogStart", provenance === "unresolved" ? null : 100, provenance),
      fieldRecord("DistanceFogEnd", provenance === "unresolved" ? null : 20000, provenance)],
    sunAffect: fieldRecord("bSunAffect", provenance === "unresolved" ? null : true, provenance === "unresolved" ? provenance : "class-default") });
  return { schemaVersion: 1, kind: "native-tile-lighting-records", lights: [], fogInfos: [fogInfo9236Record()], levelInfos: [], rules: [],
    waterVolumes: [{ exportIndex: 8 }], zones: [zone(0, "unresolved", false), zone(1, "authored", true), zone(2, "authored", false), zone(3, "authored", true, true)] };
}

export function tileLightingArrays(records: unknown = tileLightingRecordsDocument()): TypedPayloadFixtureArray[] {
  const hourPages = Array.from({ length: hourSetSlotCount }, (_, slot) => slot);
  const pageColours = [...hourPages.map(slot => (slot + 1) << 11), 0x07e0];
  const texels = pageColours.flatMap(pageTexels);
  const mipSizes = pageColours.flatMap(() => pageMipEdges.map(dxt1BytesOfEdge));
  const texelStart = mipSizes.reduce<number[]>((starts, size) => [...starts, starts.at(-1)! + size], [0]);
  const json = Array.from(new TextEncoder().encode(JSON.stringify(records)));
  return [
    { name: "LMSC.lightmapTexture", type: "int32", values: [0, 1, -1] },
    { name: "LMSC.polyFlags", type: "uint32", values: [0, 0, 0] },
    { name: "LMTX.recordStart", type: "uint32", values: [0, 1, 2] },
    { name: "LMTX.pageStart", type: "uint32", values: [0, hourSetSlotCount, hourSetSlotCount + 1] },
    { name: "LMPG.texture", type: "int32", values: [...hourPages.map(() => 0), 1] },
    { name: "LMPG.slot", type: "int32", values: [...hourPages, 0] },
    { name: "LMPG.slotCount", type: "int32", values: [...hourPages.map(() => hourSetSlotCount), 1] },
    { name: "LMPG.revision", type: "int32", values: pageColours.map(() => pageRevision) },
    { name: "LMPG.compressedRevision", type: "int32", values: pageColours.map(() => pageRevision) },
    { name: "LMPG.mipEdge", type: "uint32", values: pageColours.flatMap(() => [...pageMipEdges]) },
    { name: "LMPG.texelStart", type: "uint32", values: texelStart },
    { name: "LMPG.texels", type: "uint8", values: texels },
    { name: "LMNR.chunk", type: "int32", values: [0, 0, 0] },
    { name: "LMNR.node", type: "int32", values: [10, 11, 12] },
    { name: "LMNR.primitive", type: "int32", values: [0, 1, 2] },
    { name: "LMNR.firstIndex", type: "int32", values: [0, 0, 0] },
    { name: "LMNR.indexCount", type: "int32", values: [6, 3, 3] },
    { name: "LMNR.sunAffect", type: "int32", values: [1, 0, 0] },
    { name: "LMNR.record", type: "int32", values: [0, 1, -1] },
    { name: "LMNR.texture", type: "int32", values: [0, 1, -1] },
    { name: "LMNR.uvStart", type: "uint32", values: [0, 4, 7, 7] },
    { name: "LMUV.uv", type: "float32", values: [0.25, 0.5, 0.75, 0.5, 0.75, 0.75, 0.25, 0.75, 0.125, 0.125, 0.25, 0.125, 0.25, 0.25] },
    { name: "RECS.canonicalJson", type: "uint8", values: json },
  ];
}

export const sharedSectionSunNode = 10;
export const sharedSectionShelteredNode = 13;

export function sharedSectionArrays(sunAffect: readonly number[] = [1, 0, 0, 0], chunkOrdinal = 0): TypedPayloadFixtureArray[] {
  const nodeRangeArrays: TypedPayloadFixtureArray[] = [
    { name: "LMNR.chunk", type: "int32", values: [chunkOrdinal, chunkOrdinal, chunkOrdinal, chunkOrdinal] },
    { name: "LMNR.node", type: "int32", values: [sharedSectionSunNode, sharedSectionShelteredNode, 11, 12] },
    { name: "LMNR.primitive", type: "int32", values: [0, 0, 1, 2] },
    { name: "LMNR.firstIndex", type: "int32", values: [0, 3, 0, 0] },
    { name: "LMNR.indexCount", type: "int32", values: [3, 3, 3, 3] },
    { name: "LMNR.sunAffect", type: "int32", values: sunAffect },
    { name: "LMNR.record", type: "int32", values: [0, 0, 1, -1] },
    { name: "LMNR.texture", type: "int32", values: [0, 0, 1, -1] },
    { name: "LMNR.uvStart", type: "uint32", values: [0, 3, 6, 9, 9] },
    { name: "LMUV.uv", type: "float32", values: [0.25, 0.5, 0.75, 0.5, 0.75, 0.75, 0.25, 0.75, 0.5, 0.75, 0.5, 0.875, 0.125, 0.125, 0.25, 0.125, 0.25, 0.25] },
  ];
  const replaced = new Map(nodeRangeArrays.map(array => [array.name, array]));
  return tileLightingArrays().map(array => replaced.get(array.name) ?? array);
}

export function tileLightingPayload(arrays: readonly TypedPayloadFixtureArray[] = tileLightingArrays()): TypedPayloadFixture {
  return writeTypedPayloadFixture(arrays, goldenTypedPayloadMetadata);
}

export function tileLightingModel(): TileLightingModel {
  const payload = tileLightingPayload();
  return decodeTileLighting(payload.assetRecord, payload.payloadBytes);
}

export function withoutArray(arrays: readonly TypedPayloadFixtureArray[], name: string): TypedPayloadFixtureArray[] {
  return arrays.filter(array => array.name !== name);
}

export function replaceArray(arrays: readonly TypedPayloadFixtureArray[], name: string, values: readonly number[]): TypedPayloadFixtureArray[] {
  return arrays.map(array => array.name === name ? { ...array, values } : array);
}
