import type { NativeWindowNode } from "./nativeWindowLayoutTree";

export const nativeWindowAnchorProof = "Elbera NWindow af6c3437 proof, unverified on IMPORTA 7c12fb6b";

export const nativeWindowAnchorEvidence = {
  repository: "E:/Lineage2Elbera",
  commit: "12c9656",
  document: "docs/native-layout-evidence.md",
  documentSha256: "424f80d1b9ec081c0bb0f852c098b0613a968b884d3f9317d2f42a6693fea319",
  sections: ["All nine native anchor points", "Relative sizes are rates"],
  relativeHeightStatus: "unverified: the document notes extra native parent frame and type handling before the height multiply and add",
  label: nativeWindowAnchorProof,
} as const;

export interface NativeWindowAnchorPointFraction {
  readonly originalName: string;
  readonly widthFraction: number;
  readonly heightFraction: number;
}

export const nativeWindowAnchorPointFractions: Readonly<Record<number, NativeWindowAnchorPointFraction>> = {
  1: { originalName: "TopLeft", widthFraction: 0, heightFraction: 0 },
  2: { originalName: "TopCenter", widthFraction: 0.5, heightFraction: 0 },
  3: { originalName: "TopRight", widthFraction: 1, heightFraction: 0 },
  4: { originalName: "CenterLeft", widthFraction: 0, heightFraction: 0.5 },
  5: { originalName: "CenterCenter", widthFraction: 0.5, heightFraction: 0.5 },
  6: { originalName: "CenterRight", widthFraction: 1, heightFraction: 0.5 },
  7: { originalName: "BottomLeft", widthFraction: 0, heightFraction: 1 },
  8: { originalName: "BottomCenter", widthFraction: 0.5, heightFraction: 1 },
  9: { originalName: "BottomRight", widthFraction: 1, heightFraction: 1 },
};

export interface NativeWindowRectangle { readonly left: number; readonly top: number; readonly width: number; readonly height: number }
export interface NativeWindowScreen { readonly width: number; readonly height: number }
export interface NativeWindowAnchorGap { readonly node: NativeWindowNode; readonly reason: string }
export interface NativeWindowRectangles {
  readonly rectangles: ReadonlyMap<NativeWindowNode, NativeWindowRectangle>;
  readonly gaps: readonly NativeWindowAnchorGap[];
}

const anchorUnresolvedPrefix = "anchor-unresolved:";

interface AnchorResolution {
  readonly parentOf: ReadonlyMap<NativeWindowNode, NativeWindowNode>;
  readonly nodesByName: ReadonlyMap<string, readonly NativeWindowNode[]>;
  readonly screenRectangle: NativeWindowRectangle;
  readonly rectangles: Map<NativeWindowNode, NativeWindowRectangle>;
  readonly gapsByNode: Map<NativeWindowNode, string[]>;
  readonly nodesInProgress: Set<NativeWindowNode>;
}

type TargetLookup = { readonly rectangle: NativeWindowRectangle } | { readonly gapReason: string };

function nodesInSourceOrder(root: NativeWindowNode): readonly NativeWindowNode[] {
  return [root, ...root.children.flatMap(child => nodesInSourceOrder(child))];
}

function recordGap(resolution: AnchorResolution, node: NativeWindowNode, reason: string): void {
  const reasons = resolution.gapsByNode.get(node) ?? [];
  if (!reasons.includes(anchorUnresolvedPrefix + reason)) reasons.push(anchorUnresolvedPrefix + reason);
  resolution.gapsByNode.set(node, reasons);
}

function anchorPoint(rectangle: NativeWindowRectangle, anchorEnum: number): { readonly x: number; readonly y: number } {
  const fraction = nativeWindowAnchorPointFractions[anchorEnum]!;
  return {
    x: Math.trunc(rectangle.left + fraction.widthFraction * rectangle.width),
    y: Math.trunc(rectangle.top + fraction.heightFraction * rectangle.height),
  };
}

function parentRectangle(resolution: AnchorResolution, node: NativeWindowNode): NativeWindowRectangle {
  const parent = resolution.parentOf.get(node);
  return parent === undefined ? resolution.screenRectangle : resolveNode(resolution, parent);
}

