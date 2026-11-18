import { describe, expect, it } from "vitest";
import type { NativePlane } from "../../src/environment/model/nativePlane";
import {
  staticMeshHourlyEntryBlend, staticMeshHourlyEntryContributions, staticMeshHourlyInstanceColour, staticMeshSampleIntensity, staticMeshVertexVisible,
  staticMeshWorldNormal, type NativeLocalToWorldRows,
} from "../../src/environment/model/staticMeshHourlyLighting";
import type { Vector3 } from "../../src/shared/math/vector3";
import { maskBytes, readStaticMeshLightingFixtures, type StaticMeshLightingFixture } from "../support/staticMeshLightingFixtures";

const { pillar, fixtures } = readStaticMeshLightingFixtures();
const hourlyMasks = pillar.hourlyMasks.map(mask => maskBytes(mask.maskHex));
const ordinaryMask = pillar.ordinaryMasks.map(mask => maskBytes(mask.maskHex)).reduce((union, mask) => union.map((byte, index) => byte | mask[index]!));

function localToWorldRows(matrix: readonly number[]): NativeLocalToWorldRows {
  const row = (start: number): Vector3 => ({ x: matrix[start]!, y: matrix[start + 1]!, z: matrix[start + 2]! });
  return [row(0), row(4), row(8)];
}

function nativeNormal(vertex: number): Vector3 {
  return { x: pillar.nativeNormals[vertex * 3]!, y: pillar.nativeNormals[vertex * 3 + 1]!, z: pillar.nativeNormals[vertex * 3 + 2]! };
}

function direction(fixture: StaticMeshLightingFixture): Vector3 {
  return { x: fixture.direction[0], y: fixture.direction[1], z: fixture.direction[2] };
}

function sampleIntensityOf(fixture: StaticMeshLightingFixture, vertex: number): number {
  return staticMeshSampleIntensity(staticMeshWorldNormal(localToWorldRows(fixture.matrix), nativeNormal(vertex)), direction(fixture));
}

function vertexColour(fixture: StaticMeshLightingFixture, vertex: number, sampleIntensity = sampleIntensityOf(fixture, vertex),
  swapWeights = false) {
  const blend = staticMeshHourlyEntryBlend(hourlyMasks.length, fixture.hour);
  const weightedBlend = swapWeights ? { ...blend, weight: Math.fround(1 - blend.weight) } : blend;
  const entries = staticMeshHourlyEntryContributions(weightedBlend, staticMeshVertexVisible(hourlyMasks[blend.index]!, vertex),
    staticMeshVertexVisible(hourlyMasks[blend.nextIndex]!, vertex));
  return staticMeshHourlyInstanceColour(sampleIntensity, entries, fixture.sunPlane as NativePlane, [0, 0, 0, 0]);
}

const bgrToRgb = (bgra: readonly number[]) => [bgra[2], bgra[1], bgra[0]];

describe("RM-10 pillar hourly instance colour (actor 7732, cruma_s.f_04)", () => {
  it("keeps v0 and v4 clear of every ordinary light mask, so the hourly sum alone sets their colour", () => {
    expect(fixtures[0]!.vertexIndices.map(vertex => staticMeshVertexVisible(ordinaryMask, vertex))).toEqual([false, false]);
    expect(staticMeshVertexVisible(ordinaryMask, 2)).toBe(true);
  });

  it("gives SampleIntensity 0.1869 at v0 and 1.4163 at v4 at hour 12.3 from the source normal through the native local-to-world rows", () => {
    expect(sampleIntensityOf(fixtures[0]!, 0)).toBeCloseTo(0.1869, 4);
    expect(sampleIntensityOf(fixtures[0]!, 4)).toBeCloseTo(1.4163, 4);
  });

  it.each(fixtures.map(fixture => [fixture.hour, fixture] as const))("matches the native instance colour bytes at hour %f", (_, fixture) => {
    expect(staticMeshHourlyEntryBlend(hourlyMasks.length, fixture.hour).index).toBe(3);
    fixture.vertexIndices.forEach((vertex, position) => expect(vertexColour(fixture, vertex)).toEqual(bgrToRgb(fixture.instanceBGRA[position]!)));
  });

  it("would miss the fixture with a unit Lambert term or with w on the previous entry", () => {
    const fixture = fixtures[0]!;
    const unitLambert = (vertex: number) => sampleIntensityOf(fixture, vertex) / 2;
    expect(fixture.vertexIndices.map(vertex => vertexColour(fixture, vertex, unitLambert(vertex))))
      .not.toEqual(fixture.instanceBGRA.map(bgrToRgb));
    expect(fixture.vertexIndices.map(vertex => vertexColour(fixture, vertex, sampleIntensityOf(fixture, vertex), true)))
      .not.toEqual(fixture.instanceBGRA.map(bgrToRgb));
  });

  it("clamps SampleIntensity at zero for a normal facing away from the light and adds nothing for an entry whose bit is clear", () => {
    expect(staticMeshSampleIntensity({ x: 0, y: 0, z: -1 }, { x: 0, y: 0, z: -1 })).toBe(0);
    expect(staticMeshHourlyInstanceColour(2, [{ contributes: false, weight: 1 }], [1, 1, 1, 1], [0, 0, 0, 0])).toEqual([0, 0, 0]);
    expect(staticMeshHourlyInstanceColour(2, [{ contributes: true, weight: 1 }, { contributes: true, weight: 1 }], [1, 1, 1, 1], [0, 0, 0, 0])).toEqual([255, 255, 255]);
  });
});
