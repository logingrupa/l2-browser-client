import type { Vector3 } from "../../../../shared/math/vector3";
import { indexNone, type BspVisibilityModel } from "./decodeBspVisibility";
import { nodePlaneDot } from "./locateZone";

const rootNode = 0;
const visitSubtreeStep = 0;
const rankChainStep = 1;
const stepKindCount = 2;

function rankCoplanarChainReversed(model: BspVisibilityModel, node: number, rank: Int32Array, nextRank: number): number {
  const chain: number[] = [];
  for (let member = node; member !== indexNone; member = model.nodeCoplanar[member]!) chain.push(member);
  for (let position = chain.length - 1; position >= 0; position--) rank[chain[position]!] = nextRank++;
  return nextRank;
}

export function rankNodesBackToFront(model: BspVisibilityModel, camera: Vector3): Int32Array {
  const rank = new Int32Array(model.nodeCount).fill(indexNone), pending = [rootNode * stepKindCount + visitSubtreeStep];
  let nextRank = 0;
  while (pending.length) {
    const step = pending.pop()!, node = Math.floor(step / stepKindCount);
    if (step % stepKindCount === rankChainStep) {
      nextRank = rankCoplanarChainReversed(model, node, rank, nextRank);
      continue;
    }
    const cameraInFront = nodePlaneDot(model, node, camera) > 0;
    const farChild = cameraInFront ? model.nodeBack[node]! : model.nodeFront[node]!;
    const nearChild = cameraInFront ? model.nodeFront[node]! : model.nodeBack[node]!;
    if (nearChild !== indexNone) pending.push(nearChild * stepKindCount + visitSubtreeStep);
    pending.push(node * stepKindCount + rankChainStep);
    if (farChild !== indexNone) pending.push(farChild * stepKindCount + visitSubtreeStep);
  }
  return rank;
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
  const rank = rankNodesBackToFront(model, camera);
  const rangeRank = (range: number) => rank[model.ranges.node[range]!]!;
  for (const [section, ranges] of translucentSectionRanges) order.set(section, Int32Array.from(ranges).sort((left, right) => rangeRank(left) - rangeRank(right)));
  return order;
}
