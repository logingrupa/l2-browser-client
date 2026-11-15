import { evaluateFogState, type CameraZoneFogRecord, type FogState } from "../../materials/ue2/babylon/material";
import type { Vector3 } from "../../shared/math/vector3";
import type { TileVisibilityFrame } from "./bspVisibility/core/tileVisibilityFrame";
import type { CollisionWorld } from "./movement/core/collisionWorld";
import type { MovementNativeRules } from "./movement/core/movementRules";
import { volumesContaining, type ContainingVolume } from "./movement/core/volumeContainment";
import type { TileLightingRecords } from "./lighting/tileLightingRecords";

export interface CameraEnvironmentCollision {
  readonly world: CollisionWorld;
  readonly rules: MovementNativeRules;
}

export interface CameraEnvironmentSources {
  readonly frame: TileVisibilityFrame | null;
  readonly cameraSourcePosition: Vector3 | null;
  readonly collision: CameraEnvironmentCollision | null;
  readonly records: TileLightingRecords;
}

export interface CameraEnvironment {
  readonly cameraZone: number;
  readonly containingVolume: ContainingVolume | null;
  readonly fog: FogState;
  readonly gaps: readonly string[];
}

const noCameraZone = -1;
export const cameraEnvironmentGaps = {
  environmentPresetUnselected: "environment-fog-preset-unselected",
  cameraZoneUnknown: "camera-zone-unknown",
  fogInfoRangeUnparsed: "fog-info-range-unparsed",
  volumeQueryUnbound: "camera-volume-query-unbound",
  volumeWaterFlagAbsent: "camera-volume-water-flag-absent",
  volumePriorityUnknown: "camera-volume-priority-unknown",
  waterVolumeUnlinked: "lighting-water-volume-unlinked",
} as const;

function cameraZoneFog(cameraZone: number, records: TileLightingRecords, gaps: string[]): CameraZoneFogRecord | null {
  if (cameraZone === noCameraZone) { gaps.push(cameraEnvironmentGaps.cameraZoneUnknown); return null; }
  const zone = records.zones.find(record => record.zoneIndex === cameraZone);
  if (zone === undefined) { gaps.push(`lighting-zone-unlisted:${cameraZone}`); return null; }
  if (zone.unresolvedReason !== null) gaps.push(zone.unresolvedReason);
  return zone.fog;
}

function cameraVolume(sources: CameraEnvironmentSources, gaps: string[]): ContainingVolume | null {
  if (sources.collision === null || sources.cameraSourcePosition === null) { gaps.push(cameraEnvironmentGaps.volumeQueryUnbound); return null; }
  const containing = volumesContaining(sources.collision.world, sources.cameraSourcePosition, sources.collision.rules);
  if (containing.length === 0) return null;
  gaps.push(cameraEnvironmentGaps.volumeWaterFlagAbsent);
  if (containing.length > 1) { gaps.push(cameraEnvironmentGaps.volumePriorityUnknown); return null; }
  return containing[0]!;
}

export function computeCameraEnvironment(sources: CameraEnvironmentSources): CameraEnvironment {
  const gaps: string[] = [cameraEnvironmentGaps.environmentPresetUnselected];
  const cameraZone = sources.frame?.cameraZone ?? noCameraZone;
  const zoneFog = cameraZoneFog(cameraZone, sources.records, gaps);
  if (sources.records.fogInfoCount > 0) gaps.push(cameraEnvironmentGaps.fogInfoRangeUnparsed);
  if (sources.records.waterVolumeCount > 0) gaps.push(cameraEnvironmentGaps.waterVolumeUnlinked);
  const containingVolume = cameraVolume(sources, gaps);
  const fog = evaluateFogState({ environmentPreset: null, cameraZone: zoneFog, fogInfo: null, waterVolume: null });
  return { cameraZone, containingVolume, fog, gaps };
}
