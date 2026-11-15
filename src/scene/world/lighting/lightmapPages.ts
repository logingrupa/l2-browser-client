import type { TileLightingModel } from "./decodeTileLighting";

export const hoursPerDay = 24;
const dxt1BlockEdge = 4;
const dxt1BlockBytes = 8;
const rgbaChannels = 4;

export function dxt1ByteCount(edge: number): number {
  return (edge / dxt1BlockEdge) * (edge / dxt1BlockEdge) * dxt1BlockBytes;
}

export function lightmapSlotAtHour(hour: number, slotCount: number, outdoor: boolean): number {
  if (!Number.isFinite(hour) || hour < 0 || hour >= hoursPerDay) throw new RangeError(`Lightmap hour ${hour} is outside [0, ${hoursPerDay}).`);
  if (!Number.isSafeInteger(slotCount) || slotCount < 1) throw new RangeError(`Lightmap slot count ${slotCount} must be a positive integer.`);
  if (!outdoor) return 0;
  return Math.trunc(Math.fround(Math.fround(Math.fround(hour) * slotCount) / hoursPerDay)) % slotCount;
}

export function lightmapPageAtHour(model: TileLightingModel, texture: number, hour: number, outdoor: boolean): number {
  const firstPage = model.texturePageStart[texture], endPage = model.texturePageStart[texture + 1];
  if (firstPage === undefined || endPage === undefined) throw new RangeError(`Lightmap texture ${texture} is outside the ${model.textureCount} textures.`);
  return firstPage + lightmapSlotAtHour(hour, endPage - firstPage, outdoor);
}

export function lightmapHourPages(model: TileLightingModel, texture: number): readonly number[] {
  const firstPage = model.texturePageStart[texture]!, endPage = model.texturePageStart[texture + 1]!;
  return Array.from({ length: endPage - firstPage }, (_, slot) => firstPage + slot);
}

function expandRgb565(colour: number): [number, number, number] {
  const red = (colour >> 11) & 31, green = (colour >> 5) & 63, blue = colour & 31;
  return [(red << 3) | (red >> 2), (green << 2) | (green >> 4), (blue << 3) | (blue >> 2)];
}

function blockPalette(first: number, second: number): number[][] {
  const colour0 = expandRgb565(first), colour1 = expandRgb565(second);
  const mix = (weight0: number, weight1: number, divisor: number) =>
    [0, 1, 2].map(channel => Math.floor((weight0 * colour0[channel]! + weight1 * colour1[channel]!) / divisor));
  if (first > second) return [[...colour0, 255], [...colour1, 255], [...mix(2, 1, 3), 255], [...mix(1, 2, 3), 255]];
  return [[...colour0, 255], [...colour1, 255], [...mix(1, 1, 2), 255], [0, 0, 0, 0]];
}

export function decodeDxt1Texels(blocks: Uint8Array, edge: number): Uint8Array {
  if (!Number.isSafeInteger(edge) || edge < dxt1BlockEdge || edge % dxt1BlockEdge !== 0) throw new RangeError(`DXT1 edge ${edge} is not a multiple of ${dxt1BlockEdge}.`);
  if (blocks.length !== dxt1ByteCount(edge)) throw new RangeError(`DXT1 page of edge ${edge} needs ${dxt1ByteCount(edge)} bytes, not ${blocks.length}.`);
  const rgba = new Uint8Array(edge * edge * rgbaChannels), blocksPerRow = edge / dxt1BlockEdge;
  const view = new DataView(blocks.buffer, blocks.byteOffset, blocks.byteLength);
  for (let block = 0; block < blocksPerRow * blocksPerRow; block++) {
    const offset = block * dxt1BlockBytes;
    const palette = blockPalette(view.getUint16(offset, true), view.getUint16(offset + 2, true));
    const selectors = view.getUint32(offset + 4, true);
    const blockX = (block % blocksPerRow) * dxt1BlockEdge, blockY = Math.floor(block / blocksPerRow) * dxt1BlockEdge;
    for (let texel = 0; texel < dxt1BlockEdge * dxt1BlockEdge; texel++) {
      const colour = palette[(selectors >>> (texel * 2)) & 3]!;
      rgba.set(colour, ((blockY + (texel >> 2)) * edge + blockX + (texel & 3)) * rgbaChannels);
    }
  }
  return rgba;
}
