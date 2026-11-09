import { describe, expect, it, vi } from "vitest";
import { createSandboxRuntimeActions, type SandboxTileLocation } from "../../src/runtime/sandboxRuntimeActions";
import type { NativeWindowLayer, NativeWindowOpenResult } from "../../src/ui/nativeWindows/nativeWindowLayer";
import type { WorldCommand } from "../../src/world/worldTypes";

function fakeLocation(href: string) {
  const assigned: string[] = [];
  const url = new URL(href);
  const location: SandboxTileLocation = { href, search: url.search, assign: target => { assigned.push(String(target)); } };
  return { location, assigned };
}

function openedResult(windowId: string, gapCount: number): NativeWindowOpenResult {
  const gaps = Array.from({ length: gapCount }, (_, position) => ({ controlName: `Control${position}`, reason: "label-unresolved" }));
  return { status: "opened", windowId, key: `window:${windowId}`, window: { element: {} as HTMLElement, gaps, refresh() {}, dispose() {} } };
}

function createActions(href = "http://127.0.0.1:5173/", open: NativeWindowLayer["open"] = async windowId => openedResult(windowId, 0)) {
  const adapter = { dispatch: vi.fn((_command: WorldCommand) => {}) };
  const windowLayer = { open: vi.fn(open) };
  const lifetime = new AbortController();
  const { location, assigned } = fakeLocation(href);
  const actions = createSandboxRuntimeActions({ adapter, windowLayer, location, signal: lifetime.signal });
  return { actions, adapter, windowLayer, assigned, lifetime };
}

describe("createSandboxRuntimeActions dispatch", () => {
  it("forwards exactly the command to the adapter", () => {
    const { actions, adapter } = createActions();
    const command: WorldCommand = { type: "spawn-character", characterTemplateIndex: 0 };
    actions.dispatch(command);
    expect(adapter.dispatch).toHaveBeenCalledTimes(1);
    expect(adapter.dispatch).toHaveBeenCalledWith(command);
  });
});

describe("createSandboxRuntimeActions reloadTile", () => {
  it("does not navigate for the tile the URL already selects", () => {
    const { actions, assigned, adapter } = createActions("http://127.0.0.1:5173/?map=20_21");
    expect(actions.reloadTile("20_21")).toEqual({ tone: "info", text: "tile 20_21 already loaded" });
    expect(assigned).toEqual([]);
    expect(adapter.dispatch).not.toHaveBeenCalled();
  });

  it("sets only map and keeps every other parameter in its original order, origin, path and hash", () => {
    const { actions, assigned, adapter } = createActions("http://127.0.0.1:5173/sandbox?character=human-male-fighter&map=20_21&debug=1#sheet");
    expect(actions.reloadTile("20_20")).toEqual({ tone: "info", text: "tile 20_20 reloading" });
    expect(assigned).toEqual(["http://127.0.0.1:5173/sandbox?character=human-male-fighter&map=20_20&debug=1#sheet"]);
    expect(adapter.dispatch).not.toHaveBeenCalled();
  });

  it("appends map after the other parameters when the URL selects no tile", () => {
    const { actions, assigned } = createActions("http://127.0.0.1:5173/?character=human-male-fighter");
    actions.reloadTile("20_21");
    expect(assigned).toEqual(["http://127.0.0.1:5173/?character=human-male-fighter&map=20_21"]);
  });

  it.each(["2021", "20-21", "20_2", "https://elsewhere.example/?map=20_21", "20_21&map=19_21", ""])("refuses %j without navigating", tileId => {
    const { actions, assigned, adapter } = createActions();
    expect(actions.reloadTile(tileId)).toEqual({ tone: "warning", text: `tile ${tileId} is not an XX_YY tile id; nothing was reloaded` });
    expect(assigned).toEqual([]);
    expect(adapter.dispatch).not.toHaveBeenCalled();
  });
});

describe("createSandboxRuntimeActions openWindow", () => {
  it("opens through the native window layer and never through the adapter", async () => {
    const { actions, adapter, windowLayer } = createActions();
    await expect(actions.openWindow("StatusWnd")).resolves.toEqual({ tone: "info", text: "window:StatusWnd opened" });
    expect(windowLayer.open).toHaveBeenCalledWith("StatusWnd");
    expect(adapter.dispatch).not.toHaveBeenCalled();
  });

  it("names the control gap count of an opened window", async () => {
    const { actions } = createActions(undefined, async windowId => openedResult(windowId, 19));
    await expect(actions.openWindow("StatusWnd")).resolves.toEqual({ tone: "warning", text: "window:StatusWnd opened with 19 control gaps" });
    const single = createActions(undefined, async windowId => openedResult(windowId, 1));
    await expect(single.actions.openWindow("StatusWnd")).resolves.toEqual({ tone: "warning", text: "window:StatusWnd opened with 1 control gap" });
  });

  it("returns the not-in-catalog reason of a window without a windows record", async () => {
    const { actions } = createActions(undefined, async windowId => ({ status: "not-in-catalog", windowId, key: `window:${windowId}`,
      reason: "the served catalog has no windows record for MissingWnd" }));
    await expect(actions.openWindow("MissingWnd")).resolves.toEqual({ tone: "warning",
      text: "window:MissingWnd not in catalog: the served catalog has no windows record for MissingWnd" });
  });

  it("refuses to open once the runtime lifetime has ended", async () => {
    const { actions, lifetime, windowLayer } = createActions();
    lifetime.abort();
    await expect(actions.openWindow("StatusWnd")).rejects.toThrow();
    expect(windowLayer.open).not.toHaveBeenCalled();
  });

  it("drops the outcome of a load that settles after the runtime lifetime ended", async () => {
    let settle!: (result: NativeWindowOpenResult) => void;
    const { actions, lifetime } = createActions(undefined, () => new Promise(resolve => { settle = resolve; }));
    const opening = actions.openWindow("StatusWnd");
    lifetime.abort();
    settle(openedResult("StatusWnd", 0));
    await expect(opening).rejects.toThrow();
  });
});
