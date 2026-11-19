import { truncateToInt32 } from "../../../shared/math/x87IntegerConversion";
import { createIntensityBuffer, falloffGeometry, type ShadowAttenuationInput } from "./lightAttenuationGeometry";
import { LIGHTMAP_REBUILD_CONSTANTS } from "./lightmapRebuildEngineConstants";
import { rectangleWidth, type NativeVector3 } from "./lightmapRebuildTypes";
import { dotProductFloat32, float32Bits, roundToInt32 } from "./nativeFloatOperations";

const { pointFalloffFixedPointScale, forwardDifferenceFactor, pointFalloffAccumulatorLimit, floatRoundingBias } = LIGHTMAP_REBUILD_CONSTANTS;
const accumulatorIndexShift = 12;

interface ForwardDifferences {
  readonly rowAccumulator: number;
  readonly rowDelta: number;
  readonly rowDeltaStep: number;
  readonly columnDelta: number;
  readonly columnDeltaRowStep: number;
  readonly columnDeltaStep: number;
}

function forwardDifferences(input: ShadowAttenuationInput, firstTexelOffset: NativeVector3, indexScale: number): ForwardDifferences {
  const { uStep, vStep } = input.lightmap;
  const scale = Math.fround(indexScale * pointFalloffFixedPointScale.value);
  const quantise = (product: number) => Math.fround(roundToInt32(Math.fround(scale * product)));
  const distanceSquared = quantise(dotProductFloat32(firstTexelOffset, firstTexelOffset));
  const alongU = quantise(dotProductFloat32(uStep, firstTexelOffset));
  const alongV = quantise(dotProductFloat32(vStep, firstTexelOffset));
  const uSquared = quantise(dotProductFloat32(uStep, uStep));
  const vSquared = quantise(dotProductFloat32(vStep, vStep));
  const uDotV = quantise(dotProductFloat32(vStep, uStep));
  const doubled = (value: number) => forwardDifferenceFactor.value * value;
  return {
    rowAccumulator: truncateToInt32(distanceSquared),
    rowDelta: truncateToInt32(doubled(alongV) + vSquared),
    rowDeltaStep: truncateToInt32(doubled(vSquared)),
    columnDelta: truncateToInt32(doubled(alongU) + uSquared),
    columnDeltaRowStep: truncateToInt32(doubled(uDotV)),
    columnDeltaStep: truncateToInt32(doubled(uSquared)),
  };
}

function falloffByte(maskByte: number, planeFactor: number, attenuation: number): number {
  return float32Bits((maskByte * planeFactor) * attenuation + floatRoundingBias.value) & 0xff;
}

export function attenuatePointFalloff(input: ShadowAttenuationInput, position: NativeVector3, radius: number): Uint8Array {
  const { filteredMask, record, tables } = input;
  const { indexScale, planeFactor, firstTexelOffset } = falloffGeometry(input, position, radius);
  const differences = forwardDifferences(input, firstTexelOffset, indexScale);
  const intensities = createIntensityBuffer(record);
  const width = rectangleWidth(record);
  let { rowAccumulator, rowDelta, columnDelta } = differences;
  for (let row = 0; row <= record.maximumY - record.minimumY; row++) {
    let accumulator = rowAccumulator, columnStep = columnDelta;
    for (let column = 0; column < width; column++) {
      const maskByte = filteredMask.bytes[row * filteredMask.rowStride + column]!;
      const unsignedAccumulator = accumulator >>> 0;
      intensities[row * width + column] = maskByte === 0 || unsignedAccumulator >= pointFalloffAccumulatorLimit.value ? 0
        : falloffByte(maskByte, planeFactor, tables.attenuation[unsignedAccumulator >>> accumulatorIndexShift]!);
      accumulator = (accumulator + columnStep) | 0;
      columnStep = (columnStep + differences.columnDeltaStep) | 0;
    }
    rowAccumulator = (rowAccumulator + rowDelta) | 0;
    rowDelta = (rowDelta + differences.rowDeltaStep) | 0;
    columnDelta = (columnDelta + differences.columnDeltaRowStep) | 0;
  }
  return intensities;
}
