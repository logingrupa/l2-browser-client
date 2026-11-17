import { HOURLY_LIGHTING_CONSTANTS } from "./hourlyLightingEngineConstants";
import type { NativePlane } from "./nativePlane";
import { floorToInt32 } from "./x87IntegerConversion";

export type BgraBytes = readonly [blue: number, green: number, red: number, alpha: number];
export type RgbaBytes = readonly [red: number, green: number, blue: number, alpha: number];

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

export function saturatingAddBgra(left: BgraBytes, right: BgraBytes): BgraBytes {
  return [Math.min(byteMaximum, left[0] + right[0]), Math.min(byteMaximum, left[1] + right[1]), Math.min(byteMaximum, left[2] + right[2]),
    Math.min(byteMaximum, left[3] + right[3])];
}
