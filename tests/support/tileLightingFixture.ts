import { decodeTileLighting, type TileLightingModel } from "../../src/scene/world/lighting/decodeTileLighting";
import { goldenTypedPayloadMetadata, writeTypedPayloadFixture, type TypedPayloadFixture, type TypedPayloadFixtureArray } from "./typedPayloadFixture";

export const hourSetSlotCount = 8;
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

export function tileLightingRecordsDocument() {
  const zone = (zoneIndex: number, provenance: string, distanceFog: boolean) => ({ zoneIndex, unresolved: provenance === "unresolved",
    distanceFog: [fieldRecord("bDistanceFog", provenance === "unresolved" ? null : distanceFog, provenance),
      fieldRecord("DistanceFogColor", provenance === "unresolved" ? null : { R: 95, G: 112, B: 116, A: 0 }, provenance),
      fieldRecord("DistanceFogStart", provenance === "unresolved" ? null : 100, provenance),
      fieldRecord("DistanceFogEnd", provenance === "unresolved" ? null : 20000, provenance)],
    sunAffect: fieldRecord("bSunAffect", provenance === "unresolved" ? null : true, provenance === "unresolved" ? provenance : "class-default") });
  return { schemaVersion: 1, kind: "native-tile-lighting-records", lights: [], fogInfos: [{ exportIndex: 7 }], levelInfos: [], rules: [],
    waterVolumes: [{ exportIndex: 8 }], zones: [zone(0, "unresolved", false), zone(1, "authored", true), zone(2, "authored", false)],
    environmentProgram: { schemaVersion: 1, kind: "native-environment-program", setup: {}, unresolved: [],
      setupValues: { StartTime: { key: "StartTime", value: 12 }, TimeRatio: { key: "TimeRatio", value: 6 }, TimeEnvFileNum: { key: "TimeEnvFileNum", value: 4 } },
      environmentTypes: [0, 1, 2, 3].map(environmentType => ({ environmentType, sections: [] })) } };
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
    { name: "LMPG.mipEdge", type: "uint32", values: pageColours.flatMap(() => [...pageMipEdges]) },
    { name: "LMPG.texelStart", type: "uint32", values: texelStart },
    { name: "LMPG.texels", type: "uint8", values: texels },
    { name: "LMNR.chunk", type: "int32", values: [0, 0, 0] },
    { name: "LMNR.node", type: "int32", values: [10, 11, 12] },
    { name: "LMNR.primitive", type: "int32", values: [0, 1, 2] },
    { name: "LMNR.firstIndex", type: "int32", values: [0, 0, 0] },
    { name: "LMNR.indexCount", type: "int32", values: [6, 3, 3] },
    { name: "LMNR.record", type: "int32", values: [0, 1, -1] },
    { name: "LMNR.texture", type: "int32", values: [0, 1, -1] },
    { name: "LMNR.uvStart", type: "uint32", values: [0, 4, 7, 7] },
    { name: "LMUV.uv", type: "float32", values: [0.25, 0.5, 0.75, 0.5, 0.75, 0.75, 0.25, 0.75, 0.125, 0.125, 0.25, 0.125, 0.25, 0.25] },
    { name: "RECS.canonicalJson", type: "uint8", values: json },
  ];
}

export function tileLightingPayload(arrays: readonly TypedPayloadFixtureArray[] = tileLightingArrays()): TypedPayloadFixture {
  return writeTypedPayloadFixture(arrays, goldenTypedPayloadMetadata);
}

export function tileLightingModel(): TileLightingModel {
  const payload = tileLightingPayload();
  return decodeTileLighting(payload.assetRecord, payload.payloadBytes);
}

export function replaceArray(arrays: readonly TypedPayloadFixtureArray[], name: string, values: readonly number[]): TypedPayloadFixtureArray[] {
  return arrays.map(array => array.name === name ? { ...array, values } : array);
}
