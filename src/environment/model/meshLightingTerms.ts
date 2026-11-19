import { HOURLY_LIGHTING_CONSTANTS } from "./hourlyLightingEngineConstants";
import { fColorFromPlane, type BgraBytes, type RgbaBytes } from "./nativeColourBytes";
import type { NativePlane } from "./nativePlane";
import type { RgbBytes } from "./sampleNativeTimeTables";
import { lowByte, truncateToInt32 } from "../../shared/math/x87IntegerConversion";

export type AmbientLight<Reason extends string> =
  | { readonly status: "resolved"; readonly value: RgbaBytes }
  | { readonly status: "unresolved"; readonly reason: Reason };

export interface StaticMeshAmbientInputs {
  readonly hourlyAmbient: RgbBytes;
  readonly selectedLevelOfDetail: number;
  readonly hasStaticMeshInstance: boolean;
  readonly staticSunPlane: NativePlane;
}

const { staticMeshSunTermScale, staticMeshSunTermLevelOfDetail } = HOURLY_LIGHTING_CONSTANTS;
const opaqueAlpha = 255;
const byteMaximum = 255;

function halvedAmbient(ambient: RgbBytes): RgbaBytes {
  return [ambient[0] >> 1, ambient[1] >> 1, ambient[2] >> 1, opaqueAlpha];
}

function sunTermChannel(halvedChannel: number, sunChannel: number): number {
  return Math.min(byteMaximum, lowByte(truncateToInt32(sunChannel * staticMeshSunTermScale.value)) + halvedChannel);
}

export function staticMeshAmbientLight(inputs: StaticMeshAmbientInputs): RgbaBytes {
  const halved = halvedAmbient(inputs.hourlyAmbient);
  if (inputs.hasStaticMeshInstance || inputs.selectedLevelOfDetail !== staticMeshSunTermLevelOfDetail.value) return halved;
  const plane = inputs.staticSunPlane;
  return [sunTermChannel(halved[0], plane[0]), sunTermChannel(halved[1], plane[1]), sunTermChannel(halved[2], plane[2]), opaqueAlpha];
}

export function staticMeshRenderDataAmbient(touchedZoneAmbientVectors: readonly NativePlane[], ambientGlow: number): BgraBytes {
  const glow = Math.fround(ambientGlow / byteMaximum);
  const maximum = [0, 0, 0];
  for (const vector of touchedZoneAmbientVectors) for (let channel = 0; channel < maximum.length; channel += 1) maximum[channel] = Math.max(maximum[channel]!, vector[channel]!);
  return fColorFromPlane([Math.fround(maximum[0]! + glow), Math.fround(maximum[1]! + glow), Math.fround(maximum[2]! + glow), 0]);
}

export function staticMeshRenderDataAmbientLight(renderDataAmbient: BgraBytes): RgbaBytes {
  return halvedAmbient([renderDataAmbient[2], renderDataAmbient[1], renderDataAmbient[0]]);
}

export function actorAmbientLight(hourlyAmbient: RgbBytes, actorSunAffect: boolean): AmbientLight<"actor-unhourly-ambient-unresolved"> {
  return actorSunAffect ? { status: "resolved", value: halvedAmbient(hourlyAmbient) } : { status: "unresolved", reason: "actor-unhourly-ambient-unresolved" };
}
