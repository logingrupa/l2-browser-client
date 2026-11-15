import type { Vector3 } from "../../../../shared/math/vector3";
import { indexNone, type BspVisibilityModel } from "./decodeBspVisibility";
import { nodePlaneDot } from "./locateZone";
import { nodeSphereInsideFrustum } from "./portalWalk";
import { boxOutsideFrustum, type ViewFrustum } from "./viewFrustum";
import { zoneSetHas, zoneSetWordsEmpty, zoneSetWordsMeet, type ZoneSet } from "./zoneSet";

export interface VisibleSections {
  readonly sectionVisible: Uint8Array;
  readonly leafVisible: Uint8Array;
}

const rootNode = 0;
const descendStep = 0;
const emitStep = 1;
const stepKindCount = 2;
const backSide = 0;
const frontSide = 1;
const boxComponentCount = 6;

function renderBoundOutside(model: BspVisibilityModel, node: number, frustum: ViewFrustum): boolean {
  const bound = model.nodeRenderBound[node]!;
  if (bound === indexNone || model.boundValid[bound] !== 1) return false;
  const box = model.boundBox, offset = bound * boxComponentCount;
  return boxOutsideFrustum(frustum, { x: box[offset]!, y: box[offset + 1]!, z: box[offset + 2]! },
    { x: box[offset + 3]!, y: box[offset + 4]!, z: box[offset + 5]! });
}

function emitCoplanarChain(model: BspVisibilityModel, node: number, frustum: ViewFrustum | null, sectionVisible: Uint8Array): void {
  for (let member = node; member !== indexNone; member = model.nodeCoplanar[member]!) {
    const range = model.nodeRange[member]!;
    if (range === indexNone || (frustum !== null && !nodeSphereInsideFrustum(model, member, frustum))) continue;
    sectionVisible[model.ranges.section[range]!] = 1;
  }
}

export function walkVisibleSections(model: BspVisibilityModel, camera: Vector3, visibleZones: ZoneSet, frustum: ViewFrustum | null): VisibleSections {
  const sectionVisible = new Uint8Array(model.sections.count), leafReached = new Uint8Array(model.leafCount);
  const pending = [rootNode * stepKindCount + descendStep];
  const pushSide = (node: number, side: number) => {
    const child = side === frontSide ? model.nodeFront[node]! : model.nodeBack[node]!;
    if (child !== indexNone) pending.push(child * stepKindCount + descendStep);
    else if (model.nodeLeaf[node * 2 + side]! !== indexNone) leafReached[model.nodeLeaf[node * 2 + side]!] = 1;
  };
  while (pending.length) {
    const step = pending.pop()!, node = Math.floor(step / stepKindCount);
    if (step % stepKindCount === emitStep) {
      emitCoplanarChain(model, node, frustum, sectionVisible);
      continue;
    }
    if (!zoneSetWordsEmpty(model.nodeZoneSet, node) && !zoneSetWordsMeet(model.nodeZoneSet, node, visibleZones)) continue;
    if (frustum !== null && renderBoundOutside(model, node, frustum)) continue;
    const nearSide = nodePlaneDot(model, node, camera) > 0 ? frontSide : backSide;
    pushSide(node, 1 - nearSide);
    pending.push(node * stepKindCount + emitStep);
    pushSide(node, nearSide);
  }
  const leafVisible = Uint8Array.from(leafReached, (reached, leaf) => reached === 1 && zoneSetHas(visibleZones, model.leafZone[leaf]!) ? 1 : 0);
  return { sectionVisible, leafVisible };
}

export function outdoorViewSections(model: BspVisibilityModel, outdoorZones: ZoneSet): VisibleSections {
  const sectionVisible = new Uint8Array(model.sections.count);
  for (let node = 0; node < model.nodeCount; node++) {
    const range = model.nodeRange[node]!;
    if (range !== indexNone && zoneSetHas(outdoorZones, model.nodeZone[node * 2 + frontSide]!)) sectionVisible[model.ranges.section[range]!] = 1;
  }
  const leafVisible = Uint8Array.from(model.leafZone, zone => zoneSetHas(outdoorZones, zone) ? 1 : 0);
  return { sectionVisible, leafVisible };
}
