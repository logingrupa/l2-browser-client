import type { EnvironmentResult } from "../../environment/model/nativeEnvironmentColours";
import { ENVIRONMENT_ENGINE_CONSTANTS } from "../../environment/model/nativeEnvironmentEngineConstants";
import type { RgbBytes } from "../../environment/model/sampleNativeTimeTables";
import { FOG_CONSTANTS, type SkySceneFogRoute } from "../../materials/ue2/model/constants/fogConstants";
import {
  environmentFogPreset, evaluateFogState, evaluateLocalFogList, FOG_DISABLED, FOG_UNRESOLVED, type CameraZoneFogRecord, type EnvironmentFogRanges,
  type FogColourBytes, type FogRangeRecord, type FogState, type LocalFogList, type TerrainZoneEnvironmentFog,
} from "../../materials/ue2/model/fog";
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
  readonly skySceneRoute: SkySceneFogRoute | null;
}

export interface SkySceneFog {
  readonly route: SkySceneFogRoute | null;
  readonly fog: FogState;
  readonly gaps: readonly string[];
}

export interface CameraEnvironment {
  readonly cameraZone: number;
  readonly containingVolume: ContainingVolume | null;
  readonly fog: FogState;
  readonly skyFog: SkySceneFog;
  readonly gaps: readonly string[];
}

const noCameraZone = -1;
const transitionedFogSources: ReadonlySet<FogState["source"]> = new Set(["local-fog-list", "terrain-zone-environment"]);
const unresolvedTerrainZoneEnvironment: TerrainZoneEnvironmentFog = { status: "unresolved" };
const [baselineRed, baselineGreen, baselineBlue] = ENVIRONMENT_ENGINE_CONSTANTS.fogBaselineColour.value;
const environmentBaselineColour: FogColourBytes = [baselineRed, baselineGreen, baselineBlue];
export const cameraEnvironmentGaps = {
  cameraZoneUnknown: "camera-zone-unknown",
  fogInfoReferencePawnAbsent: "fog-info-reference-pawn-absent",
  fogInfoRetentionDistanceUnresolved: "fog-info-retention-distance-unresolved",
  fogInfoListOrderAssumed: "fog-info-list-order-assumed",
  fogTransitionUnported: "fog-transition-unported",
  skyFogSceneRouteUnresolved: "sky-fog-scene-route-unresolved",
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

function localFogList(sources: CameraEnvironmentSources, gaps: string[]): LocalFogList {
  const { records: { fogInfos }, referencePawnSourcePosition, fogEnvironment } = sources;
  if (fogInfos.length === 0) return { status: "empty" };
  for (const fogInfo of fogInfos) if (fogInfo.unresolvedReason !== null) gaps.push(fogInfo.unresolvedReason);
  if (referencePawnSourcePosition === null) { gaps.push(cameraEnvironmentGaps.fogInfoReferencePawnAbsent); return { status: "unresolved" }; }
  const resolvedFogInfos = fogInfos.flatMap(fogInfo => fogInfo.record === null ? [] : [fogInfo.record]);
  const terrainClipRange = FOG_CONSTANTS.terrainClipRange.runtimeDefault;
  const evaluation = evaluateLocalFogList(resolvedFogInfos, environmentFogBaseline(fogEnvironment.fogRanges, terrainClipRange),
    { hour: fogEnvironment.hour, terrainClipRange, referencePosition: referencePawnSourcePosition });
  if (evaluation.retentionDistanceDecides) gaps.push(cameraEnvironmentGaps.fogInfoRetentionDistanceUnresolved);
  if (evaluation.orderCanChangeResult) gaps.push(cameraEnvironmentGaps.fogInfoListOrderAssumed);
  return evaluation.list;
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
  const fog = evaluateFogState({ volume: null, localFogList: list, cameraZone: zone, terrainZoneEnvironment: environment });
  if (transitionedFogSources.has(fog.source)) gaps.push(cameraEnvironmentGaps.fogTransitionUnported);
  return fog;
}

function skySceneFog(sources: CameraEnvironmentSources, levelFog: FogState, list: LocalFogList): SkySceneFog {
  const route = sources.skySceneRoute;
  if (route === null) return { route, fog: FOG_DISABLED, gaps: [cameraEnvironmentGaps.skyFogSceneRouteUnresolved] };
  if (route === "inherit-level") return { route, fog: levelFog, gaps: [] };
  const gaps: string[] = [], skyZones = sources.frame?.skyZones ?? [];
  if (skyZones.length !== 1) return { route, fog: FOG_UNRESOLVED, gaps: [`sky-fog-zone-count:${skyZones.length}`] };
  const skyZone = skyZones[0]!;
  return { route, fog: fogOfZone(zoneFog(skyZone, sources.records, gaps), skyZone, list, sources, gaps), gaps };
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
  const list = localFogList(sources, gaps);
  const fog = fogOfZone(cameraZoneFog, cameraZone, list, sources, gaps);
  if (sources.records.waterVolumeCount > 0) gaps.push(cameraEnvironmentGaps.waterVolumeUnlinked);
  const containingVolume = cameraVolume(sources, gaps);
  return { cameraZone, containingVolume, fog, skyFog: skySceneFog(sources, fog, list), gaps };
}
