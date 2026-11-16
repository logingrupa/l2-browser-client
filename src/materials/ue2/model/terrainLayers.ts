import type { MaterialSampler, MaterialStagePlan } from "./stagePlan";

export type TerrainMaskChannel = "red" | "green" | "blue" | "alpha";

export interface TerrainTexturePixels {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array<ArrayBuffer>;
}

export interface TerrainAlphaMap {
  readonly pixels: TerrainTexturePixels;
  readonly clampU: boolean;
  readonly clampV: boolean;
}

export interface PackedTerrainMask {
  readonly pixels: TerrainTexturePixels;
  readonly clampU: boolean;
  readonly clampV: boolean;
}

export interface TerrainMaskPacking {
  readonly maskTextures: readonly PackedTerrainMask[];
  readonly layerWeights: readonly { readonly maskTexture: number; readonly channel: TerrainMaskChannel }[];
}

const packedChannels: readonly TerrainMaskChannel[] = ["red", "green", "blue", "alpha"];
const rgbaChannelCount = 4;
const alphaChannelOffset = 3;

export const terrainLayerProgramNotSingleTextureReason = "terrain-layer-program-not-single-texture";
export const terrainLayerAlphaChannelsDifferReason = "terrain-layer-alpha-channels-differ";

export function singleTextureSampler(plan: MaterialStagePlan): MaterialSampler | null {
  if (plan.status !== "compiled" || plan.expression.kind !== "texture" || plan.samplers.length !== 1 || plan.colourSources.length !== 0) return null;
  const sampler = plan.samplers[0]!;
  return sampler.frameImages.length === 1 && sampler.textureCoordinateModifiers.length === 0 ? sampler : null;
}

export function alphaMapChannelsAreEqual(pixels: TerrainTexturePixels): boolean {
  const { rgba } = pixels;
  for (let start = 0; start < rgba.length; start += rgbaChannelCount) {
    const alpha = rgba[start + alphaChannelOffset];
    if (rgba[start] !== alpha || rgba[start + 1] !== alpha || rgba[start + 2] !== alpha) return false;
  }
  return true;
}

export function packTerrainAlphaMaps(alphaMaps: readonly TerrainAlphaMap[]): TerrainMaskPacking {
  const maskTextures: { pixels: TerrainTexturePixels; clampU: boolean; clampV: boolean; used: number }[] = [];
  const layerWeights = alphaMaps.map(alphaMap => {
    const { width, height, rgba } = alphaMap.pixels;
    if (rgba.length !== width * height * rgbaChannelCount) throw new RangeError(`Terrain alpha map holds ${rgba.length} bytes, not ${width} x ${height} RGBA.`);
    let maskTexture = maskTextures.findIndex(mask => mask.used < packedChannels.length && mask.pixels.width === width && mask.pixels.height === height &&
      mask.clampU === alphaMap.clampU && mask.clampV === alphaMap.clampV);
    if (maskTexture < 0) {
      maskTextures.push({ pixels: { width, height, rgba: new Uint8Array(width * height * rgbaChannelCount) }, clampU: alphaMap.clampU, clampV: alphaMap.clampV, used: 0 });
      maskTexture = maskTextures.length - 1;
    }
    const target = maskTextures[maskTexture]!;
    const channelOffset = target.used++;
    for (let pixel = 0; pixel < width * height; pixel++) {
      target.pixels.rgba[pixel * rgbaChannelCount + channelOffset] = rgba[pixel * rgbaChannelCount + alphaChannelOffset]!;
    }
    return { maskTexture, channel: packedChannels[channelOffset]! };
  });
  return { maskTextures: maskTextures.map(({ pixels, clampU, clampV }) => ({ pixels, clampU, clampV })), layerWeights };
}