function nodeSize(resolution: AnchorResolution, node: NativeWindowNode, parent: NativeWindowRectangle): { readonly width: number; readonly height: number } {
  if (node.sizeMode === "relative" && node.relativeSize !== undefined) {
    const reference = node.relativeSize.reference === "" ? { rectangle: parent } : namedTarget(resolution, node, node.relativeSize.reference);
    if ("gapReason" in reference) recordGap(resolution, node, reference.gapReason);
    const referenceRectangle = "rectangle" in reference ? reference.rectangle : parent;
    return {
      width: Math.trunc(node.relativeSize.widthRate * referenceRectangle.width + node.relativeSize.widthOffset),
      height: Math.trunc(node.relativeSize.heightRate * referenceRectangle.height + node.relativeSize.heightOffset),
    };
  }
  if (node.width === null || node.height === null) recordGap(resolution, node, "no-size");
  return { width: node.width ?? 0, height: node.height ?? 0 };
}

function namedTarget(resolution: AnchorResolution, node: NativeWindowNode, targetName: string): TargetLookup {
  const candidates = resolution.nodesByName.get(targetName) ?? [];
  if (candidates.length === 0) return { gapReason: "target-missing" };
  if (candidates.length > 1) return { gapReason: "target-ambiguous" };
  const target = candidates[0]!;
  if (target === node || dependsOnNodeInProgress(resolution, target)) return { gapReason: "cycle" };
  return { rectangle: resolveNode(resolution, target) };
}

function dependsOnNodeInProgress(resolution: AnchorResolution, target: NativeWindowNode): boolean {
  for (let ancestor: NativeWindowNode | undefined = target; ancestor !== undefined; ancestor = resolution.parentOf.get(ancestor)) {
    if (resolution.nodesInProgress.has(ancestor)) return true;
  }
  return false;
}

function positionedRectangle(resolution: AnchorResolution, node: NativeWindowNode): NativeWindowRectangle {
  const parent = parentRectangle(resolution, node);
  const size = nodeSize(resolution, node, parent);
  const atParentOrigin = { left: parent.left, top: parent.top, ...size };
  const position = node.position;
  if (position === null) {
    recordGap(resolution, node, "no-position");
    return atParentOrigin;
  }
  if (position.selfAnchor === 0 || position.targetAnchor === 0) {
    recordGap(resolution, node, "zero-anchor-enum");
    return atParentOrigin;
  }
  const target = position.target === "" ? { rectangle: parent } : namedTarget(resolution, node, position.target);
  if ("gapReason" in target) {
    recordGap(resolution, node, target.gapReason);
    return atParentOrigin;
  }
  const selfPoint = anchorPoint(atParentOrigin, position.selfAnchor);
  const targetPoint = anchorPoint(target.rectangle, position.targetAnchor);
  return {
    left: atParentOrigin.left + position.offsetX - selfPoint.x + targetPoint.x,
    top: atParentOrigin.top + position.offsetY - selfPoint.y + targetPoint.y,
    ...size,
  };
}

function resolveNode(resolution: AnchorResolution, node: NativeWindowNode): NativeWindowRectangle {
  const resolved = resolution.rectangles.get(node);
  if (resolved !== undefined) return resolved;
  resolution.nodesInProgress.add(node);
  const rectangle = positionedRectangle(resolution, node);
  resolution.nodesInProgress.delete(node);
  resolution.rectangles.set(node, rectangle);
  return rectangle;
}

export function resolveNativeWindowRectangles(root: NativeWindowNode, screen: NativeWindowScreen): NativeWindowRectangles {
  const nodes = nodesInSourceOrder(root);
  const parentOf = new Map<NativeWindowNode, NativeWindowNode>();
  const nodesByName = new Map<string, NativeWindowNode[]>();
  for (const node of nodes) {
    node.children.forEach(child => parentOf.set(child, node));
    nodesByName.set(node.name, [...(nodesByName.get(node.name) ?? []), node]);
  }
  const resolution: AnchorResolution = {
    parentOf, nodesByName, screenRectangle: { left: 0, top: 0, width: screen.width, height: screen.height },
    rectangles: new Map(), gapsByNode: new Map(), nodesInProgress: new Set(),
  };
  nodes.forEach(node => resolveNode(resolution, node));
  return {
    rectangles: resolution.rectangles,
    gaps: nodes.flatMap(node => (resolution.gapsByNode.get(node) ?? []).map(reason => ({ node, reason }))),
  };
}
