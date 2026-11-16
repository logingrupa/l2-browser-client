import { describe, expect, it } from "vitest";
import {
  actorAmbientLight, dynamicLightDiffuse, dynamicLightPlane, dynamicLightUsesHourlyPlanes, staticMeshAmbientLight, type StaticMeshAmbientInputs,
} from "../../src/environment/model/meshLightingTerms";

const instancedActor: StaticMeshAmbientInputs = {
  hourlyAmbient: [71, 77, 95], actorSunAffect: true, selectedLevelOfDetail: 2, hasStaticMeshInstance: true,
  staticSunPlane: [0.278127521276474, 0.23720411956310272, 0.19324937462806702, 0.3921568691730499],
};
const directionalEffect = 0x13;

describe("static mesh ambient (0x1067b161)", () => {
  it("halves StaticMeshAmbient with alpha 255 while the actor has a static mesh instance", () => {
    expect(staticMeshAmbientLight(instancedActor)).toEqual({ status: "resolved", value: [35, 38, 47, 255] });
  });

  it("adds the low byte of trunc(static sun plane * 32) on LOD 2 without a static mesh instance, then clamps", () => {
    expect(staticMeshAmbientLight({ ...instancedActor, hasStaticMeshInstance: false })).toEqual({ status: "resolved", value: [43, 45, 53, 255] });
    expect(staticMeshAmbientLight({ ...instancedActor, hasStaticMeshInstance: false, hourlyAmbient: [255, 255, 255], staticSunPlane: [5, 0, 0, 0] }))
      .toEqual({ status: "resolved", value: [255, 127, 127, 255] });
    expect(staticMeshAmbientLight({ ...instancedActor, hasStaticMeshInstance: false, hourlyAmbient: [20, 0, 0], staticSunPlane: [-0.5, 0, 0, 0] }))
      .toEqual({ status: "resolved", value: [250, 0, 0, 255] });
  });

  it("leaves the sun term out on the base mesh and LOD 1", () => {
    expect([0, 1, -1].map(selectedLevelOfDetail => staticMeshAmbientLight({ ...instancedActor, hasStaticMeshInstance: false, selectedLevelOfDetail })))
      .toEqual(Array(3).fill({ status: "resolved", value: [35, 38, 47, 255] }));
  });

  it("names the gap for an actor without bSunAffect, whose ambient is not the hourly one", () => {
    expect(staticMeshAmbientLight({ ...instancedActor, actorSunAffect: false })).toEqual({ status: "unresolved", reason: "static-mesh-unhourly-ambient-unresolved" });
  });
});

describe("actor ambient (0x106ddab6)", () => {
  it("halves ActorAmbient with alpha 255 and names the gap without bSunAffect", () => {
    expect(actorAmbientLight([75, 103, 131], true)).toEqual({ status: "resolved", value: [37, 51, 65, 255] });
    expect(actorAmbientLight([75, 103, 131], false)).toEqual({ status: "unresolved", reason: "actor-unhourly-ambient-unresolved" });
  });
});

describe("dynamic lights (FDynamicLight::Update 0x10674660, SetLight 0x10024040)", () => {
  it("gates the hourly planes on the light actor, not on the lit pawn", () => {
    expect(dynamicLightUsesHourlyPlanes({ hourlyFlag: true, kind: 0 }, true)).toBe(true);
    expect([8, 9].map(kind => dynamicLightUsesHourlyPlanes({ hourlyFlag: true, kind }, true))).toEqual([false, false]);
    expect(dynamicLightUsesHourlyPlanes({ hourlyFlag: false, kind: 0 }, true)).toBe(false);
    expect(dynamicLightUsesHourlyPlanes({ hourlyFlag: true, kind: 0 }, false)).toBe(false);
  });

  it("multiplies base colour by float32(brightness / 255), the temporal factor and LevelInfo.Brightness in that order", () => {
    expect(dynamicLightPlane([0.5, 1, 2, 0], 255, 0.5, 3)).toEqual([0.75, 1.5, 3, 0]);
    const brightnessFraction = Math.fround(70 / 255);
    expect(dynamicLightPlane([1, 1, 1, 1], 70, 1, 1)).toEqual(Array(4).fill(brightnessFraction));
  });

  it("halves the GetLightColor plane for colour type 1 only, then scales a directional light by 0.5", () => {
    const plane = [0.8, 0.4, 0.2, 1] as const;
    expect(dynamicLightDiffuse(plane, 0, directionalEffect, false)).toEqual({ status: "resolved", value: [0.8, 0.4, 0.2].map(channel => Math.fround(channel * 0.5)).concat(0) });
    expect(dynamicLightDiffuse(plane, 1, directionalEffect, false))
      .toEqual({ status: "resolved", value: [0.8, 0.4, 0.2].map(channel => Math.fround(Math.fround(channel / 2) * 0.5)).concat(0) });
  });

  it("scales a directional light by 0.25 * 3.5 when the modulation flag is set", () => {
    expect(dynamicLightDiffuse([0.8, 0.4, 0.2, 1], 0, directionalEffect, true))
      .toEqual({ status: "resolved", value: [0.8, 0.4, 0.2].map(channel => Math.fround(channel * 0.875)).concat(0) });
  });

  it("names the gap for point and spot lights, whose attenuation is not ported", () => {
    expect(dynamicLightDiffuse([1, 1, 1, 1], 0, 0, false)).toEqual({ status: "unresolved", reason: "dynamic-light-point-spot-attenuation-unresolved" });
  });
});
