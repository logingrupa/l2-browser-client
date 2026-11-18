import { Constants } from "@babylonjs/core/Engines/constants";
import { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture";
import { InternalTexture, InternalTextureSource } from "@babylonjs/core/Materials/Textures/internalTexture";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import type { Scene } from "@babylonjs/core/scene";
import { TEXTURE_SAMPLING_CONSTANTS, type NativeTextureAddress, type NativeTextureFilter } from "../model/constants/textureSamplingConstants";
import type { CompiledMaterialStagePlan } from "../model/stagePlan";
import { TEXTURE_COMPRESSION_BC_UNALIGNED_SIZE_REASON, TEXTURE_COMPRESSION_BC_UNAVAILABLE_REASON, type TextureMipChainFormat } from "../model/textureMipChain";
import type { LoadedNativeMaterial, LoadedTextureMipChain } from "./loadNativeMaterial";

export interface NativeSamplerInspection {
  readonly texture: string;
  readonly levelCount: number;
  readonly samplingMode: number;
  readonly anisotropicFilteringLevel: number;
  readonly wrapU: number;
  readonly wrapV: number;
}

export interface SamplerTextures {
  readonly textures: readonly (readonly BaseTexture[])[];
  readonly gapReasons: readonly string[];
}

export type MipChainUpload = { readonly babylonFormat: number } | { readonly gapReason: string };

const babylonSamplingModeByNativeFilter: Readonly<Record<NativeTextureFilter, number>> = { linear: Texture.TRILINEAR_SAMPLINGMODE };
const babylonAddressModeByNativeAddress: Readonly<Record<NativeTextureAddress, number>> = { wrap: Texture.WRAP_ADDRESSMODE, clamp: Texture.CLAMP_ADDRESSMODE };
const nativeSamplingMode = babylonSamplingModeByNativeFilter[TEXTURE_SAMPLING_CONSTANTS.filter.runtimeDefault];
const blockCompressedBabylonFormats: Readonly<Record<Exclude<TextureMipChainFormat, "RGBA8">, number>> = {
  DXT1: Constants.TEXTUREFORMAT_COMPRESSED_RGBA_S3TC_DXT1,
  DXT3: Constants.TEXTUREFORMAT_COMPRESSED_RGBA_S3TC_DXT3,
  DXT5: Constants.TEXTUREFORMAT_COMPRESSED_RGBA_S3TC_DXT5,
};
const blockCompressionEdge = 4;

export function blockCompressionGapReason(scene: Scene): string | null {
  return scene.getEngine().getCaps().s3tc ? null : TEXTURE_COMPRESSION_BC_UNAVAILABLE_REASON;
}

export function nativeMipChainUpload(scene: Scene, chain: LoadedTextureMipChain): MipChainUpload {
  if (chain.format === "RGBA8") return { babylonFormat: Constants.TEXTUREFORMAT_BGRA };
  const unavailableReason = blockCompressionGapReason(scene);
  if (unavailableReason !== null) return { gapReason: unavailableReason };
  const [firstLevel] = chain.levels;
  if (firstLevel!.width % blockCompressionEdge !== 0 || firstLevel!.height % blockCompressionEdge !== 0) {
    return { gapReason: TEXTURE_COMPRESSION_BC_UNALIGNED_SIZE_REASON };
  }
  return { babylonFormat: blockCompressedBabylonFormats[chain.format] };
}

export function createNativeMipChainTexture(scene: Scene, chain: LoadedTextureMipChain, babylonFormat: number): BaseTexture {
  const engine = scene.getEngine();
  const [firstLevel] = chain.levels;
  const internalTexture = new InternalTexture(engine, InternalTextureSource.Raw);
  internalTexture.baseWidth = internalTexture.width = firstLevel!.width;
  internalTexture.baseHeight = internalTexture.height = firstLevel!.height;
  internalTexture.format = babylonFormat;
  internalTexture.type = Constants.TEXTURETYPE_UNSIGNED_BYTE;
  internalTexture.samplingMode = nativeSamplingMode;
  internalTexture.invertY = false;
  internalTexture.generateMipMaps = chain.levels.length > 1;
  internalTexture._maxLodLevel = chain.levels.length;
  chain.levels.forEach((level, levelIndex) => engine._uploadCompressedDataToTextureDirectly(internalTexture, babylonFormat, level.width, level.height, level.data, 0, levelIndex));
  internalTexture.isReady = true;
  return new BaseTexture(scene, internalTexture);
}

export function createNativeSingleLevelTexture(scene: Scene, rgba: Uint8Array, width: number, height: number): BaseTexture {
  return RawTexture.CreateRGBATexture(rgba, width, height, scene, false, false, nativeSamplingMode);
}

export function applyNativeSampler(texture: BaseTexture, name: string, addressU: NativeTextureAddress, addressV: NativeTextureAddress): BaseTexture {
  texture.name = name;
  texture.gammaSpace = false;
  texture.anisotropicFilteringLevel = TEXTURE_SAMPLING_CONSTANTS.anisotropy.runtimeDefault;
  texture.wrapU = babylonAddressModeByNativeAddress[addressU];
  texture.wrapV = babylonAddressModeByNativeAddress[addressV];
  return texture;
}

export function inspectNativeSampler(texture: BaseTexture): NativeSamplerInspection {
  const internalTexture = texture.getInternalTexture();
  if (!internalTexture) throw new Error(`UE2 texture ${texture.name} has no GPU texture to inspect.`);
  return { texture: texture.name, levelCount: internalTexture.useMipMaps ? internalTexture._maxLodLevel ?? 1 : 1, samplingMode: internalTexture.samplingMode,
    anisotropicFilteringLevel: texture.anisotropicFilteringLevel, wrapU: texture.wrapU, wrapV: texture.wrapV };
}

function createMipZeroPngTexture(scene: Scene, loaded: LoadedNativeMaterial, sha256: string, path: string): BaseTexture {
  const pixels = loaded.texturePixels.get(sha256);
  if (!pixels) throw new Error(`UE2 material: texture ${path} was not loaded.`);
  return createNativeSingleLevelTexture(scene, pixels.rgba, pixels.width, pixels.height);
}

function samplerAddress(clamped: boolean): NativeTextureAddress {
  return clamped ? "clamp" : "wrap";
}

export function createSamplerTextures(scene: Scene, loaded: LoadedNativeMaterial, plan: CompiledMaterialStagePlan): SamplerTextures {
  const gapReasons = new Set<string>();
  const textures = plan.samplers.map(sampler => sampler.frameImages.map((image, frameIndex) => {
    const chain = loaded.textureMipChains.get(image.sha256);
    const upload = chain ? nativeMipChainUpload(scene, chain) : null;
    if (upload && "gapReason" in upload) gapReasons.add(upload.gapReason);
    const texture = chain && upload && "babylonFormat" in upload
      ? createNativeMipChainTexture(scene, chain, upload.babylonFormat)
      : createMipZeroPngTexture(scene, loaded, image.sha256, image.path);
    texture.hasAlpha = true;
    return applyNativeSampler(texture, `UE2 texture: ${sampler.frameNodes[frameIndex]}`, samplerAddress(sampler.clampU), samplerAddress(sampler.clampV));
  }));
  return { textures, gapReasons: [...gapReasons].sort() };
}
