import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EntityRegistry } from "../../src/entities/EntityRegistry";
import type { GameWorldAdapter } from "../../src/world/GameWorldAdapter";
import { WorldInterface } from "../../src/ui/WorldInterface";
import { fakeMedia, installMiniDom, memoryStorage, throwingStorage, type FakeElement, type MiniDom } from "./support/miniDom";

let dom: MiniDom;
const interfaces: WorldInterface[] = [];
let registry: { localPlayer: null; selectedEntity: null; selectedEntityId: null; count: number; localPlayerPosition: { x: number; y: number; z: number } | null };

function create(storage: Parameters<typeof memoryStorage>[0] | "throwing" = {}) {
  const app = dom.document.createElement("main"), canvas = dom.document.createElement("canvas");
  app.append(canvas); dom.document.body.append(app);
  canvas.rect = { left: 0, top: 0, width: 1280, height: 800 };
  const dispatch = vi.fn();
  registry = { localPlayer: null, selectedEntity: null, selectedEntityId: null, count: 3, localPlayerPosition: null };
  const ui = new WorldInterface({ dispatch } as unknown as GameWorldAdapter, () => registry as unknown as EntityRegistry, canvas as unknown as HTMLCanvasElement,
    { location: "20_20 · native world section", coordinateUnit: "m" }, { storage: storage === "throwing" ? throwingStorage() : memoryStorage(storage) });
  interfaces.push(ui);
  return { ui, canvas, app, dispatch, root: ui.root as unknown as FakeElement };
}

beforeEach(() => { dom = installMiniDom(); });
afterEach(() => { for (const ui of interfaces.splice(0)) ui.dispose(); dom.restore(); });

