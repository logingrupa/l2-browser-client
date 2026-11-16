import { ENVIRONMENT_ENGINE_CONSTANTS } from "./nativeEnvironmentEngineConstants";
import type { NativePlane } from "./nativePlane";

const { hsvBrightness, byteMaximum, hsvHueSegments } = ENVIRONMENT_ENGINE_CONSTANTS;

function clampedBrightness(value: number): number {
  const scaled = Math.fround(value * hsvBrightness.value.scale / byteMaximum.value);
  const brightness = Math.fround(hsvBrightness.value.numerator / (Math.sqrt(scaled) + hsvBrightness.value.bias) * scaled);
  if (brightness < 0) return 0;
  return brightness >= 1 ? 1 : brightness;
}

function hueVector(hue: number): readonly [number, number, number] {
  const { firstBoundary, secondBoundary, segment, lastSegment } = hsvHueSegments.value;
  const segmentPart = (numerator: number, denominator: number) => Math.fround(numerator / denominator);
  if (hue < firstBoundary) return [segmentPart(segment - hue, segment), segmentPart(hue, segment), 0];
  if (hue < secondBoundary) return [0, segmentPart(2 * segment - hue, segment), segmentPart(hue - segment, segment)];
  return [segmentPart(hue - 2 * segment, segment), 0, segmentPart(byteMaximum.value - hue, lastSegment)];
}

function saturatedChannel(hueChannel: number, saturation: number, brightness: number): number {
  const remaining = Math.fround(1 - hueChannel);
  const lifted = Math.fround(hueChannel + Math.fround(remaining * saturation));
  return Math.fround(lifted * brightness);
}

export function fGetHsv(hue: number, saturation: number, value: number): NativePlane {
  const brightness = clampedBrightness(value);
  const [red, green, blue] = hueVector(hue);
  const saturationFraction = Math.fround(saturation / byteMaximum.value);
  return [saturatedChannel(red, saturationFraction, brightness), saturatedChannel(green, saturationFraction, brightness),
    saturatedChannel(blue, saturationFraction, brightness), 1];
}
