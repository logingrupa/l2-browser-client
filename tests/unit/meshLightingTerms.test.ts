import { describe, expect, it } from "vitest";
import { actorAmbientLight, staticMeshAmbientLight, type StaticMeshAmbientInputs } from "../../src/environment/model/meshLightingTerms";

const instancedActor: StaticMeshAmbientInputs = {
  hourlyAmbient: [71, 77, 95], actorSunAffect: true, selectedLevelOfDetail: 2, hasStaticMeshInstance: true,
  staticSunPlane: [0.278127521276474, 0.23720411956310272, 0.19324937462806702, 0.3921568691730499],
};

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
