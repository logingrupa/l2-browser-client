import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderNativeWindow } from "../../src/ui/nativeWindows/nativeWindowRenderer";
import type { NativeWindowMinimapSource, NativeWindowTextureResolution } from "../../src/ui/nativeWindows/nativeWindowManifestLoader";
import type { WorldEntity } from "../../src/world/worldTypes";
import { syntheticArchiveSha256 } from "../fixtures/minimapRouteManifestFixture";
import { installMiniDom, type FakeElement, type MiniDom } from "./support/miniDom";
import {
  syntheticLocalPlayerAtSource, syntheticMinimapSource, syntheticMinimapWindowManifest, syntheticTextureImageUrl, syntheticTileMinimap,
} from "./support/tileMinimapFixtures";

const screen = { width: 1440, height: 900 };
const controlWidth = 256;
const controlHeight = 256;
const worldMapPieceObject = (suffix: number) => `L2Font-e.Minimap.int_worldmap${suffix}`;

function minimapElement(container: FakeElement): FakeElement {
  const element = container.querySelector('[data-native-type="MinimapCtrl"]');
  if (element === null) throw new Error("no rendered MinimapCtrl control");
  return element;
}

function minimapPart(container: FakeElement, part: string): FakeElement | null {
  return minimapElement(container).querySelector(`[data-native-minimap-part="${part}"]`);
}

function oneTileSource(): NativeWindowMinimapSource {
  return syntheticMinimapSource({ tileMinimaps: new Map([["20_21", syntheticTileMinimap("20_21")]]) });
}

