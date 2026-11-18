import { describe, expect, it } from "vitest";
import { fGetHsv } from "../../src/environment/model/fGetHsv";
import {
  actorAmbientLight, staticMeshAmbientLight, staticMeshRenderDataAmbient, staticMeshRenderDataAmbientLight, type StaticMeshAmbientInputs,
} from "../../src/environment/model/meshLightingTerms";
import { readStaticMeshAmbientFixtures } from "../support/staticMeshAmbientFixtures";

const instancedActor: StaticMeshAmbientInputs = {
  hourlyAmbient: [71, 77, 95], selectedLevelOfDetail: 2, hasStaticMeshInstance: true,
  staticSunPlane: [0.278127521276474, 0.23720411956310272, 0.19324937462806702, 0.3921568691730499],
};
const rm20 = readStaticMeshAmbientFixtures();
const zoneVector = (zoneIndex: number) => {
  const zone = rm20.zones.find(entry => entry.zoneIndex === zoneIndex)!;
  return fGetHsv(zone.ambientHue, zone.ambientSaturation, zone.ambientBrightness);
};

describe("static mesh ambient (0x1067b161)", () => {
  it("halves StaticMeshAmbient with alpha 255 while the actor has a static mesh instance", () => {
    expect(staticMeshAmbientLight(instancedActor)).toEqual([35, 38, 47, 255]);
  });

  it("adds the low byte of trunc(static sun plane * 32) on LOD 2 without a static mesh instance, then clamps", () => {
    expect(staticMeshAmbientLight({ ...instancedActor, hasStaticMeshInstance: false })).toEqual([43, 45, 53, 255]);
    expect(staticMeshAmbientLight({ ...instancedActor, hasStaticMeshInstance: false, hourlyAmbient: [255, 255, 255], staticSunPlane: [5, 0, 0, 0] }))
      .toEqual([255, 127, 127, 255]);
    expect(staticMeshAmbientLight({ ...instancedActor, hasStaticMeshInstance: false, hourlyAmbient: [20, 0, 0], staticSunPlane: [-0.5, 0, 0, 0] }))
      .toEqual([250, 0, 0, 255]);
  });

  it("leaves the sun term out on the base mesh and LOD 1", () => {
    expect([0, 1, -1].map(selectedLevelOfDetail => staticMeshAmbientLight({ ...instancedActor, hasStaticMeshInstance: false, selectedLevelOfDetail })))
      .toEqual(Array(3).fill([35, 38, 47, 255]));
  });

  it("gives the RM-20 sun-affected actors 950 and 1155 the hourly StaticMeshAmbient 120 >> 1 at hour 12.2", () => {
    for (const fixture of rm20.fixtures.filter(entry => entry.runtimeSunAffect && (entry.actorExportIndex === 950 || entry.actorExportIndex === 1155))) {
      expect(fixture.selectedAmbientSource).toBe("StaticMeshAmbient(hour)>>1");
      expect(staticMeshAmbientLight({ hourlyAmbient: rm20.hourlyStaticMeshAmbientRGB, selectedLevelOfDetail: 0, hasStaticMeshInstance: fixture.hasInstance,
        staticSunPlane: [0, 0, 0, 0] })).toEqual([...fixture.setAmbientRGB, 255]);
    }
  });
});

describe("static mesh render data ambient (AActor::UpdateRenderData 0x105308e0)", () => {
  it("takes FGetHSV of each RM-20 zone as its AmbientVector", () => {
    for (const zone of rm20.zones) expect(fGetHsv(zone.ambientHue, zone.ambientSaturation, zone.ambientBrightness).slice(0, 3)).toEqual(zone.ambientVector);
  });

  it("stores FColor of the componentwise maximum touched-zone AmbientVector plus AmbientGlow, as each RM-20 actor caches", () => {
    for (const fixture of rm20.fixtures) {
      const vectors = fixture.zoneIndices.map(zoneVector);
      expect(staticMeshRenderDataAmbient(vectors, fixture.ambientGlow)).toEqual(fixture.cachedAmbientBGRA);
    }
  });

  it("draws the cached colour >> 1 for the RM-20 actors 1123 and 1143 that touch no sun-affected zone", () => {
    for (const fixture of rm20.fixtures.filter(entry => !entry.runtimeSunAffect)) {
      expect(fixture.selectedAmbientSource).toBe("renderData.cachedAmbientRGB>>1");
      expect(staticMeshRenderDataAmbientLight(fixture.cachedAmbientBGRA)).toEqual([...fixture.setAmbientRGB, 255]);
    }
  });

  it("adds f32(AmbientGlow / 255) to every channel before FColor floors and clamps it", () => {
    expect(staticMeshRenderDataAmbient([], 0)).toEqual([0, 0, 0, 0]);
    expect(staticMeshRenderDataAmbient([[0.1, 0.5, 0.2, 1], [0.3, 0.2, 0.1, 1]], 51)).toEqual([102, 178, 127, 0]);
    expect(staticMeshRenderDataAmbient([[0.9, 0.9, 0.9, 1]], 254)).toEqual([255, 255, 255, 0]);
  });
});

describe("actor ambient (0x106ddab6)", () => {
  it("halves ActorAmbient with alpha 255 and names the gap without bSunAffect", () => {
    expect(actorAmbientLight([75, 103, 131], true)).toEqual({ status: "resolved", value: [37, 51, 65, 255] });
    expect(actorAmbientLight([75, 103, 131], false)).toEqual({ status: "unresolved", reason: "actor-unhourly-ambient-unresolved" });
  });
});
