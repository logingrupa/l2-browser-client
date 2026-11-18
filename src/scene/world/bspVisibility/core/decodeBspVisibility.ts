import { readTypedPayload, type TypedPayload } from "../../../../shared/typedPayload";
import {
  decodeBspNodeArrays, indexNone, requireBspArrayCount, requireBspBytesBelow, requireBspIndicesInRange, requireBspPayload, type BspNodeArrays,
} from "./bspNodeArrays";
import { maximumZoneCount, zoneSetWordCount } from "./zoneSet";

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

export interface BspVisibilityModel extends BspNodeArrays {
  readonly sourceSha256: string;
  readonly nodeRange: Int32Array;
  readonly leafPvs: Uint32Array;
  readonly zoneCount: number;
  readonly zoneConnectivity: Uint32Array;
  readonly zoneClass: Uint8Array;
  readonly portalNodes: Int32Array;
  readonly ranges: BspVisibilityRanges;
  readonly sections: BspVisibilitySections;
  readonly members: BspVisibilityMembers;
}

export const bspVisibilityLabel = "BSP visibility";
export const zoneClassSkyBit = 2;
export const zoneClassVisibilityOutdoorBit = 8;
export const memberKindStaticMesh = 0;
export const memberKindMapEmitter = 1;
export const memberFlagSky = 1;
export const memberFlagUnbounded = 2;
const centerComponentCount = 3;
const knownMemberKinds = new Set([memberKindStaticMesh, memberKindMapEmitter]);
const knownMemberFlags = memberFlagSky | memberFlagUnbounded;
const label = bspVisibilityLabel;

function decodeRanges(payload: TypedPayload, nodeCount: number): { ranges: BspVisibilityRanges; sections: BspVisibilitySections; nodeRange: Int32Array } {
  const chunk = payload.int32("RNGE.chunk"), node = payload.int32("RNGE.node"), primitive = payload.int32("RNGE.primitive");
  const firstIndex = payload.int32("RNGE.firstIndex"), indexCount = payload.int32("RNGE.indexCount"), count = node.length;
  for (const [name, values] of [["RNGE.chunk", chunk], ["RNGE.primitive", primitive], ["RNGE.firstIndex", firstIndex], ["RNGE.indexCount", indexCount]] as const) {
    requireBspArrayCount(label, name, values.length, count);
  }
  requireBspIndicesInRange(label, "RNGE.node", node, 0, nodeCount);
  for (const [name, values] of [["RNGE.chunk", chunk], ["RNGE.primitive", primitive], ["RNGE.firstIndex", firstIndex]] as const) {
    const negative = values.findIndex(value => value < 0);
    requireBspPayload(label, negative === -1, `${name}[${negative}] = ${values[negative]} is negative.`);
  }
  const badIndexCount = indexCount.findIndex(value => value <= 0 || value % 3 !== 0);
  requireBspPayload(label, badIndexCount === -1, `RNGE.indexCount[${badIndexCount}] is not a positive whole number of triangles.`);
  const nodeRange = new Int32Array(nodeCount).fill(indexNone);
  node.forEach((rangeNode, range) => {
    requireBspPayload(label, nodeRange[rangeNode] === indexNone, `node ${rangeNode} has two index ranges.`);
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
  requireBspArrayCount(label, "MEMB.exportIndex", exportIndex.length, count);
  requireBspArrayCount(label, "MEMB.flags", flags.length, count);
  requireBspArrayCount(label, "MEMB.center", center.length, count * centerComponentCount);
  requireBspArrayCount(label, "MEMB.zoneSet", zoneSet.length, count * zoneSetWordCount);
  requireBspArrayCount(label, "MEMB.leafStart", leafStart.length, count + 1);
  const unknownKind = kind.findIndex(value => !knownMemberKinds.has(value));
  requireBspPayload(label, unknownKind === -1, `MEMB.kind[${unknownKind}] = ${kind[unknownKind]} is not a static mesh or map emitter.`);
  const unknownFlags = flags.findIndex(value => (value & ~knownMemberFlags) !== 0);
  requireBspPayload(label, unknownFlags === -1, `MEMB.flags[${unknownFlags}] = ${flags[unknownFlags]} sets an unknown bit.`);
  requireBspPayload(label, leafStart[0] === 0 && leafStart[count] === leaves.length, "MEMB.leafStart must run from 0 to the MEMB.leaves count.");
  const descending = leafStart.findIndex((start, member) => member > 0 && start < leafStart[member - 1]!);
  requireBspPayload(label, descending === -1, `MEMB.leafStart[${descending}] runs backwards.`);
  requireBspIndicesInRange(label, "MEMB.leaves", leaves, 0, leafCount);
  return { count, kind, exportIndex, flags, center, zoneSet, leafStart, leaves };
}

export function decodeBspVisibility(assetJson: unknown, payloadBytes: Uint8Array): BspVisibilityModel {
  const payload = readTypedPayload(assetJson, payloadBytes);
  const nodes = decodeBspNodeArrays(label, payload);
  const leafPvs = payload.uint32("LEAF.pvs");
  const zoneClass = payload.uint8("ZONE.class"), zoneConnectivity = payload.uint32("ZONE.connectivity"), zoneCount = zoneClass.length;
  const portalNodes = payload.int32("PORT.node");
  requireBspArrayCount(label, "LEAF.pvs", leafPvs.length, nodes.leafCount * zoneSetWordCount);
  requireBspArrayCount(label, "ZONE.connectivity", zoneConnectivity.length, zoneCount * zoneSetWordCount);
  requireBspPayload(label, zoneCount > 0 && zoneCount <= maximumZoneCount, `the model lists ${zoneCount} zones; a zone set holds 1 to ${maximumZoneCount}.`);
  requireBspIndicesInRange(label, "PORT.node", portalNodes, 0, nodes.nodeCount);
  requireBspBytesBelow(label, "NODE.zone", nodes.nodeZone, zoneCount);
  requireBspBytesBelow(label, "LEAF.zone", nodes.leafZone, zoneCount);
  const { ranges, sections, nodeRange } = decodeRanges(payload, nodes.nodeCount);
  return { ...nodes, sourceSha256: payload.sourceSha256, nodeRange, leafPvs, zoneCount, zoneConnectivity, zoneClass, portalNodes, ranges, sections,
    members: decodeMembers(payload, nodes.leafCount) };
}
