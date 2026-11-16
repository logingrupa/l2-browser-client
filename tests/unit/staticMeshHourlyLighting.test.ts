import { describe, expect, it } from "vitest";
import {
  staticMeshCpuEntryScale, staticMeshCpuVertexContribution, staticMeshHourKey, staticMeshHourlyEntryBlend, staticMeshHourlyPath,
  staticMeshInstanceColourWithAuthored, staticMeshPreviousEntryIndex, staticMeshShaderVisibility, staticMeshVertexVisible,
} from "../../src/environment/model/staticMeshHourlyLighting";

const keysOf = (entryCount: number) => Array.from({ length: entryCount }, (_, index) => staticMeshHourKey(index, entryCount));

describe("static mesh hour keys (0x106f4010) and entry selection (0x106f40d0)", () => {
  it("places key i of n at 24 * (i + 0.5) / n", () => {
    expect(keysOf(8)).toEqual([1.5, 4.5, 7.5, 10.5, 13.5, 16.5, 19.5, 22.5]);
    expect(keysOf(3)).toEqual([4, 12, 20]);
    expect(keysOf(1)).toEqual([12]);
  });

  it("takes the last key not above the hour, else the last entry", () => {
    expect([0, 1.4999, 1.5, 6, 22.5, 23.99].map(hour => staticMeshPreviousEntryIndex(8, hour))).toEqual([7, 7, 0, 1, 7, 7]);
    expect(() => staticMeshPreviousEntryIndex(0, 1)).toThrow(RangeError);
  });

  it("unwraps the next key and the hour by 24 and weighs between them", () => {
    expect(staticMeshHourlyEntryBlend(8, 0)).toEqual({ index: 7, nextIndex: 0, weight: 0.5 });
    expect(staticMeshHourlyEntryBlend(8, 1.5)).toEqual({ index: 0, nextIndex: 1, weight: 0 });
    expect(staticMeshHourlyEntryBlend(8, 3.75)).toEqual({ index: 0, nextIndex: 1, weight: 0.75 });
    expect(staticMeshHourlyEntryBlend(3, 2)).toEqual({ index: 2, nextIndex: 0, weight: Math.fround(6 / 8) });
  });
});

describe("static mesh shader visibility (0x10678b80)", () => {
  it("reads vertex bits least significant first within each mask byte", () => {
    const mask = Uint8Array.of(0b0000_0010, 0b1000_0000);
    expect([0, 1, 8, 15].map(vertex => staticMeshVertexVisible(mask, vertex))).toEqual([false, true, false, true]);
    expect(() => staticMeshVertexVisible(mask, 16)).toThrow(RangeError);
  });

  it("sums (1 - w) for the previous entry and w for the next, storing float32 after each add", () => {
    expect(staticMeshShaderVisibility(true, false, 0.5)).toBe(0.5);
    expect(staticMeshShaderVisibility(false, true, 0.25)).toBe(0.25);
    expect(staticMeshShaderVisibility(true, true, 0.25)).toBe(1);
    expect(staticMeshShaderVisibility(false, false, 0.25)).toBe(0);
    expect(staticMeshShaderVisibility(true, false, 2 ** -30)).toBe(1);
  });

  it("takes the shader path only when the actor flag and GL2Shader are both set", () => {
    expect(staticMeshHourlyPath(true, true)).toBe("shader-visibility");
    expect(staticMeshHourlyPath(true, false)).toBe("cpu-rebuild");
    expect(staticMeshHourlyPath(false, true)).toBe("cpu-rebuild");
  });
});

describe("static mesh CPU rebuild arithmetic (0x10679960)", () => {
  it("scales each entry by float32((1 - w) or w times 0.5)", () => {
    expect(staticMeshCpuEntryScale(0.25, "previous")).toBe(0.375);
    expect(staticMeshCpuEntryScale(0.25, "next")).toBe(0.125);
  });

  it("converts SampleIntensity times the scaled static sun plane through FColor with alpha 0", () => {
    expect(staticMeshCpuVertexContribution(1, [1, 0.5, 0, 1], 0.5)).toEqual([0, 63, 127, 0]);
    expect(staticMeshCpuVertexContribution(0.5, [1, 1, 1, 1], 1)).toEqual([127, 127, 127, 0]);
  });

  it("multiplies RGB by the authored colour / 255 only with the mesh colour selector, and always copies the authored alpha", () => {
    expect(staticMeshInstanceColourWithAuthored([27, 27, 27, 255], [255, 128, 0, 200], true)).toEqual([27, 13, 0, 200]);
    expect(staticMeshInstanceColourWithAuthored([27, 27, 27, 255], [255, 128, 0, 200], false)).toEqual([27, 27, 27, 200]);
  });
});
