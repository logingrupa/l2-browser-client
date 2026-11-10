import { planeDistance, type Plane } from "../../../../shared/math/plane";
import { dotProduct, float32Difference, float32Vector, type Vector3 } from "../../../../shared/math/vector3";
import type { CollisionBspTree } from "./collisionCell";
import { isZeroExtent, negateVector, type CollisionSweep, type PrimitiveSweepHit } from "./collisionTrace";
import { CollisionWorldError } from "./collisionWorld";
import { clipSweepAgainstPlanes, convexHullClipPlanes, planesOverlapBox, type ConvexHull } from "./convexHullClip";
import type { MovementNativeRules } from "./movementRules";

export type SolidTreeSide = "front" | "back";

export interface KeyedConvexHull {
  readonly key: number;
  readonly hull: ConvexHull;
}

export interface SolidCollisionTree {
  readonly owner: string;
  readonly nodeCount: number;
  readonly rootOutside: boolean;
  nodePlane(node: number): Plane;
  frontChild(node: number): number;
  backChild(node: number): number;
  isCsgNode(node: number): boolean;
  hullBelow(node: number, side: SolidTreeSide, outwardPathPlanes: readonly Plane[]): KeyedConvexHull | null;
}

interface SolidEntry {
  readonly location: Vector3;
  readonly splitterNode: number;
}

interface RaySegmentWalk {
  readonly tree: SolidCollisionTree;
  readonly sideTolerance: number;
}

const noNode = -1;
const rootNode = 0;

const frontOutsideBit = (outside: boolean, csg: boolean) => outside || csg;
const backOutsideBit = (outside: boolean, csg: boolean) => outside && !csg;
const outwardPlaneOfSide = (plane: Plane, side: SolidTreeSide): Plane =>
  side === "back" ? plane : { normal: negateVector(plane.normal), w: -plane.w };
const float32PlaneDistance = (plane: Plane, point: Vector3) => Math.fround(planeDistance(plane, point));

function requireWalkDepth(tree: SolidCollisionTree, depth: number): void {
  if (depth > tree.nodeCount) throw new CollisionWorldError(`${tree.owner} walk passed ${tree.nodeCount} nodes; the tree has a cycle.`);
}

function splitPoint(start: Vector3, end: Vector3, startDistance: number, endDistance: number): Vector3 {
  const fraction = Math.fround(startDistance / (endDistance - startDistance));
  const splitComponent = (startComponent: number, endComponent: number) =>
    Math.fround(startComponent + Math.fround(Math.fround(startComponent - endComponent) * fraction));
  return { x: splitComponent(start.x, end.x), y: splitComponent(start.y, end.y), z: splitComponent(start.z, end.z) };
}

function solidEntryAlongSegment(walk: RaySegmentWalk, segmentStart: Vector3, segmentEnd: Vector3, firstNode: number, firstOutside: boolean,
  firstSplitterNode: number, depth: number): SolidEntry | null {
  const { tree, sideTolerance } = walk;
  let node = firstNode, outside = firstOutside, splitterNode = firstSplitterNode, start = segmentStart;
  for (let walkDepth = depth; node !== noNode; walkDepth += 1) {
    requireWalkDepth(tree, walkDepth);
    const plane = tree.nodePlane(node), csg = tree.isCsgNode(node);
    const startDistance = float32PlaneDistance(plane, start), endDistance = float32PlaneDistance(plane, segmentEnd);
    if (startDistance > -sideTolerance && endDistance > -sideTolerance) {
      outside = frontOutsideBit(outside, csg);
      node = tree.frontChild(node);
      continue;
    }
    if (startDistance < sideTolerance && endDistance < sideTolerance) {
      outside = backOutsideBit(outside, csg);
      node = tree.backChild(node);
      continue;
    }
    const middle = splitPoint(start, segmentEnd, startDistance, endDistance);
    const startInFront = startDistance > 0;
    const nearChild = startInFront ? tree.frontChild(node) : tree.backChild(node);
    const nearOutside = startInFront ? frontOutsideBit(outside, csg) : backOutsideBit(outside, csg);
    const nearEntry = solidEntryAlongSegment(walk, start, middle, nearChild, nearOutside, splitterNode, walkDepth + 1);
    if (nearEntry !== null) return nearEntry;
    outside = startInFront ? backOutsideBit(outside, csg) : frontOutsideBit(outside, csg);
    splitterNode = node;
    node = startInFront ? tree.backChild(node) : tree.frontChild(node);
    start = middle;
  }
  return outside ? null : { location: start, splitterNode };
}

