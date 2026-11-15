import type { Vector3 } from "../../../../shared/math/vector3";
import { memberFlagSky, memberFlagUnbounded, memberKindMapEmitter, type BspVisibilityModel } from "./decodeBspVisibility";
import { zoneSetWordsEmpty, zoneSetWordsMeet, type ZoneSet } from "./zoneSet";

export interface MemberRangeLimits {
  readonly staticMeshRange: number;
  readonly emitterRange: number;
}

const centerComponentCount = 3;

function anyLeafVisible(model: BspVisibilityModel, member: number, leafVisible: Uint8Array): boolean {
  const { leafStart, leaves } = model.members, first = leafStart[member]!, end = leafStart[member + 1]!;
  if (first === end) return true;
  for (let position = first; position < end; position++) if (leafVisible[leaves[position]!] === 1) return true;
  return false;
}

function memberVisible(model: BspVisibilityModel, member: number, camera: Vector3, visibleZones: ZoneSet, leafVisible: Uint8Array,
  limits: MemberRangeLimits): boolean {
  const { kind, flags, center, zoneSet } = model.members;
  if ((flags[member]! & (memberFlagSky | memberFlagUnbounded)) !== 0) return true;
  if (!zoneSetWordsEmpty(zoneSet, member) && !zoneSetWordsMeet(zoneSet, member, visibleZones)) return false;
  const offset = member * centerComponentCount;
  const deltaX = center[offset]! - camera.x, deltaY = center[offset + 1]! - camera.y, deltaZ = center[offset + 2]! - camera.z;
  const horizontalDistanceSquared = deltaX * deltaX + deltaY * deltaY;
  if (kind[member] === memberKindMapEmitter) return horizontalDistanceSquared < limits.emitterRange * limits.emitterRange;
  return anyLeafVisible(model, member, leafVisible) && horizontalDistanceSquared + deltaZ * deltaZ <= limits.staticMeshRange * limits.staticMeshRange;
}

export function gateMembers(model: BspVisibilityModel, camera: Vector3, visibleZones: ZoneSet, leafVisible: Uint8Array, limits: MemberRangeLimits): Uint8Array {
  return Uint8Array.from({ length: model.members.count }, (_, member) => memberVisible(model, member, camera, visibleZones, leafVisible, limits) ? 1 : 0);
}
