import type { TypedPayload } from "../../../../shared/typedPayload";
import { zoneSetWordCount } from "./zoneSet";

export interface BspNodeArrays {
  readonly nodeCount: number;
  readonly nodePlane: Float32Array;
  readonly nodeFront: Int32Array;
  readonly nodeBack: Int32Array;
  readonly nodeCoplanar: Int32Array;
  readonly nodeLeaf: Int32Array;
  readonly nodeZone: Uint8Array;
  readonly nodeZoneSet: Uint32Array;
  readonly nodeRenderBound: Int32Array;
  readonly nodeSphere: Float32Array;
  readonly nodeSurface: Int32Array;
  readonly nodeSurfaceFlags: Uint32Array;
  readonly nodeSection: Int32Array;
  readonly nodeDrawable: Uint8Array;
  readonly boundBox: Float32Array;
  readonly boundValid: Uint8Array;
  readonly leafCount: number;
  readonly leafZone: Uint8Array;
}

export class BspPayloadDecodeError extends Error {
  constructor(label: string, message: string) {
    super(`${label}: ${message}`);
    this.name = "BspPayloadDecodeError";
  }
}

export const indexNone = -1;
const planeComponentCount = 4;
const sphereComponentCount = 4;
const boxComponentCount = 6;
const sidesPerNode = 2;

export function requireBspPayload(label: string, condition: boolean, message: string): asserts condition {
  if (!condition) throw new BspPayloadDecodeError(label, message);
}

export function requireBspArrayCount(label: string, name: string, actual: number, expected: number): void {
  requireBspPayload(label, actual === expected, `${name} holds ${actual} values; the counts need ${expected}.`);
}

export function requireBspIndicesInRange(label: string, name: string, values: Int32Array, lowest: number, limit: number): void {
  const outside = values.findIndex(value => value < lowest || value >= limit);
  requireBspPayload(label, outside === -1, `${name}[${outside}] = ${values[outside]} is outside [${lowest}, ${limit}).`);
}

export function requireBspBytesBelow(label: string, name: string, values: Uint8Array, limit: number): void {
  const outside = values.findIndex(value => value >= limit);
  requireBspPayload(label, outside === -1, `${name}[${outside}] = ${values[outside]} is not below ${limit}.`);
}

function requireTreeFromRoot(label: string, front: Int32Array, back: Int32Array, coplanar: Int32Array): void {
  const visited = new Uint8Array(front.length), pending = [0];
  while (pending.length) {
    const node = pending.pop()!;
    requireBspPayload(label, visited[node] === 0, `node ${node} is reached twice from node 0, so the nodes are not a tree.`);
    visited[node] = 1;
    for (const child of [front[node]!, back[node]!, coplanar[node]!]) if (child !== indexNone) pending.push(child);
  }
}

export function decodeBspNodeArrays(label: string, payload: TypedPayload): BspNodeArrays {
  const nodeFront = payload.int32("NODE.front"), nodeCount = nodeFront.length;
  requireBspPayload(label, nodeCount > 0, "the model has no nodes, so there is no root node 0.");
  const nodePlane = payload.float32("NODE.plane"), nodeBack = payload.int32("NODE.back"), nodeCoplanar = payload.int32("NODE.coplanar");
  const nodeLeaf = payload.int32("NODE.leaf"), nodeZone = payload.uint8("NODE.zone"), nodeZoneSet = payload.uint32("NODE.zoneSet");
  const nodeRenderBound = payload.int32("NODE.renderBound"), nodeSphere = payload.float32("NODE.sphere");
  const nodeSurface = payload.int32("NODE.surface"), nodeSurfaceFlags = payload.uint32("NODE.surfaceFlags"), nodeSection = payload.int32("NODE.section"), nodeDrawable = payload.uint8("NODE.drawable");
  const boundBox = payload.float32("BNDS.box"), boundValid = payload.uint8("BNDS.valid"), boundCount = boundValid.length;
  const leafZone = payload.uint8("LEAF.zone"), leafCount = leafZone.length;
  const counts: readonly (readonly [string, number, number])[] = [
    ["NODE.plane", nodePlane.length, nodeCount * planeComponentCount], ["NODE.back", nodeBack.length, nodeCount],
    ["NODE.coplanar", nodeCoplanar.length, nodeCount], ["NODE.leaf", nodeLeaf.length, nodeCount * sidesPerNode],
    ["NODE.zone", nodeZone.length, nodeCount * sidesPerNode], ["NODE.zoneSet", nodeZoneSet.length, nodeCount * zoneSetWordCount],
    ["NODE.renderBound", nodeRenderBound.length, nodeCount], ["NODE.sphere", nodeSphere.length, nodeCount * sphereComponentCount],
    ["NODE.surface", nodeSurface.length, nodeCount], ["NODE.surfaceFlags", nodeSurfaceFlags.length, nodeCount], ["NODE.section", nodeSection.length, nodeCount],
    ["NODE.drawable", nodeDrawable.length, nodeCount], ["BNDS.box", boundBox.length, boundCount * boxComponentCount],
  ];
  for (const [name, actual, expected] of counts) requireBspArrayCount(label, name, actual, expected);
  for (const [name, values] of [["NODE.front", nodeFront], ["NODE.back", nodeBack], ["NODE.coplanar", nodeCoplanar]] as const) {
    requireBspIndicesInRange(label, name, values, indexNone, nodeCount);
  }
  requireBspIndicesInRange(label, "NODE.leaf", nodeLeaf, indexNone, leafCount);
  requireBspIndicesInRange(label, "NODE.renderBound", nodeRenderBound, indexNone, boundCount);
  requireBspBytesBelow(label, "NODE.drawable", nodeDrawable, 2);
  requireTreeFromRoot(label, nodeFront, nodeBack, nodeCoplanar);
  return { nodeCount, nodePlane, nodeFront, nodeBack, nodeCoplanar, nodeLeaf, nodeZone, nodeZoneSet, nodeRenderBound, nodeSphere, nodeSurface, nodeSurfaceFlags,
    nodeSection, nodeDrawable, boundBox, boundValid, leafCount, leafZone };
}
