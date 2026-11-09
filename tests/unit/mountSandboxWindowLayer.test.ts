import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorldEntity, WorldEvent } from "../../src/world/worldTypes";
import { installMiniDom, type FakeElement, type MiniDom } from "./support/miniDom";

const layerDouble = vi.hoisted(() => ({ create: vi.fn(), refresh: vi.fn(), dispose: vi.fn() }));
vi.mock("../../src/ui/nativeWindows/nativeWindowLayer", () => ({ createNativeWindowLayer: layerDouble.create }));

const { mountSandboxWindowLayer } = await import("../../src/runtime/mountSandboxWindowLayer");

const localPlayer: WorldEntity = { id: "local-player", kind: "local-player", displayName: "Fighter", health: 90, maximumHealth: 100,
  position: { x: 0, y: 0, z: 0 }, orientationRadians: 0, animation: "idle" };

describe("mountSandboxWindowLayer", () => {
  let dom: MiniDom;
  beforeEach(() => {
    dom = installMiniDom();
    layerDouble.refresh.mockReset(); layerDouble.dispose.mockReset();
    layerDouble.create.mockReset().mockReturnValue({ open: vi.fn(), refresh: layerDouble.refresh, close: vi.fn(), openWindowIds: () => [], dispose: layerDouble.dispose });
  });
  afterEach(() => { dom.restore(); });

  function mount() {
    const root = dom.document.createElement("section");
    const sheet = dom.document.createElement("div");
    root.append(sheet);
    dom.document.body.append(root);
    const listeners = new Set<(event: WorldEvent) => void>();
    const adapter = { subscribe: (listener: (event: WorldEvent) => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; } };
    const readLocalPlayer = () => localPlayer;
    const mounted = mountSandboxWindowLayer(root as unknown as HTMLElement, adapter, readLocalPlayer);
    const emit = (event: WorldEvent) => { for (const listener of [...listeners]) listener(event); };
    return { root, sheet, listeners, readLocalPlayer, mounted, emit };
  }

  it("puts the layer host under the sheet with position and size only and builds the layer on it", () => {
    const { root, sheet, readLocalPlayer } = mount();
    const host = root.children[0] as FakeElement;
    expect(root.children[1]).toBe(sheet);
    expect(host.style.position).toBe("absolute");
    expect(host.style.inset).toBe("0");
    expect(host.getAttribute("class")).toBeNull();
    expect(host.getAttribute("style")).toBeNull();
    expect(layerDouble.create).toHaveBeenCalledWith(host, readLocalPlayer);
  });

  it("refreshes the open windows on a local player update and on nothing else", () => {
    const { emit } = mount();
    emit({ type: "update", entity: { ...localPlayer, id: "native-musveren", kind: "monster" } });
    emit({ type: "spawn", entity: localPlayer });
    expect(layerDouble.refresh).not.toHaveBeenCalled();
    emit({ type: "update", entity: localPlayer });
    expect(layerDouble.refresh).toHaveBeenCalledOnce();
  });

  it("disposes the layer, removes the host and unsubscribes once, however often it is released", () => {
    const { root, listeners, mounted, emit } = mount();
    mounted.release();
    mounted.release();
    expect(layerDouble.dispose).toHaveBeenCalledOnce();
    expect(root.children).toHaveLength(1);
    expect(listeners.size).toBe(0);
    emit({ type: "update", entity: localPlayer });
    expect(layerDouble.refresh).not.toHaveBeenCalled();
  });
});