export function traceSolidTreeRay(tree: SolidCollisionTree, sweep: CollisionSweep, rules: MovementNativeRules): PrimitiveSweepHit | null {
  if (tree.nodeCount === 0) return null;
  const start = float32Vector(sweep.start), end = float32Vector(sweep.end);
  const entry = solidEntryAlongSegment({ tree, sideTolerance: rules.bspSideEpsilon }, start, end, rootNode, tree.rootOutside, rootNode, 0);
  if (entry === null) return null;
  const delta = float32Difference(end, start), entryOffset = float32Difference(entry.location, start);
  const time = Math.fround(Math.fround(dotProduct(entryOffset, delta)) / Math.fround(dotProduct(delta, delta)));
  const splitterNormal = tree.nodePlane(entry.splitterNode).normal;
  return { time, normal: Math.fround(dotProduct(splitterNormal, negateVector(delta))) < 0 ? negateVector(splitterNormal) : splitterNormal };
}

interface HullWalk {
  readonly tree: SolidCollisionTree;
  readonly hullsByKey: Map<number, ConvexHull>;
  readonly outwardPath: Plane[];
  readonly sidesToVisit: (plane: Plane, node: number) => readonly SolidTreeSide[];
}

function collectHulls(walk: HullWalk, node: number, outside: boolean, parentNode: number, parentSide: SolidTreeSide, depth: number): void {
  if (node === noNode) {
    if (outside || parentNode === noNode) return;
    const keyedHull = walk.tree.hullBelow(parentNode, parentSide, walk.outwardPath);
    if (keyedHull !== null && !walk.hullsByKey.has(keyedHull.key)) walk.hullsByKey.set(keyedHull.key, keyedHull.hull);
    return;
  }
  requireWalkDepth(walk.tree, depth);
  const plane = walk.tree.nodePlane(node), csg = walk.tree.isCsgNode(node);
  for (const side of walk.sidesToVisit(plane, node)) {
    walk.outwardPath.push(outwardPlaneOfSide(plane, side));
    const child = side === "front" ? walk.tree.frontChild(node) : walk.tree.backChild(node);
    collectHulls(walk, child, side === "front" ? frontOutsideBit(outside, csg) : backOutsideBit(outside, csg), node, side, depth + 1);
    walk.outwardPath.pop();
  }
}

function solidHulls(tree: SolidCollisionTree, sidesToVisit: HullWalk["sidesToVisit"]): ConvexHull[] {
  if (tree.nodeCount === 0) return [];
  const walk: HullWalk = { tree, hullsByKey: new Map(), outwardPath: [], sidesToVisit };
  collectHulls(walk, rootNode, tree.rootOutside, noNode, "back", 0);
  return [...walk.hullsByKey.values()];
}

function boxPushOut(plane: Plane, extent: Vector3, rules: MovementNativeRules): number {
  const pushOutAlongAxis = (normalComponent: number, extentComponent: number) =>
    Math.abs(Math.fround(normalComponent * Math.fround(extentComponent * rules.bspPushOutScale)));
  return Math.fround(pushOutAlongAxis(plane.normal.x, extent.x) + pushOutAlongAxis(plane.normal.y, extent.y) + pushOutAlongAxis(plane.normal.z, extent.z));
}

function sweptBoxHulls(tree: SolidCollisionTree, sweep: CollisionSweep, rules: MovementNativeRules): ConvexHull[] {
  return solidHulls(tree, plane => {
    const pushOut = boxPushOut(plane, sweep.extent, rules);
    const startDistance = float32PlaneDistance(plane, sweep.start), endDistance = float32PlaneDistance(plane, sweep.end);
    const visitFront = startDistance >= -pushOut || endDistance >= -pushOut, visitBack = startDistance <= pushOut || endDistance <= pushOut;
    const sideOrder: readonly SolidTreeSide[] = endDistance <= startDistance ? ["front", "back"] : ["back", "front"];
    return sideOrder.filter(side => side === "front" ? visitFront : visitBack);
  });
}

export function traceSolidTreeBox(tree: SolidCollisionTree, sweep: CollisionSweep, rules: MovementNativeRules): PrimitiveSweepHit | null {
  let earliest: PrimitiveSweepHit | null = null;
  for (const hull of sweptBoxHulls(tree, sweep, rules)) {
    const hit = clipSweepAgainstPlanes(convexHullClipPlanes(hull, rules), sweep, "after-minus-one", rules);
    if (hit !== null && (earliest === null || hit.time < earliest.time)) earliest = hit;
  }
  return earliest;
}

export function traceSolidTree(tree: SolidCollisionTree, sweep: CollisionSweep, rules: MovementNativeRules): PrimitiveSweepHit | null {
  return isZeroExtent(sweep.extent) ? traceSolidTreeRay(tree, sweep, rules) : traceSolidTreeBox(tree, sweep, rules);
}

