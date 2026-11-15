import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readWindowCatalogRecord } from "../../src/assets/native/nativeCatalogRecords";
import { nativeWindowAnchorProof } from "../../src/ui/nativeWindows/nativeWindowAnchors";
import { NativeWindowManifestError, parseNativeWindowManifest } from "../../src/ui/nativeWindows/nativeWindowLayoutTree";

const tailHash = "a".repeat(64);
const laneStoreRoot = "artifacts/lane-store/data-ui/l2";
const laneStoreCatalogPath = `${laneStoreRoot}/catalog.json`;
const syntheticWindowLayoutPath = "tests/fixtures/xdat/synthetic-window-layout.json";

function laneStoreWindowManifests(): readonly unknown[] {
  const catalog = JSON.parse(readFileSync(laneStoreCatalogPath, "utf8")) as { readonly windows?: readonly unknown[] };
  return (catalog.windows ?? []).map(value => JSON.parse(readFileSync(`${laneStoreRoot}/${readWindowCatalogRecord(value).manifest.slice("/l2/".length)}`, "utf8")));
}

function literalNode(name: string, sourceOffset: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name, type: "Texture", width: 12, height: 8, x: 2, y: -3, sizeMode: "absolute",
    position: { selfAnchor: 1, targetAnchor: 3, target: "", offsetX: 2, offsetY: -3 },
    textures: [], children: [], sourceOffset, tail: { offset: sourceOffset + 10, end: sourceOffset + 40, sha256: tailHash },
    ...overrides,
  };
}

function literalManifest(overrides: Record<string, unknown> = {}, rootOverrides: Record<string, unknown> = {}): Record<string, unknown> {
  const children = [
    literalNode("LiteralBackTex", 140, { textures: ["LiteralUI.Window.Back"], parentResolution: { name: "LiteralWnd", source: "commonParent", status: "resolved" } }),
    literalNode("LiteralLabel", 220, {
      type: "TextBox", width: null, height: null, sizeMode: "relative", textures: ["LiteralUI.Window.Back", "LiteralUI.Label"],
      autosize: [1, 0.5], insets: [-4, 12], relativeSize: { reference: "", widthRate: 1, heightRate: 0.5, widthOffset: -4, heightOffset: 12 },
      textLayout: { defaultText: "undefined", autoSize: -1, fontType: 0, alignEnum: 2 }, color: "#DCDCDC", align: "center", textId: 104,
    }),
  ];
  return {
    kind: "native-window-layout", schemaVersion: 1, windowId: "LiteralWnd#2", name: "LiteralWnd", sourceSha256: "b".repeat(64),
    sourceOffset: 4, anchorProof: nativeWindowAnchorProof, textureRefs: ["LiteralUI.Window.Back", "LiteralUI.Label"],
    root: literalNode("LiteralWnd", 4, {
      type: "Window", position: null, declaredWindowParent: "undefined", drawer: { direction: 0 }, children,
      grid: { rows: 4, capacity: 250, cellX: 32, cellY: 32, gapX: 5, gapY: 3 }, ...rootOverrides,
    }),
    ...overrides,
  };
}

function nestedRoot(depth: number): Record<string, unknown> {
  let node = literalNode("LiteralLeaf", 4 + depth);
  for (let level = depth - 1; level > 1; level -= 1) node = literalNode(`LiteralLevel${level}`, 4 + level, { children: [node] });
  return literalNode("LiteralWnd", 4, { children: [node] });
}

