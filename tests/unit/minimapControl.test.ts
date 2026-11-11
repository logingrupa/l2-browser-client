import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderNativeWindow } from "../../src/ui/nativeWindows/nativeWindowRenderer";
import type { NativeWindowMinimapTileSource } from "../../src/ui/nativeWindows/nativeWindowManifestLoader";
import type { WorldEntity } from "../../src/world/worldTypes";
import { installMiniDom, type FakeElement, type MiniDom } from "./support/miniDom";
import {
  syntheticLocalPlayerAt, syntheticMinimapTileSource, syntheticMinimapWindowManifest, syntheticRadarImageUrl, syntheticTileMinimap,
} from "./support/tileMinimapFixtures";

const screen = { width: 1440, height: 900 };
const controlWidth = 256;
const controlHeight = 256;
const noConvertedTileReason = "no converted tile at the player position";

function minimapElement(container: FakeElement): FakeElement {
  const element = container.querySelector('[data-native-type="MinimapCtrl"]');
  if (element === null) throw new Error("no rendered MinimapCtrl control");
  return element;
}

function minimapPart(container: FakeElement, part: string): FakeElement | null {
  return minimapElement(container).querySelector(`[data-native-minimap-part="${part}"]`);
}

describe("renderMinimapControl", () => {
  let miniDom: MiniDom;
  let container: FakeElement;
  beforeEach(() => {
    miniDom = installMiniDom();
    container = miniDom.document.createElement("main");
  });
  afterEach(() => miniDom.restore());

  function render(localPlayer: WorldEntity | null, minimapTileSource: NativeWindowMinimapTileSource) {
    return renderNativeWindow(container as unknown as HTMLElement, syntheticMinimapWindowManifest(controlWidth, controlHeight),
      { localPlayer, textures: new Map(), fieldBindings: [], screen, minimapTileSource });
  }

  async function readyMinimap(): Promise<FakeElement> {
    await vi.waitFor(() => expect(minimapElement(container).getAttribute("data-native-minimap-state")).toBe("ready"));
    return minimapElement(container);
  }

  it("renders a MinimapCtrl control instead of the unsupported control gap", async () => {
    const rendered = render(null, syntheticMinimapTileSource(new Map()));
    const control = await readyMinimap();
    expect(control.getAttribute("data-native-gap")).toBeNull();
    expect(rendered.gaps.map(gap => gap.reason)).not.toContain("control-type-unsupported:MinimapCtrl");
  });

  it("shows the radar texture of the tile holding the player through the tile source and an unverified marker", async () => {
    render(syntheticLocalPlayerAt(64, 320), syntheticMinimapTileSource(new Map([["20_21", syntheticTileMinimap("20_21")]])));
    const control = await readyMinimap();
    await vi.waitFor(() => expect(control.querySelector("img")?.getAttribute("src")).toBe(syntheticRadarImageUrl("20_21")));
    const marker = minimapPart(container, "marker");
    expect(marker?.getAttribute("data-native-status")).toBe("unverified");
    expect(minimapPart(container, "state")).toBeNull();
  });

  it("shows one gap with its reason and no marker when no converted tile holds the player", async () => {
    render(syntheticLocalPlayerAt(-500, -500), syntheticMinimapTileSource(new Map([["20_21", syntheticTileMinimap("20_21")]])));
    const control = await readyMinimap();
    expect(control.querySelectorAll(`[data-native-gap="${noConvertedTileReason}"]`)).toHaveLength(1);
    expect(minimapPart(container, "marker")).toBeNull();
    expect(control.querySelector("img")).toBeNull();
  });

  it("moves the marker on a world state update and keeps the texture elements", async () => {
    const rendered = render(syntheticLocalPlayerAt(64, 320), syntheticMinimapTileSource(new Map([["20_21", syntheticTileMinimap("20_21")]])));
    const control = await readyMinimap();
    await vi.waitFor(() => expect(control.querySelector("img")).not.toBeNull());
    const image = control.querySelector("img");
    const markerBefore = [minimapPart(container, "marker")?.style.left, minimapPart(container, "marker")?.style.top];
    rendered.refresh(syntheticLocalPlayerAt(65, 330));
    const markerAfter = [minimapPart(container, "marker")?.style.left, minimapPart(container, "marker")?.style.top];
    expect(markerAfter).not.toEqual(markerBefore);
    expect(control.querySelector("img")).toBe(image);
  });

  it("keeps the marker texture and the zone name text as explicit unresolved elements", async () => {
    render(syntheticLocalPlayerAt(64, 320), syntheticMinimapTileSource(new Map([["20_21", syntheticTileMinimap("20_21")]])));
    await readyMinimap();
    expect(minimapPart(container, "marker")?.getAttribute("data-native-gap")).toBe("texture-reference-unresolved");
    expect(minimapPart(container, "zone-name")?.getAttribute("data-native-gap")).toBe("label-unresolved");
    expect(minimapPart(container, "zone-name")?.textContent).toBe("");
  });

  it("shows the adapter position gap when the adapter reports no local player", async () => {
    render(null, syntheticMinimapTileSource(new Map([["20_21", syntheticTileMinimap("20_21")]])));
    const control = await readyMinimap();
    expect(minimapPart(container, "state")?.getAttribute("data-native-gap")).toBe("adapter-field-absent:position");
    expect(control.querySelector("img")).toBeNull();
  });
});
