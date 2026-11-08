import { windowIdPattern } from "../../../src/assets/native/nativeCatalogRecords";
import { createNativeWindowLayer, type NativeWindowOpenResult } from "../../../src/ui/nativeWindows/nativeWindowLayer";
import type { NativeWindowControlGap } from "../../../src/ui/nativeWindows/nativeWindowRenderer";
import { NativeSliceAdapter } from "../../../src/world/NativeSliceAdapter";
import type { WorldEntity } from "../../../src/world/worldTypes";

export interface NativeWindowHarnessResult {
  readonly status: "loading" | "opened" | "not-in-catalog" | "failed";
  readonly windowId: string | null;
  readonly key: string | null;
  readonly reason: string | null;
  readonly gaps: readonly NativeWindowControlGap[];
}

export interface NativeWindowHarness {
  readonly result: NativeWindowHarnessResult;
  setHealth(health: number): void;
}

declare global {
  interface Window { __nativeWindowHarness?: NativeWindowHarness }
}

const harnessContainer = document.getElementById("native-window-harness");
if (!(harnessContainer instanceof HTMLElement)) throw new Error("Native window harness page is missing #native-window-harness.");
const container = harnessContainer;

const adapter = new NativeSliceAdapter({ x: 0, y: 0, z: 0 });
let localPlayer: WorldEntity | null = adapter.getInitialState().find(entity => entity.kind === "local-player") ?? null;
const layer = createNativeWindowLayer(container, () => localPlayer);
adapter.subscribe(event => {
  if (event.type === "update" && event.entity.kind === "local-player") localPlayer = event.entity;
  layer.refresh();
});

let openResult: NativeWindowOpenResult | null = null;
let failure: { readonly windowId: string | null; readonly reason: string } | null = null;

function harnessResult(): NativeWindowHarnessResult {
  if (failure !== null) return { status: "failed", windowId: failure.windowId, key: null, reason: failure.reason, gaps: [] };
  if (openResult === null) return { status: "loading", windowId: null, key: null, reason: null, gaps: [] };
  if (openResult.status === "not-in-catalog") {
    return { status: "not-in-catalog", windowId: openResult.windowId, key: openResult.key, reason: openResult.reason, gaps: [] };
  }
  return { status: "opened", windowId: openResult.windowId, key: openResult.key, reason: null, gaps: openResult.window.gaps };
}

window.__nativeWindowHarness = {
  get result() { return harnessResult(); },
  setHealth(health: number) {
    if (localPlayer === null) throw new Error("Native window harness has no local player.");
    adapter.dispatch({ type: "set-health", entityId: localPlayer.id, health });
  },
};

async function openRequestedWindow(): Promise<void> {
  const windowId = new URLSearchParams(location.search).get("window");
  if (windowId === null || !windowIdPattern.test(windowId)) {
    failure = { windowId: null, reason: `?window= must match ${windowIdPattern.source}` };
    return;
  }
  try { openResult = await layer.open(windowId); }
  catch (error) { failure = { windowId, reason: error instanceof Error ? error.message : String(error) }; }
}

void openRequestedWindow().then(() => container.setAttribute("data-status", harnessResult().status));
