import { describe, expect, it } from "vitest";
import { bspLightmapSlot } from "../../src/environment/model/bspLightmapSelection";
import { actorAmbientLight, staticMeshAmbientLight } from "../../src/environment/model/meshLightingTerms";
import { nativeDrawLightingStates } from "../../src/environment/model/nativeDrawLightingStates";
import { environmentColour, environmentLightPlane } from "../../src/environment/model/nativeEnvironmentColours";
import type { NativeEnvironmentBlend } from "../../src/environment/model/nativeEnvironmentManager";
import type { BlackStartColourSection, HsvLightSection } from "../../src/environment/model/nativeEnvironmentTypeTables";
import { terrainIntensityMapBlend } from "../../src/environment/model/sampleNativeTimeTables";
import {
  staticMeshHourlyEntryBlend, staticMeshShaderVisibility, staticMeshVertexVisible,
} from "../../src/environment/model/staticMeshHourlyLighting";
import {
  terrainIntensitySampleIndex, terrainVertexColour, terrainVertexStaticBase, truncatedTerrainIntensity,
} from "../../src/environment/model/terrainVertexLighting";
import { readDayNightLoadedTables } from "../support/dayNightFixtures";
import {
  fixtureBoolean, fixtureNumber, fixtureNumbers, readHourlyLightingFixtures, type HourlyLightingFixtureRow,
} from "../support/hourlyLightingFixtures";

const document = readHourlyLightingFixtures();
const { context, fixtures } = document;
const tables = readDayNightLoadedTables();
const fixtureEnvironmentType = 0;
const settledBlend: NativeEnvironmentBlend = { oldType: fixtureEnvironmentType, targetType: fixtureEnvironmentType, weight: 1 };
const terrainSampleColumn = 134, terrainSampleRow = 129;
const terrainMapSampleCount = 257 * 257;
const visibilityVertex = 0;

function resolved<Value>(result: { readonly status: string; readonly value?: Value }): Value {
  if (result.status !== "resolved" || result.value === undefined) throw new Error(`Expected a resolved value, got ${JSON.stringify(result)}.`);
  return result.value;
}

const hourlyColour = (section: BlackStartColourSection, hour: number) => resolved(environmentColour(tables, settledBlend, section, hour));
const hourlyPlane = (section: HsvLightSection, hour: number) => resolved(environmentLightPlane(tables, settledBlend, section, hour));

function expectBitExact(actual: readonly number[], expected: readonly number[]): void {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((value, index) => expect(Object.is(value, expected[index]), `component ${index}`).toBe(true));
}

function terrainMapWithSample(intensity: number): Uint8Array {
  const map = new Uint8Array(terrainMapSampleCount);
  map[terrainIntensitySampleIndex(terrainSampleColumn, terrainSampleRow)] = intensity;
  return map;
}

function rowsOf(predicate: (row: HourlyLightingFixtureRow) => boolean) {
  return fixtures.filter(predicate).map(row => [`${row.surfaceType} ${row.status ?? row.controlWord ?? ""} hour ${row.hour}`, row] as const);
}

const terrainRows = rowsOf(row => row.surfaceType === "terrain");
const bspRows = rowsOf(row => row.surfaceType === "BSP");
const staticAmbientRows = rowsOf(row => row.surfaceType === "staticMesh" && row.status === "conditional-input-fixture");
const staticSunTermRows = rowsOf(row => row.surfaceType === "staticMesh" && row.status === "synthetic-arithmetic-fixture");
const staticVisibilityRows = rowsOf(row => row.surfaceType === "staticMesh" && row.status === "conditional-authored-input-fixture");
const actorRows = rowsOf(row => row.surfaceType === "actor");
const reproducedRowGroups = [terrainRows, bspRows, staticAmbientRows, staticSunTermRows, staticVisibilityRows, actorRows];

