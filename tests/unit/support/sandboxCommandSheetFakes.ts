import { vi } from "vitest";
import { DevSheet, type DevSection } from "../../../src/ui/devSheet/DevSheet";
import type { NativeCatalogIndex, NativeCatalogLookup } from "../../../src/assets/native/nativeCatalogIndex";
import { createNativeClipPreviewHub } from "../../../src/assets/native/nativeClipPreview";
import { attachSandboxCommandSheet } from "../../../src/runtime/attachSandboxCommandSheet";
import { createSandboxRuntimeActions, type SandboxTileLocation } from "../../../src/runtime/sandboxRuntimeActions";
import type { NativeWindowLayer, NativeWindowOpenResult } from "../../../src/ui/nativeWindows/nativeWindowLayer";
import type { WorldCommand, WorldEvent } from "../../../src/world/worldTypes";
import { fakeMedia, fire, type FakeElement, type MiniDom } from "./miniDom";

export function fakeCatalogIndexOver(lookups: ReadonlyMap<string, NativeCatalogLookup>): NativeCatalogIndex {
  return {
    lookup: key => lookups.get(key) ?? { status: "not-in-catalog", key,
      reason: key.startsWith("window:") ? "interface windows are not converted yet (UI-01)" : "not in catalog" },
    keys: prefix => [...lookups.keys()].filter(key => key.startsWith(prefix)),
  };
}

export function createSandboxSection(dom: MiniDom): { readonly sheet: DevSheet; readonly section: DevSection } {
  const host = dom.document.createElement("section"); host.className = "world-interface";
  const canvas = dom.document.createElement("canvas");
  const toggle = dom.document.createElement("button");
  host.append(toggle); dom.document.body.append(canvas, host);
  host.rect = { left: 0, top: 0, width: 1280, height: 800 };
  const sheet = new DevSheet({ host: host as unknown as HTMLElement, canvas: canvas as unknown as HTMLCanvasElement,
    toggle: toggle as unknown as HTMLButtonElement, worldTargets: [canvas] as unknown as EventTarget[], storage: null, matchMedia: fakeMedia().matchMedia });
  return { sheet, section: sheet.section("sandbox", { title: "Sandbox" }) };
}

function fakeWindowLayerOver(index: NativeCatalogIndex, openedWindowIds: string[]): Pick<NativeWindowLayer, "open"> {
  return {
    open: async windowId => {
      const lookup = index.lookup(`window:${windowId}`);
      if (lookup.status !== "converted") return { status: "not-in-catalog", windowId, key: lookup.key, reason: lookup.reason };
      openedWindowIds.push(windowId);
      const result: NativeWindowOpenResult = { status: "opened", windowId, key: lookup.key,
        window: { element: {} as HTMLElement, gaps: [], refresh() {}, dispose() {} } };
      return result;
    },
  };
}

export interface SandboxSheetFakeOptions {
  readonly index: NativeCatalogIndex;
  readonly selectedEntityId?: string | null;
  readonly indexFailure?: string | null;
  readonly search?: string;
}

export function attachSandboxSheetWithFakes(dom: MiniDom, options: SandboxSheetFakeOptions) {
  const { index, selectedEntityId = "native-musveren", indexFailure = null, search = "" } = options;
  const dispatched: WorldCommand[] = [];
  const listeners = new Set<(event: WorldEvent) => void>();
  const adapter = {
    dispatch: vi.fn((command: WorldCommand) => { dispatched.push(command); }),
    subscribe: vi.fn((listener: (event: WorldEvent) => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; }),
  };
  const emit = (event: WorldEvent) => { for (const listener of [...listeners]) listener(event); };
  const assignedLocations: string[] = [];
  const location: SandboxTileLocation = { href: `http://127.0.0.1:5173/${search}`, search, assign: url => { assignedLocations.push(String(url)); } };
  const openedWindowIds: string[] = [];
  const lifetime = new AbortController();
  const powerStrike = { start: vi.fn(async () => {}) };
  const { sheet, section } = createSandboxSection(dom);
  const host = createSandboxRuntimeActions({ adapter, windowLayer: fakeWindowLayerOver(index, openedWindowIds), location, signal: lifetime.signal,
    clipListings: createNativeClipPreviewHub() });
  const release = attachSandboxCommandSheet({ section, adapter, indexFailure, powerStrike, pickerContext: {
    host, catalogIndex: index,
    readNameIndex: async tableId => ({ status: "not-in-catalog", key: `table:${tableId.replace(/-/g, "_")}_names`, reason: "no tables record in the served catalog" }),
    selectedEntityId: () => selectedEntityId, currentTileId: () => null, signal: lifetime.signal,
  } });
  const panel = section.element as unknown as FakeElement;
  const submit = async (testId: string, values: Record<string, string>) => {
    const form = panel.querySelector(`[data-testid="${testId}"]`)!;
    for (const [name, value] of Object.entries(values)) form.querySelector(`[data-testid="${testId}-${name}"]`)!.value = value;
    fire(form, "submit");
    for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
  };
  const note = (testId: string) => panel.querySelectorAll(`[data-testid="${testId}"]`);
  return { sheet, section, adapter, dispatched, listeners, emit, assignedLocations, openedWindowIds, powerStrike, release, submit, note, panel };
}
