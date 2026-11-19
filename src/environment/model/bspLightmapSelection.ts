import { ENVIRONMENT_ENGINE_CONSTANTS } from "./nativeEnvironmentEngineConstants";
import { truncateToInt32 } from "../../shared/math/x87IntegerConversion";

export type BspLightmapPageSource = "compressed-child" | "rebuilt-composite";

export const bspLiveCacheStateReason = "bsp-live-cache-state";

const { hoursPerDay } = ENVIRONMENT_ENGINE_CONSTANTS;

export function bspLightmapSlot(hour: number, childCount: number, sunAffect: boolean): number {
  if (!Number.isFinite(hour) || hour < 0 || hour >= hoursPerDay.value) throw new RangeError(`Lightmap hour ${hour} is outside [0, ${hoursPerDay.value}).`);
  if (!Number.isSafeInteger(childCount) || childCount < 1) throw new RangeError(`Lightmap child count ${childCount} must be a positive integer.`);
  if (!sunAffect) return 0;
  return truncateToInt32((childCount * Math.fround(hour)) / hoursPerDay.value) % childCount;
}

export function bspLightmapPageSource(revision: number, compressedRevision: number): BspLightmapPageSource {
  return revision === compressedRevision ? "compressed-child" : "rebuilt-composite";
}
