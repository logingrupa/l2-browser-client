import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  nativeWindowAnchorEvidence, nativeWindowAnchorPointFractions, resolveNativeWindowRectangles,
} from "../../src/ui/nativeWindows/nativeWindowAnchors";
import type { NativeWindowAnchorPosition, NativeWindowNode } from "../../src/ui/nativeWindows/nativeWindowLayoutTree";

const documentedAnchorRows = [
  [1, "TopLeft", 0, 0], [2, "TopCenter", 0.5, 0], [3, "TopRight", 1, 0],
  [4, "CenterLeft", 0, 0.5], [5, "CenterCenter", 0.5, 0.5], [6, "CenterRight", 1, 0.5],
  [7, "BottomLeft", 0, 1], [8, "BottomCenter", 0.5, 1], [9, "BottomRight", 1, 1],
] as const;
const pinnedEvidencePath = `${nativeWindowAnchorEvidence.repository}/${nativeWindowAnchorEvidence.document}`;
const screen = { width: 1000, height: 600 };
const tail = { offset: 0, end: 0, sha256: "a".repeat(64) };

function anchoredAt(selfAnchor: number, targetAnchor: number, offsetX = 0, offsetY = 0, target = ""): NativeWindowAnchorPosition {
  return { selfAnchor, targetAnchor, target, offsetX, offsetY };
}

function windowNode(name: string, fields: Partial<NativeWindowNode> = {}): NativeWindowNode {
  return {
    name, type: "Window", width: 10, height: 10, x: 0, y: 0, sizeMode: "absolute", position: anchoredAt(1, 1),
    textures: [], children: [], sourceOffset: 0, tail, ...fields,
  };
}

function rectangleOf(root: NativeWindowNode, name: string) {
  const { rectangles } = resolveNativeWindowRectangles(root, screen);
  return [...rectangles].find(([node]) => node.name === name)?.[1];
}

function gapReasonsOf(root: NativeWindowNode, name: string): readonly string[] {
  return resolveNativeWindowRectangles(root, screen).gaps.filter(gap => gap.node.name === name).map(gap => gap.reason);
}

describe("native window anchor evidence", () => {
  it("copies the nine enum rows of the pinned anchor table", () => {
    expect(Object.entries(nativeWindowAnchorPointFractions).map(([anchorEnum, row]) =>
      [Number(anchorEnum), row.originalName, row.widthFraction, row.heightFraction])).toEqual(documentedAnchorRows);
    expect(nativeWindowAnchorEvidence.label).toBe("Elbera NWindow af6c3437 proof, unverified on IMPORTA 7c12fb6b");
  });

  it.skipIf(!existsSync(pinnedEvidencePath))("matches the table of the pinned evidence document byte for byte", () => {
    const documentBytes = readFileSync(pinnedEvidencePath);
    expect(createHash("sha256").update(documentBytes).digest("hex")).toBe(nativeWindowAnchorEvidence.documentSha256);
    const tableRows = [...documentBytes.toString("utf8").matchAll(/^\| (\d) \| (\w+) \| ([\d.]+), ([\d.]+) \|/gm)]
      .map(match => [Number(match[1]), match[2], Number(match[3]), Number(match[4])]);
    expect(tableRows).toEqual(documentedAnchorRows);
  });
});

