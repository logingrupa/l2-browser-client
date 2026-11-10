import { readTypedPayload, type TypedPayload } from "../../../../shared/typedPayload";
import { maximumZoneCount, zoneSetWordCount } from "./zoneSet";

export class BspVisibilityDecodeError extends Error {
  constructor(message: string) {
    super(`BSP visibility: ${message}`);
    this.name = "BspVisibilityDecodeError";
  }
}

export interface BspVisibilityRanges {
  readonly count: number;
  readonly chunk: Int32Array;
  readonly node: Int32Array;
  readonly primitive: Int32Array;
  readonly firstIndex: Int32Array;
  readonly indexCount: Int32Array;
  readonly section: Int32Array;
}

export interface BspVisibilitySections {
  readonly count: number;
  readonly chunk: Int32Array;
  readonly primitive: Int32Array;
}

export interface BspVisibilityMembers {
  readonly count: number;
  readonly kind: Uint8Array;
  readonly exportIndex: Int32Array;
  readonly flags: Uint8Array;
  readonly center: Float32Array;
  readonly zoneSet: Uint32Array;
  readonly leafStart: Uint32Array;
  readonly leaves: Int32Array;
}

export interface BspVisibilityModel {
  readonly sourceSha256: string;
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
  readonly nodeRange: Int32Array;
  readonly boundBox: Float32Array;
  readonly boundValid: Uint8Array;
  readonly leafCount: number;
  readonly leafZone: Uint8Array;
  readonly leafPvs: Uint32Array;
  readonly zoneCount: number;
  readonly zoneConnectivity: Uint32Array;
  readonly zoneClass: Uint8Array;
  readonly portalNodes: Int32Array;
  readonly ranges: BspVisibilityRanges;
  readonly sections: BspVisibilitySections;
  readonly members: BspVisibilityMembers;
}

export const zoneClassSkyBit = 2;
export const zoneClassVisibilityOutdoorBit = 8;
export const memberKindStaticMesh = 0;
export const memberKindMapEmitter = 1;
export const memberFlagSky = 1;
export const memberFlagUnbounded = 2;
export const indexNone = -1;
const planeComponentCount = 4;
const sphereComponentCount = 4;
const boxComponentCount = 6;
const centerComponentCount = 3;
const sidesPerNode = 2;
const knownMemberKinds = new Set([memberKindStaticMesh, memberKindMapEmitter]);
const knownMemberFlags = memberFlagSky | memberFlagUnbounded;

function requireResource(condition: boolean, message: string): asserts condition {
  if (!condition) throw new BspVisibilityDecodeError(message);
}

function requireCount(name: string, actual: number, expected: number): void {
  requireResource(actual === expected, `${name} holds ${actual} values; the counts need ${expected}.`);
}

function requireIndicesInRange(name: string, values: Int32Array, lowest: number, limit: number): void {
  const outside = values.findIndex(value => value < lowest || value >= limit);
  requireResource(outside === -1, `${name}[${outside}] = ${values[outside]} is outside [${lowest}, ${limit}).`);
}

function requireBytesBelow(name: string, values: Uint8Array, limit: number): void {
  const outside = values.findIndex(value => value >= limit);
  requireResource(outside === -1, `${name}[${outside}] = ${values[outside]} is not below ${limit}.`);
}

function requireTreeFromRoot(front: Int32Array, back: Int32Array, coplanar: Int32Array): void {
  const visited = new Uint8Array(front.length), pending = [0];
  while (pending.length) {
    const node = pending.pop()!;
    requireResource(visited[node] === 0, `node ${node} is reached twice from node 0, so the nodes are not a tree.`);
    visited[node] = 1;
    for (const child of [front[node]!, back[node]!, coplanar[node]!]) if (child !== indexNone) pending.push(child);
  }
}

