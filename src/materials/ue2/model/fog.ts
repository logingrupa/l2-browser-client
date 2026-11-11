import type { FogFamily } from "./constants/blendFactorTypes";
import { FOG_CONSTANTS } from "./constants/fogConstants";

export type FogColourBytes = readonly [number, number, number];
export type FogSourceName = "environment-preset" | "camera-zone" | "fog-info" | "water-volume";

export interface FogRangeRecord {
  readonly colourBytes: FogColourBytes;
  readonly startSourceUnits: number;
  readonly endSourceUnits: number;
}

export interface CameraZoneFogRecord {
  readonly distanceFog: boolean;
  readonly sunAffected: boolean;
  readonly fog: FogRangeRecord | null;
}

export interface FogInputs {
  readonly environmentPreset: FogRangeRecord | null;
  readonly cameraZone: CameraZoneFogRecord | null;
  readonly fogInfo: FogRangeRecord | null;
  readonly waterVolume: FogRangeRecord | null;
}

export interface FogState {
  readonly enabled: boolean;
  readonly source: FogSourceName | "none" | "zone-without-fog";
  readonly colour: readonly [number, number, number];
  readonly startSourceUnits: number;
  readonly endSourceUnits: number;
  readonly fogEnd: number | null;
}

export const FOG_DISABLED: FogState = { enabled: false, source: "none", colour: [0, 0, 0], startSourceUnits: 0, endSourceUnits: 0, fogEnd: null };

function requireFogRange(record: FogRangeRecord, source: FogSourceName): void {
  if (!record.colourBytes.every(channel => Number.isInteger(channel) && channel >= 0 && channel <= 255)) {
    throw new RangeError(`Fog ${source} colour must be three bytes.`);
  }
  if (!Number.isFinite(record.startSourceUnits) || !Number.isFinite(record.endSourceUnits) || record.endSourceUnits <= record.startSourceUnits) {
    throw new RangeError(`Fog ${source} range ${record.startSourceUnits} to ${record.endSourceUnits} must be finite and increasing.`);
  }
}

function enabledFog(record: FogRangeRecord, source: FogSourceName): FogState {
  requireFogRange(record, source);
  return {
    enabled: true, source, colour: [record.colourBytes[0] / 255, record.colourBytes[1] / 255, record.colourBytes[2] / 255],
    startSourceUnits: record.startSourceUnits, endSourceUnits: record.endSourceUnits, fogEnd: record.endSourceUnits,
  };
}

function cameraZoneFog(zone: CameraZoneFogRecord, earlier: FogState): FogState {
  if (zone.distanceFog) {
    if (zone.fog === null) throw new RangeError("A camera zone with distance fog needs its fog range.");
    return enabledFog(zone.fog, "camera-zone");
  }
  return zone.sunAffected ? earlier : { ...FOG_DISABLED, source: "zone-without-fog" };
}

export function evaluateFogState(inputs: FogInputs): FogState {
  let state = inputs.environmentPreset ? enabledFog(inputs.environmentPreset, "environment-preset") : FOG_DISABLED;
  if (inputs.cameraZone) state = cameraZoneFog(inputs.cameraZone, state);
  if (inputs.fogInfo) state = enabledFog(inputs.fogInfo, "fog-info");
  if (inputs.waterVolume) state = enabledFog(inputs.waterVolume, "water-volume");
  return state;
}

export function fogTargetColour(family: FogFamily, state: FogState): readonly [number, number, number] | null {
  if (!state.enabled) return null;
  switch (family) {
    case "fog-colour": return state.colour;
    case "black": return [0, 0, 0];
    case "neutral-grey": {
      const grey = FOG_CONSTANTS.neutralGreyByte.runtimeDefault / 255;
      return [grey, grey, grey];
    }
    case "none": return null;
  }
}
