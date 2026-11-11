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
const statusWindowId = "SyntheticStatusWnd";
const statusTextureReferences = ["SyntheticUI.StatusWnd.BackPlate", "SyntheticUI.StatusWnd.GaugeFill", "SyntheticUI.StatusWnd.GaugeBack"];
const textureArchiveSha256 = "a".repeat(64);
const syntheticPngBytes = new Uint8Array([137, 80, 78, 71]);

type TextureImageFetch = (reference: string) => Promise<Uint8Array>;

function windowManifestSha256(windowId: string): string {
  return (syntheticManifests.findIndex(manifest => manifest.windowId === windowId) + 1).toString(16).padStart(64, "0");
}

function windowManifestPath(windowId: string): string {
  return `/l2/windows/${windowManifestSha256(windowId)}/window.json`;
}

function textureImagePath(reference: string): string {
  return `/l2/${textureArchiveSha256}/${reference}.png`;
}

function syntheticCatalog(): NativeCatalog {
  return {
    schemaVersion: 1, models: [], sections: [], movers: [], npcProfiles: [], playerProfiles: [], animationAudio: [], combatAudio: [],
    worldAudio: [], effectComponents: [], tables: [], tiles: [], servedCatalogSha256: "f".repeat(64), laneCatalogSha256: null,
    windows: [plainWindowId, statusWindowId].map(windowId => ({ id: windowId, manifest: windowManifestPath(windowId),
      manifestSha256: windowManifestSha256(windowId), manifestBytes: 1 })),
    textures: statusTextureReferences.map(reference => ({ id: `ui-texture:${reference}`, archiveSha256: textureArchiveSha256,
      image: textureImagePath(reference), imageBytes: syntheticPngBytes.length, imageSha256: "b".repeat(64) })),
  };
}

function serveSyntheticStore(fetchTextureImage: TextureImageFetch = async () => syntheticPngBytes): void {
  nativeStoreDoubles.fetchVerifiedNativeResource.mockImplementation(async (url: string) => {
    const manifest = syntheticManifests.find(candidate => windowManifestPath(candidate.windowId) === url);
    if (manifest !== undefined) return new TextEncoder().encode(JSON.stringify(manifest));
    const textureReference = statusTextureReferences.find(reference => textureImagePath(reference) === url);
    if (textureReference !== undefined) return fetchTextureImage(textureReference);
    throw new Error(`no synthetic resource at ${url}`);
  });
}

describe("createNativeWindowLayer", () => {
  let miniDom: MiniDom;
  let container: FakeElement;
  let createdObjectUrls: string[];
  let revokedObjectUrls: string[];
  let objectUrlSpies: { restore(): void }[];
  beforeEach(() => {
    miniDom = installMiniDom();
    RecordingResizeObserver.instances.length = 0;
    vi.stubGlobal("ResizeObserver", RecordingResizeObserver);
    container = miniDom.document.createElement("div");
    container.rect = { left: 0, top: 0, width: 1440, height: 900 };
    nativeStoreDoubles.readNativeCatalog.mockReset().mockResolvedValue(syntheticCatalog());
    nativeStoreDoubles.fetchVerifiedNativeResource.mockReset();
    serveSyntheticStore();
    createdObjectUrls = [];
    revokedObjectUrls = [];
    const createObjectUrlSpy = vi.spyOn(URL, "createObjectURL").mockImplementation(() => {
      const url = `blob:synthetic/${createdObjectUrls.length + 1}`;
      createdObjectUrls.push(url);
      return url;
    });
    const revokeObjectUrlSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(url => { revokedObjectUrls.push(url); });
    objectUrlSpies = [{ restore: () => createObjectUrlSpy.mockRestore() }, { restore: () => revokeObjectUrlSpy.mockRestore() }];
  });
  afterEach(() => {
    objectUrlSpies.forEach(spy => spy.restore());
    miniDom.restore();
  });

  function createLayer() {
    return createNativeWindowLayer(container as unknown as HTMLElement, () => null);
  }

  function renderedWindowRoot(): FakeElement | null {
    return container.querySelector("[data-native-window]");
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

  it("shares one load between concurrent opens of a window and re-appends the open window on a later open", async () => {
    const layer = createLayer();
    const firstOpen = layer.open(plainWindowId);
    const secondOpen = layer.open(plainWindowId);
    expect(secondOpen).toBe(firstOpen);
    const opened = await firstOpen;
    if (opened.status !== "opened") throw new Error("the synthetic window did not open");
    opened.window.element.remove();
    expect(await layer.open(plainWindowId)).toBe(opened);
    expect(renderedWindowRoot()).toBe(opened.window.element);
    expect(nativeStoreDoubles.fetchVerifiedNativeResource).toHaveBeenCalledTimes(1);
    layer.dispose();
  });

  it("rejects an open disposed while its textures resolve, revokes every texture URL it created and renders nothing", async () => {
    const layer = createLayer();
    serveSyntheticStore(async reference => {
      if (reference === statusTextureReferences.at(-1)) layer.dispose();
      return syntheticPngBytes;
    });
    await expect(layer.open(statusWindowId)).rejects.toMatchObject({ name: "AbortError" });
    expect(createdObjectUrls).toHaveLength(statusTextureReferences.length);
    expect(revokedObjectUrls).toEqual(createdObjectUrls);
    expect(renderedWindowRoot()).toBeNull();
  });

  it("revokes the texture URLs already created when a later texture fetch fails, and loads again on the next open", async () => {
    serveSyntheticStore(async reference => {
      if (reference === statusTextureReferences[1]) throw new Error("synthetic texture fetch failure");
      return syntheticPngBytes;
    });
    const layer = createLayer();
    await expect(layer.open(statusWindowId)).rejects.toThrow("synthetic texture fetch failure");
    expect(createdObjectUrls).toEqual(["blob:synthetic/1"]);
    expect(revokedObjectUrls).toEqual(["blob:synthetic/1"]);
    expect(renderedWindowRoot()).toBeNull();
    serveSyntheticStore();
    expect((await layer.open(statusWindowId)).status).toBe("opened");
    layer.dispose();
  });

  it("removes every open window, revokes its texture URLs and refuses further opens on dispose", async () => {
    const layer = createLayer();
    expect((await layer.open(statusWindowId)).status).toBe("opened");
    expect(revokedObjectUrls).toEqual([]);
    layer.dispose();
    expect(createdObjectUrls).toHaveLength(statusTextureReferences.length);
    expect(revokedObjectUrls).toEqual(createdObjectUrls);
    expect(renderedWindowRoot()).toBeNull();
    expect(() => layer.open(plainWindowId)).toThrow();
  });
});
