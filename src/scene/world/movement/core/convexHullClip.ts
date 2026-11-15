import { planeDistance, type Plane } from "../../../../shared/math/plane";
import { addVectors, crossProduct, dotProduct, normalizeVector, scaleVector, type Vector3 } from "../../../../shared/math/vector3";
import { boxSupportAlongNormal, negateVector, UNIT_AXES, type CollisionSweep, type PrimitiveSweepHit } from "./collisionTrace";
import type { MovementNativeRules } from "./movementRules";

export interface ConvexHull {
  readonly planes: readonly Plane[];
  readonly boxMinimum: Vector3;
  readonly boxMaximum: Vector3;
}

export interface AxisAlignedBoxOffsets {
  readonly minimumOutward: Vector3;
  readonly maximumOutward: Vector3;
}

export type HullEntryRule = "after-minus-one" | "from-zero";

const clipPlanesByRules = new WeakMap<MovementNativeRules, WeakMap<ConvexHull, readonly Plane[]>>();

const axisComponent = (vector: Vector3, axisIndex: number) => axisIndex === 0 ? vector.x : axisIndex === 1 ? vector.y : vector.z;

export function axisAlignedBoxPlanes(minimum: Vector3, maximum: Vector3, offsets: AxisAlignedBoxOffsets): Plane[] {
  return [
    { normal: { x: 1, y: 0, z: 0 }, w: maximum.x + offsets.maximumOutward.x },
    { normal: { x: -1, y: 0, z: 0 }, w: -(minimum.x - offsets.minimumOutward.x) },
    { normal: { x: 0, y: 1, z: 0 }, w: maximum.y + offsets.maximumOutward.y },
    { normal: { x: 0, y: -1, z: 0 }, w: -(minimum.y - offsets.minimumOutward.y) },
    { normal: { x: 0, y: 0, z: 1 }, w: maximum.z + offsets.maximumOutward.z },
    { normal: { x: 0, y: 0, z: -1 }, w: -(minimum.z - offsets.minimumOutward.z) },
  ];
}

export function hullBoxOffsets(rules: MovementNativeRules): AxisAlignedBoxOffsets {
  const offset = rules.hullBoxOffset;
  return { minimumOutward: { x: offset, y: offset, z: offset }, maximumOutward: { x: -offset, y: -offset, z: offset } };
}

function pointOnPlanePairLine(first: Plane, second: Plane, lineDirection: Vector3): Vector3 {
  const lengthSquared = dotProduct(lineDirection, lineDirection);
  const fromFirst = scaleVector(crossProduct(second.normal, lineDirection), first.w / lengthSquared);
  const fromSecond = scaleVector(crossProduct(lineDirection, first.normal), second.w / lengthSquared);
  return addVectors(fromFirst, fromSecond);
}

export function hullBevelPlanes(planes: readonly Plane[], rules: MovementNativeRules): Plane[] {
  const bevels: Plane[] = [];
  planes.forEach((first, firstIndex) => {
    for (const second of planes.slice(firstIndex + 1)) {
      const lineDirection = crossProduct(first.normal, second.normal);
      if (dotProduct(lineDirection, lineDirection) < rules.bevelCrossSquaredMinimum) continue;
      UNIT_AXES.forEach((axis, axisIndex) => {
        if (axisComponent(first.normal, axisIndex) * axisComponent(second.normal, axisIndex) >= 0) return;
        if (dotProduct(crossProduct(axis, first.normal), crossProduct(axis, second.normal)) <= rules.bevelAxisDotMinimum) return;
        const bevelNormal = normalizeVector(crossProduct(axis, lineDirection));
        const outwardNormal = dotProduct(bevelNormal, first.normal) < 0 ? negateVector(bevelNormal) : bevelNormal;
        bevels.push({ normal: outwardNormal, w: dotProduct(outwardNormal, pointOnPlanePairLine(first, second, lineDirection)) });
      });
    }
  });
  return bevels;
}

export function convexHullClipPlanes(hull: ConvexHull, rules: MovementNativeRules): readonly Plane[] {
  const clipPlanesByHull = clipPlanesByRules.get(rules) ?? new WeakMap<ConvexHull, readonly Plane[]>();
  clipPlanesByRules.set(rules, clipPlanesByHull);
  const cached = clipPlanesByHull.get(hull);
  if (cached !== undefined) return cached;
  const clipPlanes = [...hull.planes, ...axisAlignedBoxPlanes(hull.boxMinimum, hull.boxMaximum, hullBoxOffsets(rules)), ...hullBevelPlanes(hull.planes, rules)];
  clipPlanesByHull.set(hull, clipPlanes);
  return clipPlanes;
}

export function clipSweepAgainstPlanes(planes: readonly Plane[], sweep: CollisionSweep, entryRule: HullEntryRule, rules: MovementNativeRules): PrimitiveSweepHit | null {
  let entryTime = -1, exitTime = 1;
  let entryNormal: Vector3 | null = null;
  for (const plane of planes) {
    const pushOut = boxSupportAlongNormal(plane.normal, sweep.extent);
    const startDistance = planeDistance(plane, sweep.start), endDistance = planeDistance(plane, sweep.end);
    if (Math.abs(startDistance - endDistance) <= rules.parallelEpsilon) {
      if (startDistance > pushOut && endDistance > pushOut) return null;
      continue;
    }
    const movesTowardPlane = startDistance > endDistance;
    const startsInsideBand = startDistance >= 0 && startDistance < pushOut;
    const clipDistance = movesTowardPlane && startsInsideBand ? 0 : startDistance - pushOut;
    const crossingTime = clipDistance / (startDistance - endDistance);
    if (movesTowardPlane) {
      if (crossingTime > entryTime) {
        entryTime = crossingTime;
        entryNormal = plane.normal;
      }
    } else if (crossingTime < exitTime) {
      exitTime = crossingTime;
    }
  }
  if (entryNormal === null || !(entryTime < exitTime)) return null;
  if (entryRule === "after-minus-one" ? !(entryTime > -1 && exitTime > 0) : !(entryTime >= 0)) return null;
  return { time: entryTime, normal: entryNormal };
}

export function planesOverlapBox(planes: readonly Plane[], centre: Vector3, extent: Vector3): boolean {
  return planes.every(plane => boxSupportAlongNormal(plane.normal, extent) - planeDistance(plane, centre) > 0);
}
