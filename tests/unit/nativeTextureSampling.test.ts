import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { WebGPUCacheSampler } from "@babylonjs/core/Engines/WebGPU/webgpuCacheSampler";
import type { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildFragmentChain, lightmapCoordinatesVaryingName, lightmapSamplerName, samplerUniformName } from "../../src/materials/ue2/babylon/fragmentChain";
import { loadNativeMaterial } from "../../src/materials/ue2/babylon/loadNativeMaterial";
import { createNativeMaterial } from "../../src/materials/ue2/babylon/material";
import { MATERIAL_CONSTANT_TABLES } from "../../src/materials/ue2/model/constants/materialConstants";
import { TEXTURE_SAMPLING_CONSTANTS } from "../../src/materials/ue2/model/constants/textureSamplingConstants";
import type { CompiledMaterialStagePlan } from "../../src/materials/ue2/model/stagePlan";
import { mipChainSwatch } from "../support/nativeMipChainFixture";
import {
  d3dTextureAddressClamp, d3dTextureAddressWrap, d3dTextureFilterLinear, liveBoundStage, liveBoundStages, liveLightmapTexture, textureSamplersFixture,
} from "../support/textureSamplersFixture";

const scenes: Scene[] = [];

function blockCompressionScene(): Scene {
  const engine = new NullEngine();
  (engine.getCaps() as { s3tc?: unknown }).s3tc = {};
  vi.spyOn(engine, "_uploadCompressedDataToTextureDirectly").mockImplementation(() => undefined);
  const scene = new Scene(engine);
  scenes.push(scene);
  return scene;
}

async function loadedLibraryMaterialOf(object: string) {
  const swatch = mipChainSwatch(object);
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const bytes = swatch.servedFiles.get(url);
    return new Response(bytes === undefined ? null : bytes.slice(), { status: bytes === undefined ? 404 : 200 });
  }));
  return loadNativeMaterial(swatch.materialId, new AbortController().signal);
}

async function libraryMaterialOf(object: string) {
  return createNativeMaterial(blockCompressionScene(), await loadedLibraryMaterialOf(object), { sessionSeed: 1, lighting: "unlit" });
}

function webGpuSamplerDescriptorOf(texture: BaseTexture) {
  const internalTexture = texture.getInternalTexture()!;
  internalTexture._cachedWrapU = texture.wrapU;
  internalTexture._cachedWrapV = texture.wrapV;
  internalTexture._cachedAnisotropicFilteringLevel = texture.anisotropicFilteringLevel;
  return WebGPUCacheSampler._GetSamplerDescriptor(internalTexture);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const scene of scenes.splice(0)) {
    const engine = scene.getEngine();
    scene.dispose();
    engine.dispose();
  }
});

describe("RM-25 texture sampling constant rows", () => {
  it("take the mip bias, anisotropy and filter from the RM-25 l2.ini and Option.ini and match every live bound stage", () => {
    const { l2Ini, optionIni, runtimeGlobals } = textureSamplersFixture.configuration;
    expect(TEXTURE_SAMPLING_CONSTANTS.mipBias.runtimeDefault).toBe(Number(l2Ini.DefaultTexMipBias));
    expect(TEXTURE_SAMPLING_CONSTANTS.anisotropy.runtimeDefault).toBe(Number(l2Ini.LevelOfAnisotropy));
    expect([optionIni.UseTrilinear, runtimeGlobals.GL2UseTrilinear, TEXTURE_SAMPLING_CONSTANTS.filter.runtimeDefault]).toEqual(["True", 1, "linear"]);
    for (const stage of liveBoundStages()) {
      expect([stage.lodBias, stage.maxAnisotropy, stage.minFilter, stage.magFilter, stage.mipFilter])
        .toEqual([TEXTURE_SAMPLING_CONSTANTS.mipBias.runtimeDefault, TEXTURE_SAMPLING_CONSTANTS.anisotropy.runtimeDefault, ...Array(3).fill(d3dTextureFilterLinear)]);
    }
  });

  it("clamp the live wall lightmap and wrap every other live stage", () => {
    expect(liveBoundStage(liveLightmapTexture).address).toEqual([d3dTextureAddressClamp, d3dTextureAddressClamp, d3dTextureAddressClamp]);
    expect(TEXTURE_SAMPLING_CONSTANTS.lightmapAddress.runtimeDefault).toBe("clamp");
    for (const stage of liveBoundStages().filter(candidate => candidate.texture !== liveLightmapTexture)) {
      expect(stage.address).toEqual([d3dTextureAddressWrap, d3dTextureAddressWrap, d3dTextureAddressWrap]);
    }
  });

  it("are confirmed Interlude rows of the material constant tables that cite the RM-25 report", () => {
    for (const row of Object.values(MATERIAL_CONSTANT_TABLES.textureSampling)) {
      expect(row).toMatchObject({ status: "confirmed-interlude", interludeEvidence: expect.stringContaining("fc0169fe") });
      expect(row.runtimeDefault).toEqual(row.value);
    }
  });
});

describe("RM-25 texture mip bias in the material fragment chain", () => {
  it("passes the DefaultTexMipBias as the texture2D bias of every material and lightmap sample", async () => {
    const plan = (await loadedLibraryMaterialOf("dion_curumadungeon_t.cm_dg_etc")).plan as CompiledMaterialStagePlan;
    const bias = String(liveBoundStage("dion_curumadungeon_t.cm_dg_etc").lodBias);
    const source = buildFragmentChain(plan, "lightmap-modulate2x").fragmentSource;
    expect(source).toMatch(new RegExp(`texture2D\\(${samplerUniformName(0)}, vec2\\(.*\\), ${bias.replace(".", "\\.")}\\)`));
    expect(source).toContain(`texture2D(${lightmapSamplerName}, ${lightmapCoordinatesVaryingName}, ${bias})`);
  });
});

describe("RM-25 library material samplers", () => {
  it.each(["l2_skies.Textures.WhiteChip", "dion_curumadungeon_t.cm_dg_etc", "cruma_tr_t.Cm_o_wall008"])(
    "give %s the live level count, trilinear filtering, anisotropy 1 and wrap", async object => {
      const material = await libraryMaterialOf(object);
      const live = liveBoundStage(object);
      expect(material.inspect().samplers).toEqual([{ texture: expect.stringContaining("SwatchTexture"), levelCount: live.levelCount,
        samplingMode: Texture.TRILINEAR_SAMPLINGMODE, anisotropicFilteringLevel: live.maxAnisotropy, wrapU: Texture.WRAP_ADDRESSMODE, wrapV: Texture.WRAP_ADDRESSMODE }]);
    });

  it("reach WebGPU as a linear, linear, linear sampler with anisotropy 1 and no level clamp when the chain has levels", async () => {
    const material = await libraryMaterialOf("cruma_tr_t.Cm_o_wall008");
    expect(webGpuSamplerDescriptorOf(material.material.getActiveTextures()[0]!)).toMatchObject({
      magFilter: "linear", minFilter: "linear", mipmapFilter: "linear", lodMinClamp: undefined, lodMaxClamp: undefined, maxAnisotropy: 1,
      addressModeU: "repeat", addressModeV: "repeat" });
  });

  it("reach WebGPU as a linear single-level sampler with anisotropy 1 for a one-level texture", async () => {
    const material = await libraryMaterialOf("l2_skies.Textures.WhiteChip");
    expect(webGpuSamplerDescriptorOf(material.material.getActiveTextures()[0]!)).toMatchObject({ magFilter: "linear", minFilter: "linear", maxAnisotropy: 1 });
  });
});
