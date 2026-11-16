import { evaluateFogState, type CameraZoneFogRecord, type FogRangeRecord, type FogState } from "../../materials/ue2/babylon/material";
import { FOG_CONSTANTS } from "../../materials/ue2/model/constants/fogConstants";
import { environmentFogBaseline, localFogListRecord, type EnvironmentFogRanges } from "../../materials/ue2/model/fog";
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
  readonly environmentFogRanges: EnvironmentFogRanges | null;
  readonly hour: number;
}

export interface CameraEnvironment {
  readonly cameraZone: number;
  readonly containingVolume: ContainingVolume | null;
  readonly fog: FogState;
  readonly gaps: readonly string[];
}

const noCameraZone = -1;
export const cameraEnvironmentGaps = {
  cameraZoneUnknown: "camera-zone-unknown",
  fogInfoTerrainClipRangeUnresolved: "fog-info-terrain-clip-range-unresolved",
  fogInfoReferencePositionUnresolved: "fog-info-reference-position-unresolved",
  fogInfoListProducerUnresolved: "fog-info-list-producer-unresolved",
  environmentFogRangesUnresolved: "environment-fog-ranges-unresolved",
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

function localFogList(sources: CameraEnvironmentSources, gaps: string[]): FogRangeRecord | null {
  const { records: { fogInfos }, environmentFogRanges } = sources;
  if (fogInfos.length === 0) return null;
  for (const fogInfo of fogInfos) if (fogInfo.unresolvedReason !== null) gaps.push(fogInfo.unresolvedReason);
  const terrainClipRange = FOG_CONSTANTS.terrainClipRange.runtimeDefault;
  const referencePosition = FOG_CONSTANTS.fadeReferencePosition.runtimeDefault === "camera" ? sources.cameraSourcePosition : null;
  const listProducer = FOG_CONSTANTS.localListProducer.runtimeDefault;
  if (terrainClipRange === null) gaps.push(cameraEnvironmentGaps.fogInfoTerrainClipRangeUnresolved);
  if (referencePosition === null) gaps.push(cameraEnvironmentGaps.fogInfoReferencePositionUnresolved);
  if (listProducer === null) gaps.push(cameraEnvironmentGaps.fogInfoListProducerUnresolved);
  if (environmentFogRanges === null) gaps.push(cameraEnvironmentGaps.environmentFogRangesUnresolved);
  const resolvedFogInfos = fogInfos.flatMap(fogInfo => fogInfo.record === null ? [] : [fogInfo.record]);
  if (terrainClipRange === null || referencePosition === null || listProducer === null || environmentFogRanges === null || resolvedFogInfos.length === 0) return null;
  return localFogListRecord(resolvedFogInfos, environmentFogBaseline(environmentFogRanges, terrainClipRange),
    { hour: sources.hour, terrainClipRange, referencePosition });
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
  const gaps: string[] = [];
  const cameraZone = sources.frame?.cameraZone ?? noCameraZone;
  const zoneFog = cameraZoneFog(cameraZone, sources.records, gaps);
  const localFog = localFogList(sources, gaps);
  if (sources.records.waterVolumeCount > 0) gaps.push(cameraEnvironmentGaps.waterVolumeUnlinked);
  const containingVolume = cameraVolume(sources, gaps);
  const fog = evaluateFogState({ volume: null, localFogList: localFog, cameraZone: zoneFog });
  return { cameraZone, containingVolume, fog, gaps };
}