describe("resolveNativeWindowRectangles", () => {
  it("places a root on the screen and a top-right child inside its parent by the documented update", () => {
    const root = windowNode("Root", { width: 256, height: 92, children: [
      windowNode("RightStrip", { width: 4, height: 72, position: anchoredAt(3, 3, -13, 11) }),
    ] });
    expect(rectangleOf(root, "Root")).toEqual({ left: 0, top: 0, width: 256, height: 92 });
    expect(rectangleOf(root, "RightStrip")).toEqual({ left: 239, top: 11, width: 4, height: 72 });
  });

  it("truncates each anchor point toward zero for odd sizes and negative positions", () => {
    const centred = windowNode("Centred", { width: 7, height: 5, position: anchoredAt(5, 5) });
    expect(rectangleOf(centred, "Centred")).toEqual({ left: 497, top: 298, width: 7, height: 5 });
    const negativeParent = windowNode("NegativeParent", { width: 8, height: 8, position: anchoredAt(1, 1, -5, -5), children: [
      windowNode("OddChild", { width: 3, height: 3, position: anchoredAt(5, 5) }),
    ] });
    expect(rectangleOf(negativeParent, "OddChild")).toEqual({ left: -3, top: -3, width: 3, height: 3 });
  });

  it("anchors to the one named sibling of the same window", () => {
    const root = windowNode("Root", { width: 200, height: 80, children: [
      windowNode("Back", { width: 120, height: 60, position: anchoredAt(1, 1, 8, 10) }),
      windowNode("Gauge", { width: 90, height: 12, position: anchoredAt(3, 3, -4, 6, "Back") }),
      windowNode("Below", { width: 20, height: 4, position: anchoredAt(1, 7, 0, 3, "Gauge") }),
    ] });
    expect(rectangleOf(root, "Gauge")).toEqual({ left: 34, top: 16, width: 90, height: 12 });
    expect(rectangleOf(root, "Below")).toEqual({ left: 34, top: 31, width: 20, height: 4 });
    expect(resolveNativeWindowRectangles(root, screen).gaps).toEqual([]);
  });

  it("gives target-ambiguous for two candidates and target-missing for none, placed at the parent origin", () => {
    const root = windowNode("Root", { width: 100, height: 100, position: anchoredAt(1, 1, 5, 7), children: [
      windowNode("Twin"), windowNode("Twin"),
      windowNode("ToTwin", { position: anchoredAt(1, 1, 3, 3, "Twin") }),
      windowNode("ToNobody", { position: anchoredAt(1, 1, 3, 3, "Nobody") }),
    ] });
    expect(gapReasonsOf(root, "ToTwin")).toEqual(["anchor-unresolved:target-ambiguous"]);
    expect(gapReasonsOf(root, "ToNobody")).toEqual(["anchor-unresolved:target-missing"]);
    expect(rectangleOf(root, "ToNobody")).toEqual({ left: 5, top: 7, width: 10, height: 10 });
  });

  it("refuses zero enums, a missing position and a target cycle as gaps", () => {
    const root = windowNode("Root", { width: 100, height: 100, children: [
      windowNode("ZeroSelf", { position: anchoredAt(0, 1, 4, 4) }),
      windowNode("NoPosition", { position: null }),
      windowNode("First", { position: anchoredAt(1, 1, 1, 1, "Second") }),
      windowNode("Second", { position: anchoredAt(1, 1, 1, 1, "First") }),
      windowNode("Outer", { position: anchoredAt(1, 1, 0, 0, "Inner"), children: [windowNode("Inner")] }),
    ] });
    expect(gapReasonsOf(root, "ZeroSelf")).toEqual(["anchor-unresolved:zero-anchor-enum"]);
    expect(gapReasonsOf(root, "NoPosition")).toEqual(["anchor-unresolved:no-position"]);
    expect(rectangleOf(root, "NoPosition")).toEqual({ left: 0, top: 0, width: 10, height: 10 });
    expect([...gapReasonsOf(root, "First"), ...gapReasonsOf(root, "Second")]).toEqual(["anchor-unresolved:cycle"]);
    expect(gapReasonsOf(root, "Outer")).toEqual(["anchor-unresolved:cycle"]);
  });

  it("sizes a relative control as the truncated rate of its parent plus the offset", () => {
    const root = windowNode("Root", { width: 255, height: 92, children: [
      windowNode("Band", { width: null, height: null, sizeMode: "relative",
        relativeSize: { reference: "", widthRate: 0.5, heightRate: 0, widthOffset: -1, heightOffset: 14 } }),
      windowNode("Unsized", { width: null, height: null }),
    ] });
    expect(rectangleOf(root, "Band")).toEqual({ left: 0, top: 0, width: 126, height: 14 });
    expect(gapReasonsOf(root, "Unsized")).toEqual(["anchor-unresolved:no-size"]);
  });

  it("compares target names byte for byte", () => {
    const root = windowNode("Root", { width: 100, height: 100, children: [
      windowNode("backTex", { position: anchoredAt(1, 1, 30, 0) }),
      windowNode("Follower", { position: anchoredAt(1, 1, 0, 0, "BackTex") }),
    ] });
    expect(gapReasonsOf(root, "Follower")).toEqual(["anchor-unresolved:target-missing"]);
  });
});