function decodeRanges(payload: TypedPayload, nodeCount: number): { ranges: BspVisibilityRanges; sections: BspVisibilitySections; nodeRange: Int32Array } {
  const chunk = payload.int32("RNGE.chunk"), node = payload.int32("RNGE.node"), primitive = payload.int32("RNGE.primitive");
  const firstIndex = payload.int32("RNGE.firstIndex"), indexCount = payload.int32("RNGE.indexCount"), count = node.length;
  for (const [name, values] of [["RNGE.chunk", chunk], ["RNGE.primitive", primitive], ["RNGE.firstIndex", firstIndex], ["RNGE.indexCount", indexCount]] as const) {
    requireCount(name, values.length, count);
  }
  requireIndicesInRange("RNGE.node", node, 0, nodeCount);
  for (const [name, values] of [["RNGE.chunk", chunk], ["RNGE.primitive", primitive], ["RNGE.firstIndex", firstIndex]] as const) {
    const negative = values.findIndex(value => value < 0);
    requireResource(negative === -1, `${name}[${negative}] = ${values[negative]} is negative.`);
  }
  const badIndexCount = indexCount.findIndex(value => value <= 0 || value % 3 !== 0);
  requireResource(badIndexCount === -1, `RNGE.indexCount[${badIndexCount}] is not a positive whole number of triangles.`);
  const nodeRange = new Int32Array(nodeCount).fill(indexNone);
  node.forEach((rangeNode, range) => {
    requireResource(nodeRange[rangeNode] === indexNone, `node ${rangeNode} has two index ranges.`);
    nodeRange[rangeNode] = range;
  });
  const sectionKeys = [...new Set([...node.keys()].map(range => `${chunk[range]}:${primitive[range]}`))]
    .map(key => key.split(":").map(Number) as [number, number])
    .sort((left, right) => left[0] - right[0] || left[1] - right[1]);
  const sectionByKey = new Map(sectionKeys.map(([sectionChunk, sectionPrimitive], section) => [`${sectionChunk}:${sectionPrimitive}`, section]));
  const section = Int32Array.from(node.keys(), range => sectionByKey.get(`${chunk[range]}:${primitive[range]}`)!);
  return { ranges: { count, chunk, node, primitive, firstIndex, indexCount, section }, nodeRange,
    sections: { count: sectionKeys.length, chunk: Int32Array.from(sectionKeys, key => key[0]), primitive: Int32Array.from(sectionKeys, key => key[1]) } };
}

function decodeMembers(payload: TypedPayload, leafCount: number): BspVisibilityMembers {
  const kind = payload.uint8("MEMB.kind"), exportIndex = payload.int32("MEMB.exportIndex"), flags = payload.uint8("MEMB.flags");
  const center = payload.float32("MEMB.center"), zoneSet = payload.uint32("MEMB.zoneSet"), leafStart = payload.uint32("MEMB.leafStart");
  const leaves = payload.int32("MEMB.leaves"), count = kind.length;
  requireCount("MEMB.exportIndex", exportIndex.length, count);
  requireCount("MEMB.flags", flags.length, count);
  requireCount("MEMB.center", center.length, count * centerComponentCount);
  requireCount("MEMB.zoneSet", zoneSet.length, count * zoneSetWordCount);
  requireCount("MEMB.leafStart", leafStart.length, count + 1);
  const unknownKind = kind.findIndex(value => !knownMemberKinds.has(value));
  requireResource(unknownKind === -1, `MEMB.kind[${unknownKind}] = ${kind[unknownKind]} is not a static mesh or map emitter.`);
  const unknownFlags = flags.findIndex(value => (value & ~knownMemberFlags) !== 0);
  requireResource(unknownFlags === -1, `MEMB.flags[${unknownFlags}] = ${flags[unknownFlags]} sets an unknown bit.`);
  requireResource(leafStart[0] === 0 && leafStart[count] === leaves.length, "MEMB.leafStart must run from 0 to the MEMB.leaves count.");
  const descending = leafStart.findIndex((start, member) => member > 0 && start < leafStart[member - 1]!);
  requireResource(descending === -1, `MEMB.leafStart[${descending}] runs backwards.`);
  requireIndicesInRange("MEMB.leaves", leaves, 0, leafCount);
  return { count, kind, exportIndex, flags, center, zoneSet, leafStart, leaves };
}

