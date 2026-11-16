import { HOURLY_LIGHTING_CONSTANTS } from "./hourlyLightingEngineConstants";
import { fColorFromPlane, saturatingAddBgra, type BgraBytes } from "./nativeColourBytes";
import { scalePlane, type NativePlane } from "./nativePlane";
import type { RgbBytes } from "./sampleNativeTimeTables";
import { lowByte, truncateToInt32 } from "./x87IntegerConversion";

export type TerrainVertexStaticBase =
  | { readonly status: "resolved"; readonly value: BgraBytes }
  | { readonly status: "unresolved"; readonly reason: "terrain-general-staticlight-sampleintensity" };

const { terrainLightPlaneScale, terrainIntensityDivisor, terrainIntensityMapWidth } = HOURLY_LIGHTING_CONSTANTS;
const opaqueAlpha = 255;
const blackOpaque: BgraBytes = [0, 0, 0, opaqueAlpha];
const terrainIntensityMapSampleCount = terrainIntensityMapWidth.value * terrainIntensityMapWidth.value;

export function terrainIntensitySampleIndex(column: number, row: number): number {
  const lastSample = terrainIntensityMapWidth.value - 1;
  if (!Number.isSafeInteger(column) || !Number.isSafeInteger(row) || column < 0 || row < 0 || column > lastSample || row > lastSample) {
    throw new RangeError(`Terrain intensity sample (${column}, ${row}) is outside the ${terrainIntensityMapWidth.value} x ${terrainIntensityMapWidth.value} map.`);
  }
  return row * terrainIntensityMapWidth.value + column;
}

export function truncatedTerrainIntensity(previousMap: Uint8Array, nextMap: Uint8Array, sampleIndex: number, weight: number): number {
  if (previousMap.length !== terrainIntensityMapSampleCount || nextMap.length !== terrainIntensityMapSampleCount) {
    throw new RangeError(`Terrain intensity maps hold ${previousMap.length} and ${nextMap.length} samples, not ${terrainIntensityMapSampleCount}.`);
  }
  const previousIntensity = previousMap[sampleIndex], nextIntensity = nextMap[sampleIndex];
  if (previousIntensity === undefined || nextIntensity === undefined) throw new RangeError(`Terrain intensity sample ${sampleIndex} is outside the maps.`);
  return lowByte(truncateToInt32(nextIntensity * weight + previousIntensity * (1 - weight)));
}

export function terrainVertexStaticBase(litBySerializedLight: boolean): TerrainVertexStaticBase {
  return litBySerializedLight ? { status: "unresolved", reason: "terrain-general-staticlight-sampleintensity" } : { status: "resolved", value: blackOpaque };
}

export function terrainVertexColour(staticBase: BgraBytes, terrainLight: NativePlane, truncatedIntensity: number, terrainAmbient: RgbBytes): BgraBytes {
  const intensity = Math.fround(truncatedIntensity / terrainIntensityDivisor.value);
  const litPlane = scalePlane(scalePlane(terrainLight, terrainLightPlaneScale.value), intensity);
  const light = fColorFromPlane([litPlane[0], litPlane[1], litPlane[2], 0]);
  const halvedAmbient: BgraBytes = [terrainAmbient[2] >> 1, terrainAmbient[1] >> 1, terrainAmbient[0] >> 1, opaqueAlpha];
  return saturatingAddBgra(staticBase, saturatingAddBgra(light, halvedAmbient));
}