describe("WorldInterface developer sheet compatibility", () => {
  it("keeps the legacy hosts inside the sheet's General group", () => {
    const { ui, root } = create();
    const body = root.querySelector(".demo-controls-body")!;
    const sheet = root.querySelector(".dev-sheet")!;
    expect(sheet).toBe(ui.sheet.element);
    expect(sheet.contains(body)).toBe(true);
    expect(body).toBe(ui.generalGroup.element);
    expect(ui.generalGroup.section.id).toBe("general");
    // Runtime code takes the first .secondary-actions for its buttons.
    const actions = root.querySelector(".secondary-actions")!;
    expect(actions.parentElement).toBe(body);
    expect(actions.children.map(button => button.dataset.action)).toEqual(["pause", "despawn", "missing-model"]);
    expect(root.querySelector('[data-action="despawn"]')!.disabled).toBe(true);
    const appended = dom.document.createElement("p"); appended.id = "native-flame-status";
    root.querySelector(".demo-controls-body")!.append(appended);
    const extra = dom.document.createElement("button"); extra.textContent = "Leather shirt";
    root.querySelector(".secondary-actions")!.append(extra);
    expect(ui.generalGroup.element.contains(appended as unknown as Node)).toBe(true);
    expect(sheet.contains(extra)).toBe(true);
  });

  it("keeps HUD actions, diagnostics and test ids in the DOM", () => {
    const { ui, root } = create();
    for (const action of ["attack", "run", "idle", "teleport", "spawn", "pause", "despawn", "missing-model"]) expect(root.querySelector(`[data-action="${action}"]`), action).not.toBeNull();
    for (const testId of ["fps", "entity-count", "coordinates", "world-status", "player-name", "player-health", "target-name", "target-health", "dev-sheet-toggle"]) {
      expect(root.querySelector(`[data-testid="${testId}"]`), testId).not.toBeNull();
    }
    expect(root.querySelector(".world-location h1")!.textContent).toBe("20_20 · native world section");
    expect(root.querySelector(".action-bar")!.querySelector('[data-action="attack"]')).not.toBeNull();
    expect(root.querySelector(".demo-controls")).toBeNull();
    ui.update(.2, 59.6);
    expect(root.querySelector('[data-testid="fps"]')!.textContent).toBe("60");
    expect(root.querySelector('[data-testid="entity-count"]')!.textContent).toBe("3");
  });

  it("toggles the sheet from the HUD and dispatches legacy actions from inside it", () => {
    const { ui, root, dispatch } = create();
    const toggle = root.querySelector('[data-testid="dev-sheet-toggle"]')!;
    expect(toggle.getAttribute("aria-controls")).toBe(ui.sheet.element.id);
    toggle.click();
    expect(ui.sheet.isOpen).toBe(true);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const pause = root.querySelector('[data-action="pause"]')!;
    pause.click();
    expect(dispatch).toHaveBeenCalledWith({ type: "set-paused", isPaused: true });
    expect(pause.textContent).toBe("Resume");
    toggle.click();
    expect(ui.sheet.isOpen).toBe(false);
  });

  it("restores a pinned docked sheet, and dispose returns the canvas width", () => {
    const { ui, canvas } = create({ "l2.devSheet.v1": JSON.stringify({ open: true, pinned: true, snap: "half", tab: "general", collapsed: {} }) });
    expect(ui.sheet.isDocked).toBe(true);
    expect(canvas.style.width).toBe("calc(100% - 384px)");
    const resizes = dom.window.resizeEvents;
    ui.dispose(); interfaces.length = 0;
    expect(canvas.style.width).toBe("");
    expect(dom.window.resizeEvents).toBe(resizes + 1);
    expect(dom.document.body.querySelector(".dev-sheet")).toBeNull();
  });

  it("shows a tap-for-sound chip until audio unlocks and marks the armed gait", () => {
    const { ui, root } = create();
    const cue = root.querySelector('[data-testid="hud-sound-cue"]')!;
    expect(cue.hidden).toBe(true);
    let state = "locked";
    const unlock = vi.fn();
    const stopSound = ui.watchSound(() => state, unlock);
    expect(cue.hidden).toBe(false);
    expect(cue.textContent).toContain("Tap anywhere for sound");
    cue.click();
    expect(unlock).toHaveBeenCalledOnce();
    state = "running"; ui.update(.2, 60);
    expect(cue.hidden).toBe(true);
    state = "suspended"; ui.update(.2, 60);
    expect(cue.hidden).toBe(false);
    stopSound();
    expect(cue.hidden).toBe(true);
    // WorldAudioMixer.locked (boolean) works the same way.
    let locked = true;
    const stopLocked = ui.watchSound(() => locked);
    expect(cue.hidden).toBe(false);
    expect(cue.dataset.state).toBe("locked");
    locked = false; ui.update(.2, 60);
    expect(cue.hidden).toBe(true);
    stopLocked();

    let gait = "run";
    const walk = dom.document.createElement("button"); walk.dataset.action = "walk";
    root.querySelector('[data-action="run"]')!.after(walk);
    const stopGait = ui.bindGait(() => gait);
    expect(root.querySelector('[data-action="run"]')!.getAttribute("aria-pressed")).toBe("true");
    expect(walk.getAttribute("aria-pressed")).toBe("false");
    gait = "walk"; walk.click();
    expect(walk.getAttribute("aria-pressed")).toBe("true");
    expect(root.querySelector('[data-action="run"]')!.getAttribute("aria-pressed")).toBe("false");
    stopGait();
    expect(walk.hasAttribute("aria-pressed")).toBe(false);
  });

  it("clears transient action statuses after a few seconds or once the player moves", () => {
    const { ui, root } = create();
    const status = root.querySelector('[data-testid="world-status"]')!;
    root.querySelector('[data-action="attack"]')!.click();
    expect(status.textContent).toBe("Attack demonstration");
    ui.update(3.9, 60);
    expect(status.textContent).toBe("Attack demonstration");
    ui.update(.2, 60);
    expect(status.textContent).toBe("");
    ui.showStatus("World load failed.");
    ui.update(10, 60);
    expect(status.textContent).toBe("World load failed.");
    registry.localPlayerPosition = { x: 0, y: 0, z: 0 };
    ui.showStatus("Walk demonstration · tap the ground to walk there", { transient: true });
    ui.update(.1, 60);
    expect(status.textContent).toContain("Walk demonstration");
    registry.localPlayerPosition = { x: .4, y: 0, z: .1 };
    ui.update(.1, 60);
    expect(status.textContent).toBe("");
  });

  it("measures the top HUD and action bar so a full phone sheet never covers them", () => {
    dom.window.matchMedia = fakeMedia({ narrow: true }).matchMedia;
    const { ui, root, canvas, app } = create();
    app.rect = { left: 0, top: 0, width: 390, height: 844 };
    root.querySelector(".world-header")!.rect = { left: 12, top: 12, width: 366, height: 60 };
    root.querySelector(".target-panel")!.rect = { left: 100, top: 86, width: 190, height: 34 };
    root.querySelector(".world-bottom")!.rect = { left: 12, top: 700, width: 366, height: 62 };
    ui.sheet.open(); ui.sheet.setSnap("full");
    // 844 - 120 (target panel bottom) - (62 + 18) - 8.
    expect(ui.sheet.inspect()).toMatchObject({ mode: "bottom", snap: "full", docked: true, dock: "height", height: 636 });
    expect(canvas.style.height).toBe("calc(100% - 636px)");
    ui.sheet.setSnap("half");
    expect(ui.sheet.inspect().height).toBe(464);
    expect(root.hasAttribute("data-dev-sheet-open")).toBe(true);
    expect(root.dataset.devSheetMode).toBe("bottom");
  });

  it("works when storage throws", () => {
    const { ui, root } = create("throwing");
    (root.querySelector('[data-testid="dev-sheet-toggle"]')!).click();
    ui.sheet.setPinned(true);
    expect(ui.sheet.inspect()).toMatchObject({ open: true, pinned: true, persisted: false });
  });
});
