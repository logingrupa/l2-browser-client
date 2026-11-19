import { HOURLY_LIGHTING_CONSTANTS } from "./hourlyLightingEngineConstants";
import type { NativePlane } from "./nativePlane";
import { floorToInt32 } from "../../shared/math/x87IntegerConversion";

export type BgraBytes = readonly [blue: number, green: number, red: number, alpha: number];
export type RgbaBytes = readonly [red: number, green: number, blue: number, alpha: number];
export type BgrBytes = readonly [blue: number, green: number, red: number];

const { colourChannelScale } = HOURLY_LIGHTING_CONSTANTS;
const byteMaximum = 255;

function clampedByte(value: number): number {
  if (value < 0) return 0;
  return value >= byteMaximum ? byteMaximum : value;
}

function colourChannelByte(channel: number): number {
  return clampedByte(floorToInt32(Math.fround(channel * colourChannelScale.value)));
}

export function fColorFromPlane(plane: NativePlane): BgraBytes {
  return [colourChannelByte(plane[2]), colourChannelByte(plane[1]), colourChannelByte(plane[0]), colourChannelByte(plane[3])];
}

const saturatingByteSum = (left: number, right: number) => Math.min(byteMaximum, left + right);

export function saturatingAddBgra(left: BgraBytes, right: BgraBytes): BgraBytes {
  return [saturatingByteSum(left[0], right[0]), saturatingByteSum(left[1], right[1]), saturatingByteSum(left[2], right[2]), saturatingByteSum(left[3], right[3])];
}

export function saturatingAddBgr(left: BgrBytes, right: BgrBytes): BgrBytes {
  return [saturatingByteSum(left[0], right[0]), saturatingByteSum(left[1], right[1]), saturatingByteSum(left[2], right[2])];
}

export function bgrOf(colour: BgraBytes): BgrBytes {
  return [colour[0], colour[1], colour[2]];
}
