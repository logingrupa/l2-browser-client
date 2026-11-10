import { subtractVectors, vectorLength, type Vector3 } from "../../../../shared/math/vector3";
import { indexNone, type BspVisibilityModel } from "./decodeBspVisibility";
import { nodePlaneDot, type ZoneLocation } from "./locateZone";
import { sphereInsideFrustum, type ViewFrustum } from "./viewFrustum";
import {
  fullZoneSetWord, isEmptyZoneSet, maximumZoneCount, zoneSetAt, zoneSetHas, zoneSetIntersection, zoneSetOf, zoneSetUnion, type ZoneSet,
} from "./zoneSet";

export interface PortalWalkLimits {
  readonly portalRange: number;
  readonly portalDepthCap: number;
}

export interface PortalWalkResult {
  readonly visibleZones: ZoneSet;
  readonly openedPortalCount: number;
}

const sphereComponentCount = 4;
const backSide = 0;
const frontSide = 1;
const unreachedDepth = -1;

function nodeSphereCenter(model: BspVisibilityModel, node: number): Vector3 {
  const offset = node * sphereComponentCount;
  return { x: model.nodeSphere[offset]!, y: model.nodeSphere[offset + 1]!, z: model.nodeSphere[offset + 2]! };
}

function nodeSphereRadius(model: BspVisibilityModel, node: number): number {
  return model.nodeSphere[node * sphereComponentCount + 3]!;
}

export function nodeSphereInsideFrustum(model: BspVisibilityModel, node: number, frustum: ViewFrustum): boolean {
  return sphereInsideFrustum(frustum, nodeSphereCenter(model, node), nodeSphereRadius(model, node));
}

export function seedZoneSet(model: BspVisibilityModel, location: ZoneLocation): ZoneSet {
  const cameraZone = zoneSetOf(location.zone);
  if (location.leaf === indexNone) return cameraZone;
  const potentiallyVisible = zoneSetAt(model.leafPvs, location.leaf);
  if (isEmptyZoneSet(potentiallyVisible) || (potentiallyVisible.low === fullZoneSetWord && potentiallyVisible.high === fullZoneSetWord)) return cameraZone;
  const connectivity = zoneSetAt(model.zoneConnectivity, location.zone);
  return zoneSetUnion(isEmptyZoneSet(connectivity) ? potentiallyVisible : zoneSetIntersection(potentiallyVisible, connectivity), cameraZone);
}

function portalOpens(model: BspVisibilityModel, portal: number, nearZone: number, farZone: number, camera: Vector3, frustum: ViewFrustum | null,
  limits: PortalWalkLimits): boolean {
  if (frustum !== null && !nodeSphereInsideFrustum(model, portal, frustum)) return false;
  if (vectorLength(subtractVectors(camera, nodeSphereCenter(model, portal))) > limits.portalRange + nodeSphereRadius(model, portal)) return false;
  const connectivity = zoneSetAt(model.zoneConnectivity, nearZone);
  return isEmptyZoneSet(connectivity) || zoneSetHas(connectivity, farZone);
}

export function expandThroughPortals(model: BspVisibilityModel, camera: Vector3, seed: ZoneSet, frustum: ViewFrustum | null, limits: PortalWalkLimits):
  PortalWalkResult {
  const depth = new Int32Array(model.zoneCount).fill(unreachedDepth);
  for (let zone = 0; zone < model.zoneCount; zone++) if (zoneSetHas(seed, zone)) depth[zone] = 0;
  let visibleZones = seed, openedPortalCount = 0;
  for (let round = 0; round < maximumZoneCount && round + 1 < limits.portalDepthCap; round++) {
    let opened = false;
    for (const portal of model.portalNodes) {
      const cameraSide = nodePlaneDot(model, portal, camera) > 0 ? frontSide : backSide;
      const nearZone = model.nodeZone[portal * 2 + cameraSide]!, farZone = model.nodeZone[portal * 2 + 1 - cameraSide]!;
      if (depth[nearZone] !== round || depth[farZone] !== unreachedDepth) continue;
      if (!portalOpens(model, portal, nearZone, farZone, camera, frustum, limits)) continue;
      depth[farZone] = round + 1;
      visibleZones = zoneSetUnion(visibleZones, zoneSetOf(farZone));
      openedPortalCount++;
      opened = true;
    }
    if (!opened) break;
  }
  return { visibleZones, openedPortalCount };
}
