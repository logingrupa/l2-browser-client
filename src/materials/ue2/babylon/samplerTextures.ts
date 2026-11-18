import { Constants } from "@babylonjs/core/Engines/constants";
import { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture";
import { InternalTexture, InternalTextureSource } from "@babylonjs/core/Materials/Textures/internalTexture";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import type { Scene } from "@babylonjs/core/scene";
import type { CompiledMaterialStagePlan } from "../model/stagePlan";
import { TEXTURE_COMPRESSION_BC_UNALIGNED_SIZE_REASON, TEXTURE_COMPRESSION_BC_UNAVAILABLE_REASON, type TextureMipChainFormat } from "../model/textureMipChain";
import type { LoadedNativeMaterial, LoadedTextureMipChain } from "./loadNativeMaterial";

export interface SamplerTextures {
  readonly textures: readonly (readonly BaseTexture[])[];
  readonly gapReasons: readonly string[];
}

const nativeTextureSamplingMode = Texture.BILINEAR_SAMPLINGMODE;
const blockCompressedBabylonFormats: Readonly<Record<Exclude<TextureMipChainFormat, "RGBA8">, number>> = {
  DXT1: Constants.TEXTUREFORMAT_COMPRESSED_RGBA_S3TC_DXT1,
  DXT3: Constants.TEXTUREFORMAT_COMPRESSED_RGBA_S3TC_DXT3,
  DXT5: Constants.TEXTUREFORMAT_COMPRESSED_RGBA_S3TC_DXT5,
};
const blockCompressionEdge = 4;

type MipChainUpload = { readonly babylonFormat: number } | { readonly gapReason: string };

function mipChainUpload(scene: Scene, chain: LoadedTextureMipChain): MipChainUpload {
  if (chain.format === "RGBA8") return { babylonFormat: Constants.TEXTUREFORMAT_BGRA };
  if (!scene.getEngine().getCaps().s3tc) return { gapReason: TEXTURE_COMPRESSION_BC_UNAVAILABLE_REASON };
  const [firstLevel] = chain.levels;
  if (firstLevel!.width % blockCompressionEdge !== 0 || firstLevel!.height % blockCompressionEdge !== 0) {
    return { gapReason: TEXTURE_COMPRESSION_BC_UNALIGNED_SIZE_REASON };
  }
  return { babylonFormat: blockCompressedBabylonFormats[chain.format] };
}

function createNativeMipChainTexture(scene: Scene, chain: LoadedTextureMipChain, babylonFormat: number): BaseTexture {
  const engine = scene.getEngine();
  const [firstLevel] = chain.levels;
  const internalTexture = new InternalTexture(engine, InternalTextureSource.Raw);
  internalTexture.baseWidth = internalTexture.width = firstLevel!.width;
  internalTexture.baseHeight = internalTexture.height = firstLevel!.height;
  internalTexture.format = babylonFormat;
  internalTexture.type = Constants.TEXTURETYPE_UNSIGNED_BYTE;
  internalTexture.samplingMode = nativeTextureSamplingMode;
  internalTexture.invertY = false;
  internalTexture.generateMipMaps = chain.levels.length > 1;
  internalTexture._maxLodLevel = chain.levels.length;
  chain.levels.forEach((level, levelIndex) => engine._uploadCompressedDataToTextureDirectly(internalTexture, babylonFormat, level.width, level.height, level.data, 0, levelIndex));
  internalTexture.isReady = true;
  return new BaseTexture(scene, internalTexture);
}

function createMipZeroPngTexture(scene: Scene, loaded: LoadedNativeMaterial, sha256: string, path: string): BaseTexture {
  const pixels = loaded.texturePixels.get(sha256);
  if (!pixels) throw new Error(`UE2 material: texture ${path} was not loaded.`);
  return RawTexture.CreateRGBATexture(pixels.rgba, pixels.width, pixels.height, scene, false, false, nativeTextureSamplingMode);
}

export function createSamplerTextures(scene: Scene, loaded: LoadedNativeMaterial, plan: CompiledMaterialStagePlan): SamplerTextures {
  const gapReasons = new Set<string>();
  const textures = plan.samplers.map(sampler => sampler.frameImages.map((image, frameIndex) => {
    const chain = loaded.textureMipChains.get(image.sha256);
    const upload = chain ? mipChainUpload(scene, chain) : null;
    if (upload && "gapReason" in upload) gapReasons.add(upload.gapReason);
    const texture = chain && upload && "babylonFormat" in upload
      ? createNativeMipChainTexture(scene, chain, upload.babylonFormat)
      : createMipZeroPngTexture(scene, loaded, image.sha256, image.path);
    texture.name = `UE2 texture: ${sampler.frameNodes[frameIndex]}`;
    texture.gammaSpace = false;
    texture.hasAlpha = true;
    texture.wrapU = sampler.clampU ? Texture.CLAMP_ADDRESSMODE : Texture.WRAP_ADDRESSMODE;
    texture.wrapV = sampler.clampV ? Texture.CLAMP_ADDRESSMODE : Texture.WRAP_ADDRESSMODE;
    return texture;
  }));
  return { textures, gapReasons: [...gapReasons].sort() };
}
