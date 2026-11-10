import { float32Vector, type Vector3 } from "../../../../shared/math/vector3";
import { indexNone, zoneClassSkyBit, zoneClassVisibilityOutdoorBit, type BspVisibilityModel } from "./decodeBspVisibility";
import { locateZone, type ZoneLocation } from "./locateZone";
import { gateMembers, type MemberRangeLimits } from "./memberVisibility";
import { expandThroughPortals, seedZoneSet, type PortalWalkLimits } from "./portalWalk";
import { groupRangesBySection, orderTranslucentSections } from "./translucentOrder";
import { createViewFrustum, type ViewPose } from "./viewFrustum";
import { outdoorViewSections, walkVisibleSections } from "./visibleSectionWalk";
import { emptyZoneSet, isEmptyZoneSet, zoneSetIntersection, zoneSetMembers, zoneSetOf, zoneSetOfAllZones, zoneSetUnion, type ZoneSet } from "./zoneSet";

export interface TileVisibilityLimits extends PortalWalkLimits, MemberRangeLimits {}

export interface TileVisibilityFrame {
  readonly culling: boolean;
  readonly cameraLeaf: number;
  readonly cameraZone: number;
  readonly outdoorView: boolean;
  readonly visibleZones: ZoneSet;
  readonly visibleZoneCount: number;
  readonly openedPortalCount: number;
  readonly skyZones: readonly number[];
  readonly sectionVisible: Uint8Array;
  readonly memberVisible: Uint8Array;
  readonly terrainVisible: boolean;
  readonly translucentOrder: ReadonlyMap<number, Int32Array>;
}

export interface TileVisibilityFrameSource {
  frame(pose: ViewPose, culling: boolean): TileVisibilityFrame;
  readonly computedFrameCount: number;
  readonly cacheHitCount: number;
}

interface CullingResult {
  readonly outdoorView: boolean;
  readonly visibleZones: ZoneSet;
  readonly openedPortalCount: number;
  readonly sectionVisible: Uint8Array;
  readonly memberVisible: Uint8Array;
}

function float32PoseKey(pose: ViewPose, culling: boolean): readonly number[] {
  const { position, forward, up } = pose;
  return [position.x, position.y, position.z, forward.x, forward.y, forward.z, up.x, up.y, up.z, pose.verticalFieldOfView, pose.aspectRatio, pose.near, pose.far]
    .map(Math.fround).concat(culling ? 1 : 0);
}

function zonesWithClassBit(model: BspVisibilityModel, bit: number): number[] {
  return [...model.zoneClass.keys()].filter(zone => (model.zoneClass[zone]! & bit) !== 0);
}

function zoneSetOfZones(zones: readonly number[]): ZoneSet {
  return zones.reduce((set, zone) => zoneSetUnion(set, zoneSetOf(zone)), emptyZoneSet);
}

export function translucentSectionRangesOf(model: BspVisibilityModel, translucentSections: readonly number[]): Map<number, Int32Array> {
  const rangesBySection = groupRangesBySection(model);
  return new Map(translucentSections.map(section => [section, rangesBySection[section]!]));
}

function cullTile(model: BspVisibilityModel, camera: Vector3, location: ZoneLocation, pose: ViewPose, outdoorZones: ZoneSet, limits: TileVisibilityLimits):
  CullingResult {
  if (location.leaf === indexNone) {
    const outdoor = outdoorViewSections(model, outdoorZones);
    return { outdoorView: true, visibleZones: outdoorZones, openedPortalCount: 0, sectionVisible: outdoor.sectionVisible,
      memberVisible: gateMembers(model, camera, outdoorZones, outdoor.leafVisible, limits) };
  }
  const frustum = createViewFrustum({ ...pose, position: camera });
  const { visibleZones, openedPortalCount } = expandThroughPortals(model, camera, seedZoneSet(model, location), frustum, limits);
  const walked = walkVisibleSections(model, camera, visibleZones, frustum);
  return { outdoorView: false, visibleZones, openedPortalCount, sectionVisible: walked.sectionVisible,
    memberVisible: gateMembers(model, camera, visibleZones, walked.leafVisible, limits) };
}

function everythingVisible(model: BspVisibilityModel): CullingResult {
  return { outdoorView: false, visibleZones: zoneSetOfAllZones(model.zoneCount), openedPortalCount: 0,
    sectionVisible: new Uint8Array(model.sections.count).fill(1), memberVisible: new Uint8Array(model.members.count).fill(1) };
}

export function computeTileVisibilityFrame(model: BspVisibilityModel, translucentSectionRanges: ReadonlyMap<number, Int32Array>, pose: ViewPose,
  culling: boolean, limits: TileVisibilityLimits): TileVisibilityFrame {
  const camera = float32Vector(pose.position), location = locateZone(model, camera);
  const outdoorZones = zoneSetOfZones(zonesWithClassBit(model, zoneClassVisibilityOutdoorBit));
  const result = culling ? cullTile(model, camera, location, pose, outdoorZones, limits) : everythingVisible(model);
  const visibleTranslucentRanges = new Map([...translucentSectionRanges].filter(([section]) => result.sectionVisible[section] === 1));
  return { culling, cameraLeaf: location.leaf, cameraZone: location.zone, outdoorView: result.outdoorView, visibleZones: result.visibleZones,
    visibleZoneCount: zoneSetMembers(result.visibleZones, model.zoneCount).length, openedPortalCount: result.openedPortalCount,
    skyZones: zonesWithClassBit(model, zoneClassSkyBit), sectionVisible: result.sectionVisible, memberVisible: result.memberVisible,
    terrainVisible: !culling || !isEmptyZoneSet(zoneSetIntersection(result.visibleZones, outdoorZones)),
    translucentOrder: orderTranslucentSections(model, camera, visibleTranslucentRanges) };
}

export function createTileVisibilityFrameSource(model: BspVisibilityModel, translucentSections: readonly number[], limits: TileVisibilityLimits):
  TileVisibilityFrameSource {
  const translucentSectionRanges = translucentSectionRangesOf(model, translucentSections);
  let lastKey: readonly number[] | null = null, lastFrame: TileVisibilityFrame | null = null, computedFrameCount = 0, cacheHitCount = 0;
  return {
    frame(pose, culling) {
      const key = float32PoseKey(pose, culling);
      if (lastFrame !== null && lastKey !== null && key.every((value, index) => Object.is(value, lastKey![index]))) {
        cacheHitCount++;
        return lastFrame;
      }
      lastKey = key;
      lastFrame = computeTileVisibilityFrame(model, translucentSectionRanges, pose, culling, limits);
      computedFrameCount++;
      return lastFrame;
    },
    get computedFrameCount() { return computedFrameCount; },
    get cacheHitCount() { return cacheHitCount; },
  };
}
