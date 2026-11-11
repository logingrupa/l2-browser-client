import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NativeWindowFieldBinding } from "../../src/ui/nativeWindows/nativeWindowFieldBindings";
import { parseNativeWindowManifest, type NativeWindowManifest } from "../../src/ui/nativeWindows/nativeWindowLayoutTree";
import type { NativeWindowTextureResolution } from "../../src/ui/nativeWindows/nativeWindowManifestLoader";
import { nativeWindowRenderedControlTypes, renderNativeWindow } from "../../src/ui/nativeWindows/nativeWindowRenderer";
import type { WorldEntity } from "../../src/world/worldTypes";
import { listTypeScriptModules, readSourceModuleText } from "../support/sourceImportSpecifiers";
import { moduleStringLiterals } from "../support/sourceStringLiterals";
import { installMiniDom, type FakeElement, type MiniDom } from "./support/miniDom";
import { emptyMinimapTileSource } from "./support/tileMinimapFixtures";

function decodedWindowAndControlNames(): ReadonlySet<string> {
  const census = JSON.parse(readFileSync("docs/parts/ui/interface-window-census.json", "utf8")) as {
    controlNames: string[]; windows: { name: string }[];
  };
  return new Set([...census.controlNames, ...census.windows.map(window => window.name)]);
}

const syntheticManifests = JSON.parse(readFileSync("tests/fixtures/xdat/synthetic-window-layout.json", "utf8")) as Record<string, unknown>[];
const screen = { width: 1440, height: 900 };
const markupText = "<b>Greeting</b>";
const bindingSource = { document: "synthetic", sha256: "b".repeat(64), excerpt: "synthetic binding" };

function syntheticStatusManifest(textBoxCount = 1): NativeWindowManifest {
  const fixture = syntheticManifests.find(manifest => manifest.windowId === "SyntheticStatusWnd")!;
  const root = fixture.root as Record<string, unknown>;
  const textBoxes = Array.from({ length: textBoxCount }, (_, textBoxIndex) => ({
    name: "SyntheticLevelText", type: "TextBox", width: 0, height: 0, x: 1, y: 2, sizeMode: "absolute",
    position: { selfAnchor: 1, targetAnchor: 1, target: "", offsetX: 1, offsetY: 2 }, textures: [], children: [],
    sourceOffset: 700 + textBoxIndex * 20, tail: { offset: 700 + textBoxIndex * 20, end: 720 + textBoxIndex * 20, sha256: "c".repeat(64) },
    textLayout: { defaultText: markupText, autoSize: 1, fontType: 6, alignEnum: 1 },
  }));
  return parseNativeWindowManifest({ ...fixture, root: { ...root, children: [...(root.children as unknown[]), ...textBoxes] } });
}

function localPlayerWithHealth(health: number): WorldEntity {
  return { id: "local-player", kind: "local-player", displayName: "Synthetic player", position: { x: 0, y: 0, z: 0 },
    orientationRadians: 0, health, maximumHealth: 100, animation: "idle" };
}

function healthBinding(controlName: string, fillTextureRef: string | null): NativeWindowFieldBinding {
  return { windowId: "SyntheticStatusWnd", controlName, worldField: "health", maximumField: "maximumHealth", fillTextureRef,
    gapReason: null, status: "unverified", source: bindingSource };
}

function absentBinding(controlName: string, field: string): NativeWindowFieldBinding {
  return { windowId: "SyntheticStatusWnd", controlName, worldField: null, maximumField: null, fillTextureRef: null,
    gapReason: `adapter-field-absent:${field}`, status: "unverified", source: bindingSource };
}

const resolvedTextures: ReadonlyMap<string, NativeWindowTextureResolution> = new Map([
  ["SyntheticUI.StatusWnd.BackPlate", { status: "resolved", url: "blob:synthetic/back-plate" }],
  ["SyntheticUI.StatusWnd.GaugeFill", { status: "resolved", url: "blob:synthetic/gauge-fill" }],
  ["SyntheticUI.StatusWnd.GaugeBack", { status: "gap", reason: "texture-not-in-catalog" }],
]);

function control(container: FakeElement, name: string): FakeElement {
  const element = container.querySelector(`[data-native-control="${name}"]`);
  if (element === null) throw new Error(`no rendered control ${name}`);
  return element;
}

function childElements(element: FakeElement): FakeElement[] {
  return element.childNodes.filter((node): node is FakeElement => node.nodeType === 1);
}