describe("DB-7 hourly lighting fixtures through the pure lighting model", () => {
  it("holds the 32 rows the claim audit recomputed, pinned by their source sha256", () => {
    expect(fixtures).toHaveLength(32);
    expect(document.source.composition.sha256).toBe("f0a6eb0f106be32fa9b4b58f1ea5868eb3f5d5a394ef5c0696016ac8ab6dee3c");
    expect(document.source.replayResult).toMatchObject({ sha256: "7a0b2e2f73e9b199e8f47a63773e3f7d82b9202b4c57a93741ad71c52206a787", checked: 32, matched: 32 });
    expect(fixtures.map(row => row.surfaceType).reduce<Record<string, number>>((counts, surface) => ({ ...counts, [surface]: (counts[surface] ?? 0) + 1 }), {}))
      .toEqual({ terrain: 12, BSP: 4, staticMesh: 12, actor: 4 });
  });

  it.each(terrainRows)("reproduces %s from the TIntMap keys and the DB-4 tables", (_, row) => {
    const { input, output, hour } = row;
    const blend = terrainIntensityMapBlend(context.tIntMapTimes, hour);
    expect([blend.index, blend.nextIndex]).toEqual(fixtureNumbers(input, "mapIndices"));
    expect(Object.is(blend.weight, fixtureNumber(input, "weight"))).toBe(true);
    const fromKey = context.tIntMapTimes[blend.index]!, nextKey = context.tIntMapTimes[blend.nextIndex]!;
    expect([fromKey, nextKey < fromKey ? nextKey + 24 : nextKey]).toEqual(fixtureNumbers(input, "times"));
    const intensities = [context.tIntMapSample134x129[blend.index]!, context.tIntMapSample134x129[blend.nextIndex]!];
    expect(intensities).toEqual(fixtureNumbers(input, "intensities"));
    const truncated = truncatedTerrainIntensity(terrainMapWithSample(intensities[0]!), terrainMapWithSample(intensities[1]!),
      terrainIntensitySampleIndex(terrainSampleColumn, terrainSampleRow), blend.weight);
    expect(truncated).toBe(fixtureNumber(input, "truncatedIntensity"));
    const ambient = hourlyColour("TerrainAmbient", hour), plane = hourlyPlane("HSVTerrainLight", hour);
    expect(ambient).toEqual(fixtureNumbers(input, "TerrainAmbientRGB"));
    expectBitExact(plane, fixtureNumbers(input, "HSVTerrainLight"));
    const litBySerializedLight = context.terrainLightMaskBit23.some(([, leastSignificantFirst, mostSignificantFirst]) => leastSignificantFirst === 1 || mostSignificantFirst === 1);
    const staticBase = resolved(terrainVertexStaticBase(litBySerializedLight));
    expect(staticBase.slice(0, 3)).toEqual(fixtureNumbers(input, "staticLightBaseRGB"));
    const colour = terrainVertexColour(staticBase, plane, truncated, ambient);
    expect(colour).toEqual(fixtureNumbers(output, "vertexBGRA"));
    expect([colour[2], colour[1], colour[0]]).toEqual(fixtureNumbers(output, "vertexRGB"));
  });

  it.each(bspRows)("reproduces %s atlas 0 slot and its BSPAmbient input", (_, row) => {
    const { input, output, hour } = row;
    const childCount = context.atlasChildCounts[0]!;
    expect(childCount).toBe(fixtureNumber(input, "atlasCount"));
    expect(bspLightmapSlot(hour, childCount, fixtureBoolean(input, "bSunAffect"))).toBe(fixtureNumber(output, "selectedAtlasChild"));
    const ambient = hourlyColour("BSPAmbient", hour);
    expect(ambient).toEqual(fixtureNumbers(input, "GetBSPAmbientColorRGB"));
    expect(nativeDrawLightingStates.bsp).toMatchObject({ deviceLighting: false, colourVertex: false, ambientSource: "baked-into-compressed-lightmap" });
  });

  it.each(staticAmbientRows)(
    "reproduces %s as StaticMeshAmbient >> 1 for an actor with a static mesh instance", (_, row) => {
      const { input, output, hour } = row;
      const ambient = hourlyColour("StaticMeshAmbient", hour), plane = hourlyPlane("HSVStaticMeshLight", hour);
      expect(ambient).toEqual(fixtureNumbers(input, "hourlyAmbientRGB"));
      expectBitExact(plane, fixtureNumbers(input, "hourlyStaticSunPlane"));
      const light = resolved(staticMeshAmbientLight({ hourlyAmbient: ambient, actorSunAffect: fixtureBoolean(input, "assumedEnvironmentGate"),
        selectedLevelOfDetail: 0, hasStaticMeshInstance: true, staticSunPlane: plane }));
      expect(light).toEqual([...fixtureNumbers(output, "ambientRGB"), fixtureNumber(output, "alpha")]);
    });

  it.each(staticSunTermRows)(
    "reproduces %s with the LOD 2 sun term for an actor without a static mesh instance", (_, row) => {
      const { input, output, hour } = row;
      const ambient = hourlyColour("StaticMeshAmbient", hour), plane = hourlyPlane("HSVStaticMeshLight", hour);
      expect(ambient).toEqual(fixtureNumbers(input, "ambientRGB"));
      expectBitExact(plane, fixtureNumbers(input, "sunPlane"));
      const light = resolved(staticMeshAmbientLight({ hourlyAmbient: ambient, actorSunAffect: true, selectedLevelOfDetail: 2,
        hasStaticMeshInstance: false, staticSunPlane: plane }));
      expect(light).toEqual([...fixtureNumbers(output, "ambientRGB"), fixtureNumber(output, "alpha")]);
    });

  it.each(staticVisibilityRows)(
    "reproduces %s G_12 vertex 0 shader visibility from the eight hourly masks", (_, row) => {
      const { input, output, hour } = row;
      const masks = context.staticHourlyVertex0Bits.map(bit => Uint8Array.of(bit));
      const blend = staticMeshHourlyEntryBlend(masks.length, hour);
      expect([blend.index, blend.nextIndex]).toEqual([fixtureNumber(input, "previousTimeIndex"), fixtureNumber(input, "nextTimeIndex")]);
      expect(Object.is(blend.weight, fixtureNumber(input, "weight"))).toBe(true);
      const previousVisible = staticMeshVertexVisible(masks[blend.index]!, visibilityVertex), nextVisible = staticMeshVertexVisible(masks[blend.nextIndex]!, visibilityVertex);
      expect([Number(previousVisible), Number(nextVisible)]).toEqual([fixtureNumber(input, "previousVisible"), fixtureNumber(input, "nextVisible")]);
      expect(Object.is(staticMeshShaderVisibility(previousVisible, nextVisible, blend.weight), fixtureNumber(output, "shaderVisibilityFloat"))).toBe(true);
    });

  it.each(actorRows)("reproduces %s as ActorAmbient >> 1 with alpha 255", (_, row) => {
    const { input, output, hour } = row;
    const ambient = hourlyColour("ActorAmbient", hour);
    expect(ambient).toEqual(fixtureNumbers(input, "hourlyAmbientRGB"));
    expect(resolved(actorAmbientLight(ambient, fixtureBoolean(input, "assumedEnvironmentGate"))))
      .toEqual([...fixtureNumbers(output, "ambientRGB"), fixtureNumber(output, "alpha")]);
  });

  it("reproduces every row in exactly one group: 12 terrain, 4 BSP, 4 + 4 + 4 static mesh and 4 actor", () => {
    expect(reproducedRowGroups.map(group => group.length)).toEqual([12, 4, 4, 4, 4, 4]);
    expect(new Set(reproducedRowGroups.flatMap(group => group.map(([, row]) => row.index))).size).toBe(32);
  });
});
