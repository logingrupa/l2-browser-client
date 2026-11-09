import type { WorldEntity } from "../../world/worldTypes";
import { readNativeWindowFieldBindings, type NativeWindowFieldBinding } from "./nativeWindowFieldBindings";
import { loadNativeWindowManifest, resolveNativeWindowTextures, revokeNativeWindowTextures, type NativeWindowTextureResolution } from "./nativeWindowManifestLoader";
import { renderNativeWindow, type RenderedNativeWindow } from "./nativeWindowRenderer";

export type NativeWindowOpenResult =
  | { readonly status: "opened"; readonly windowId: string; readonly key: string; readonly window: RenderedNativeWindow }
  | { readonly status: "not-in-catalog"; readonly windowId: string; readonly key: string; readonly reason: string };

export interface NativeWindowLayerPresentation {
  readonly overflow: "hidden";
  readonly status: "presentation";
  readonly source: string;
}

const nativeWindowLayerPresentation: NativeWindowLayerPresentation = {
  overflow: "hidden", status: "presentation", source: "windows anchored past the viewport are clipped instead of scrolling the page",
};

export interface NativeWindowLayer {
  readonly presentation: NativeWindowLayerPresentation;
  open(windowId: string): Promise<NativeWindowOpenResult>;
  refresh(): void;
  close(windowId: string): void;
  openWindowIds(): readonly string[];
  dispose(): void;
}

interface OpenNativeWindow {
  readonly result: Extract<NativeWindowOpenResult, { status: "opened" }>;
  readonly textures: ReadonlyMap<string, NativeWindowTextureResolution>;
}

function windowTextureReferences(textureRefs: readonly string[], bindings: readonly NativeWindowFieldBinding[]): readonly string[] {
  return [...new Set([...textureRefs, ...bindings.flatMap(binding => binding.fillTextureRef === null ? [] : [binding.fillTextureRef])])];
}

export function createNativeWindowLayer(container: HTMLElement, readLocalPlayer: () => WorldEntity | null): NativeWindowLayer {
  const lifetime = new AbortController();
  container.style.overflow = nativeWindowLayerPresentation.overflow;
  const fieldBindings = readNativeWindowFieldBindings();
  const openWindows = new Map<string, OpenNativeWindow>();
  const pendingOpens = new Map<string, Promise<NativeWindowOpenResult>>();

  const loadAndRender = async (windowId: string): Promise<NativeWindowOpenResult> => {
    const load = await loadNativeWindowManifest(windowId, lifetime.signal);
    if (load.status === "not-in-catalog") return { status: "not-in-catalog", windowId, key: load.key, reason: load.reason };
    const windowBindings = fieldBindings.filter(binding => binding.windowId === windowId);
    const textures = await resolveNativeWindowTextures(load.catalog, windowTextureReferences(load.manifest.textureRefs, windowBindings), lifetime.signal);
    if (lifetime.signal.aborted) {
      revokeNativeWindowTextures(textures);
      lifetime.signal.throwIfAborted();
    }
    const bounds = container.getBoundingClientRect();
    const rendered = renderNativeWindow(container, load.manifest, {
      localPlayer: readLocalPlayer(), textures, fieldBindings: windowBindings, screen: { width: bounds.width, height: bounds.height },
    });
    const result = { status: "opened", windowId, key: load.key, window: rendered } as const;
    openWindows.set(windowId, { result, textures });
    return result;
  };

  const open = (windowId: string): Promise<NativeWindowOpenResult> => {
    lifetime.signal.throwIfAborted();
    const alreadyOpen = openWindows.get(windowId);
    if (alreadyOpen !== undefined) {
      container.append(alreadyOpen.result.window.element);
      return Promise.resolve(alreadyOpen.result);
    }
    const pending = pendingOpens.get(windowId);
    if (pending !== undefined) return pending;
    const opening = loadAndRender(windowId).finally(() => pendingOpens.delete(windowId));
    pendingOpens.set(windowId, opening);
    return opening;
  };

  const close = (windowId: string): void => {
    const openWindow = openWindows.get(windowId);
    if (openWindow === undefined) return;
    openWindow.result.window.dispose();
    revokeNativeWindowTextures(openWindow.textures);
    openWindows.delete(windowId);
  };

  return {
    presentation: nativeWindowLayerPresentation,
    open,
    refresh: () => {
      const localPlayer = readLocalPlayer();
      for (const openWindow of openWindows.values()) openWindow.result.window.refresh(localPlayer);
    },
    close,
    openWindowIds: () => [...openWindows.keys()],
    dispose: () => {
      lifetime.abort();
      [...openWindows.keys()].forEach(close);
    },
  };
}
