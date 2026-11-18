import { describe, expect, it } from "vitest";
import type { NativePlane } from "../../src/environment/model/nativePlane";
import {
  staticMeshLightSampleIntensity, staticMeshLightSamplerEffect, staticMeshOrdinaryLightContribution, staticMeshOrdinaryLightGain, staticMeshOrdinaryVertexColour,
  type StaticMeshLightSampler, type StaticMeshOrdinaryLight,
} from "../../src/environment/model/staticMeshOrdinaryLighting";
import { staticMeshVertexVisible } from "../../src/environment/model/staticMeshHourlyLighting";
import { maskBytes } from "../support/staticMeshLightingFixtures";
import {
  integratedFixtureOf, readOrdinaryStaticLightingFixtures, type OrdinaryIntegratedFixture, type OrdinarySampleIntensityFixture,
} from "../support/ordinaryStaticLightingFixtures";

const document = readOrdinaryStaticLightingFixtures();
const spotlightCase = integratedFixtureOf(document, 1219);

function samplerOf(row: OrdinarySampleIntensityFixture): StaticMeshLightSampler {
  const { position, radius, direction, cone } = row.light;
  return row.effect === 0 ? { effect: "point", position, radius } : { effect: "spot", position, radius, direction, cone };
}

function cachedLight(fixture: OrdinaryIntegratedFixture, reference: number): StaticMeshOrdinaryLight {
  const light = fixture.ordinaryLights.find(entry => entry.exportIndex === reference)!;
  const fieldValue = (name: string) => light.fields.find(field => field.field === name)!.value as number;
  const { position, radius, direction, color38 } = light.cache;
  const sampler: StaticMeshLightSampler = fieldValue("LightEffect") === 0 ? { effect: "point", position, radius }
    : { effect: "spot", position, radius, direction, cone: fieldValue("LightCone") };
  return { colour: color38 as NativePlane, sampler };
}

describe("static mesh SampleIntensity 0x10670640, effects 0 and 12 (RM-19)", () => {
  it("covers the 94 native effect 0 and effect 12 fixtures", () => {
    expect(document.sampleIntensity.length).toBe(94);
    expect(new Set(document.sampleIntensity.map(row => row.effect))).toEqual(new Set([0, 12]));
  });

  it.each(document.sampleIntensity.map((row, index) => [index, row.effect, row] as const))("matches native fixture %i (effect %i) bit for bit", (_, __, row) => {
    expect(staticMeshLightSampleIntensity(samplerOf(row), { worldPosition: row.worldPosition, worldNormal: row.worldNormal })).toBe(row.intensity);
  });

  it("selects the cubic point falloff for effect 0 and the squared cone ramp for effect 12, and names every other effect", () => {
    expect(staticMeshLightSamplerEffect(0)).toEqual({ status: "resolved", value: "point" });
    expect(staticMeshLightSamplerEffect(12)).toEqual({ status: "resolved", value: "spot" });
    for (const effect of [8, 13, 17, 19, 20, 1]) {
      expect(staticMeshLightSamplerEffect(effect)).toEqual({ status: "unresolved", reason: `static-mesh-light-effect-unported:${effect}` });
    }
  });

  it("peaks at 2 at normal incidence next to the light, so the effect 0 term is not a clamped cosine", () => {
    const peak = document.sampleIntensity.find(row => row.function === "FDynamicLight::SampleIntensity" && row.effect === 0 && row.intensity > 1.99)!;
    expect(peak.intensity).toBeGreaterThan(1);
    expect(staticMeshLightSampleIntensity(samplerOf(peak), peak)).toBe(peak.intensity);
  });
});

describe("ordinary light contribution and vertex sum 0x10677fa0 (RM-19 actor 1219, instance 3919)", () => {
  it("uses f32(ScaleGlow * 0.5) as the gain", () => {
    expect(staticMeshOrdinaryLightGain(spotlightCase.scaleGlow)).toBe(0.5);
    expect(staticMeshOrdinaryLightGain(1.3)).toBe(Math.fround(0.65));
  });

  it.each(spotlightCase.perLightSamples.map(sample => [sample.reference, sample.vertex, sample] as const))(
    "quantizes light %i at vertex %i to its native FColor before any addition", (reference, _, sample) => {
      const light = cachedLight(spotlightCase, reference);
      expect(staticMeshLightSampleIntensity(light.sampler, sample)).toBe(sample.intensity);
      expect(staticMeshOrdinaryLightContribution(light.colour, staticMeshOrdinaryLightGain(spotlightCase.scaleGlow), sample.intensity)).toEqual(sample.contributionBGRA);
    });

  it("sums vertices 0 and 1 to BGR 2,3,4 and vertices 2 and 3 to BGR 1,1,2 from the lights whose mask bit is set, leaving alpha to the authored stream", () => {
    const gain = staticMeshOrdinaryLightGain(spotlightCase.scaleGlow);
    const colours = spotlightCase.vertexIndices.map(vertex => {
      const sample = spotlightCase.perLightSamples.find(entry => entry.vertex === vertex)!;
      const lights = spotlightCase.ordinaryEntries.filter(entry => staticMeshVertexVisible(maskBytes(entry.maskHex), vertex))
        .map(entry => cachedLight(spotlightCase, entry.light));
      return staticMeshOrdinaryVertexColour(lights, gain, sample);
    });
    expect(colours).toEqual(spotlightCase.ordinaryBGRA.map(bgra => bgra.slice(0, 3)));
    expect(colours).toEqual([[2, 3, 4], [2, 3, 4], [1, 1, 2], [1, 1, 2]]);
  });

  it("saturates each byte at 255 when lights add past it", () => {
    const light: StaticMeshOrdinaryLight = { colour: [0.6, 0.6, 0.6, 1], sampler: { effect: "point", position: [0, 0, 0], radius: 1000 } };
    const sample = { worldPosition: [1, 0, 0] as const, worldNormal: [-1, 0, 0] as const };
    const single = staticMeshOrdinaryVertexColour([light], 0.5, sample);
    expect(single[0]).toBeGreaterThan(127);
    expect(staticMeshOrdinaryVertexColour([light, light], 0.5, sample)).toEqual([255, 255, 255]);
  });
});
