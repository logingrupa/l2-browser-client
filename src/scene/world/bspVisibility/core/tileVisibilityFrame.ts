import type { Vector3 } from "../../../../shared/math/vector3";
import { zoneClassSkyBit, type BspVisibilityModel } from "./decodeBspVisibility";
import { locateZone } from "./locateZone";
import { groupRangesBySection, orderTranslucentSections } from "./translucentOrder";
import type { ViewPose } from "./viewFrustum";
import { zoneSetOfAllZones, type ZoneSet } from "./zoneSet";

export interface TileVisibilityFrame {
  readonly culling: boolean;
  readonly cameraLeaf: number;
  readonly cameraZone: number;
  readonly visibleZones: ZoneSet;
  readonly visibleZoneCount: number;
  readonly skyZones: readonly number[];
  readonly sectionVisible: Uint8Array;
  readonly memberVisible: Uint8Array;
  readonly terrainVisible: boolean;
  readonly translucentOrder: ReadonlyMap<number, Int32Array>;
}

export interface TileVisibilityFrameSource {
  frame(pose: ViewPose): TileVisibilityFrame;
  readonly computedFrameCount: number;
  readonly cacheHitCount: number;
}

function float32Vector(vector: Vector3): Vector3 {
  return { x: Math.fround(vector.x), y: Math.fround(vector.y), z: Math.fround(vector.z) };
}

function float32PoseKey(pose: ViewPose): readonly number[] {
  const { position, forward, up } = pose;
  return [position.x, position.y, position.z, forward.x, forward.y, forward.z, up.x, up.y, up.z, pose.verticalFieldOfView, pose.aspectRatio, pose.near, pose.far]
    .map(Math.fround);
}

export function skyZonesOf(model: BspVisibilityModel): number[] {
  return [...model.zoneClass.keys()].filter(zone => (model.zoneClass[zone]! & zoneClassSkyBit) !== 0);
}

export function translucentSectionRangesOf(model: BspVisibilityModel, translucentSections: readonly number[]): Map<number, Int32Array> {
  const rangesBySection = groupRangesBySection(model);
  return new Map(translucentSections.map(section => [section, rangesBySection[section]!]));
}

export function computeTileVisibilityFrame(model: BspVisibilityModel, translucentSectionRanges: ReadonlyMap<number, Int32Array>, pose: ViewPose):
  TileVisibilityFrame {
  const camera = float32Vector(pose.position), location = locateZone(model, camera);
  return { culling: false, cameraLeaf: location.leaf, cameraZone: location.zone, visibleZones: zoneSetOfAllZones(model.zoneCount),
    visibleZoneCount: model.zoneCount, skyZones: skyZonesOf(model), sectionVisible: new Uint8Array(model.sections.count).fill(1),
    memberVisible: new Uint8Array(model.members.count).fill(1), terrainVisible: true,
    translucentOrder: orderTranslucentSections(model, camera, translucentSectionRanges) };
}

export function createTileVisibilityFrameSource(model: BspVisibilityModel, translucentSections: readonly number[]): TileVisibilityFrameSource {
  const translucentSectionRanges = translucentSectionRangesOf(model, translucentSections);
  let lastKey: readonly number[] | null = null, lastFrame: TileVisibilityFrame | null = null, computedFrameCount = 0, cacheHitCount = 0;
  return {
    frame(pose) {
      const key = float32PoseKey(pose);
      if (lastFrame !== null && lastKey !== null && key.every((value, index) => Object.is(value, lastKey![index]))) {
        cacheHitCount++;
        return lastFrame;
      }
      lastKey = key;
      lastFrame = computeTileVisibilityFrame(model, translucentSectionRanges, pose);
      computedFrameCount++;
      return lastFrame;
    },
    get computedFrameCount() { return computedFrameCount; },
    get cacheHitCount() { return cacheHitCount; },
  };
}
