import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, describe, expect, it } from "vitest";
import { createNativeMaterial } from "../../src/materials/ue2/babylon/material";
import {
  buildFragmentChain, instanceColourAttributeName, lightmapCoordinatesVaryingName, lightmapSamplerName, litDiffuseVaryingName, staticMeshAmbientUniformName,
} from "../../src/materials/ue2/babylon/fragmentChain";
import type { LoadedNativeMaterial } from "../../src/materials/ue2/babylon/loadNativeMaterial";
import { LIGHTING_CONSTANTS } from "../../src/materials/ue2/model/constants/lightingConstants";
import { parseMaterialProgram } from "../../src/materials/ue2/model/materialProgram";
import { compileMaterialStagePlan, type CompiledMaterialStagePlan } from "../../src/materials/ue2/model/stagePlan";
import { swatchTexturePng, syntheticSwatchProgram, textureImageFor } from "../support/materialProgramFixture";

const swatchImage = textureImageFor(swatchTexturePng());
const scenes: Scene[] = [];

function swatchMaterial(): LoadedNativeMaterial {
  const program = parseMaterialProgram(JSON.parse(JSON.stringify(syntheticSwatchProgram(swatchImage))));
  return { materialId: "cd".repeat(32), program, plan: compileMaterialStagePlan(program),
    texturePixels: new Map([[swatchImage.sha256, { width: 4, height: 4, rgba: new Uint8Array(64).fill(255) }]]), textureMipChains: new Map() };
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

describe("lightmap colour operation", () => {
  it("samples the lightmap on its own coordinates and scales it by the D3D operation before fog only when the material is lightmapped", () => {
    expect(LIGHTING_CONSTANTS.lightmapModulateScale).toMatchObject({ status: "confirmed-interlude", runtimeDefault: 1 });
    expect(LIGHTING_CONSTANTS.globalModulationModulate2xScale).toMatchObject({ id: "light.global-modulation-modulate2x-scale", status: "unconfirmed",
      runtimeDefault: 2 });
    expect(LIGHTING_CONSTANTS.globalModulationModulate2xScale.provenance).toMatch(/RM-10 static mesh vertex stage/);
    const plan = swatchMaterial().plan as CompiledMaterialStagePlan;
    const modulated = buildFragmentChain(plan, "lightmap-modulate"), doubled = buildFragmentChain(plan, "lightmap-modulate2x");
    const unlit = buildFragmentChain(plan, "unlit");
    expect(doubled.samplers).toContain(lightmapSamplerName);
    expect(doubled.fragmentSource).toContain(`varying vec2 ${lightmapCoordinatesVaryingName};`);
    expect(doubled.fragmentSource).toContain(`* 2.0 * texture2D(${lightmapSamplerName}, ${lightmapCoordinatesVaryingName}, -0.5).rgb`);
    expect(modulated.fragmentSource).toContain(`* 1.0 * texture2D(${lightmapSamplerName}, ${lightmapCoordinatesVaryingName}, -0.5).rgb`);
    expect(unlit.samplers).not.toContain(lightmapSamplerName);
    expect(unlit.fragmentSource).not.toContain(lightmapSamplerName);
  });

  it("binds a lightmap texture on a lightmapped material and refuses one on an unlit material", () => {
    const scene = nullScene();
    const lightmapped = createNativeMaterial(scene, swatchMaterial(), { sessionSeed: 1, lighting: "lightmap-modulate2x" });
    expect(lightmapped.inspect()).toMatchObject({ status: "compiled", lighting: "lightmap-modulate2x", lightmapBound: false });
    lightmapped.setLightmap(RawTexture.CreateRGBATexture(new Uint8Array(16).fill(128), 2, 2, scene));
    expect(lightmapped.inspect().lightmapBound).toBe(true);
    const unlit = createNativeMaterial(scene, swatchMaterial(), { sessionSeed: 1, lighting: "unlit" });
    expect(() => unlit.setLightmap(RawTexture.CreateRGBATexture(new Uint8Array(16), 2, 2, scene))).toThrow(/takes no lightmap/);
  });
});

describe("vertex-modulate2x static mesh lighting", () => {
  it("doubles the material colour by the Gouraud lit diffuse inside the clamp, before the fog mix", () => {
    const plan = swatchMaterial().plan as CompiledMaterialStagePlan;
    const chain = buildFragmentChain(plan, "vertex-modulate2x");
    expect(chain.samplers).not.toContain(lightmapSamplerName);
    expect(chain.fragmentSource).toContain(`varying vec3 ${litDiffuseVaryingName};`);
    const output = chain.fragmentSource.split("\n").find(line => line.includes("gl_FragColor"))!;
    expect(output).toMatch(new RegExp(String.raw`mix\(clamp\(ue2Value\d+\.rgb \* 2\.0 \* ${litDiffuseVaryingName}, 0\.0, 1\.0\), ue2FogColour\.rgb, ue2FogFactor\)`));
  });

  it("clamps the instance colour attribute plus the ambient uniform per vertex and takes the ambient only on a vertex-lit material", () => {
    const scene = nullScene();
    const lit = createNativeMaterial(scene, swatchMaterial(), { sessionSeed: 1, lighting: "vertex-modulate2x" });
    expect((lit.material.shaderPath as { vertexSource: string }).vertexSource).toContain(
      `${litDiffuseVaryingName} = clamp(${instanceColourAttributeName}.rgb + ${staticMeshAmbientUniformName}.rgb, 0.0, 1.0);`);
    expect(lit.material.options.attributes).toContain(instanceColourAttributeName);
    lit.setStaticMeshAmbient([60 / 255, 60 / 255, 60 / 255]);
    const unlit = createNativeMaterial(scene, swatchMaterial(), { sessionSeed: 1, lighting: "unlit" });
    expect(unlit.material.options.attributes).not.toContain(instanceColourAttributeName);
    expect(() => unlit.setStaticMeshAmbient([0, 0, 0])).toThrow(/takes no static mesh ambient/);
  });
});
