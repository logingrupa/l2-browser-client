import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { layoutNativeWindowText, parseNativeWindowFontManifest, type NativeWindowFont } from "../../src/ui/nativeWindows/nativeWindowFonts";
import { parseNativeWindowManifest, type NativeWindowManifest, type NativeWindowNode } from "../../src/ui/nativeWindows/nativeWindowLayoutTree";
import { renderNativeWindow } from "../../src/ui/nativeWindows/nativeWindowRenderer";
import { nativeWindowFontRoutes, planTextBoxText } from "../../src/ui/nativeWindows/nativeWindowTextBox";
import { installMiniDom, type FakeElement, type MiniDom } from "./support/miniDom";
import { emptyMinimapSource } from "./support/tileMinimapFixtures";

const syntheticManifests = JSON.parse(readFileSync("tests/fixtures/xdat/synthetic-window-layout.json", "utf8")) as Record<string, unknown>[];
const digitSlots = "0123456789HMP/%.C:";
const atlasImage = `/l2/${"e".repeat(64)}/texture.png`;

function fontManifestDocument(overrides: Record<string, unknown>): Record<string, unknown> {
  return { kind: "native-ui-font", schemaVersion: 1, fontType: 10, route: "digit-atlas",
    atlas: { width: 256, height: 8, image: atlasImage, imageSha256: "e".repeat(64), imageBytes: 889 },
    digitCells: { cellWidth: 8, cellHeight: 8, slotCharacters: digitSlots }, ...overrides };
}

const digitFont: NativeWindowFont = { manifest: parseNativeWindowFontManifest(fontManifestDocument({}), 10), imageUrl: "blob:synthetic/number" };
const bitmapFont: NativeWindowFont = {
  manifest: parseNativeWindowFontManifest(fontManifestDocument({ fontType: 0, route: "bitmap-glyph-table", digitCells: undefined,
    atlas: { width: 64, height: 16, image: atlasImage, imageSha256: "e".repeat(64), imageBytes: 100 },
    glyphs: [{ codeUnit: 65, x: 0, y: 0, width: 5, height: 12 }, { codeUnit: 66, x: 5, y: 2, width: 7, height: 11 }] }), 0),
  imageUrl: "blob:synthetic/small",
};
const fonts: ReadonlyMap<number, NativeWindowFont> = new Map([[10, digitFont], [0, bitmapFont]]);

function textBoxNode(textLayout: NativeWindowNode["textLayout"], extra: Partial<NativeWindowNode> = {}): NativeWindowNode {
  return { name: "SyntheticText", type: "TextBox", width: 40, height: 0, x: 0, y: 0, sizeMode: "absolute", position: null, textures: [], children: [],
    sourceOffset: 1, tail: { offset: 1, end: 2, sha256: "c".repeat(64) }, color: "#DCDCDC", align: "left", ...(textLayout ? { textLayout } : {}), ...extra };
}

function withoutColour(node: NativeWindowNode): NativeWindowNode {
  return Object.fromEntries(Object.entries(node).filter(([field]) => field !== "color")) as unknown as NativeWindowNode;
}

function layout(defaultText: string, fontType: number, alignEnum = 1): NonNullable<NativeWindowNode["textLayout"]> {
  return { defaultText, autoSize: 1, fontType, alignEnum };
}

describe("TextBox text plan", () => {
  it("lays CP out on the digit atlas cells of C and P with no gap", () => {
    const plan = planTextBoxText(textBoxNode(layout("CP", 10)), null, fonts);
    expect(plan.status).toBe("drawn");
    if (plan.status !== "drawn") return;
    expect(plan.layout.glyphs).toEqual([
      { left: 0, glyph: { x: 16 * 8, y: 0, width: 8, height: 8 } },
      { left: 8, glyph: { x: 12 * 8, y: 0, width: 8, height: 8 } },
    ]);
    expect([plan.layout.width, plan.layout.height, plan.color, plan.gaps]).toEqual([16, 8, "#DCDCDC", []]);
  });

  it("neither draws nor advances a character without a digit slot", () => {
    expect(layoutNativeWindowText(digitFont.manifest, "+1").glyphs).toEqual([{ left: 0, glyph: { x: 8, y: 0, width: 8, height: 8 } }]);
  });

  it("advances bitmap glyphs by their width, skips code units without a glyph and keeps the bitmap branch condition visible", () => {
    const plan = planTextBoxText(textBoxNode(layout("A B", 0)), null, fonts);
    if (plan.status !== "drawn") throw new Error("bitmap text was not drawn");
    expect(plan.layout).toEqual({ width: 12, height: 12, glyphs: [
      { left: 0, glyph: { x: 0, y: 0, width: 5, height: 12 } }, { left: 5, glyph: { x: 5, y: 2, width: 7, height: 11 } }] });
    expect(plan.gaps).toEqual(["font-bitmap-branch-unconfirmed"]);
  });

  it("names the reason a TextBox draws no text instead of substituting a browser font", () => {
    const reasons = (node: NativeWindowNode, text: string | null = null) => planTextBoxText(node, text, fonts).gaps;
    expect(reasons(textBoxNode(layout("", 10)))).toEqual(["textbox-text-set-at-runtime"]);
    expect(reasons(textBoxNode(layout("undefined", 0)))).toEqual(["textbox-text-undefined-sentinel"]);
    expect(reasons(textBoxNode(undefined))).toEqual(["textbox-tail-unresolved"]);
    expect(reasons(textBoxNode(layout("HP", 6)))).toEqual(["font-gdi-face-unconverted:6"]);
    expect(reasons(textBoxNode(layout("Big", 1)))).toEqual(["font-unresolved:1"]);
    expect(reasons(textBoxNode(layout("Odd", 3)))).toEqual(["font-unresolved:3"]);
    expect(reasons(withoutColour(textBoxNode(layout("CP", 10))))).toEqual(["textbox-colour-unresolved"]);
    expect(reasons(textBoxNode(layout("", 10)), "12")).toEqual([]);
  });

  it("reads every stored fontType route from recipes/data/ui-fonts.json", () => {
    expect([...nativeWindowFontRoutes.entries()].sort(([left], [right]) => left - right)).toEqual([
      [0, "bitmap-glyph-table"], [1, "bitmap-glyph-table"], [4, "system-face"], [6, "system-face"], [7, "system-face"], [10, "digit-atlas"], [11, "digit-atlas"]]);
  });
});

