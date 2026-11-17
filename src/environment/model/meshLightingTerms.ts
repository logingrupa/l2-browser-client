import { HOURLY_LIGHTING_CONSTANTS } from "./hourlyLightingEngineConstants";
import type { RgbaBytes } from "./nativeColourBytes";
import type { NativePlane } from "./nativePlane";
import type { RgbBytes } from "./sampleNativeTimeTables";
import { lowByte, truncateToInt32 } from "./x87IntegerConversion";

export type AmbientLight<Reason extends string> =
  | { readonly status: "resolved"; readonly value: RgbaBytes }
  | { readonly status: "unresolved"; readonly reason: Reason };

export interface StaticMeshAmbientInputs {
  readonly hourlyAmbient: RgbBytes;
  readonly actorSunAffect: boolean;
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

export function staticMeshAmbientLight(inputs: StaticMeshAmbientInputs): AmbientLight<"static-mesh-unhourly-ambient-unresolved"> {
  if (!inputs.actorSunAffect) return { status: "unresolved", reason: "static-mesh-unhourly-ambient-unresolved" };
  const halved = halvedAmbient(inputs.hourlyAmbient);
  if (inputs.hasStaticMeshInstance || inputs.selectedLevelOfDetail !== staticMeshSunTermLevelOfDetail.value) return { status: "resolved", value: halved };
  const plane = inputs.staticSunPlane;
  return { status: "resolved", value: [sunTermChannel(halved[0], plane[0]), sunTermChannel(halved[1], plane[1]), sunTermChannel(halved[2], plane[2]), opaqueAlpha] };
}

export function actorAmbientLight(hourlyAmbient: RgbBytes, actorSunAffect: boolean): AmbientLight<"actor-unhourly-ambient-unresolved"> {
  return actorSunAffect ? { status: "resolved", value: halvedAmbient(hourlyAmbient) } : { status: "unresolved", reason: "actor-unhourly-ambient-unresolved" };
}
