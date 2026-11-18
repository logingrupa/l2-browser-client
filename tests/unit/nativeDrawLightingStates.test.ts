import { describe, expect, it } from "vitest";
import {
  globalModulationOperation, hourlyLightingUnresolvedItems, lightmapStageColourOperation, nativeDrawLightingStates, staticMeshColourStreams,
  staticMeshDrawnComposition, terrainRefreshThreshold,
} from "../../src/environment/model/nativeDrawLightingStates";

describe("native draw lighting states", () => {
  it("adds ambient once per surface: baked into BSP lightmaps and terrain colours, D3DRS_AMBIENT for meshes and actors", () => {
    expect(Object.fromEntries(Object.entries(nativeDrawLightingStates).map(([surface, state]) => [surface, [state.deviceLighting, state.colourVertex, state.ambientSource]])))
      .toEqual({
        bsp: [false, false, "baked-into-compressed-lightmap"],
        terrain: [false, true, "baked-into-vertex-colour"],
        staticMesh: [true, true, "render-state-ambient"],
        actor: [true, false, "render-state-ambient"],
      });
  });

  it("modulates a UColorModifier lightmap with D3DTOP_MODULATE and every other one with the unobserved global opcode", () => {
    expect(lightmapStageColourOperation(true)).toEqual({ operation: "modulate", opcode: 4 });
    expect(lightmapStageColourOperation(false)).toBe(globalModulationOperation);
    expect(globalModulationOperation).toEqual({ operation: "global-modulation", imageDefaultOpcode: 5, status: "unresolved", reason: "d3d-device-live-state" });
  });

  it("binds the instance stream to COLOR0 as emissive and keeps the COLOR1 material source a device gap", () => {
    expect(staticMeshColourStreams.instanceLighting).toMatchObject({ declarationUsage: "COLOR0", materialSource: "emissive" });
    expect(staticMeshColourStreams.authoredColour).toMatchObject({ declarationUsage: "COLOR1", status: "unresolved", reason: "d3d-device-live-state" });
  });

  it("lists all 13 DB-7 unresolved items, the 4 RM-10 composition items, the RM-20 light-changed item and the terrain refresh threshold as visible gaps", () => {
    expect(hourlyLightingUnresolvedItems.map(item => item.id)).toEqual([
      "terrain-general-staticlight-sampleintensity", "terrain-full-runtime-map-reconstruction", "bsp-full-effect-attenuation", "bsp-shadow-slot-origin",
      "bsp-final-filtered-rgb", "bsp-live-cache-state", "ma-final-static-vertex", "ma-live-actor-fixture", "ma-scalar-field-name", "ma-temporal-light-types",
      "d3d-programmable-composition", "d3d-device-live-state", "d3d-universal-stage-number",
      "rm10-selected-shader", "rm10-static-live-branch", "rm10-live-device-state", "rm10-final-gpu-colour", "static-mesh-light-changed-clearing",
    ]);
    expect(hourlyLightingUnresolvedItems.find(item => item.id === "static-mesh-light-changed-clearing")).toMatchObject({ surface: "staticMesh",
      reason: expect.stringContaining("950 retained 60 vs cleared 71,69,68") });
    expect(terrainRefreshThreshold).toMatchObject({ status: "unresolved", reason: "terrain-refresh-threshold-unresolved" });
  });

  it("marks the drawn static mesh composition as inferred from the D3D9 contract and lists each RM-10 reason as a static mesh item", () => {
    expect(staticMeshDrawnComposition).toEqual({ status: "inferred-d3d9",
      reasons: ["rm10-selected-shader", "rm10-static-live-branch", "rm10-live-device-state", "rm10-final-gpu-colour"] });
    const staticMeshItems = hourlyLightingUnresolvedItems.filter(item => item.surface === "staticMesh").map(item => item.id);
    for (const reason of staticMeshDrawnComposition.reasons) expect(staticMeshItems).toContain(reason);
  });
});