export function decodeBspVisibility(assetJson: unknown, payloadBytes: Uint8Array): BspVisibilityModel {
  const payload = readTypedPayload(assetJson, payloadBytes);
  const nodeFront = payload.int32("NODE.front"), nodeCount = nodeFront.length;
  requireResource(nodeCount > 0, "the model has no nodes, so there is no root node 0.");
  const nodePlane = payload.float32("NODE.plane"), nodeBack = payload.int32("NODE.back"), nodeCoplanar = payload.int32("NODE.coplanar");
  const nodeLeaf = payload.int32("NODE.leaf"), nodeZone = payload.uint8("NODE.zone"), nodeZoneSet = payload.uint32("NODE.zoneSet");
  const nodeRenderBound = payload.int32("NODE.renderBound"), nodeSphere = payload.float32("NODE.sphere");
  const boundBox = payload.float32("BNDS.box"), boundValid = payload.uint8("BNDS.valid"), boundCount = boundValid.length;
  const leafZone = payload.uint8("LEAF.zone"), leafPvs = payload.uint32("LEAF.pvs"), leafCount = leafZone.length;
  const zoneClass = payload.uint8("ZONE.class"), zoneConnectivity = payload.uint32("ZONE.connectivity"), zoneCount = zoneClass.length;
  const portalNodes = payload.int32("PORT.node");
  requireCount("NODE.plane", nodePlane.length, nodeCount * planeComponentCount);
  requireCount("NODE.back", nodeBack.length, nodeCount);
  requireCount("NODE.coplanar", nodeCoplanar.length, nodeCount);
  requireCount("NODE.leaf", nodeLeaf.length, nodeCount * sidesPerNode);
  requireCount("NODE.zone", nodeZone.length, nodeCount * sidesPerNode);
  requireCount("NODE.zoneSet", nodeZoneSet.length, nodeCount * zoneSetWordCount);
  requireCount("NODE.renderBound", nodeRenderBound.length, nodeCount);
  requireCount("NODE.sphere", nodeSphere.length, nodeCount * sphereComponentCount);
  requireCount("BNDS.box", boundBox.length, boundCount * boxComponentCount);
  requireCount("LEAF.pvs", leafPvs.length, leafCount * zoneSetWordCount);
  requireCount("ZONE.connectivity", zoneConnectivity.length, zoneCount * zoneSetWordCount);
  requireResource(zoneCount > 0 && zoneCount <= maximumZoneCount, `the model lists ${zoneCount} zones; a zone set holds 1 to ${maximumZoneCount}.`);
  for (const [name, values] of [["NODE.front", nodeFront], ["NODE.back", nodeBack], ["NODE.coplanar", nodeCoplanar]] as const) {
    requireIndicesInRange(name, values, indexNone, nodeCount);
  }
  requireIndicesInRange("NODE.leaf", nodeLeaf, indexNone, leafCount);
  requireIndicesInRange("NODE.renderBound", nodeRenderBound, indexNone, boundCount);
  requireIndicesInRange("PORT.node", portalNodes, 0, nodeCount);
  requireBytesBelow("NODE.zone", nodeZone, zoneCount);
  requireBytesBelow("LEAF.zone", leafZone, zoneCount);
  requireTreeFromRoot(nodeFront, nodeBack, nodeCoplanar);
  const { ranges, sections, nodeRange } = decodeRanges(payload, nodeCount);
  return { sourceSha256: payload.sourceSha256, nodeCount, nodePlane, nodeFront, nodeBack, nodeCoplanar, nodeLeaf, nodeZone, nodeZoneSet,
    nodeRenderBound, nodeSphere, nodeRange, boundBox, boundValid, leafCount, leafZone, leafPvs, zoneCount, zoneConnectivity, zoneClass,
    portalNodes, ranges, sections, members: decodeMembers(payload, leafCount) };
}
