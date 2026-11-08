import { DISPLAY_GAMMA_CONSTANTS } from "./constants/displayGammaConstants";

export interface DisplayGammaSettings {
  readonly gamma: number;
  readonly brightness: number;
  readonly contrast: number;
}

export const DISPLAY_GAMMA_ENTRY_COUNT = 256;
const brightnessContrastScale = 32768 / 65535;

export function defaultDisplayGammaSettings(): DisplayGammaSettings {
  const { brightness, contrast } = DISPLAY_GAMMA_CONSTANTS.brightnessAndContrast.runtimeDefault;
  return { gamma: DISPLAY_GAMMA_CONSTANTS.gamma.runtimeDefault, brightness, contrast };
}

export function buildDisplayGammaTable(settings: DisplayGammaSettings): Float32Array {
  if (![settings.gamma, settings.brightness, settings.contrast].every(Number.isFinite) || settings.gamma < 0) {
    throw new RangeError("Display gamma settings must be finite with a non-negative gamma.");
  }
  return Float32Array.from({ length: DISPLAY_GAMMA_ENTRY_COUNT }, (_, entry) => {
    const input = entry / (DISPLAY_GAMMA_ENTRY_COUNT - 1);
    if (settings.gamma === 0) return input;
    const ramp = (settings.contrast + 0.5) * input ** (1 / settings.gamma) + (settings.brightness - settings.contrast) * brightnessContrastScale;
    return Math.min(1, Math.max(0, ramp));
  });
}
