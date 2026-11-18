import type { Vector3 } from "../../../../shared/math/vector3";
import { indexNone } from "./bspNodeArrays";
import { walkSelectedBspNodes, type BspNodeSelectorRules } from "./bspNodeSelector";
import type { BspVisibilityModel } from "./decodeBspVisibility";
import type { NativeViewFrustum } from "./nativeViewFrustum";
import { zoneSetHas, type ZoneSet } from "./zoneSet";

export interface VisibleSections {
  readonly sectionVisible: Uint8Array;
  readonly rangeVisible: Uint8Array;
  readonly leafVisible: Uint8Array;
}

export interface SharedSkyTrigger {
  readonly triggerNode: number;
  readonly otherZoneCandidates: number;
}

export interface WalkedSections extends VisibleSections, SharedSkyTrigger {}

const frontSide = 1;

export function walkVisibleSections(model: BspVisibilityModel, eye: Vector3, sceneZone: number, visibleZones: ZoneSet, frustum: NativeViewFrustum | null,
  rules: BspNodeSelectorRules): WalkedSections {
  const sectionVisible = new Uint8Array(model.sections.count), rangeVisible = new Uint8Array(model.ranges.count), leafReached = new Uint8Array(model.leafCount);
  let triggerNode = indexNone, otherZoneCandidates = 0;
  walkSelectedBspNodes(model, { eye, sceneZone, visibleZones, frustum }, rules, {
    accept(node) {
      const range = model.nodeRange[node]!;
      if (range === indexNone) return;
      sectionVisible[model.ranges.section[range]!] = 1;
      rangeVisible[range] = 1;
    },
    reachLeaf(leaf) { leafReached[leaf] = 1; },
    fakeBackdrop(node, visibilityZone) {
      if (visibilityZone !== sceneZone) otherZoneCandidates++;
      else if (triggerNode === indexNone) triggerNode = node;
    },
  });
  const leafVisible = Uint8Array.from(leafReached, (reached, leaf) => reached === 1 && zoneSetHas(visibleZones, model.leafZone[leaf]!) ? 1 : 0);
  return { sectionVisible, rangeVisible, leafVisible, triggerNode, otherZoneCandidates };
}

export function outdoorViewSections(model: BspVisibilityModel, outdoorZones: ZoneSet): VisibleSections {
  const sectionVisible = new Uint8Array(model.sections.count), rangeVisible = new Uint8Array(model.ranges.count);
  for (let node = 0; node < model.nodeCount; node++) {
    const range = model.nodeRange[node]!;
    if (range === indexNone || !zoneSetHas(outdoorZones, model.nodeZone[node * 2 + frontSide]!)) continue;
    sectionVisible[model.ranges.section[range]!] = 1;
    rangeVisible[range] = 1;
  }
  const leafVisible = Uint8Array.from(model.leafZone, zone => zoneSetHas(outdoorZones, zone) ? 1 : 0);
  return { sectionVisible, rangeVisible, leafVisible };
}
