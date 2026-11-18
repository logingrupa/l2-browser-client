import type { Vector3 } from "../../../../shared/math/vector3";
import { indexNone, type BspNodeArrays } from "./bspNodeArrays";

export interface ZoneLocation {
  readonly leaf: number;
  readonly zone: number;
}

const backSide = 0;
const frontSide = 1;
const sidesPerNode = 2;
const planeComponentCount = 4;

export function nodePlaneDot(model: BspNodeArrays, node: number, point: Vector3): number {
  const offset = node * planeComponentCount, plane = model.nodePlane;
  return plane[offset]! * point.x + plane[offset + 1]! * point.y + plane[offset + 2]! * point.z - plane[offset + 3]!;
}

export function locateZone(model: BspNodeArrays, point: Vector3): ZoneLocation {
  for (let node = 0; ;) {
    const side = Math.fround(nodePlaneDot(model, node, point)) < 0 ? backSide : frontSide;
    const child = side === frontSide ? model.nodeFront[node]! : model.nodeBack[node]!;
    if (child === indexNone) return { leaf: model.nodeLeaf[node * sidesPerNode + side]!, zone: model.nodeZone[node * sidesPerNode + side]! };
    node = child;
  }
}