export function solidTreeHoldsPoint(tree: SolidCollisionTree, point: Vector3): boolean {
  if (tree.nodeCount === 0) return false;
  let node = rootNode, outside = tree.rootOutside;
  for (let depth = 0; node !== noNode; depth += 1) {
    requireWalkDepth(tree, depth);
    const csg = tree.isCsgNode(node);
    if (float32PlaneDistance(tree.nodePlane(node), point) > 0) {
      outside = frontOutsideBit(outside, csg);
      node = tree.frontChild(node);
    } else {
      outside = backOutsideBit(outside, csg);
      node = tree.backChild(node);
    }
  }
  return !outside;
}

export function solidTreeOverlapsBox(tree: SolidCollisionTree, centre: Vector3, extent: Vector3, rules: MovementNativeRules): boolean {
  if (isZeroExtent(extent)) return solidTreeHoldsPoint(tree, centre);
  const hulls = solidHulls(tree, plane => {
    const pushOut = boxPushOut(plane, extent, rules), distance = float32PlaneDistance(plane, centre);
    const frontSides: readonly SolidTreeSide[] = distance > -pushOut ? ["front"] : [];
    return distance <= pushOut ? [...frontSides, "back"] : frontSides;
  });
  return hulls.some(hull => planesOverlapBox(convexHullClipPlanes(hull, rules), centre, extent));
}

const leafHullCache = new WeakMap<CollisionBspTree, Map<number, ConvexHull>>();
const leafHullBoxWordCount = 6;

function float32FromInt32Words(words: Int32Array): Float32Array {
  return new Float32Array(Int32Array.from(words).buffer);
}

function readLeafHull(tree: CollisionBspTree, owner: string, collisionBound: number, rules: MovementNativeRules): ConvexHull {
  const planes: Plane[] = [];
  let wordIndex = collisionBound;
  for (; ; wordIndex += 1) {
    if (wordIndex >= tree.leafHulls.length) throw new CollisionWorldError(`${owner} BSPT.leafHulls run at ${collisionBound} has no terminator.`);
    const reference = tree.leafHulls[wordIndex]!;
    if (reference < 0) break;
    if (planes.length + 1 >= rules.hullPlaneLimit) throw new CollisionWorldError(`${owner} BSPT.leafHulls run at ${collisionBound} reaches ${rules.hullPlaneLimit} planes.`);
    const planeNode = reference & ~rules.leafHullFlipBit;
    if (planeNode >= tree.nodeCount) throw new CollisionWorldError(`${owner} BSPT.leafHulls[${wordIndex}] names node ${planeNode} of ${tree.nodeCount}.`);
    const plane = tileTreeNodePlane(tree, planeNode);
    planes.push((reference & rules.leafHullFlipBit) !== 0 ? { normal: negateVector(plane.normal), w: -plane.w } : plane);
  }
  const boxStart = wordIndex + 1;
  if (boxStart + leafHullBoxWordCount > tree.leafHulls.length) throw new CollisionWorldError(`${owner} BSPT.leafHulls run at ${collisionBound} has no hull box.`);
  const box = float32FromInt32Words(tree.leafHulls.subarray(boxStart, boxStart + leafHullBoxWordCount));
  if (!box.every(Number.isFinite)) throw new CollisionWorldError(`${owner} BSPT.leafHulls run at ${collisionBound} holds a non-finite hull box.`);
  return { planes, boxMinimum: { x: box[0]!, y: box[1]!, z: box[2]! }, boxMaximum: { x: box[3]!, y: box[4]!, z: box[5]! } };
}

function tileTreeNodePlane(tree: CollisionBspTree, node: number): Plane {
  const offset = node * 4;
  return { normal: { x: tree.planes[offset]!, y: tree.planes[offset + 1]!, z: tree.planes[offset + 2]! }, w: tree.planes[offset + 3]! };
}

export function tileSolidCollisionTree(tileId: string, tree: CollisionBspTree, rules: MovementNativeRules): SolidCollisionTree {
  const owner = `tile ${tileId}`;
  const hullsByBound = leafHullCache.get(tree) ?? new Map<number, ConvexHull>();
  leafHullCache.set(tree, hullsByBound);
  return {
    owner,
    nodeCount: tree.nodeCount,
    rootOutside: tree.rootOutside,
    nodePlane: node => tileTreeNodePlane(tree, node),
    frontChild: node => tree.front[node]!,
    backChild: node => tree.back[node]!,
    isCsgNode: node => tree.numVertices[node]! > 0 && (tree.nodeFlags[node]! & rules.notCsgNodeFlags) === 0,
    hullBelow: node => {
      const collisionBound = tree.collisionBound[node]!;
      if (collisionBound === noNode) return null;
      const hull = hullsByBound.get(collisionBound) ?? readLeafHull(tree, owner, collisionBound, rules);
      hullsByBound.set(collisionBound, hull);
      return { key: collisionBound, hull };
    },
  };
}
