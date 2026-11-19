import { saturatingAddBgra, type BgraBytes } from "../nativeColourBytes";
import type { NativePlane } from "../nativePlane";
import { floorToInt32, truncateToInt64LowDword } from "../../../shared/math/x87IntegerConversion";
import { LIGHTMAP_REBUILD_CONSTANTS } from "./lightmapRebuildEngineConstants";
import { rectangleWidth, type LightmapTexelRectangle } from "./lightmapRebuildTypes";

const { colourTableChannelScale, colourTableEntries } = LIGHTMAP_REBUILD_CONSTANTS;
const bytesPerEntry = 4;
const alphaByteOffset = 3;
const opaqueAlpha = 0xff;
const channelMaximum = 0xff;
const shiftBase = 0x20;
const shiftCountMask = 31;
const uint32Maximum = 0xffffffff;
const channelByteOffsets = [[0, 2], [1, 1], [2, 0]] as const;

export function ceilLogTwo(argument: number): number {
  if (!Number.isInteger(argument) || argument < 0 || argument > uint32Maximum) throw new RangeError(`appCeilLogTwo argument ${argument} is not a uint32.`);
  const predecessor = (argument - 1) >>> 0;
  return predecessor === uint32Maximum ? 0 : shiftBase - Math.clz32(predecessor);
}

function fillChannel(table: Uint8Array, channel: number, byteOffset: number): void {
  const shiftCount = ((shiftBase - ceilLogTwo(truncateToInt64LowDword(channel * colourTableChannelScale.value))) & 0xff) & shiftCountMask;
  const increment = floorToInt32(Math.fround(((1 << shiftCount) | 0) * channel));
  let accumulator = 0;
  for (let entry = 0; entry < colourTableEntries.value; entry++) {
    const shifted = accumulator >>> shiftCount;
    table[entry * bytesPerEntry + byteOffset] = shifted > channelMaximum ? channelMaximum : shifted;
    accumulator = (accumulator + increment) >>> 0;
  }
}

export function buildLightColourTable(colour: NativePlane): Uint8Array {
  const table = new Uint8Array(colourTableEntries.value * bytesPerEntry);
  for (const [planeIndex, byteOffset] of channelByteOffsets) fillChannel(table, colour[planeIndex], byteOffset);
  for (let entry = 0; entry < colourTableEntries.value; entry++) table[entry * bytesPerEntry + alphaByteOffset] = opaqueAlpha;
  return table;
}

function bgraAt(bytes: Uint8Array, offset: number): BgraBytes {
  return [bytes[offset]!, bytes[offset + 1]!, bytes[offset + 2]!, bytes[offset + 3]!];
}

export function addLightColourTableToPixels(
  pixels: Uint8Array, lightmapWidth: number, rectangle: LightmapTexelRectangle, intensities: Uint8Array, colourTable: Uint8Array,
): void {
  const width = rectangleWidth(rectangle);
  for (let y = rectangle.minimumY; y <= rectangle.maximumY; y++) {
    for (let x = rectangle.minimumX; x <= rectangle.maximumX; x++) {
      const pixelOffset = (y * lightmapWidth + x) * bytesPerEntry;
      const entryOffset = intensities[(y - rectangle.minimumY) * width + (x - rectangle.minimumX)]! * bytesPerEntry;
      pixels.set(saturatingAddBgra(bgraAt(pixels, pixelOffset), bgraAt(colourTable, entryOffset)), pixelOffset);
    }
  }
}
