import { LIGHTING_CONSTANTS } from "./constants/lightingConstants";
import type { ColourChannels } from "./combiner";
import type { ColourUnits } from "./materialFieldValues";

export type MaterialLighting = "unlit" | "lightmap";

export function applyModulate2xLighting(colour: ColourUnits, light: ColourChannels): ColourUnits {
  const multiplier = LIGHTING_CONSTANTS.modulate2x.runtimeDefault;
  const lit = (index: 0 | 1 | 2) => Math.min(1, Math.max(0, colour[index] * multiplier * light[index]));
  return [lit(0), lit(1), lit(2), colour[3]];
}
