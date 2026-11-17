import { ENVIRONMENT_ENGINE_CONSTANTS } from "./nativeEnvironmentEngineConstants";
import type { RgbBytes } from "./sampleNativeTimeTables";
import { truncateToInt32 } from "./x87IntegerConversion";

export type BspCompressedLightmapGate =
  | { readonly status: "compressed" }
  | { readonly status: "unresolved"; readonly reason: "bsp-live-cache-state" };

const { hoursPerDay, bspAmbientScale } = ENVIRONMENT_ENGINE_CONSTANTS;

export function bspLightmapSlot(hour: number, childCount: number, sunAffect: boolean): number {
  if (!Number.isFinite(hour) || hour < 0 || hour >= hoursPerDay.value) throw new RangeError(`Lightmap hour ${hour} is outside [0, ${hoursPerDay.value}).`);
  if (!Number.isSafeInteger(childCount) || childCount < 1) throw new RangeError(`Lightmap child count ${childCount} must be a positive integer.`);
  if (!sunAffect) return 0;
  return truncateToInt32((childCount * Math.fround(hour)) / hoursPerDay.value) % childCount;
}

export function bspCompressedLightmapGate(revision: number, compressedRevision: number): BspCompressedLightmapGate {
  return revision === compressedRevision ? { status: "compressed" } : { status: "unresolved", reason: "bsp-live-cache-state" };
}

export function bspLightmapRebuildAmbient(ambient: RgbBytes): RgbBytes {
  return [Math.trunc(ambient[0] * bspAmbientScale.value), Math.trunc(ambient[1] * bspAmbientScale.value), Math.trunc(ambient[2] * bspAmbientScale.value)];
}
