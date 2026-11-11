import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NativeCatalog } from "../../src/assets/native/readNativeCatalog";
import { createNativeWindowLayer } from "../../src/ui/nativeWindows/nativeWindowLayer";
import { installMiniDom, type FakeElement, type MiniDom } from "./support/miniDom";

const nativeStoreDoubles = vi.hoisted(() => ({ readNativeCatalog: vi.fn(), fetchVerifiedNativeResource: vi.fn() }));

vi.mock("../../src/assets/native/readNativeCatalog", async importOriginal => ({
  ...await importOriginal<typeof import("../../src/assets/native/readNativeCatalog")>(),
  readNativeCatalog: nativeStoreDoubles.readNativeCatalog,
}));
vi.mock("../../src/assets/native/fetchVerifiedNativeResource", () => ({ fetchVerifiedNativeResource: nativeStoreDoubles.fetchVerifiedNativeResource }));

class RecordingResizeObserver {
  static readonly instances: RecordingResizeObserver[] = [];
  readonly observedTargets: unknown[] = [];
  disconnected = false;
  constructor(readonly notifyResize: () => void) { RecordingResizeObserver.instances.push(this); }
  observe(target: unknown): void { this.observedTargets.push(target); }
  disconnect(): void { this.disconnected = true; }
}

const syntheticManifests = JSON.parse(readFileSync("tests/fixtures/xdat/synthetic-window-layout.json", "utf8")) as { readonly windowId: string }[];
const plainWindowId = "SyntheticPlainWnd";

function windowManifestSha256(windowId: string): string {
  return (syntheticManifests.findIndex(manifest => manifest.windowId === windowId) + 1).toString(16).padStart(64, "0");
}

function windowManifestPath(windowId: string): string {
  return `/l2/windows/${windowManifestSha256(windowId)}/window.json`;
}

function syntheticCatalog(windowIds: readonly string[]): NativeCatalog {
  return {
    schemaVersion: 1, models: [], textures: [], sections: [], movers: [], npcProfiles: [], playerProfiles: [], animationAudio: [], combatAudio: [],
    worldAudio: [], effectComponents: [], tables: [], tiles: [], servedCatalogSha256: "f".repeat(64), laneCatalogSha256: null,
    windows: windowIds.map(windowId => ({ id: windowId, manifest: windowManifestPath(windowId), manifestSha256: windowManifestSha256(windowId), manifestBytes: 1 })),
  };
}

function serveWindowManifests(): void {
  nativeStoreDoubles.fetchVerifiedNativeResource.mockImplementation(async (url: string) => {
    const manifest = syntheticManifests.find(candidate => windowManifestPath(candidate.windowId) === url);
    if (manifest === undefined) throw new Error(`no synthetic resource at ${url}`);
    return new TextEncoder().encode(JSON.stringify(manifest));
  });
}

describe("createNativeWindowLayer", () => {
  let miniDom: MiniDom;
  let container: FakeElement;
  beforeEach(() => {
    miniDom = installMiniDom();
    RecordingResizeObserver.instances.length = 0;
    vi.stubGlobal("ResizeObserver", RecordingResizeObserver);
    container = miniDom.document.createElement("div");
    container.rect = { left: 0, top: 0, width: 1440, height: 900 };
    nativeStoreDoubles.readNativeCatalog.mockReset().mockResolvedValue(syntheticCatalog([plainWindowId]));
    nativeStoreDoubles.fetchVerifiedNativeResource.mockReset();
    serveWindowManifests();
  });
  afterEach(() => miniDom.restore());

  function createLayer() {
    return createNativeWindowLayer(container as unknown as HTMLElement, () => null);
  }

  it("clips windows anchored past the viewport instead of scrolling the page and reports that as a presentation variable", () => {
    const layer = createLayer();
    expect(container.style.overflow).toBe("hidden");
    expect(layer.presentation).toEqual({ overflow: "hidden", status: "presentation",
      source: "windows anchored past the viewport are clipped instead of scrolling the page" });
    layer.dispose();
  });

  it("re-places an open window at its anchors when the container resizes and stops observing on dispose", async () => {
    const layer = createLayer();
    const [resizeObserver] = RecordingResizeObserver.instances;
    expect(resizeObserver?.observedTargets).toEqual([container]);
    const opened = await layer.open(plainWindowId);
    if (opened.status !== "opened") throw new Error("the synthetic window did not open");
    expect([opened.window.element.style.left, opened.window.element.style.top]).toEqual(["1380px", "870px"]);
    container.rect = { left: 0, top: 0, width: 932, height: 430 };
    resizeObserver!.notifyResize();
    expect([opened.window.element.style.left, opened.window.element.style.top]).toEqual(["872px", "400px"]);
    layer.dispose();
    expect(resizeObserver!.disconnected).toBe(true);
  });
});
