import { describe, expect, it } from "vitest";
import { decodeTileLighting } from "../../src/scene/world/lighting/decodeTileLighting";
import {
  probeColumn, probeRow, readConverterExpectations, staticMeshLightListArrays, staticMeshOrdinaryInputArrays, staticMeshSunAffectArray, terrainIntensityArrays,
  terrainLightMaskArrays, terrainMapEdge,
} from "../support/hourlyLightingInputsFixture";
import { maskBytes, readStaticMeshLightingFixtures } from "../support/staticMeshLightingFixtures";
import { readHourlyLightingFixtures } from "../support/hourlyLightingFixtures";
import { replaceArray, tileLightingArrays, tileLightingPayload } from "../support/tileLightingFixture";
import type { TypedPayloadFixtureArray } from "../support/typedPayloadFixture";

function decodedHourly(arrays: readonly TypedPayloadFixtureArray[]) {
  const payload = tileLightingPayload(arrays);
  return decodeTileLighting(payload.assetRecord, payload.payloadBytes).hourly;
}

const restagedArrays = () => [...tileLightingArrays(), ...terrainIntensityArrays(), ...terrainLightMaskArrays([0, 0, 0]), ...staticMeshLightListArrays()];

describe("decodeHourlyLightingInputs", () => {
  it("reads the node range sun affect, page footer, TIntMap, terrain light masks and static mesh hourly masks of a restaged payload", () => {
    const hourly = decodedHourly(restagedArrays());
    const { context } = readHourlyLightingFixtures();
    expect(hourly.nodeRangeSunAffect).toEqual({ status: "staged", value: new Int32Array([1, 0, 0]) });
    expect(hourly.pageRevisions.status).toBe("staged");
    if (hourly.terrainIntensityMaps.status !== "staged") throw new Error("TIntMap not staged");
    const { times, width, height, maps } = hourly.terrainIntensityMaps.value;
    expect({ times, width, height, mapCount: maps.length }).toEqual({ times: context.tIntMapTimes, width: terrainMapEdge, height: terrainMapEdge, mapCount: 8 });
    expect(maps.map(map => map[probeRow * terrainMapEdge + probeColumn])).toEqual(context.tIntMapSample134x129);
    expect(hourly.terrainLightMasks).toEqual({ status: "staged", value: { sectorCount: 1, lightCount: 1, lightsCoveringAVertex: 0 } });
    if (hourly.staticMeshLightLists.status !== "staged") throw new Error("static mesh light lists not staged");
    const { instance, mesh } = readConverterExpectations().staticMesh;
    const list = hourly.staticMeshLightLists.value.get(instance.actorExportIndex)!;
    expect(list).toMatchObject({ instanceExportIndex: instance.instanceExportIndex, vertexCount: mesh.vertexCount });
    expect(list.hourlyMasks.map(mask => mask.visibility[0]! & 1)).toEqual(context.staticHourlyVertex0Bits);
    expect(list.ordinaryMasks).toEqual([]);
    expect(list.sunAffect).toEqual({ status: "unstaged", reason: "hourly-lighting-input-unstaged:SMLL.sunAffect" });
    expect(list.ordinaryInputs).toEqual({ status: "unstaged", reason: "hourly-lighting-input-unstaged:SMLL.ordinaryInputsResolved" });
  });

  it("reads each light list's ScaleGlow and float32 LocalToWorld and names a list whose ordinary inputs did not resolve", () => {
    const hourly = decodedHourly([...restagedArrays(), ...staticMeshOrdinaryInputArrays()]);
    if (hourly.staticMeshLightLists.status !== "staged") throw new Error("static mesh light lists not staged");
    const { pillar, fixtures } = readStaticMeshLightingFixtures();
    expect(hourly.staticMeshLightLists.value.get(pillar.actorExportIndex)!.ordinaryInputs).toEqual(
      { status: "staged", value: { scaleGlow: 1, localToWorld: Float32Array.from(fixtures[0]!.matrix) } });
    expect(hourly.staticMeshLightLists.value.get(readConverterExpectations().staticMesh.instance.actorExportIndex)!.ordinaryInputs).toEqual(
      { status: "unstaged", reason: "static-mesh-ordinary-inputs-unresolved" });
  });

  it("keeps each ordinary light mask with its light reference and reads SMLL.sunAffect when staged", () => {
    const hourly = decodedHourly([...restagedArrays(), staticMeshSunAffectArray]);
    if (hourly.staticMeshLightLists.status !== "staged") throw new Error("static mesh light lists not staged");
    const { pillar } = readStaticMeshLightingFixtures();
    const list = hourly.staticMeshLightLists.value.get(pillar.actorExportIndex)!;
    expect(list.ordinaryMasks).toEqual(pillar.ordinaryMasks.map(mask => ({ light: mask.light, visibility: maskBytes(mask.maskHex) })));
    expect(list.sunAffect).toEqual({ status: "staged", value: 1 });
    expect(hourly.staticMeshLightLists.value.get(readConverterExpectations().staticMesh.instance.actorExportIndex)!.sunAffect)
      .toEqual({ status: "staged", value: -1 });
  });

  it("counts a terrain light that covers at least one vertex", () => {
    expect(decodedHourly([...tileLightingArrays(), ...terrainLightMaskArrays([0, 0x80, 0])]).terrainLightMasks)
      .toMatchObject({ status: "staged", value: { lightsCoveringAVertex: 1 } });
  });

  it("names each input a payload converted before DB-7 lacks instead of failing the tile", () => {
    const hourly = decodedHourly(tileLightingArrays().filter(array => array.name !== "LMNR.sunAffect" && !array.name.startsWith("LMPG.rev")));
    expect(hourly).toEqual({
      nodeRangeSunAffect: { status: "unstaged", reason: "hourly-lighting-input-unstaged:LMNR.sunAffect" },
      pageRevisions: { status: "unstaged", reason: "hourly-lighting-input-unstaged:LMPG.revision" },
      terrainIntensityMaps: { status: "unstaged", reason: "hourly-lighting-input-unstaged:TINT.time" },
      terrainLightMasks: { status: "unstaged", reason: "hourly-lighting-input-unstaged:TSEC.exportIndex" },
      staticMeshLightLists: { status: "unstaged", reason: "hourly-lighting-input-unstaged:SMLL.actorExportIndex" },
      lightmapRebuild: { status: "unstaged", reason: "hourly-lighting-input-unstaged:LMTX.rebuildInputs" },
      lightActors: { lights: [], levelInfos: [] },
    });
  });

  it.each<[string, TypedPayloadFixtureArray[], RegExp]>([
    ["a sun affect value outside -1, 0 and 1", replaceArray(restagedArrays(), "LMNR.sunAffect", [1, 2, 0]), /LMNR.sunAffect\[1\] = 2 is not -1, 0 or 1/],
    ["a sun affect count that differs from the node ranges", replaceArray(restagedArrays(), "LMNR.sunAffect", [1, 0]),
      /LMNR.sunAffect holds 2 values for 3 lightmap node ranges/],
    ["page revisions that miss a page", replaceArray(restagedArrays(), "LMPG.revision", [3]), /LMPG.revision and LMPG.compressedRevision hold 1 and 9/],
    ["map times that do not ascend", replaceArray(restagedArrays(), "TINT.time", [1.5, 1.5, 7.5, 10.5, 13.5, 16.5, 19.5, 22.5]), /TINT.time must ascend/],
    ["intensity samples that are not whole maps", replaceArray(restagedArrays(), "TINT.width", [256]), /TINT.intensity holds/],
    ["a static mesh mask shorter than its vertices", replaceArray(restagedArrays(), "SMLL.colorCount", [33, 36]), /covers 32 of 33 vertices/],
    ["an ordinary light mask shorter than its vertices", replaceArray(restagedArrays(), "SMSC.bitStart", [0, 4, 10]),
      /ordinary light mask 0 covers 32 of 36 vertices/],
    ["a sun affect value outside -1, 0 and 1 on a light list", [...restagedArrays(), { ...staticMeshSunAffectArray, values: [1, 3] }],
      /SMLL.sunAffect\[1\] = 3 is not -1, 0 or 1/],
    ["a sun affect count that differs from the light lists", [...restagedArrays(), { ...staticMeshSunAffectArray, values: [1] }],
      /SMLL.sunAffect holds 1 values for 2 static mesh light lists/],
    ["an ordinary input flag outside 0 and 1", replaceArray([...restagedArrays(), ...staticMeshOrdinaryInputArrays()], "SMLL.ordinaryInputsResolved", [0, 2]),
      /SMLL.ordinaryInputsResolved\[1\] = 2 is not 0 or 1/],
    ["a LocalToWorld that misses a light list", replaceArray([...restagedArrays(), ...staticMeshOrdinaryInputArrays()], "SMLL.localToWorld",
      new Array<number>(16).fill(0)), /hold 2, 2 and 16 values for 2 static mesh light lists/],
    ["a resolved LocalToWorld that is not affine", replaceArray([...restagedArrays(), ...staticMeshOrdinaryInputArrays()], "SMLL.localToWorld",
      new Array<number>(32).fill(0)), /SMLL.localToWorld of static mesh light list 1 is not an affine row-major matrix/],
  ])("refuses %s", (_, arrays, message) => {
    expect(() => decodedHourly(arrays)).toThrow(message);
  });
});
