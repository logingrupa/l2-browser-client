import { planeDistance, type Plane } from "../../../../shared/math/plane";
import type { Vector3 } from "../../../../shared/math/vector3";
import type { CollisionBspTree } from "./collisionCell";
import {
  boxSupportAlongNormal, isZeroExtent, negateVector, pointAlongSweep, ZERO_VECTOR, type CollisionSweep, type PrimitiveSweepHit,
} from "./collisionTrace";
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

interface RayEntry {
  readonly time: number;
  readonly splitterNode: number | null;
}

const noNode = -1;
const rootNode = 0;

const frontOutsideBit = (outside: boolean, csg: boolean) => outside || csg;
const backOutsideBit = (outside: boolean, csg: boolean) => outside && !csg;
const outwardPlaneOfSide = (plane: Plane, side: SolidTreeSide): Plane =>
  side === "back" ? plane : { normal: negateVector(plane.normal), w: -plane.w };

function requireWalkDepth(tree: SolidCollisionTree, depth: number): void {
  if (depth > tree.nodeCount) throw new CollisionWorldError(`${tree.owner} walk passed ${tree.nodeCount} nodes; the tree has a cycle.`);
}

function walkRay(tree: SolidCollisionTree, sweep: CollisionSweep, rules: MovementNativeRules, node: number, outside: boolean,
  startTime: number, endTime: number, splitterNode: number | null, depth: number): RayEntry | null {
  if (node === noNode) return outside ? null : { time: startTime, splitterNode };
  requireWalkDepth(tree, depth);
  const plane = tree.nodePlane(node), csg = tree.isCsgNode(node);
  const startDistance = planeDistance(plane, pointAlongSweep(sweep, startTime)), endDistance = planeDistance(plane, pointAlongSweep(sweep, endTime));
  const sideEpsilon = rules.bspSideEpsilon;
  if (startDistance > -sideEpsilon && endDistance > -sideEpsilon) {
    return walkRay(tree, sweep, rules, tree.frontChild(node), frontOutsideBit(outside, csg), startTime, endTime, splitterNode, depth + 1);
  }
  if (startDistance < sideEpsilon && endDistance < sideEpsilon) {
    return walkRay(tree, sweep, rules, tree.backChild(node), backOutsideBit(outside, csg), startTime, endTime, splitterNode, depth + 1);
  }
  const splitTime = startTime + (endTime - startTime) * startDistance / (startDistance - endDistance);
  const startInFront = startDistance > 0;
  const nearChild = startInFront ? tree.frontChild(node) : tree.backChild(node), farChild = startInFront ? tree.backChild(node) : tree.frontChild(node);
  const nearOutside = startInFront ? frontOutsideBit(outside, csg) : backOutsideBit(outside, csg);
  const farOutside = startInFront ? backOutsideBit(outside, csg) : frontOutsideBit(outside, csg);
  return walkRay(tree, sweep, rules, nearChild, nearOutside, startTime, splitTime, splitterNode, depth + 1)
    ?? walkRay(tree, sweep, rules, farChild, farOutside, splitTime, endTime, node, depth + 1);
}

export function traceSolidTreeRay(tree: SolidCollisionTree, sweep: CollisionSweep, rules: MovementNativeRules): PrimitiveSweepHit | null {
  if (tree.nodeCount === 0) return null;
  const entry = walkRay(tree, sweep, rules, rootNode, tree.rootOutside, 0, 1, null, 0);
  if (entry === null) return null;
  if (entry.splitterNode === null) return { time: entry.time, normal: ZERO_VECTOR };
  const splitter = tree.nodePlane(entry.splitterNode);
  return { time: entry.time, normal: planeDistance(splitter, sweep.start) < 0 ? negateVector(splitter.normal) : splitter.normal };
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

function sweptBoxHulls(tree: SolidCollisionTree, sweep: CollisionSweep, rules: MovementNativeRules): ConvexHull[] {
  return solidHulls(tree, plane => {
    const pushOut = rules.bspPushOutScale * boxSupportAlongNormal(plane.normal, sweep.extent);
    const startDistance = planeDistance(plane, sweep.start), endDistance = planeDistance(plane, sweep.end);
    const visitFront = startDistance >= -pushOut || endDistance >= -pushOut, visitBack = startDistance <= pushOut || endDistance <= pushOut;
    const startSideFirst: readonly SolidTreeSide[] = startDistance >= 0 ? ["front", "back"] : ["back", "front"];
    return startSideFirst.filter(side => side === "front" ? visitFront : visitBack);
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
    if (planeDistance(tree.nodePlane(node), point) > 0) {
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
    const pushOut = rules.bspPushOutScale * boxSupportAlongNormal(plane.normal, extent);
    const distance = planeDistance(plane, centre);
    const sides: SolidTreeSide[] = distance > -pushOut ? ["front"] : [];
    return distance > pushOut ? sides : [...sides, "back"];
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
