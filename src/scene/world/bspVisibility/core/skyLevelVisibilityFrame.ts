import type { Vector3 } from "../../../../shared/math/vector3";
import { readTypedPayload } from "../../../../shared/typedPayload";
import {
  decodeBspNodeArrays, indexNone, requireBspArrayCount, requireBspBytesBelow, requireBspIndicesInRange, requireBspPayload, type BspNodeArrays,
} from "./bspNodeArrays";
import { walkSelectedBspNodes, type BspNodeSelectorRules } from "./bspNodeSelector";
import { locateZone } from "./locateZone";
import { nativeFrustumOfScene, nativeSkySceneMatrices, type NativeFrustumConstants, type NativeSceneMatrices, type NativeViewFrustum } from "./nativeViewFrustum";
import { zoneSetOf } from "./zoneSet";

export interface SkyLevelVisibilityModel extends BspNodeArrays {
  readonly sourceSha256: string;
  readonly nodeRange: Int32Array;
  readonly rangePart: Int32Array;
  readonly rangeFirstIndex: Int32Array;
  readonly rangeIndexCount: Int32Array;
  readonly partCount: number;
  readonly partRequiresSorting: Uint8Array;
  readonly partSortingResolved: Uint8Array;
}

export interface SkyLevelScene {
  readonly eye: Vector3;
  readonly frustum: NativeViewFrustum;
}

export type SkyDrawRoute = "unsorted-section" | "sorted-bsp";

export interface SkyDraw {
  readonly route: SkyDrawRoute;
  readonly section: number;
  readonly nodes: readonly number[];
}

export interface SkyDrawOrder {
  readonly draws: readonly SkyDraw[];
  readonly actorSlotDrawIndex: number;
}

export interface SkyMaterialRun {
  readonly part: number;
  readonly nodes: readonly number[];
}

export interface SkyLevelVisibilityFrame extends SkyDrawOrder {
  readonly sceneZone: number;
  readonly sceneLeaf: number;
  readonly acceptedNodes: Int32Array;
  readonly runs: readonly SkyMaterialRun[];
  readonly unresolvedSortingParts: readonly number[];
}

const label = "Shared sky visibility";

export function decodeSkyLevelVisibility(assetJson: unknown, payloadBytes: Uint8Array): SkyLevelVisibilityModel {
  const payload = readTypedPayload(assetJson, payloadBytes);
  const nodes = decodeBspNodeArrays(label, payload);
  const rangeNode = payload.int32("RNGE.node"), rangePart = payload.int32("RNGE.part"), rangeFirstIndex = payload.int32("RNGE.firstIndex");
  const rangeIndexCount = payload.int32("RNGE.indexCount"), partRequiresSorting = payload.uint8("PART.requiresSorting");
  const partSortingResolved = payload.uint8("PART.sortingResolved"), partCount = partRequiresSorting.length;
  for (const [name, values] of [["RNGE.part", rangePart], ["RNGE.firstIndex", rangeFirstIndex], ["RNGE.indexCount", rangeIndexCount]] as const) {
    requireBspArrayCount(label, name, values.length, rangeNode.length);
  }
  requireBspArrayCount(label, "PART.sortingResolved", partSortingResolved.length, partCount);
  requireBspIndicesInRange(label, "RNGE.node", rangeNode, 0, nodes.nodeCount);
  requireBspIndicesInRange(label, "RNGE.part", rangePart, 0, partCount);
  requireBspBytesBelow(label, "PART.requiresSorting", partRequiresSorting, 2);
  requireBspBytesBelow(label, "PART.sortingResolved", partSortingResolved, 2);
  const nodeRange = new Int32Array(nodes.nodeCount).fill(indexNone);
  rangeNode.forEach((node, range) => {
    requireBspPayload(label, nodeRange[node] === indexNone, `node ${node} has two index ranges.`);
    requireBspPayload(label, rangeFirstIndex[range]! >= 0 && rangeIndexCount[range]! > 0 && rangeIndexCount[range]! % 3 === 0,
      `range ${range} is not a positive whole number of triangles from a non-negative first index.`);
    nodeRange[node] = range;
  });
  return { ...nodes, sourceSha256: payload.sourceSha256, nodeRange, rangePart, rangeFirstIndex, rangeIndexCount, partCount, partRequiresSorting,
    partSortingResolved };
}

export function skyLevelSceneOfPose(parent: NativeSceneMatrices, skyLocation: Vector3, constants: NativeFrustumConstants): SkyLevelScene {
  const sky = nativeSkySceneMatrices(parent, skyLocation);
  return { eye: { x: sky.eye[0]!, y: sky.eye[1]!, z: sky.eye[2]! }, frustum: nativeFrustumOfScene(sky, constants) };
}

export function orderSkyLevelDraws(acceptedNodes: Iterable<number>, sectionOfNode: (node: number) => number, requiresSorting: (node: number) => boolean):
  SkyDrawOrder {
  const sortedNodes: number[] = [], activeSections: number[] = [], nodesOfSection = new Map<number, number[]>();
  for (const node of acceptedNodes) {
    if (requiresSorting(node)) {
      sortedNodes.unshift(node);
      continue;
    }
    const section = sectionOfNode(node);
    if (!nodesOfSection.has(section)) {
      nodesOfSection.set(section, []);
      activeSections.unshift(section);
    }
    nodesOfSection.get(section)!.push(node);
  }
  const unsortedDraws = activeSections.map((section): SkyDraw => ({ route: "unsorted-section", section, nodes: nodesOfSection.get(section)! }));
  const sortedDraws = sortedNodes.map((node): SkyDraw => ({ route: "sorted-bsp", section: sectionOfNode(node), nodes: [node] }));
  return { draws: [...unsortedDraws, ...sortedDraws], actorSlotDrawIndex: unsortedDraws.length };
}

function materialRuns(model: SkyLevelVisibilityModel, draws: readonly SkyDraw[]): SkyMaterialRun[] {
  const runs: { part: number; nodes: number[] }[] = [];
  for (const draw of draws) for (const node of draw.nodes) {
    const part = model.rangePart[model.nodeRange[node]!]!, last = runs[runs.length - 1];
    if (last !== undefined && last.part === part) last.nodes.push(node);
    else runs.push({ part, nodes: [node] });
  }
  return runs;
}

export function computeSkyLevelVisibilityFrame(model: SkyLevelVisibilityModel, scene: SkyLevelScene, selector: BspNodeSelectorRules): SkyLevelVisibilityFrame {
  const location = locateZone(model, scene.eye), accepted: number[] = [];
  walkSelectedBspNodes(model, { eye: scene.eye, sceneZone: location.zone, visibleZones: zoneSetOf(location.zone), frustum: scene.frustum }, selector, {
    accept(node) { if (model.nodeRange[node] !== indexNone) accepted.push(node); },
  });
  const partOfNode = (node: number) => model.rangePart[model.nodeRange[node]!]!;
  const unresolvedSortingParts = [...new Set(accepted.map(partOfNode).filter(part => model.partSortingResolved[part] !== 1))].sort((left, right) => left - right);
  const order = orderSkyLevelDraws(accepted, node => model.nodeSection[node]!, node => model.partRequiresSorting[partOfNode(node)] === 1);
  return { sceneZone: location.zone, sceneLeaf: location.leaf, acceptedNodes: Int32Array.from(accepted), ...order, runs: materialRuns(model, order.draws),
    unresolvedSortingParts };
}
