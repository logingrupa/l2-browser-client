import type { EnvironmentResult } from "../../environment/model/nativeEnvironmentColours";
import { ENVIRONMENT_ENGINE_CONSTANTS } from "../../environment/model/nativeEnvironmentEngineConstants";
import type { RgbBytes } from "../../environment/model/sampleNativeTimeTables";
import { FOG_CONSTANTS } from "../../materials/ue2/model/constants/fogConstants";
import {
  environmentFogPreset, evaluateFogState, evaluateLocalFogList, type CameraZoneFogRecord, type EnvironmentFogRanges,
  type FogColourBytes, type FogRangeRecord, type FogState, type LocalFogList, type TerrainZoneEnvironmentFog, type WeightedFogInfo,
} from "../../materials/ue2/model/fog";
import type { Vector3 } from "../../shared/math/vector3";
import type { TileVisibilityFrame } from "./bspVisibility/core/tileVisibilityFrame";
import type { CollisionWorld } from "./movement/core/collisionWorld";
import type { MovementNativeRules } from "./movement/core/movementRules";
import { volumesContaining, type ContainingVolume } from "./movement/core/volumeContainment";
import { zoneFogBlendTimeUnstagedReason, type TileLightingRecords, type ZoneFogBlendTime } from "./lighting/tileLightingRecords";

export interface CameraEnvironmentCollision {
  readonly world: CollisionWorld;
  readonly rules: MovementNativeRules;
}

export interface FogEnvironment {
  readonly hour: number;
  readonly fogRanges: EnvironmentFogRanges;
  readonly hazeColour: EnvironmentResult<RgbBytes, string>;
}

export interface CameraEnvironmentSources {
  readonly frame: TileVisibilityFrame | null;
  readonly cameraSourcePosition: Vector3 | null;
  readonly referencePawnSourcePosition: Vector3 | null;
  readonly collision: CameraEnvironmentCollision | null;
  readonly records: TileLightingRecords;
  readonly fogEnvironment: FogEnvironment;
}

export interface SkySceneFog {
  readonly route: typeof FOG_CONSTANTS.skySceneRoute.value;
  readonly fog: FogState;
}

export type EmptyListZoneFog =
  | { readonly kind: "terrain-zone"; readonly hazeColour: FogColourBytes }
  | { readonly kind: "distance-fog-zone"; readonly target: FogRangeRecord; readonly blendTime: ZoneFogBlendTime }
  | { readonly kind: "without-fog" };

export type CameraFogRoute =
  | { readonly kind: "local-list"; readonly target: FogRangeRecord }
  | { readonly kind: "empty-list"; readonly presetPair: readonly [start: number, end: number]; readonly zone: EmptyListZoneFog }
  | { readonly kind: "bypass" };

export type RetainedFogInfoList =
  | { readonly status: "listed"; readonly hour: number; readonly fogInfos: readonly WeightedFogInfo[] }
  | { readonly status: "unresolved"; readonly reason: string };

export interface CameraEnvironment {
  readonly cameraZone: number;
  readonly containingVolume: ContainingVolume | null;
  readonly fog: FogState;
  readonly fogRoute: CameraFogRoute;
  readonly skyFog: SkySceneFog;
  readonly retainedFogInfos: RetainedFogInfoList;
  readonly gaps: readonly string[];
}

export type CameraEnvironmentFog = Pick<CameraEnvironment, "fog" | "skyFog" | "retainedFogInfos">;

interface EvaluatedLocalFogList {
  readonly list: LocalFogList;
  readonly retainedFogInfos: RetainedFogInfoList;
}

const noCameraZone = -1;
const byteMaximum = 255;
const unlistedZoneBlendTime: ZoneFogBlendTime = { status: "unstaged", reason: zoneFogBlendTimeUnstagedReason };
const unresolvedTerrainZoneEnvironment: TerrainZoneEnvironmentFog = { status: "unresolved" };
const [baselineRed, baselineGreen, baselineBlue] = ENVIRONMENT_ENGINE_CONSTANTS.fogBaselineColour.value;
const environmentBaselineColour: FogColourBytes = [baselineRed, baselineGreen, baselineBlue];
export const cameraEnvironmentGaps = {
  cameraZoneUnknown: "camera-zone-unknown",
  fogInfoReferencePawnAbsent: "fog-info-reference-pawn-absent",
  fogInfoRetentionDistanceUnresolved: "fog-info-retention-distance-unresolved",
  fogInfoListOrderAssumed: "fog-info-list-order-assumed",
  volumeQueryUnbound: "camera-volume-query-unbound",
  volumeWaterFlagAbsent: "camera-volume-water-flag-absent",
  volumePriorityUnknown: "camera-volume-priority-unknown",
  waterVolumeUnlinked: "lighting-water-volume-unlinked",
} as const;

export function environmentFogBaseline(ranges: EnvironmentFogRanges, terrainClipRange: number): FogRangeRecord {
  return environmentFogPreset(ranges, terrainClipRange, environmentBaselineColour);
}

function zoneFog(zoneIndex: number, records: TileLightingRecords, gaps: string[]): CameraZoneFogRecord | null {
  if (zoneIndex === noCameraZone) { gaps.push(cameraEnvironmentGaps.cameraZoneUnknown); return null; }
  const zone = records.zones.find(record => record.zoneIndex === zoneIndex);
  if (zone === undefined) { gaps.push(`lighting-zone-unlisted:${zoneIndex}`); return null; }
  if (zone.unresolvedReason !== null) gaps.push(zone.unresolvedReason);
  return zone.fog;
}