describe("native UI font manifest", () => {
  it("refuses a manifest of another fontType, an unknown route and a glyph outside the atlas", () => {
    expect(() => parseNativeWindowFontManifest(fontManifestDocument({}), 11)).toThrow("not its catalog fontType 11");
    expect(() => parseNativeWindowFontManifest(fontManifestDocument({ route: "system-face" }), 10)).toThrow("route must be");
    expect(() => parseNativeWindowFontManifest(fontManifestDocument({ route: "bitmap-glyph-table", glyphs: [{ codeUnit: 65, x: 250, y: 0, width: 9, height: 8 }] }), 10))
      .toThrow("glyph 0 width");
    expect(() => parseNativeWindowFontManifest(fontManifestDocument({ digitCells: { cellWidth: 16, cellHeight: 8, slotCharacters: digitSlots } }), 10))
      .toThrow("cells fit the atlas");
  });
});

describe("TextBox drawing in a rendered window", () => {
  let miniDom: MiniDom;
  let container: FakeElement;
  beforeEach(() => {
    miniDom = installMiniDom();
    container = miniDom.document.createElement("main");
  });
  afterEach(() => miniDom.restore());

  function statusManifest(textBox: Record<string, unknown>): NativeWindowManifest {
    const fixture = syntheticManifests.find(manifest => manifest.windowId === "SyntheticStatusWnd")!;
    const root = fixture.root as Record<string, unknown>;
    return parseNativeWindowManifest({ ...fixture, root: { ...root, children: [...(root.children as unknown[]), {
      name: "SyntheticCpName", type: "TextBox", width: 0, height: 0, x: 7, y: 3, sizeMode: "absolute",
      position: { selfAnchor: 1, targetAnchor: 1, target: "", offsetX: 7, offsetY: 3 }, textures: [], children: [],
      sourceOffset: 700, tail: { offset: 700, end: 720, sha256: "c".repeat(64) }, color: "#DCDCDC", align: "left", ...textBox }] } });
  }

  function render(textBox: Record<string, unknown>) {
    return renderNativeWindow(container as unknown as HTMLElement, statusManifest(textBox), { localPlayer: null, textures: new Map(), fonts,
      fieldBindings: [], screen: { width: 1440, height: 900 }, minimapSource: emptyMinimapSource });
  }

  function glyphs(): FakeElement[] {
    return [...container.querySelectorAll("[data-native-glyph]")];
  }

  it("draws CP with the converted digit atlas in its decoded colour at the control origin and reports no gap for it", () => {
    const rendered = render({ textLayout: { defaultText: "CP", autoSize: 1, fontType: 10, alignEnum: 1 } });
    const text = container.querySelector('[data-native-control="SyntheticCpName"] > [data-native-text]');
    expect(text?.getAttribute("data-native-text")).toBe("drawn");
    expect([text?.style.left, text?.style.top, text?.style.width, text?.style.height]).toEqual(["0px", "0px", "16px", "8px"]);
    expect(glyphs().map(glyph => [glyph.style.left, glyph.style.backgroundPosition, glyph.style.backgroundColor, glyph.style.backgroundImage]))
      .toEqual([["0px", "-128px 0px", "#DCDCDC", 'url("blob:synthetic/number")'], ["8px", "-96px 0px", "#DCDCDC", 'url("blob:synthetic/number")']]);
    expect(rendered.gaps.filter(gap => gap.controlName === "SyntheticCpName")).toEqual([]);
    expect(container.textContent).not.toContain("CP");
  });

  it("centres and right-aligns the drawn text inside the control width", () => {
    render({ width: 40, textLayout: { defaultText: "1", autoSize: -1, fontType: 10, alignEnum: 2 }, align: "center" });
    expect(container.querySelector("[data-native-text]")?.style.left).toBe("16px");
    container.replaceChildren();
    render({ width: 40, textLayout: { defaultText: "1", autoSize: -1, fontType: 10, alignEnum: 3 }, align: "right" });
    expect(container.querySelector("[data-native-text]")?.style.left).toBe("32px");
  });

  it("draws no text element and lists the runtime reason for a TextBox without default text", () => {
    const rendered = render({ textLayout: { defaultText: "", autoSize: 1, fontType: 10, alignEnum: 1 } });
    expect(container.querySelector("[data-native-text]")).toBeNull();
    expect(rendered.gaps).toContainEqual({ controlName: "SyntheticCpName", reason: "textbox-text-set-at-runtime" });
  });
});