describe("native window layout manifest parser", () => {
  it("accepts a literal manifest and keeps nodes, optional fields and child order", () => {
    const manifest = parseNativeWindowManifest(literalManifest());
    expect(manifest.windowId).toBe("LiteralWnd#2");
    expect(manifest.root.children.map(child => child.name)).toEqual(["LiteralBackTex", "LiteralLabel"]);
    expect(manifest.root.drawer).toEqual({ direction: 0 });
    expect(manifest.root.children[1]?.relativeSize?.heightRate).toBe(0.5);
    expect(manifest.root.children[1]?.align).toBe("center");
    expect(manifest.root.children[0]).not.toHaveProperty("textId");
  });

  it("accepts a drawer with a direction and its owner", () => {
    const manifest = parseNativeWindowManifest(literalManifest({}, { drawer: { direction: 1, offset: 0, fixed: 1, owner: "LiteralOwnerWnd" } }));
    expect(manifest.root.drawer).toEqual({ direction: 1, offset: 0, fixed: 1, owner: "LiteralOwnerWnd" });
  });

  it.each([
    ["a wrong kind", { kind: "native-table" }],
    ["schema version 2", { schemaVersion: 2 }],
    ["a window id with a zero ordinal", { windowId: "LiteralWnd#0" }],
    ["a window id that names another window", { windowId: "OtherWnd" }],
    ["a short source hash", { sourceSha256: "b".repeat(63) }],
    ["an anchor proof that claims verification", { anchorProof: "verified" }],
    ["texture references out of tree order", { textureRefs: ["LiteralUI.Label", "LiteralUI.Window.Back"] }],
    ["a manifest offset that is not the root offset", { sourceOffset: 5 }],
    ["an unknown manifest field", { extra: true }],
  ])("rejects %s", (_label, overrides) => {
    expect(() => parseNativeWindowManifest(literalManifest(overrides))).toThrow(NativeWindowManifestError);
  });

  it.each([
    ["a tail whose offset passes its end", { tail: { offset: 41, end: 40, sha256: tailHash } }],
    ["a negative tail offset", { tail: { offset: -1, end: 40, sha256: tailHash } }],
    ["a fractional width", { width: 1.5 }],
    ["an anchor enum above 9", { position: { selfAnchor: 10, targetAnchor: 1, target: "", offsetX: 0, offsetY: 0 } }],
    ["a truncated texture reference", { textures: ["LiteralUI.d"] }],
    ["an unknown size mode", { sizeMode: "stretched" }],
    ["an unknown node field", { opaqueBytes: "00" }],
    ["a drawer with direction 0 and an owner", { drawer: { direction: 0, owner: "LiteralOwnerWnd" } }],
    ["a parent resolution with an unknown status", { parentResolution: { name: "Other", source: "commonParent", status: "guessed" } }],
  ])("rejects a root with %s", (_label, rootOverrides) => {
    expect(() => parseNativeWindowManifest(literalManifest({}, rootOverrides))).toThrow(NativeWindowManifestError);
  });

  it("accepts 64 nesting levels and rejects 65", () => {
    const literal = (depth: number) => literalManifest({ textureRefs: [] }, nestedRoot(depth));
    expect(parseNativeWindowManifest(literal(64)).root.children).toHaveLength(1);
    expect(() => parseNativeWindowManifest(literal(65))).toThrow(/nests deeper than 64 levels/);
  });

  it("rejects a tree of more than 4096 nodes", () => {
    const children = Array.from({ length: 4096 }, (_, index) => literalNode(`LiteralChild${index}`, 100 + index));
    expect(() => parseNativeWindowManifest(literalManifest({ textureRefs: [] }, { children }))).toThrow(/exceeds 4096 nodes/);
  });

  it("parses every manifest the Python adapter generated from synthetic xdat bytes", () => {
    const fixture = JSON.parse(readFileSync(syntheticWindowLayoutPath, "utf8")) as readonly unknown[];
    const manifests = fixture.map(parseNativeWindowManifest);
    expect(manifests.map(manifest => manifest.windowId)).toEqual([
      "SyntheticStatusWnd", "SyntheticRepeatedWnd#1", "SyntheticRepeatedTex", "SyntheticPlainWnd", "SyntheticRepeatedWnd#2",
    ]);
    expect(manifests[0]?.root.children.map(child => child.name)).toEqual(["SyntheticBackTex", "SyntheticGaugeBar"]);
    expect(manifests[2]?.root.parentResolution?.status).toBe("ambiguous");
  });

  it.skipIf(!existsSync(laneStoreCatalogPath))("parses every window manifest the layout step wrote to the data-ui lane store", () => {
    const manifests = laneStoreWindowManifests().map(parseNativeWindowManifest);
    expect(manifests.map(manifest => manifest.windowId)).toContain("StatusWnd");
  });
});
