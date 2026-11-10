import type { Vector3 } from "../../../../shared/math/vector3";
import { sweepDelta, type CollisionSweep, type PawnCylinder, type PrimitiveSweepHit } from "./collisionTrace";
import type { MovementNativeRules } from "./movementRules";

interface WidenedCylinder {
  readonly centre: Vector3;
  readonly radius: number;
  readonly halfHeight: number;
  readonly halfWidthY: number;
}

const widenCylinder = (pawn: PawnCylinder, extent: Vector3): WidenedCylinder => ({
  centre: pawn.location,
  radius: pawn.collisionRadius + extent.x,
  halfHeight: pawn.collisionHeight + extent.z,
  halfWidthY: pawn.collisionRadius + extent.y,
});

function sweepMissesBounds(cylinder: WidenedCylinder, sweep: CollisionSweep): boolean {
  const { centre, radius, halfHeight, halfWidthY } = cylinder;
  const outside = (start: number, end: number, middle: number, halfSize: number) => Math.max(start, end) < middle - halfSize || Math.min(start, end) > middle + halfSize;
  return outside(sweep.start.x, sweep.end.x, centre.x, radius) || outside(sweep.start.y, sweep.end.y, centre.y, halfWidthY)
    || outside(sweep.start.z, sweep.end.z, centre.z, halfHeight);
}

function radialNormal(point: Vector3, centre: Vector3): Vector3 {
  const offsetX = point.x - centre.x, offsetY = point.y - centre.y, length = Math.hypot(offsetX, offsetY);
  return length === 0 ? { x: 0, y: 0, z: 0 } : { x: offsetX / length, y: offsetY / length, z: 0 };
}

export function traceCylinder(pawn: PawnCylinder, sweep: CollisionSweep, rules: MovementNativeRules): PrimitiveSweepHit | null {
  const cylinder = widenCylinder(pawn, sweep.extent);
  if (sweepMissesBounds(cylinder, sweep)) return null;
  const { centre, radius, halfHeight } = cylinder, delta = sweepDelta(sweep);
  const startOffsetX = sweep.start.x - centre.x, startOffsetY = sweep.start.y - centre.y;
  const radialStart = startOffsetX * startOffsetX + startOffsetY * startOffsetY - radius * radius;
  const startBetweenCaps = Math.abs(sweep.start.z - centre.z) <= halfHeight;
  if (startBetweenCaps && radialStart < rules.cylinderInsideMargin) {
    const inwardDot = delta.x * startOffsetX + delta.y * startOffsetY;
    return inwardDot < rules.cylinderInwardDot ? { time: 0, normal: radialNormal(sweep.start, centre) } : null;
  }
  let capEntry = -Infinity, capExit = Infinity;
  if (delta.z === 0) {
    if (!startBetweenCaps) return null;
  } else {
    const lowerTime = (centre.z - halfHeight - sweep.start.z) / delta.z, upperTime = (centre.z + halfHeight - sweep.start.z) / delta.z;
    capEntry = Math.min(lowerTime, upperTime);
    capExit = Math.max(lowerTime, upperTime);
  }
  const radialA = delta.x * delta.x + delta.y * delta.y, radialB = 2 * (startOffsetX * delta.x + startOffsetY * delta.y);
  let sideEntry = -Infinity, sideExit = Infinity;
  if (radialA === 0) {
    if (radialStart > 0) return null;
  } else {
    const discriminant = radialB * radialB - 4 * radialA * radialStart;
    if (discriminant < 0) return null;
    const root = Math.sqrt(discriminant);
    sideEntry = (-radialB - root) / (2 * radialA);
    sideExit = (-radialB + root) / (2 * radialA);
  }
  const entryTime = Math.max(capEntry, sideEntry), exitTime = Math.min(capExit, sideExit);
  if (entryTime > exitTime || entryTime < 0 || entryTime > 1) return null;
  const capHit = capEntry >= sideEntry;
  const entryPoint = { x: sweep.start.x + delta.x * entryTime, y: sweep.start.y + delta.y * entryTime, z: sweep.start.z + delta.z * entryTime };
  const normal = capHit ? { x: 0, y: 0, z: delta.z > 0 ? -1 : 1 } : radialNormal(entryPoint, centre);
  return { time: Math.min(Math.max(entryTime - rules.cylinderTimeOffset, 0), 1), normal };
}

export function cylinderOverlapsBox(pawn: PawnCylinder, centre: Vector3, extent: Vector3): boolean {
  const cylinder = widenCylinder(pawn, extent);
  const offsetX = centre.x - cylinder.centre.x, offsetY = centre.y - cylinder.centre.y;
  return offsetX * offsetX + offsetY * offsetY < cylinder.radius * cylinder.radius && Math.abs(centre.z - cylinder.centre.z) < cylinder.halfHeight;
}
