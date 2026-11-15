import type { Vector3 } from "../../../../shared/math/vector3";
import { indexNone, type BspVisibilityModel } from "./decodeBspVisibility";
import { nodePlaneDot } from "./locateZone";

interface TraversalEntry {
  node: number;
  nodeVisited: boolean;
  farChild: number;
}

const rootNode = 0;

function nodesFrontToBack(model: BspVisibilityModel, camera: Vector3): number[] {
  const visitedNodes: number[] = [], entries: TraversalEntry[] = [{ node: rootNode, nodeVisited: false, farChild: indexNone }];
  while (entries.length > 0) {
    const entry = entries[entries.length - 1]!;
    if (!entry.nodeVisited) {
      const cameraInFront = Math.fround(nodePlaneDot(model, entry.node, camera)) > 0;
      const nearChild = cameraInFront ? model.nodeFront[entry.node]! : model.nodeBack[entry.node]!;
      entry.nodeVisited = true;
      entry.farChild = cameraInFront ? model.nodeBack[entry.node]! : model.nodeFront[entry.node]!;
      if (nearChild !== indexNone) entries.push({ node: nearChild, nodeVisited: false, farChild: indexNone });
      continue;
    }
    for (let member = entry.node; member !== indexNone; member = model.nodeCoplanar[member]!) visitedNodes.push(member);
    if (entry.farChild === indexNone) entries.pop();
    else Object.assign(entry, { node: entry.farChild, nodeVisited: false, farChild: indexNone });
  }
  return visitedNodes;
}

export function groupRangesBySection(model: BspVisibilityModel): Int32Array[] {
  const rangesBySection = Array.from({ length: model.sections.count }, () => [] as number[]);
  for (let range = 0; range < model.ranges.count; range++) rangesBySection[model.ranges.section[range]!]!.push(range);
  return rangesBySection.map(ranges => Int32Array.from(ranges));
}

export function orderTranslucentSections(model: BspVisibilityModel, camera: Vector3, translucentSectionRanges: ReadonlyMap<number, Int32Array>):
  Map<number, Int32Array> {
  const order = new Map<number, Int32Array>();
  if (translucentSectionRanges.size === 0) return order;
  const drawnRangesOfRange = new Array<number[] | undefined>(model.ranges.count), drawnRangesBySection = new Map<number, number[]>();
  for (const [section, ranges] of translucentSectionRanges) {
    const drawnRanges: number[] = [];
    ranges.forEach(range => { drawnRangesOfRange[range] = drawnRanges; });
    drawnRangesBySection.set(section, drawnRanges);
  }
  const visitedNodes = nodesFrontToBack(model, camera);
  for (let position = visitedNodes.length - 1; position >= 0; position--) {
    const range = model.nodeRange[visitedNodes[position]!]!;
    if (range !== indexNone) drawnRangesOfRange[range]?.push(range);
  }
  for (const [section, ranges] of drawnRangesBySection) order.set(section, Int32Array.from(ranges));
  return order;
}
