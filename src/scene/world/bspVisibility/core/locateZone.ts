import type { Vector3 } from "../../../../shared/math/vector3";
import { indexNone, type BspVisibilityModel } from "./decodeBspVisibility";

export interface ZoneLocation {
  readonly leaf: number;
  readonly zone: number;
}

const backSide = 0;
const frontSide = 1;
const planeComponentCount = 4;

export function nodePlaneDot(model: BspVisibilityModel, node: number, point: Vector3): number {
  const offset = node * planeComponentCount, plane = model.nodePlane;
  return plane[offset]! * point.x + plane[offset + 1]! * point.y + plane[offset + 2]! * point.z - plane[offset + 3]!;
}

export function locateZone(model: BspVisibilityModel, point: Vector3): ZoneLocation {
  let node = 0;
  for (;;) {
    const side = nodePlaneDot(model, node, point) >= 0 ? frontSide : backSide;
    const child = side === frontSide ? model.nodeFront[node]! : model.nodeBack[node]!;
    if (child !== indexNone) {
      node = child;
      continue;
    }
    const sideLeaf = model.nodeLeaf[node * 2 + side]!, otherLeaf = model.nodeLeaf[node * 2 + 1 - side]!;
    const leaf = sideLeaf !== indexNone ? sideLeaf : otherLeaf;
    return leaf !== indexNone ? { leaf, zone: model.leafZone[leaf]! } : { leaf: indexNone, zone: model.nodeZone[node * 2 + side]! };
  }
}