function localFogList(sources: CameraEnvironmentSources, gaps: string[]): EvaluatedLocalFogList {
  const { records: { fogInfos }, referencePawnSourcePosition, fogEnvironment } = sources;
  if (fogInfos.length === 0) return { list: { status: "empty" }, retainedFogInfos: { status: "listed", hour: fogEnvironment.hour, fogInfos: [] } };
  const unresolvedReasons = fogInfos.flatMap(fogInfo => fogInfo.unresolvedReason === null ? [] : [fogInfo.unresolvedReason]);
  gaps.push(...unresolvedReasons);
  if (referencePawnSourcePosition === null) {
    gaps.push(cameraEnvironmentGaps.fogInfoReferencePawnAbsent);
    return { list: { status: "unresolved" }, retainedFogInfos: { status: "unresolved", reason: cameraEnvironmentGaps.fogInfoReferencePawnAbsent } };
  }
  const resolvedFogInfos = fogInfos.flatMap(fogInfo => fogInfo.record === null ? [] : [fogInfo.record]);
  const terrainClipRange = FOG_CONSTANTS.terrainClipRange.runtimeDefault;
  const evaluation = evaluateLocalFogList(resolvedFogInfos, environmentFogBaseline(fogEnvironment.fogRanges, terrainClipRange),
    { hour: fogEnvironment.hour, terrainClipRange, referencePosition: referencePawnSourcePosition });
  if (evaluation.retentionDistanceDecides) gaps.push(cameraEnvironmentGaps.fogInfoRetentionDistanceUnresolved);
  if (evaluation.orderCanChangeResult) gaps.push(cameraEnvironmentGaps.fogInfoListOrderAssumed);
  const [firstUnresolvedReason] = unresolvedReasons;
  const retainedFogInfos: RetainedFogInfoList = firstUnresolvedReason === undefined
    ? { status: "listed", hour: fogEnvironment.hour, fogInfos: evaluation.retained } : { status: "unresolved", reason: firstUnresolvedReason };
  return { list: evaluation.list, retainedFogInfos };
}

function terrainZoneEnvironment(fogEnvironment: FogEnvironment, gaps: string[]): TerrainZoneEnvironmentFog {
  const haze = fogEnvironment.hazeColour;
  if (haze.status !== "resolved") { gaps.push(`fog-terrain-zone-haze-unresolved:${haze.reason}`); return unresolvedTerrainZoneEnvironment; }
  return { status: "resolved", record: environmentFogPreset(fogEnvironment.fogRanges, FOG_CONSTANTS.terrainClipRange.runtimeDefault, haze.value) };
}

function fogOfZone(zone: CameraZoneFogRecord | null, zoneIndex: number, list: LocalFogList, sources: CameraEnvironmentSources, gaps: string[]): FogState {
  const routesByTerrainFlag = list.status === "empty" && zone !== null && zone.distanceFog;
  if (routesByTerrainFlag && zone.terrainZone === null) gaps.push(`lighting-zone-terrain-flag-unresolved:${zoneIndex}`);
  const environment = routesByTerrainFlag && zone.terrainZone === true ? terrainZoneEnvironment(sources.fogEnvironment, gaps) : unresolvedTerrainZoneEnvironment;
  return evaluateFogState({ volume: null, localFogList: list, cameraZone: zone, terrainZoneEnvironment: environment });
}

function zoneBlendTime(zoneIndex: number, records: TileLightingRecords): ZoneFogBlendTime {
  return records.zones.find(record => record.zoneIndex === zoneIndex)?.distanceFogBlendTime ?? unlistedZoneBlendTime;
}

function fogRouteOf(fog: FogState, zone: CameraZoneFogRecord | null, zoneIndex: number, list: LocalFogList, sources: CameraEnvironmentSources): CameraFogRoute {
  if (fog.source === "local-fog-list" && list.status === "blended") return { kind: "local-list", target: list.record };
  const preset = environmentFogBaseline(sources.fogEnvironment.fogRanges, FOG_CONSTANTS.terrainClipRange.runtimeDefault);
  const emptyList = (emptyListZone: EmptyListZoneFog): CameraFogRoute => ({ kind: "empty-list", presetPair: [preset.startSourceUnits, preset.endSourceUnits],
    zone: emptyListZone });
  if (fog.source === "terrain-zone-environment") {
    return emptyList({ kind: "terrain-zone", hazeColour: [Math.round(fog.colour[0] * byteMaximum), Math.round(fog.colour[1] * byteMaximum),
      Math.round(fog.colour[2] * byteMaximum)] });
  }
  if (fog.source === "camera-zone" && zone?.fog) return emptyList({ kind: "distance-fog-zone", target: zone.fog, blendTime: zoneBlendTime(zoneIndex, sources.records) });
  if (fog.source === "zone-without-fog" && list.status === "empty") return emptyList({ kind: "without-fog" });
  return { kind: "bypass" };
}

function skySceneFog(levelFog: FogState): SkySceneFog {
  return { route: FOG_CONSTANTS.skySceneRoute.value, fog: levelFog };
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
  const cameraZoneFog = zoneFog(cameraZone, sources.records, gaps);
  const { list, retainedFogInfos } = localFogList(sources, gaps);
  const fog = fogOfZone(cameraZoneFog, cameraZone, list, sources, gaps);
  if (sources.records.waterVolumeCount > 0) gaps.push(cameraEnvironmentGaps.waterVolumeUnlinked);
  const containingVolume = cameraVolume(sources, gaps);
  return { cameraZone, containingVolume, fog, fogRoute: fogRouteOf(fog, cameraZoneFog, cameraZone, list, sources), skyFog: skySceneFog(fog), retainedFogInfos, gaps };
}
