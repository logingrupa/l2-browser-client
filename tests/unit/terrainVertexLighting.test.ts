import { describe, expect, it } from "vitest";
import {
  terrainIntensitySampleIndex, terrainVertexColour, terrainVertexStaticBase, truncatedTerrainIntensity,
} from "../../src/environment/model/terrainVertexLighting";

const mapSampleCount = 257 * 257;
const blackOpaque = [0, 0, 0, 255] as const;

function mapsWithSample(sampleIndex: number, previousIntensity: number, nextIntensity: number): [Uint8Array, Uint8Array] {
  const previousMap = new Uint8Array(mapSampleCount), nextMap = new Uint8Array(mapSampleCount);
  previousMap[sampleIndex] = previousIntensity;
  nextMap[sampleIndex] = nextIntensity;
  return [previousMap, nextMap];
}

describe("terrain intensity sample (SetInterpolatedIntensityMap 0x1072ccb0)", () => {
  it("indexes the 257-wide TIntMap row by row", () => {
    expect(terrainIntensitySampleIndex(134, 129)).toBe(129 * 257 + 134);
    expect(terrainIntensitySampleIndex(256, 256)).toBe(mapSampleCount - 1);
  });

  it("refuses a sample outside the 257 x 257 map", () => {
    expect(() => terrainIntensitySampleIndex(257, 0)).toThrow(RangeError);
    expect(() => terrainIntensitySampleIndex(0, -1)).toThrow(RangeError);
  });

  it("truncates (1 - t) * previous + t * next toward zero instead of rounding", () => {
    const sampleIndex = terrainIntensitySampleIndex(6, 1);
    expect(truncatedTerrainIntensity(...mapsWithSample(sampleIndex, 57, 156), sampleIndex, 0.5)).toBe(106);
    expect(truncatedTerrainIntensity(...mapsWithSample(sampleIndex, 0, 255), sampleIndex, Math.fround(0.999))).toBe(254);
    expect(truncatedTerrainIntensity(...mapsWithSample(sampleIndex, 213, 156), sampleIndex, 0)).toBe(213);
  });

  it("refuses maps that are not both 257 x 257, where the native blend would leave the colours unchanged", () => {
    expect(() => truncatedTerrainIntensity(new Uint8Array(mapSampleCount), new Uint8Array(17 * 17), 0, 0.5)).toThrow(RangeError);
  });
});

describe("terrain vertex colour (SetIntensityMap 0x10729bc0)", () => {
  it("starts from black alpha 255 and names the gap when a serialized light covers the vertex", () => {
    expect(terrainVertexStaticBase(false)).toEqual({ status: "resolved", value: blackOpaque });
    expect(terrainVertexStaticBase(true)).toEqual({ status: "unresolved", reason: "terrain-general-staticlight-sampleintensity" });
  });

  it("adds FColor(HSVTerrainLight * 0.5 * I / 255) with alpha 0 to TerrainAmbient >> 1 with alpha 255", () => {
    expect(terrainVertexColour(blackOpaque, [1, 0, 0, 1], 255, [255, 0, 0])).toEqual([0, 0, 254, 255]);
    expect(terrainVertexColour(blackOpaque, [0, 0, 1, 1], 0, [0, 0, 101])).toEqual([50, 0, 0, 255]);
  });

  it("scales the light by the truncated intensity before the floor", () => {
    expect(terrainVertexColour(blackOpaque, [1, 1, 1, 1], 106, [0, 0, 0])).toEqual(Array(3).fill(Math.floor(Math.fround(Math.fround(0.5 * Math.fround(106 / 255)) * 255))).concat(255));
  });

  it("saturates each byte when the static base and the light overflow", () => {
    expect(terrainVertexColour([200, 200, 200, 255], [1, 1, 1, 1], 255, [255, 255, 255])).toEqual([255, 255, 255, 255]);
  });
});
