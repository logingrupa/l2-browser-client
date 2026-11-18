import { LIGHTMAP_REBUILD_CONSTANTS } from "./lightmapRebuildEngineConstants";
import { float32Bits, float32FromBits } from "./nativeFloatOperations";

export interface LightingTables {
  readonly attenuation: Float32Array;
  readonly shadowPatterns: Uint32Array;
  readonly inverseSquareRootMantissa: Float32Array;
  readonly inverseSquareRootExponent: Float32Array;
}

const {
  attenuationTableSize, attenuationSampleStep, attenuationCubicCoefficient, attenuationCubicConstant,
  shadowKernelRows, shadowPatternCount, inverseSquareRootPower, inverseSquareRootTableSizes,
} = LIGHTMAP_REBUILD_CONSTANTS;

export const shadowPatternRowsPerEntry = 4;
const shadowPatternLanes = 4;
const bitsPerLane = 8;
const byteMaximum = 0xff;
const float32OneBits = 0x3f800000;
const float32ExponentShift = 23;
const mantissaIndexShift = 13;
const mantissaIndexMask = 0x3ff;

function buildAttenuationTable(): Float32Array {
  const table = new Float32Array(attenuationTableSize.value);
  for (let index = 0; index < table.length; index++) {
    const falloff = Math.fround(Math.sqrt((index + 1) * attenuationSampleStep.value));
    const cubic = Math.fround(((falloff + falloff) * falloff) * falloff - (falloff * attenuationCubicCoefficient.value) * falloff
      + attenuationCubicConstant.value);
    table[index] = Math.fround(cubic / falloff);
  }
  return table;
}

function shadowKernel(): readonly (readonly number[])[] {
  const { edgeRow, centreRow } = shadowKernelRows.value;
  return [edgeRow, centreRow, edgeRow, []];
}

function buildShadowPatternTable(): Uint32Array {
  const kernel = shadowKernel();
  const kernelTotal = kernel.flat().reduce((total, weight) => total + weight, 0);
  const table = new Uint32Array(shadowPatternCount.value * shadowPatternRowsPerEntry);
  for (let pattern = 0; pattern < shadowPatternCount.value; pattern++) {
    kernel.forEach((kernelRow, rowIndex) => {
      let packedLanes = 0;
      for (let lane = 0; lane < shadowPatternLanes; lane++) {
        const weightSum = kernelRow.reduce((sum, weight, column) => (pattern & (1 << (column + lane))) !== 0 ? sum + weight : sum, 0);
        packedLanes += Math.trunc((weightSum * byteMaximum) / kernelTotal) * 2 ** (bitsPerLane * lane);
      }
      table[pattern * shadowPatternRowsPerEntry + rowIndex] = packedLanes;
    });
  }
  return table;
}

function powerTableEntry(base: number): number {
  const magnitude = base < 0 || Number.isNaN(base) ? -base : base;
  const power = Math.fround(Math.pow(magnitude, Math.fround(inverseSquareRootPower.value)));
  return Number.isNaN(power) ? 0 : power;
}

function buildInverseSquareRootExponentTable(): Float32Array {
  const table = new Float32Array(inverseSquareRootTableSizes.value.exponentEntries);
  for (let exponent = 0; exponent < table.length; exponent++) table[exponent] = powerTableEntry(float32FromBits((exponent << float32ExponentShift) >>> 0));
  return table;
}

function buildInverseSquareRootMantissaTable(): Float32Array {
  const table = new Float32Array(inverseSquareRootTableSizes.value.mantissaEntries);
  for (let mantissa = 0; mantissa < table.length; mantissa++) table[mantissa] = powerTableEntry(float32FromBits(float32OneBits + (mantissa << mantissaIndexShift)));
  return table;
}

export function buildLightingTables(): LightingTables {
  return {
    attenuation: buildAttenuationTable(),
    shadowPatterns: buildShadowPatternTable(),
    inverseSquareRootMantissa: buildInverseSquareRootMantissaTable(),
    inverseSquareRootExponent: buildInverseSquareRootExponentTable(),
  };
}

export function inverseSquareRootLookup(tables: LightingTables, value: number): number {
  const bits = float32Bits(value);
  return Math.fround(tables.inverseSquareRootMantissa[(bits >>> mantissaIndexShift) & mantissaIndexMask]!
    * tables.inverseSquareRootExponent[bits >>> float32ExponentShift]!);
}
