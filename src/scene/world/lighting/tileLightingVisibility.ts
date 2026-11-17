import type { TileVisibilityFrame } from "../bspVisibility/core/tileVisibilityFrame";
import type { LightmapSectionPlan } from "./tileLightmapSections";

export interface TileLightingVisibility {
  frame(): TileVisibilityFrame | null;
  nodeRangeVisible(chunkOrdinal: number, node: number): boolean;
  nodeRangeListed(chunkOrdinal: number, node: number): boolean;
}

export type SunAffectNodeSet = "visibility-walk" | "every-node-culling-off" | "every-node-no-frame";

export const visibilityNodeRangeMissingReason = "bsp-visibility-node-range-missing";

export function sunAffectNodeSetOf(visibility: TileLightingVisibility | null): SunAffectNodeSet {
  const frame = visibility?.frame() ?? null;
  if (frame === null) return "every-node-no-frame";
  return frame.culling ? "visibility-walk" : "every-node-culling-off";
}

export function sunAffectedNodeVisible(visibility: TileLightingVisibility | null, chunkOrdinal: number, plan: LightmapSectionPlan): boolean {
  if (plan.kind !== "lightmapped") return false;
  const nodes = plan.sunAffectedNodes;
  if (visibility === null) return nodes.length > 0;
  for (let position = 0; position < nodes.length; position += 1) if (visibility.nodeRangeVisible(chunkOrdinal, nodes[position]!)) return true;
  return false;
}

export function planWithVisibilityNodeRanges(visibility: TileLightingVisibility | null, chunkOrdinal: number, plan: LightmapSectionPlan): LightmapSectionPlan {
  if (visibility === null || plan.kind !== "lightmapped") return plan;
  const missing = plan.sunAffectedNodes.find(node => !visibility.nodeRangeListed(chunkOrdinal, node));
  return missing === undefined ? plan : { kind: "gap", chunkId: plan.chunkId, primitive: plan.primitive, reason: `${visibilityNodeRangeMissingReason}:${missing}` };
}
