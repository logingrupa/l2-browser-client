import { DISPLAY_GAMMA_CONSTANTS } from "./constants/displayGammaConstants";

export interface DisplayGammaSettings {
  readonly gamma: number;
  readonly brightness: number;
  readonly contrast: number;
}

export const DISPLAY_GAMMA_ENTRY_COUNT = 256;
const rampEntryMaximum = 65535;
const rampHalfRange = 32768;
const rampQuarterRange = 16384;
const int32Minimum = -(2 ** 31);
const int32Maximum = 2 ** 31 - 1;

export function defaultDisplayGammaSettings(): DisplayGammaSettings {
  const { brightness, contrast } = DISPLAY_GAMMA_CONSTANTS.brightnessAndContrast.runtimeDefault;
  return { gamma: DISPLAY_GAMMA_CONSTANTS.gamma.runtimeDefault, brightness, contrast };
}

function runtimeLibraryPower(base: number, exponent: number): number {
  return base === 1 && exponent === Infinity ? 1 : base ** exponent;
}

function roundHalfUpToInt32(value: number): number {
  const rounded = Math.floor(value + 0.5);
  return rounded >= int32Minimum && rounded <= int32Maximum ? rounded : int32Minimum;
}

export function buildDisplayGammaTable(settings: DisplayGammaSettings): Float32Array {
  if (![settings.gamma, settings.brightness, settings.contrast].every(Number.isFinite) || settings.gamma < 0) {
    throw new RangeError("Display gamma settings must be finite with a non-negative gamma.");
  }
  const gamma = Math.fround(settings.gamma), brightness = Math.fround(settings.brightness), contrast = Math.fround(settings.contrast);
  const curveExponent = 1 / gamma;
  return Float32Array.from({ length: DISPLAY_GAMMA_ENTRY_COUNT }, (_, entry) => {
    const curvedInput = runtimeLibraryPower(entry / (DISPLAY_GAMMA_ENTRY_COUNT - 1), curveExponent);
    const rampValue = Math.fround((contrast + 0.5) * curvedInput * rampEntryMaximum + (brightness - 0.5) * rampHalfRange - contrast * rampHalfRange + rampQuarterRange);
    return Math.min(rampEntryMaximum, Math.max(0, roundHalfUpToInt32(rampValue))) / rampEntryMaximum;
  });
}
