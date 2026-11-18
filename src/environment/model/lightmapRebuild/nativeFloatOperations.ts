import { floorToInt32, lowByte, truncateToInt32 } from "../x87IntegerConversion";
import type { NativeVector3 } from "./lightmapRebuildTypes";

const float32Scratch = new Float32Array(1);
const uint32Scratch = new Uint32Array(float32Scratch.buffer);

export function float32Bits(value: number): number {
  float32Scratch[0] = value;
  return uint32Scratch[0]!;
}

export function float32FromBits(bits: number): number {
  uint32Scratch[0] = bits;
  return float32Scratch[0]!;
}

export function absoluteFloat32(value: number): number {
  return Math.fround(value < 0 || Number.isNaN(value) ? -value : value);
}

export function maximumFloat32(first: number, second: number): number {
  return Math.fround(second > first || Number.isNaN(second) || Number.isNaN(first) ? second : first);
}

export function roundToInt32(value: number): number {
  return truncateToInt32(Math.floor(value + 0.5));
}

export function floorToLowByte(value: number): number {
  return lowByte(floorToInt32(Math.fround(value)));
}

export function dotProductFloat32(first: NativeVector3, second: NativeVector3): number {
  return Math.fround((first[0] * second[0] + first[1] * second[1]) + first[2] * second[2]);
}