function renderedTextAndAttributes(element: FakeElement): string[] {
  return [element.textContent, ...element.attributes.values(), ...childElements(element).flatMap(renderedTextAndAttributes)];
}

describe("renderNativeWindow", () => {
  let miniDom: MiniDom;
  let container: FakeElement;
  beforeEach(() => {
    miniDom = installMiniDom();
    container = miniDom.document.createElement("main");
  });
  afterEach(() => miniDom.restore());

  function render(bindings: readonly NativeWindowFieldBinding[], localPlayer: WorldEntity | null = localPlayerWithHealth(100),
    textures: ReadonlyMap<string, NativeWindowTextureResolution> = resolvedTextures) {
    return renderNativeWindow(container as unknown as HTMLElement, syntheticStatusManifest(), { localPlayer, textures, fieldBindings: bindings, screen,
      minimapTileSource: emptyMinimapTileSource });
  }

  it("places one element per node in source order with positions relative to the parent in px", () => {
    const rendered = render([]);
    expect(container.querySelector('[data-native-window="SyntheticStatusWnd"]')).toBe(rendered.element);
    expect(childElements(rendered.element as unknown as FakeElement).map(element => element.getAttribute("data-native-control")))
      .toEqual(["SyntheticBackTex", "SyntheticGaugeBar", "SyntheticLevelText"]);
    const gauge = control(container, "SyntheticGaugeBar");
    expect([gauge.style.left, gauge.style.top, gauge.style.width, gauge.style.height]).toEqual(["34px", "16px", "90px", "12px"]);
    expect(gauge.getAttribute("data-native-type")).toBe("BarCtrl");
    const back = control(container, "SyntheticBackTex");
    const [backImage] = childElements(back);
    expect(backImage?.tagName).toBe("IMG");
    expect([backImage?.getAttribute("src"), backImage?.style.width, backImage?.style.height]).toEqual(["blob:synthetic/back-plate", "120px", "60px"]);
  });

  it("clips the bound gauge fill to the truncated health share and follows refresh", () => {
    const rendered = render([healthBinding("SyntheticGaugeBar", "SyntheticUI.StatusWnd.GaugeFill")]);
    const gaugeWidth = 90;
    const fill = () => control(container, "SyntheticGaugeBar").querySelector("[data-native-gauge-fill]");
    expect(fill()?.style.width).toBe(`${Math.trunc(gaugeWidth * 100 / 100)}px`);
    rendered.refresh(localPlayerWithHealth(37));
    expect(fill()?.style.width).toBe(`${Math.trunc(gaugeWidth * 37 / 100)}px`);
    expect(fill()?.querySelector("img")?.getAttribute("src")).toBe("blob:synthetic/gauge-fill");
  });

  it("shows adapter-field-absent gaps and draws no fill for absent fields or no local player", () => {
    const rendered = render([absentBinding("SyntheticBackTex", "cp"), healthBinding("SyntheticGaugeBar", null)], null);
    expect(control(container, "SyntheticBackTex").getAttribute("data-native-gap")).toBe("adapter-field-absent:cp");
    expect(control(container, "SyntheticBackTex").querySelector("[data-native-gauge-fill]")).toBeNull();
    expect(control(container, "SyntheticGaugeBar").querySelector("[data-native-gauge-fill]")).toBeNull();
    expect(rendered.gaps).toContainEqual({ controlName: "SyntheticGaugeBar", reason: "adapter-field-absent:health" });
    rendered.refresh(localPlayerWithHealth(50));
    expect(rendered.gaps).not.toContainEqual({ controlName: "SyntheticGaugeBar", reason: "adapter-field-absent:health" });
    expect(control(container, "SyntheticGaugeBar").querySelector("[data-native-gauge-fill]")?.style.width).toBe("45px");
  });

  it("marks a text box label-unresolved, an unsupported type and a missing texture, and writes no manifest text", () => {
    const rendered = render([]);
    const label = control(container, "SyntheticLevelText");
    expect(label.getAttribute("data-native-gap")).toBe("label-unresolved");
    expect(label.textContent).toBe("");
    expect(control(container, "SyntheticGaugeBar").getAttribute("data-native-gap")).toBe("control-type-unsupported:BarCtrl");
    expect(rendered.gaps).toEqual([
      { controlName: "SyntheticGaugeBar", reason: "control-type-unsupported:BarCtrl" },
      { controlName: "SyntheticLevelText", reason: "label-unresolved" },
    ]);
    expect(renderedTextAndAttributes(container).join("\n")).not.toContain("Greeting");
    container.replaceChildren();
    render([], localPlayerWithHealth(100), new Map());
    expect(control(container, "SyntheticBackTex").getAttribute("data-native-gap")).toBe("texture-not-in-catalog");
    expect(readFileSync("src/ui/nativeWindows/nativeWindowRenderer.ts", "utf8")).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML/);
  });

  it("draws only the first texture of a control and keeps it a gap instead of substituting a later resolved texture", () => {
    const rendered = render([], localPlayerWithHealth(100), new Map<string, NativeWindowTextureResolution>([
      ["SyntheticUI.StatusWnd.BackPlate", { status: "resolved", url: "blob:synthetic/back-plate" }],
      ["SyntheticUI.StatusWnd.GaugeFill", { status: "gap", reason: "texture-not-in-catalog" }],
      ["SyntheticUI.StatusWnd.GaugeBack", { status: "resolved", url: "blob:synthetic/gauge-back" }],
    ]));
    const gauge = control(container, "SyntheticGaugeBar");
    expect(gauge.querySelector("img")).toBeNull();
    expect(gauge.getAttribute("data-native-gap")).toBe("control-type-unsupported:BarCtrl texture-not-in-catalog");
    expect(rendered.gaps).toContainEqual({ controlName: "SyntheticGaugeBar", reason: "texture-not-in-catalog" });
  });

  it("marks the window root with a gap for a field binding whose control is missing or ambiguous and draws no gauge for it", () => {
    const rendered = renderNativeWindow(container as unknown as HTMLElement, syntheticStatusManifest(2), { localPlayer: localPlayerWithHealth(100),
      textures: resolvedTextures, fieldBindings: [healthBinding("SyntheticRenamedBar", null), healthBinding("SyntheticLevelText", null)], screen,
      minimapTileSource: emptyMinimapTileSource });
    expect(rendered.element.getAttribute("data-native-gap"))
      .toBe("binding-control-missing:SyntheticRenamedBar binding-control-ambiguous:SyntheticLevelText");
    expect(rendered.gaps).toEqual(expect.arrayContaining([
      { controlName: "SyntheticStatusWnd", reason: "binding-control-missing:SyntheticRenamedBar" },
      { controlName: "SyntheticStatusWnd", reason: "binding-control-ambiguous:SyntheticLevelText" },
    ]));
    expect(container.querySelector("[data-native-gauge-fill]")).toBeNull();
  });

  it("renders an empty positioned box for a control without textures and the root box only for an empty window", () => {
    const plain = parseNativeWindowManifest(syntheticManifests.find(manifest => manifest.windowId === "SyntheticPlainWnd"));
    const rendered = renderNativeWindow(container as unknown as HTMLElement, plain, { localPlayer: null, textures: new Map(), fieldBindings: [], screen,
      minimapTileSource: emptyMinimapTileSource });
    expect(childElements(rendered.element as unknown as FakeElement)).toEqual([]);
    expect([rendered.element.style.left, rendered.element.style.top]).toEqual(["1380px", "870px"]);
    expect(rendered.gaps).toEqual([]);
    rendered.dispose();
    expect(container.childNodes).toEqual([]);
  });

  it("draws exactly the control types declared in recipes/data/native-window-control-types.json", () => {
    const recipe = JSON.parse(readFileSync("recipes/data/native-window-control-types.json", "utf8")) as { schemaVersion: number; renderedTypes: string[] };
    expect(recipe.schemaVersion).toBe(1);
    expect(nativeWindowRenderedControlTypes).toEqual(recipe.renderedTypes);
  });
});

describe("native window sources", () => {
  it("hold no decoded window or control name as a string literal, and report decoded names equal to a rendered control type", () => {
    const decodedNames = decodedWindowAndControlNames();
    const modules = listTypeScriptModules("src/ui/nativeWindows");
    expect(modules.length).toBeGreaterThanOrEqual(6);
    const literalNames = modules.flatMap(modulePath => moduleStringLiterals(readSourceModuleText(modulePath))
      .filter(literal => decodedNames.has(literal)).map(literal => `${modulePath}: ${literal}`));
    const controlTypeNames = literalNames.filter(entry => nativeWindowRenderedControlTypes.some(type => entry.endsWith(`: ${type}`)));
    expect(literalNames.filter(entry => !controlTypeNames.includes(entry))).toEqual([]);
    expect(controlTypeNames).toEqual(["src/ui/nativeWindows/nativeWindowRenderer.ts: TextBox", "src/ui/nativeWindows/nativeWindowRenderer.ts: TextBox"]);
  });
});
