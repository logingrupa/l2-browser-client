import type { Vector3 } from "../../../../shared/math/vector3";
import { indexNone, type BspNodeArrays } from "./bspNodeArrays";
import { boxCheckFlags, frustumFlagIntersects, sphereCheckFlags, type NativeFrustumConstants, type NativeViewFrustum } from "./nativeViewFrustum";
import { zoneSetHas, zoneSetWordsMeet, type ZoneSet } from "./zoneSet";

export interface BspNodeSelectorRules {
  readonly backfaceKeepFlags: readonly number[];
  readonly fakeBackdropFlag: number;
  readonly ordinaryExcludedFlag: number;
  readonly ordinaryUnlessNeitherFlags: readonly number[];
}

export interface BspWalkRules {
  readonly selector: BspNodeSelectorRules;
  readonly frustum: NativeFrustumConstants;
}

export interface BspSceneView {
  readonly eye: Vector3;
  readonly sceneZone: number;
  readonly visibleZones: ZoneSet;
  readonly frustum: NativeViewFrustum | null;
}

export interface BspWalkVisitor {
  accept(node: number): void;
  reachLeaf?(leaf: number): void;
  fakeBackdrop?(node: number): void;
}

const rootNode = 0;
const descendStep = 0;
const emitStep = 1;
const stepKindCount = 2;
const backSide = 0;
const frontSide = 1;
const sidesPerNode = 2;
const planeComponentCount = 4;
const sphereComponentCount = 4;
const boxComponentCount = 6;
const unrestrictedSceneZone = 0;

export function nodePlaneDistance(model: BspNodeArrays, node: number, point: Vector3): number {
  const offset = node * planeComponentCount, plane = model.nodePlane;
  return Math.fround(plane[offset + 1]! * point.y + plane[offset]! * point.x + plane[offset + 2]! * point.z - plane[offset + 3]!);
}

function renderBoundVisible(model: BspNodeArrays, node: number, frustum: NativeViewFrustum | null): boolean {
  const bound = model.nodeRenderBound[node]!;
  if (frustum === null || bound === indexNone || model.boundValid[bound] !== 1) return true;
  const offset = bound * boxComponentCount;
  return (boxCheckFlags(frustum, model.boundBox.subarray(offset, offset + boxComponentCount)) & frustumFlagIntersects) !== 0;
}

export function nodeSphereVisible(model: BspNodeArrays, node: number, frustum: NativeViewFrustum | null): boolean {
  if (frustum === null) return true;
  const offset = node * sphereComponentCount, sphere = model.nodeSphere;
  return (sphereCheckFlags(frustum, sphere[offset]!, sphere[offset + 1]!, sphere[offset + 2]!, sphere[offset + 3]!) & frustumFlagIntersects) !== 0;
}

function ordinaryGeometry(flags: number, rules: BspNodeSelectorRules): boolean {
  return (flags & rules.ordinaryExcludedFlag) === 0 || rules.ordinaryUnlessNeitherFlags.every(flag => (flags & flag) === 0);
}

function selectNode(model: BspNodeArrays, node: number, view: BspSceneView, rules: BspNodeSelectorRules, visitor: BspWalkVisitor): void {
  const distance = nodePlaneDistance(model, node, view.eye), flags = model.nodeSurfaceFlags[node]!;
  const side = distance > 0 ? frontSide : backSide;
  const restricted = view.sceneZone !== unrestrictedSceneZone;
  if (distance <= 0 && restricted && rules.backfaceKeepFlags.every(flag => (flags & flag) === 0)) return;
  const visibilityZone = restricted ? model.nodeZone[node * sidesPerNode + side]! : unrestrictedSceneZone;
  if (!zoneSetHas(view.visibleZones, visibilityZone) || !nodeSphereVisible(model, node, view.frustum)) return;
  if ((flags & rules.fakeBackdropFlag) !== 0) {
    visitor.fakeBackdrop?.(node);
    return;
  }
  if (model.nodeDrawable[node] === 1 && ordinaryGeometry(flags, rules)) visitor.accept(node);
}

export function walkSelectedBspNodes(model: BspNodeArrays, view: BspSceneView, rules: BspNodeSelectorRules, visitor: BspWalkVisitor): void {
  const pending = [rootNode * stepKindCount + descendStep];
  const restricted = view.sceneZone !== unrestrictedSceneZone;
  const pushSide = (node: number, side: number) => {
    const child = side === frontSide ? model.nodeFront[node]! : model.nodeBack[node]!;
    if (child !== indexNone) pending.push(child * stepKindCount + descendStep);
    else if (model.nodeLeaf[node * sidesPerNode + side]! !== indexNone) visitor.reachLeaf?.(model.nodeLeaf[node * sidesPerNode + side]!);
  };
  while (pending.length) {
    const step = pending.pop()!, node = Math.floor(step / stepKindCount);
    if (step % stepKindCount === emitStep) {
      for (let member = node; member !== indexNone; member = model.nodeCoplanar[member]!) selectNode(model, member, view, rules, visitor);
      continue;
    }
    if (restricted && !zoneSetWordsMeet(model.nodeZoneSet, node, view.visibleZones)) continue;
    if (!renderBoundVisible(model, node, view.frustum)) continue;
    const nearSide = nodePlaneDistance(model, node, view.eye) > 0 ? frontSide : backSide;
    pushSide(node, 1 - nearSide);
    pending.push(node * stepKindCount + emitStep);
    pushSide(node, nearSide);
  }
}
