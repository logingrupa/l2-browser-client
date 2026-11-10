import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, describe, expect, it } from "vitest";
import { createNativeMaterial } from "../../src/materials/ue2/babylon/material";
import { buildFragmentChain, lightmapCoordinatesVaryingName, lightmapSamplerName } from "../../src/materials/ue2/babylon/fragmentChain";
import type { LoadedNativeMaterial } from "../../src/materials/ue2/babylon/loadNativeMaterial";
import { LIGHTING_CONSTANTS } from "../../src/materials/ue2/model/constants/lightingConstants";
import { applyModulate2xLighting } from "../../src/materials/ue2/model/lighting";
import { parseMaterialProgram } from "../../src/materials/ue2/model/materialProgram";
import { compileMaterialStagePlan, type CompiledMaterialStagePlan } from "../../src/materials/ue2/model/stagePlan";
import { swatchTexturePng, syntheticSwatchProgram, textureImageFor } from "../support/materialProgramFixture";

const swatchImage = textureImageFor(swatchTexturePng());
const scenes: Scene[] = [];

function swatchMaterial(): LoadedNativeMaterial {
  const program = parseMaterialProgram(JSON.parse(JSON.stringify(syntheticSwatchProgram(swatchImage))));
  return { materialId: "cd".repeat(32), program, plan: compileMaterialStagePlan(program),
    texturePixels: new Map([[swatchImage.sha256, { width: 4, height: 4, rgba: new Uint8Array(64).fill(255) }]]) };
}

function nullScene(): Scene {
  const scene = new Scene(new NullEngine());
  scenes.push(scene);
  return scene;
}

afterEach(() => {
  for (const scene of scenes.splice(0)) {
    const engine = scene.getEngine();
    scene.dispose();
    engine.dispose();
  }
});

describe("Modulate2X lighting", () => {
  it("doubles the colour by the light in the byte domain and saturates at one", () => {
    expect(LIGHTING_CONSTANTS.modulate2x).toMatchObject({ status: "unconfirmed", runtimeDefault: 2 });
    const lit = applyModulate2xLighting([100 / 255, 200 / 255, 40 / 255, 0.5], [0.5, 0.5, 0]);
    expect(lit.map(channel => Math.round(channel * 255))).toEqual([100, 200, 0, 128]);
    expect(applyModulate2xLighting([200 / 255, 1, 1, 1], [1, 1, 1])).toEqual([1, 1, 1, 1]);
  });

  it("samples the lightmap on its own coordinates and multiplies before fog only when the material is lightmapped", () => {
    const plan = swatchMaterial().plan as CompiledMaterialStagePlan;
    const lightmapped = buildFragmentChain(plan, "lightmap"), unlit = buildFragmentChain(plan, "unlit");
    expect(lightmapped.samplers).toContain(lightmapSamplerName);
    expect(lightmapped.fragmentSource).toContain(`varying vec2 ${lightmapCoordinatesVaryingName};`);
    expect(lightmapped.fragmentSource).toContain(`* 2.0 * texture2D(${lightmapSamplerName}, ${lightmapCoordinatesVaryingName}).rgb`);
    expect(unlit.samplers).not.toContain(lightmapSamplerName);
    expect(unlit.fragmentSource).not.toContain(lightmapSamplerName);
  });

  it("binds a lightmap texture on a lightmapped material and refuses one on an unlit material", () => {
    const scene = nullScene();
    const lightmapped = createNativeMaterial(scene, swatchMaterial(), { sessionSeed: 1, lighting: "lightmap" });
    expect(lightmapped.inspect()).toMatchObject({ status: "compiled", lighting: "lightmap", lightmapBound: false });
    lightmapped.setLightmap(RawTexture.CreateRGBATexture(new Uint8Array(16).fill(128), 2, 2, scene));
    expect(lightmapped.inspect().lightmapBound).toBe(true);
    const unlit = createNativeMaterial(scene, swatchMaterial(), { sessionSeed: 1, lighting: "unlit" });
    expect(() => unlit.setLightmap(RawTexture.CreateRGBATexture(new Uint8Array(16), 2, 2, scene))).toThrow(/takes no lightmap/);
  });
});
