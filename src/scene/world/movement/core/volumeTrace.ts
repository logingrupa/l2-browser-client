import { transformPoint, type AffineMatrix } from "../../../../shared/math/affineMatrix";
import { transformPlane, type Plane } from "../../../../shared/math/plane";
import { rotatorSineFromTable } from "../../../../shared/math/rotator";
import type { Vector3 } from "../../../../shared/math/vector3";
import { solidTreeHoldsPoint, solidTreeOverlapsBox, traceSolidTree, type SolidCollisionTree } from "./bspCollisionTrace";
import type { CollisionSourceVector, CollisionVolume } from "./collisionCell";
import { boundsOfPoints, type CollisionSweep, type PrimitiveSweepHit } from "./collisionTrace";
import { CollisionWorldError } from "./collisionWorld";
import type { MovementNativeRules } from "./movementRules";

interface VolumeWorldGeometry {
  readonly planes: readonly Plane[];
  readonly boxMinimum: Vector3;
  readonly boxMaximum: Vector3;
}

const quarterTurn = 16384;
const volumeGeometryCache = new WeakMap<CollisionVolume, VolumeWorldGeometry>();

export function ue2ActorLocalToWorld(location: CollisionSourceVector, rotation: CollisionSourceVector, drawScale: number,
  drawScale3D: CollisionSourceVector, prePivot: CollisionSourceVector): AffineMatrix {
  const [pitch, yaw, roll] = rotation;
  const sinePitch = rotatorSineFromTable(pitch), sineYaw = rotatorSineFromTable(yaw), sineRoll = rotatorSineFromTable(roll);
  const cosinePitch = rotatorSineFromTable(pitch + quarterTurn), cosineYaw = rotatorSineFromTable(yaw + quarterTurn);
  const cosineRoll = rotatorSineFromTable(roll + quarterTurn);
  const rotationRows = [
    [cosinePitch * cosineYaw, cosinePitch * sineYaw, sinePitch],
    [sineRoll * sinePitch * cosineYaw - cosineRoll * sineYaw, sineRoll * sinePitch * sineYaw + cosineRoll * cosineYaw, -sineRoll * cosinePitch],
    [-(cosineRoll * sinePitch * cosineYaw + sineRoll * sineYaw), cosineYaw * sineRoll - cosineRoll * sinePitch * sineYaw, cosineRoll * cosinePitch],
  ];
  const basisRows = rotationRows.map((row, axis) => row.map(value => value * drawScale3D[axis]! * drawScale));
  const column = (index: number) => [basisRows[0]![index]!, basisRows[1]![index]!, basisRows[2]![index]!] as const;
  const translationComponent = (index: number) => location[index]! - (prePivot[0] * column(index)[0] + prePivot[1] * column(index)[1] + prePivot[2] * column(index)[2]);
  return {
    linear: [...column(0), ...column(1), ...column(2)],
    translation: { x: translationComponent(0), y: translationComponent(1), z: translationComponent(2) },
  };
}

function volumeWorldGeometry(volume: CollisionVolume, owner: string): VolumeWorldGeometry {
  const cached = volumeGeometryCache.get(volume);
  if (cached !== undefined) return cached;
  if (volume.drawScale === 0 || volume.drawScale3D.some(scale => scale === 0)) throw new CollisionWorldError(`${owner} has a singular scale.`);
  const localToWorld = ue2ActorLocalToWorld(volume.location, volume.rotation, volume.drawScale, volume.drawScale3D, volume.prePivot);
  const planes = volume.nodes.map(node => transformPlane({ normal: { x: node.plane[0], y: node.plane[1], z: node.plane[2] }, w: node.plane[3] }, localToWorld));
  const localVertices = volume.nodes.flatMap(node => Array.from({ length: node.polygon.length / 3 },
    (_, vertex): Vector3 => ({ x: node.polygon[vertex * 3]!, y: node.polygon[vertex * 3 + 1]!, z: node.polygon[vertex * 3 + 2]! })));
  if (localVertices.length === 0) throw new CollisionWorldError(`${owner} has nodes but no polygon vertices for its hull box.`);
  const localBounds = boundsOfPoints(localVertices);
  const worldCorners = [0, 1, 2, 3, 4, 5, 6, 7].map(corner => transformPoint(localToWorld, {
    x: corner & 1 ? localBounds.maximum.x : localBounds.minimum.x, y: corner & 2 ? localBounds.maximum.y : localBounds.minimum.y,
    z: corner & 4 ? localBounds.maximum.z : localBounds.minimum.z,
  }));
  const worldBounds = boundsOfPoints(worldCorners);
  const geometry: VolumeWorldGeometry = { planes, boxMinimum: worldBounds.minimum, boxMaximum: worldBounds.maximum };
  volumeGeometryCache.set(volume, geometry);
  return geometry;
}

export function volumeSolidCollisionTree(volume: CollisionVolume, owner: string, rules: MovementNativeRules): SolidCollisionTree {
  const geometry = volumeWorldGeometry(volume, owner);
  return {
    owner,
    nodeCount: volume.nodes.length,
    rootOutside: volume.rootOutside,
    nodePlane: node => geometry.planes[node]!,
    frontChild: node => volume.nodes[node]!.front,
    backChild: node => volume.nodes[node]!.back,
    isCsgNode: node => volume.nodes[node]!.polygon.length > 0 && (volume.nodes[node]!.nodeFlags & rules.notCsgNodeFlags) === 0,
    hullBelow: (node, side, outwardPathPlanes) => ({
      key: node * 2 + (side === "back" ? 1 : 0),
      hull: { planes: [...outwardPathPlanes], boxMinimum: geometry.boxMinimum, boxMaximum: geometry.boxMaximum },
    }),
  };
}

export function traceVolume(volume: CollisionVolume, owner: string, sweep: CollisionSweep, rules: MovementNativeRules): PrimitiveSweepHit | null {
  return traceSolidTree(volumeSolidCollisionTree(volume, owner, rules), sweep, rules);
}

export function volumeOverlapsBox(volume: CollisionVolume, owner: string, centre: Vector3, extent: Vector3, rules: MovementNativeRules): boolean {
  return solidTreeOverlapsBox(volumeSolidCollisionTree(volume, owner, rules), centre, extent, rules);
}

export function volumeHoldsPoint(volume: CollisionVolume, owner: string, point: Vector3, rules: MovementNativeRules): boolean {
  return solidTreeHoldsPoint(volumeSolidCollisionTree(volume, owner, rules), point);
}