describe("renderMinimapControl", () => {
  let miniDom: MiniDom;
  let container: FakeElement;
  beforeEach(() => {
    miniDom = installMiniDom();
    container = miniDom.document.createElement("main");
  });
  afterEach(() => miniDom.restore());

  function render(localPlayer: WorldEntity | null, minimapSource: NativeWindowMinimapSource) {
    return renderNativeWindow(container as unknown as HTMLElement, syntheticMinimapWindowManifest(controlWidth, controlHeight),
      { localPlayer, textures: new Map(), fieldBindings: [], screen, minimapSource });
  }

  async function readyMinimap(): Promise<FakeElement> {
    await vi.waitFor(() => expect(minimapElement(container).getAttribute("data-native-minimap-state")).toBe("ready"));
    return minimapElement(container);
  }

  it("draws the six world map pieces of the route through the pinned route and the marker at the control centre", async () => {
    const rendered = render(syntheticLocalPlayerAtSource(0, 0), oneTileSource());
    const control = await readyMinimap();
    await vi.waitFor(() => expect(control.querySelectorAll("[data-native-world-map-piece] img")).toHaveLength(6));
    const pieces = control.querySelectorAll("[data-native-world-map-piece]");
    expect(pieces.map(piece => piece.getAttribute("data-native-world-map-piece"))).toEqual(["1", "2", "3", "4", "5", "6"]);
    expect(pieces.map(piece => piece.querySelector("img")?.getAttribute("src")))
      .toEqual([1, 2, 3, 4, 5, 6].map(suffix => syntheticTextureImageUrl(syntheticArchiveSha256(worldMapPieceObject(suffix)))));
    expect([pieces[3]?.style.left, pieces[3]?.style.top]).toEqual([`${128 - 656 + 1024}px`, `${128 - 1312 + 1024}px`]);
    const marker = minimapPart(container, "marker");
    expect([marker?.style.left, marker?.style.top]).toEqual(["128px", "128px"]);
    expect([marker?.getAttribute("data-native-map-x"), marker?.getAttribute("data-native-map-y")]).toEqual(["656", "1312"]);
    expect(marker?.getAttribute("data-native-gap")).toBe("texture-reference-unresolved");
    expect(control.getAttribute("data-native-minimap-view-origin")).toBe("centred on the marker, presentation");
    expect(rendered.gaps.map(gap => gap.reason)).not.toContain("control-type-unsupported:MinimapCtrl");
  });

  it("lists every unresolved minimap item in the control gaps", async () => {
    const rendered = render(syntheticLocalPlayerAtSource(0, 0), oneTileSource());
    await readyMinimap();
    expect(rendered.gaps.filter(gap => gap.controlName === "SyntheticMinimap").map(gap => gap.reason)).toEqual(expect.arrayContaining([
      "minimap-join-unresolved:zone-title-source", "minimap-join-unresolved:radar-anchor", "texture-reference-unresolved",
      "presentation:view-origin-centred-on-marker", "label-unresolved"]));
    expect(minimapPart(container, "zone-name")?.getAttribute("data-native-gap")).toBe("label-unresolved");
    expect(minimapPart(container, "zone-name")?.textContent).toBe("");
  });

  it("moves the view origin on a world state update and reuses the piece images", async () => {
    const rendered = render(syntheticLocalPlayerAtSource(0, 0), oneTileSource());
    const control = await readyMinimap();
    await vi.waitFor(() => expect(control.querySelectorAll("[data-native-world-map-piece] img")).toHaveLength(6));
    const firstImage = control.querySelector("[data-native-world-map-piece] img");
    rendered.refresh(syntheticLocalPlayerAtSource(8192, -8192));
    const firstPiece = control.querySelector("[data-native-world-map-piece]");
    expect([firstPiece?.style.left, firstPiece?.style.top]).toEqual([`${128 - 697}px`, `${128 - 1271}px`]);
    expect(control.querySelector("[data-native-world-map-piece] img")).toBe(firstImage);
    expect(minimapPart(container, "marker")?.getAttribute("data-native-map-x")).toBe("697");
  });

  it("shows the route gap when the served catalog holds no tile minimap", async () => {
    render(syntheticLocalPlayerAtSource(0, 0), syntheticMinimapSource({ tileMinimaps: new Map() }));
    await readyMinimap();
    expect(minimapPart(container, "state")?.getAttribute("data-native-gap")).toBe("minimap-route-not-in-catalog");
    expect(minimapElement(container).querySelectorAll("[data-native-world-map-piece]")).toHaveLength(0);
  });

  it("fails with the error text when two tile minimaps pin different routes", async () => {
    render(syntheticLocalPlayerAtSource(0, 0), syntheticMinimapSource({ tileMinimaps: new Map([["20_21", syntheticTileMinimap("20_21")],
      ["20_22", syntheticTileMinimap("20_22", { routeManifestSha256: "e".repeat(64) })]]) }));
    await vi.waitFor(() => expect(minimapElement(container).getAttribute("data-native-minimap-state")).toBe("failed"));
    expect(minimapPart(container, "state")?.getAttribute("data-native-gap")).toBe("minimap-load-failed");
    expect(minimapElement(container).getAttribute("data-native-minimap-error")).toMatch(/different minimap routes/);
  });

  it("shows the load failure as the control gap with the error text", async () => {
    const failingSource: NativeWindowMinimapSource = { ...oneTileSource(),
      loadTileMinimap: async () => { throw new Error("Native tile 20_21 minimap manifest kind or schema version is invalid."); } };
    render(syntheticLocalPlayerAtSource(0, 0), failingSource);
    await vi.waitFor(() => expect(minimapElement(container).getAttribute("data-native-minimap-state")).toBe("failed"));
    expect(minimapPart(container, "state")?.getAttribute("data-native-gap")).toBe("minimap-load-failed");
    expect(minimapElement(container).getAttribute("data-native-minimap-error")).toMatch(/20_21/);
  });

  it("revokes a piece image URL that resolves after the window is disposed and draws no image for it", async () => {
    const revokeObjectUrlSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    try {
      const resolvers: ((resolution: NativeWindowTextureResolution) => void)[] = [];
      const source: NativeWindowMinimapSource = { ...oneTileSource(),
        loadTextureImage: () => new Promise<NativeWindowTextureResolution>(resolve => { resolvers.push(resolve); }) };
      const rendered = render(syntheticLocalPlayerAtSource(0, 0), source);
      const control = await readyMinimap();
      await vi.waitFor(() => expect(resolvers.length).toBeGreaterThan(0));
      rendered.dispose();
      resolvers[0]!({ status: "resolved", url: "blob:synthetic/late" });
      await vi.waitFor(() => expect(revokeObjectUrlSpy).toHaveBeenCalledWith("blob:synthetic/late"));
      expect(control.querySelector("img")).toBeNull();
    } finally {
      revokeObjectUrlSpy.mockRestore();
    }
  });

  it("shows the adapter position gap when the adapter reports no local player", async () => {
    render(null, oneTileSource());
    const control = await readyMinimap();
    expect(minimapPart(container, "state")?.getAttribute("data-native-gap")).toBe("adapter-field-absent:position");
    expect(control.querySelector("img")).toBeNull();
  });
});
