import { LIGHTMAP_REBUILD_CONSTANTS } from "./lightmapRebuildEngineConstants";
import { rectangleHeight, rectangleWidth, type FilteredShadowMask, type PackedShadowRecord } from "./lightmapRebuildTypes";
import { shadowPatternRowsPerEntry } from "./lightingTables";

const { maskBitsPerByte } = LIGHTMAP_REBUILD_CONSTANTS;
const fullyLitByte = 0xff;
const windowNextByteShift = 10;
const windowLeftEdgeBit = 0x400;
const windowLeftEdgeFill = 0x300;
const windowRightEdgeBit = 0x200;
const windowRightEdgeFill = 0xc00;
const windowPatternMask = 0x7f;
const windowHighHalfShift = 4;
const pixelsPerPattern = 4;
const kernelRowCount = 3;

function requireConsistentMultiRowRecord(record: PackedShadowRecord): void {
  if (record.height < 2 || record.height !== rectangleHeight(record) || record.bits.length !== record.height * record.rowBytes) {
    throw new RangeError(`Shadow record rows ${record.height}, rectangle height ${rectangleHeight(record)} and ${record.bits.length} mask bytes for ${record.rowBytes} row bytes do not form a multi-row mask.`);
  }
}

function addPatternLanes(filtered: Uint8Array, shadowPatterns: Uint32Array, pattern: number, outputRows: readonly number[], rowStride: number, firstPixel: number): void {
  for (let kernelRow = 0; kernelRow < kernelRowCount; kernelRow++) {
    const packedLanes = shadowPatterns[pattern * shadowPatternRowsPerEntry + kernelRow]!;
    const rowOffset = outputRows[kernelRow]! * rowStride + firstPixel;
    for (let lane = 0; lane < pixelsPerPattern; lane++) filtered[rowOffset + lane] = filtered[rowOffset + lane]! + ((packedLanes >>> (8 * lane)) & 0xff);
  }
}

function filterMaskRow(filtered: Uint8Array, record: PackedShadowRecord, shadowPatterns: Uint32Array, maskRow: number, rowStride: number): void {
  const { bits, rowBytes } = record;
  const rowStart = maskRow * rowBytes;
  const outputRows = [Math.max(maskRow - 1, 0), maskRow, Math.min(maskRow + 1, record.height - 1)];
  let maskBitWindow = bits[rowStart]! << windowNextByteShift;
  if ((maskBitWindow & windowLeftEdgeBit) !== 0) maskBitWindow |= windowLeftEdgeFill;
  for (let byteIndex = 0; byteIndex < rowBytes; byteIndex++) {
    maskBitWindow >>>= 8;
    const rightEdgeFill = (maskBitWindow & windowRightEdgeBit) !== 0 ? windowRightEdgeFill : 0;
    maskBitWindow += byteIndex < rowBytes - 1 ? bits[rowStart + byteIndex + 1]! << windowNextByteShift : rightEdgeFill;
    const firstPixel = byteIndex * maskBitsPerByte.value;
    addPatternLanes(filtered, shadowPatterns, maskBitWindow & windowPatternMask, outputRows, rowStride, firstPixel);
    addPatternLanes(filtered, shadowPatterns, (maskBitWindow >>> windowHighHalfShift) & windowPatternMask, outputRows, rowStride, firstPixel + pixelsPerPattern);
  }
}

export function filterPackedShadowMask(record: PackedShadowRecord, shadowPatterns: Uint32Array): FilteredShadowMask {
  if (record.minimumY === record.maximumY) {
    const width = rectangleWidth(record);
    return { bytes: new Uint8Array(width).fill(fullyLitByte), rowStride: width };
  }
  requireConsistentMultiRowRecord(record);
  const rowStride = record.rowBytes * maskBitsPerByte.value;
  const bytes = new Uint8Array(record.height * rowStride);
  for (let maskRow = 0; maskRow < record.height; maskRow++) filterMaskRow(bytes, record, shadowPatterns, maskRow, rowStride);
  return { bytes, rowStride };
}
