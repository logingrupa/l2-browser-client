import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderNativeWindow } from "../../src/ui/nativeWindows/nativeWindowRenderer";
import type { NativeWindowMinimapSource, NativeWindowTextureResolution } from "../../src/ui/nativeWindows/nativeWindowManifestLoader";
import type { WorldEntity } from "../../src/world/worldTypes";
import { radarTextureMapBinding } from "../../src/ui/nativeWindows/minimapRadarRouteRecipe";
import { parseNativeWindowFontManifest, type NativeWindowFont } from "../../src/ui/nativeWindows/nativeWindowFonts";
import { zoneNameTextBoxBinding } from "../../src/ui/nativeWindows/zoneNameTextBoxRecipe";
import { syntheticArchiveSha256 } from "../fixtures/minimapRouteManifestFixture";
import { installMiniDom, type FakeElement, type MiniDom } from "./support/miniDom";
import { syntheticZoneKeyMip, syntheticZoneKeyRows } from "./support/radarZoneFixtures";
import {
  syntheticLocalPlayerAtSource, syntheticMinimapSource, syntheticMinimapWindowManifest, syntheticTextureImageUrl, syntheticTileMinimap,
  syntheticZoneKeyObject,
} from "./support/tileMinimapFixtures";

const screen = { width: 1440, height: 900 };
const controlWidth = 256;
const controlHeight = 256;
const worldMapPieceObject = (suffix: number) => `L2Font-e.Minimap.int_worldmap${suffix}`;
const printableCodeUnits = Array.from({ length: 95 }, (_, index) => 32 + index);
const syntheticBitmapFont: NativeWindowFont = {
  manifest: parseNativeWindowFontManifest({ kind: "native-ui-font", schemaVersion: 1, fontType: 0, route: "bitmap-glyph-table",
    atlas: { width: 512, height: 8, image: `/l2/${"e".repeat(64)}/texture.png`, imageSha256: "e".repeat(64), imageBytes: 100 },
    glyphs: printableCodeUnits.map((codeUnit, index) => ({ codeUnit, x: index * 4, y: 0, width: 4, height: 8 })) }, 0),
  imageUrl: "blob:synthetic/small-font",
};

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
      { localPlayer, textures: new Map(), fonts: new Map(), fieldBindings: [], screen, minimapSource });
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

  it("lists every unresolved minimap item in the control gaps and keeps no text gap of its own", async () => {
    const rendered = render(syntheticLocalPlayerAtSource(0, 0), oneTileSource());
    await readyMinimap();
    const reasons = rendered.gaps.filter(gap => gap.controlName === "SyntheticMinimap").map(gap => gap.reason);
    expect(reasons).toEqual(expect.arrayContaining([
      "minimap-join-unresolved:zone-title-source", "minimap-join-unresolved:radar-anchor", "texture-reference-unresolved",
      "presentation:view-origin-centred-on-marker"]));
    expect(reasons).not.toContain("label-unresolved");
    expect(minimapPart(container, "zone-name")?.getAttribute("data-native-gap")).toBeNull();
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

  describe("zone name and the NewRadarWnd texture map", () => {
    const giranPosition = { x: 8192, y: 98304 + 16384 };
    const plainsPosition = { x: 0, y: 98304 };
    const keyRunPosition = { x: 16384, y: 98304 + 16384 };

    function zoneSource(): NativeWindowMinimapSource {
      return syntheticMinimapSource({ tileMinimaps: new Map([["20_21", syntheticTileMinimap("20_21", { gaps: [
        { reason: "minimap-join-unresolved:zone-title-source", evidence: "synthetic" },
        { reason: "minimap-join-unresolved:zone-key-run", evidence: "a zone key run of tile 20_21 has overlapping Bottom-Top ranges" }] })]]),
        route: { zoneKeyRows: syntheticZoneKeyRows },
        zoneKeyMips: new Map([[syntheticZoneKeyObject("20_21"), { status: "loaded", mip: syntheticZoneKeyMip }]]) });
    }

    function renderRadarWindow(localPlayer: WorldEntity) {
      return renderNativeWindow(container as unknown as HTMLElement, syntheticMinimapWindowManifest(controlWidth, controlHeight,
        radarTextureMapBinding.windowId, [radarTextureMapBinding.controlName]), { localPlayer, textures: new Map(), fonts: new Map(), fieldBindings: [], screen,
        minimapSource: zoneSource() });
    }

    function radarTextureMap(): FakeElement | null {
      return container.querySelector(`[data-native-control="${radarTextureMapBinding.controlName}"] [data-native-radar-texture-map]`);
    }

    it("carries the sampled zone name in data-native-zone-name and draws no text of its own", async () => {
      render(syntheticLocalPlayerAtSource(giranPosition.x, giranPosition.y), zoneSource());
      await readyMinimap();
      await vi.waitFor(() => expect(minimapPart(container, "zone-name")?.getAttribute("data-native-zone-name")).toBe("Giran Castle Town"));
      expect(minimapPart(container, "zone-name")?.getAttribute("data-native-gap")).toBeNull();
      expect(minimapPart(container, "zone-name")?.textContent).toBe("");
      expect(radarTextureMap()).toBeNull();
    });

    it("draws the sampled zone name in the GetLocInfo text boxes with the converted font and clears it on a zone gap", async () => {
      const rendered = renderNativeWindow(container as unknown as HTMLElement, syntheticMinimapWindowManifest(controlWidth, controlHeight,
        zoneNameTextBoxBinding.windowId, [], zoneNameTextBoxBinding.controlNames), { localPlayer: syntheticLocalPlayerAtSource(giranPosition.x, giranPosition.y),
        textures: new Map(), fonts: new Map([[0, syntheticBitmapFont]]), fieldBindings: [], screen, minimapSource: zoneSource() });
      const zoneNameGlyphs = (controlName: string) => container.querySelectorAll(`[data-native-control="${controlName}"] [data-native-glyph]`);
      const textBoxReasons = () => rendered.gaps.filter(gap => zoneNameTextBoxBinding.controlNames.includes(gap.controlName)).map(gap => gap.reason);
      await readyMinimap();
      for (const controlName of zoneNameTextBoxBinding.controlNames) {
        await vi.waitFor(() => expect(zoneNameGlyphs(controlName)).toHaveLength("Giran Castle Town".length));
      }
      expect(zoneNameGlyphs(zoneNameTextBoxBinding.controlNames[0]!).map(glyph => glyph.style.left).slice(0, 3)).toEqual(["0px", "4px", "8px"]);
      expect(new Set(textBoxReasons())).toEqual(new Set(["font-bitmap-branch-unconfirmed"]));
      rendered.refresh(syntheticLocalPlayerAtSource(keyRunPosition.x, keyRunPosition.y, 1000));
      await vi.waitFor(() => expect(zoneNameGlyphs(zoneNameTextBoxBinding.controlNames[0]!)).toHaveLength(0));
      expect(new Set(textBoxReasons())).toEqual(new Set(["textbox-text-set-at-runtime"]));
    });

    it("shows the GetLocInfo texture of the sampled zone in texMap and follows a zone change on refresh", async () => {
      const rendered = renderRadarWindow(syntheticLocalPlayerAtSource(giranPosition.x, giranPosition.y));
      await readyMinimap();
      await vi.waitFor(() => expect(radarTextureMap()?.querySelector("img")?.getAttribute("src"))
        .toBe(syntheticTextureImageUrl(syntheticArchiveSha256("L2_RadarMap.RadarMaps.giran_castle_town"))));
      expect(radarTextureMap()?.getAttribute("data-native-radar-texture")).toBe("L2_RadarMap.RadarMaps.giran_castle_town");
      expect(radarTextureMap()?.getAttribute("data-native-radar-zone-name")).toBe("Giran Castle Town");
      expect(radarTextureMap()?.getAttribute("data-native-gap")).toBe("minimap-join-unresolved:zone-title-source minimap-join-unresolved:radar-anchor");
      rendered.refresh(syntheticLocalPlayerAtSource(plainsPosition.x, plainsPosition.y));
      await vi.waitFor(() => expect(radarTextureMap()?.getAttribute("data-native-radar-texture")).toBe("L2_RadarMap.RadarMaps.Global"));
      expect(radarTextureMap()?.getAttribute("data-native-radar-is-global")).toBe("true");
      await vi.waitFor(() => expect(radarTextureMap()?.querySelectorAll("img").map(image => image.getAttribute("src")))
        .toEqual([syntheticTextureImageUrl(syntheticArchiveSha256("L2_RadarMap.RadarMaps.Global"))]));
    });

    it("lists the zone-key-run gap and draws no texture where an overlapping key run holds the position", async () => {
      const rendered = renderRadarWindow(syntheticLocalPlayerAtSource(keyRunPosition.x, keyRunPosition.y, 1000));
      await readyMinimap();
      await vi.waitFor(() => expect(radarTextureMap()?.getAttribute("data-native-texture-state")).toBe("gap"));
      expect(radarTextureMap()?.getAttribute("data-native-gap")).toContain("minimap-join-unresolved:zone-key-run");
      expect(radarTextureMap()?.querySelector("img")).toBeNull();
      expect(minimapPart(container, "zone-name")?.getAttribute("data-native-zone-name")).toBeNull();
      expect(rendered.gaps.map(gap => gap.reason)).toContain("minimap-join-unresolved:zone-key-run");
    });
  });

  it("shows the adapter position gap when the adapter reports no local player", async () => {
    render(null, oneTileSource());
    const control = await readyMinimap();
    expect(minimapPart(container, "state")?.getAttribute("data-native-gap")).toBe("adapter-field-absent:position");
    expect(control.querySelector("img")).toBeNull();
  });
});
