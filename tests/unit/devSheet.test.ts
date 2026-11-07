import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DevSheet, stickyExplanation, type DevSheetOptions } from "../../src/ui/devSheet/DevSheet";
import { devSheetStorageKey, readDevSheetState, resolveDevSheetStorage } from "../../src/ui/devSheet/devSheetState";
import { bottomSnapHeights, placeCard, placeCardInZone, resolveSheetMode, resolveSideSheetWidth, resolveSnapRelease } from "../../src/ui/devSheet/sheetGeometry";
import type { VariableInfo } from "../../src/ui/devSheet/types";
import { fakeMedia, fire, installMiniDom, memoryStorage, throwingStorage, type FakeElement, type MiniDom } from "./support/miniDom";

let dom: MiniDom;
const sheets: DevSheet[] = [];

function stage() {
  const app = dom.document.createElement("main"); app.id = "app";
  const canvas = dom.document.createElement("canvas"); canvas.id = "canvas";
  const host = dom.document.createElement("section"); host.className = "world-interface";
  const toggle = dom.document.createElement("button"); toggle.type = "button"; toggle.dataset.testid = "dev-sheet-toggle";
  const labels = dom.document.createElement("div");
  app.append(canvas); host.append(toggle); dom.document.body.append(app, labels, host);
  host.rect = { left: 0, top: 0, width: 1280, height: 800 };
  return { app, canvas, host, toggle, labels };
}

function create(options: Partial<DevSheetOptions> = {}, parts = stage()) {
  const sheet = new DevSheet({
    host: parts.host as unknown as HTMLElement, canvas: parts.canvas as unknown as HTMLCanvasElement,
    toggle: parts.toggle as unknown as HTMLButtonElement, worldTargets: [parts.canvas, parts.labels] as unknown as EventTarget[],
    storage: null, matchMedia: fakeMedia().matchMedia, ...options,
  });
  sheets.push(sheet);
  return { sheet, ...parts, element: sheet.element as unknown as FakeElement };
}

beforeEach(() => { dom = installMiniDom(); });
afterEach(() => { for (const sheet of sheets.splice(0)) sheet.dispose(); vi.useRealTimers(); dom.restore(); });

describe("developer sheet open and close", () => {
  it("opens from the HUD toggle, closes on Escape and returns focus", () => {
    const { sheet, toggle, element } = create();
    sheet.section("general", { title: "General" });
    expect(element.dataset.state).toBe("closed");
    expect(element.hasAttribute("inert")).toBe(true);
    expect(toggle.getAttribute("aria-controls")).toBe(element.id);
    toggle.click();
    expect(sheet.isOpen).toBe(true);
    expect(element.dataset.state).toBe("open");
    expect(element.hasAttribute("inert")).toBe(false);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(element.contains(dom.document.activeElement)).toBe(true);
    fire(dom.document.activeElement, "keydown", { key: "Escape" });
    expect(sheet.isOpen).toBe(false);
    expect(dom.document.activeElement).toBe(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("defaults to pinned; an unpinned overlay closes on a world pointerdown and via the close button", () => {
    const { sheet, canvas, host } = create();
    sheet.open();
    expect(sheet.isPinned).toBe(true);
    fire(canvas, "pointerdown");
    expect(sheet.isOpen).toBe(true);
    sheet.setPinned(false);
    expect(host.dataset.devSheet).toBe("overlay");
    expect(host.dataset.devSheetMode).toBe("side");
    fire(canvas, "pointerdown");
    expect(sheet.isOpen).toBe(false);
    sheet.open();
    (sheet.closeButton as unknown as FakeElement).click();
    expect(sheet.isOpen).toBe(false);
  });

  it("toggles with the backtick key except while typing", () => {
    const { sheet } = create();
    fire(dom.document.body, "keydown", { key: "`" });
    expect(sheet.isOpen).toBe(true);
    (sheet.filterInput as unknown as FakeElement).focus();
    fire(sheet.filterInput as unknown as FakeElement, "keydown", { key: "`" });
    expect(sheet.isOpen).toBe(true);
    fire(dom.document.body, "keydown", { key: "`" });
    expect(sheet.isOpen).toBe(false);
  });
});

describe("developer sheet pinning", () => {
  it("docks a pinned desktop sheet by shrinking the canvas and dispatching resize", () => {
    const onLayoutChange = vi.fn();
    const { sheet, canvas, host } = create({ onLayoutChange });
    canvas.style.width = "100%";
    sheet.open();
    expect(sheet.isDocked).toBe(true);
    expect(canvas.style.width).toBe("calc(100% - 384px)");
    expect(dom.window.resizeEvents).toBe(1);
    expect(onLayoutChange).toHaveBeenCalledTimes(1);
    expect(host.hasAttribute("data-dev-docked")).toBe(true);
    expect(host.dataset.devSheet).toBe("docked");
    // Pinned: world interaction and Escape outside the sheet keep it open.
    fire(canvas, "pointerdown");
    fire(dom.document.body, "keydown", { key: "Escape" });
    expect(sheet.isOpen).toBe(true);
    fire(sheet.pinButton as unknown as FakeElement, "keydown", { key: "Escape" });
    expect(sheet.isOpen).toBe(false);
    expect(canvas.style.width).toBe("100%");
    expect(dom.window.resizeEvents).toBe(2);
    expect(host.hasAttribute("data-dev-docked")).toBe(false);
  });

  it("lifts the HUD above an auto-hide bottom sheet; sticky shrinks the canvas height instead", () => {
    const media = fakeMedia({ narrow: true });
    const { sheet, canvas, host, element } = create({ matchMedia: media.matchMedia });
    canvas.style.height = "100%";
    sheet.setPinned(false); sheet.open();
    expect(sheet.mode).toBe("bottom");
    expect(element.dataset.mode).toBe("bottom");
    expect(sheet.isDocked).toBe(false);
    expect(host.style.getPropertyValue("--dev-sheet-lift")).toBe("440px");
    expect(host.hasAttribute("data-dev-sheet-open")).toBe(true);
    expect(host.dataset.devSnap).toBe("half");
    const resizes = dom.window.resizeEvents;
    sheet.setPinned(true);
    // Sticky on a phone docks like desktop: the world keeps the area above the sheet.
    expect(sheet.isDocked).toBe(true);
    expect(sheet.inspect()).toMatchObject({ docked: true, dock: "height", lift: 0, height: 440 });
    expect(canvas.style.height).toBe("calc(100% - 440px)");
    expect(canvas.style.width).toBe("");
    expect(host.style.getPropertyValue("--dev-sheet-dock")).toBe("440px");
    expect(host.hasAttribute("data-dev-lift")).toBe(false);
    expect(dom.window.resizeEvents).toBe(resizes + 1);
    sheet.setSnap("peek");
    expect(canvas.style.height).toBe("calc(100% - 116px)");
    media.set("narrow", false);
    expect(sheet.mode).toBe("side");
    expect(sheet.isDocked).toBe(true);
    expect(canvas.style.height).toBe("100%");
    expect(canvas.style.width).toBe("calc(100% - 384px)");
    expect(host.hasAttribute("data-dev-lift")).toBe(false);
    expect(host.style.getPropertyValue("--dev-sheet-dock")).toBe("");
    sheet.close();
    expect(canvas.style.width).toBe("");
    expect(host.hasAttribute("data-dev-sheet-open")).toBe(false);
  });

  it("stops the full bottom snap below the top HUD and above the action bar", () => {
    const { sheet, canvas, host } = create({ matchMedia: fakeMedia({ coarse: true }).matchMedia, topReserve: () => 120, bottomReserve: () => 80 });
    sheet.setPinned(false); sheet.open(); sheet.setSnap("full");
    // 800 stage - 120 top HUD - 80 action bar - 8 gap.
    expect(sheet.inspect()).toMatchObject({ snap: "full", height: 592, lift: 592, docked: false });
    expect(host.dataset.devSnap).toBe("full");
    sheet.setPinned(true);
    expect(sheet.inspect()).toMatchObject({ docked: true, dock: "height", lift: 0, height: 592 });
    expect(canvas.style.height).toBe("calc(100% - 592px)");
  });

  it("keeps a sticky bottom sheet docked while dragging and re-docks on release", () => {
    const { sheet, canvas, host } = create({ matchMedia: fakeMedia({ coarse: true }).matchMedia });
    sheet.open();
    expect(canvas.style.height).toBe("calc(100% - 440px)");
    const grip = sheet.grip as unknown as FakeElement, resizes = dom.window.resizeEvents;
    fire(grip, "pointerdown", { pointerType: "touch", clientY: 400, timeStamp: 0 });
    fire(grip, "pointermove", { pointerType: "touch", clientY: 300, timeStamp: 400 });
    expect(host.style.getPropertyValue("--dev-sheet-height")).toBe("540px");
    expect(canvas.style.height).toBe("calc(100% - 440px)");
    expect(dom.window.resizeEvents).toBe(resizes);
    fire(grip, "pointerup", { pointerType: "touch", clientY: 300, timeStamp: 800 });
    expect(sheet.snap).toBe("half");
    expect(canvas.style.height).toBe("calc(100% - 440px)");
  });

  it("does not dock when the remaining world would be too narrow", () => {
    const parts = stage(); dom.window.innerWidth = 640;
    const { sheet } = create({}, parts);
    sheet.open(); sheet.setPinned(true);
    expect(sheet.isDocked).toBe(false);
    expect(sheet.inspect()).toMatchObject({ open: true, pinned: true, docked: false, mode: "side" });
  });

  it("resizes and closes a bottom sheet by dragging its grip", () => {
    const { sheet, element, canvas } = create({ matchMedia: fakeMedia({ coarse: true }).matchMedia });
    sheet.open();
    const grip = sheet.grip as unknown as FakeElement;
    fire(grip, "pointerdown", { pointerType: "touch", clientY: 400, timeStamp: 0 });
    fire(grip, "pointermove", { pointerType: "touch", clientY: 200, timeStamp: 300 });
    expect(element.hasAttribute("data-dragging")).toBe(true);
    fire(grip, "pointermove", { pointerType: "touch", clientY: 60, timeStamp: 600 });
    fire(grip, "pointerup", { pointerType: "touch", clientY: 60, timeStamp: 900 });
    expect(sheet.snap).toBe("full");
    fire(grip, "pointerdown", { pointerType: "touch", clientY: 100, timeStamp: 1000 });
    fire(grip, "pointermove", { pointerType: "touch", clientY: 700, timeStamp: 1040 });
    fire(grip, "pointerup", { pointerType: "touch", clientY: 780, timeStamp: 1060 });
    expect(sheet.isOpen).toBe(false);
    expect(canvas.style.height).toBe("");
  });

  it("labels the toggle Sticky with an obvious on/off state and a one-line explanation", () => {
    vi.useFakeTimers();
    const { sheet, element } = create();
    sheet.open();
    const pin = sheet.pinButton as unknown as FakeElement;
    expect(pin.getAttribute("aria-label")).toBe("Sticky");
    expect(pin.getAttribute("aria-pressed")).toBe("true");
    expect(pin.querySelector(".dev-pin-label")!.textContent).toBe("Sticky");
    expect(pin.querySelector(".dev-pin-state")!.textContent).toBe("On");
    const status = element.querySelector('[data-testid="dev-sheet-status"]')!;
    expect(status.textContent).toBe("Sticky · docked beside the world");
    pin.click();
    expect(sheet.isSticky).toBe(false);
    expect(pin.getAttribute("aria-pressed")).toBe("false");
    expect(pin.querySelector(".dev-pin-state")!.textContent).toBe("Off");
    expect(element.dataset.pinned).toBe("false");
    expect(status.textContent).toBe("Sticky off · tap the world to close");
    vi.advanceTimersByTime(2700);
    expect(status.textContent).toBe("Auto-hide · tap the world to close");
    expect(sheet.cards.info(pin as unknown as Element)?.description).toBe(stickyExplanation);
    // One sentence, short enough for one card line.
    expect(stickyExplanation.match(/\.\s/g)).toBeNull();
    expect(stickyExplanation.length).toBeLessThan(140);
  });
});

describe("developer sheet persistence", () => {
  it("restores open, pinned, snap, tab and collapsed groups", () => {
    const storage = memoryStorage();
    const first = create({ storage });
    first.sheet.section("audio", { title: "Audio", order: 1 }).group("mix", "Mixer").setCollapsed(true);
    first.sheet.section("world", { title: "World", order: 2 });
    first.sheet.open(); first.sheet.setPinned(true); first.sheet.setSnap("full"); first.sheet.activate("world");
    expect(JSON.parse(storage.values.get(devSheetStorageKey)!)).toEqual({ open: true, pinned: true, snap: "full", tab: "world", collapsed: { "audio/mix": true } });
    first.sheet.dispose();
    const second = create({ storage });
    expect(second.sheet.isOpen).toBe(true);
    expect(second.sheet.isPinned).toBe(true);
    expect(second.sheet.isDocked).toBe(true);
    expect(second.sheet.snap).toBe("full");
    const audio = second.sheet.section("audio", { title: "Audio", order: 1 });
    expect(second.sheet.activeSection?.id).toBe("audio");
    expect(audio.group("mix", "Mixer").collapsed).toBe(true);
    // The remembered tab activates once its section registers.
    second.sheet.section("world", { title: "World", order: 2 });
    expect(second.sheet.activeSection?.id).toBe("world");
  });

  it("works with storage that throws on every access", () => {
    const storage = throwingStorage();
    const { sheet } = create({ storage });
    const group = sheet.section("audio", { title: "Audio" }).group("mix", "Mixer");
    expect(() => { sheet.open(); sheet.setPinned(true); group.setCollapsed(true); sheet.setSnap("peek"); }).not.toThrow();
    expect(sheet.inspect()).toMatchObject({ open: true, pinned: true, docked: true, persisted: false });
    expect(group.collapsed).toBe(true);
    expect(storage.getItem).toHaveBeenCalled();
    expect(storage.setItem).toHaveBeenCalled();
  });

  it("treats a throwing localStorage getter and corrupt data as no storage", () => {
    Object.defineProperty(dom.window, "localStorage", { configurable: true, get() { throw new Error("blocked"); } });
    expect(resolveDevSheetStorage()).toBeNull();
    expect(readDevSheetState(memoryStorage({ [devSheetStorageKey]: "{not json" }))).toMatchObject({ open: false, pinned: true, snap: "half" });
    expect(readDevSheetState(memoryStorage({ [devSheetStorageKey]: JSON.stringify({ open: "yes", pinned: false, snap: "huge", collapsed: { a: true, b: "no" } }) })))
      .toEqual({ open: false, pinned: false, snap: "half", tab: null, collapsed: { a: true } });
  });
});

describe("developer sheet sections and tabs", () => {
  it("orders tabs, keeps registration idempotent and switches panels", () => {
    const { sheet } = create();
    const debug = sheet.section("debug", { title: "Debug", icon: "debug", order: 70 });
    const audio = sheet.section("audio", { title: "Audio", icon: "audio", order: 10 });
    const movement = sheet.section("movement", { title: "Movement", order: 20 });
    expect(sheet.section("audio")).toBe(audio);
    expect(audio.group("mix", "Mixer")).toBe(audio.group("mix", "Other title"));
    const tabs = (sheet.element as unknown as FakeElement).querySelectorAll(".dev-tab");
    expect(tabs.map(tab => tab.textContent)).toEqual(["Audio", "Movement", "Debug"]);
    expect(sheet.activeSection).toBe(audio);
    expect((audio.element as unknown as FakeElement).hidden).toBe(false);
    expect((debug.element as unknown as FakeElement).hidden).toBe(true);
    (debug.tab as unknown as FakeElement).click();
    expect(sheet.activeSection).toBe(debug);
    expect(debug.tab.getAttribute("aria-selected")).toBe("true");
    expect(debug.tab.tabIndex).toBe(0);
    expect((audio.element as unknown as FakeElement).hidden).toBe(true);
    fire(debug.tab as unknown as FakeElement, "keydown", { key: "ArrowRight" });
    expect(sheet.activeSection).toBe(audio);
    fire(audio.tab as unknown as FakeElement, "keydown", { key: "End" });
    expect(sheet.activeSection).toBe(debug);
    expect(movement.element.getAttribute("role")).toBe("tabpanel");
    expect(movement.tab.getAttribute("aria-controls")).toBe(movement.element.id);
  });

  it("collapses groups from their heading", () => {
    const { sheet } = create();
    const group = sheet.section("audio", { title: "Audio" }).group("mix", "Mixer", { collapsed: true });
    expect(group.collapsed).toBe(true);
    expect(group.header.getAttribute("aria-expanded")).toBe("false");
    (group.header as unknown as FakeElement).click();
    expect(group.collapsed).toBe(false);
    expect(group.header.getAttribute("aria-controls")).toBe(group.element.id);
  });
});

describe("developer sheet filter", () => {
  function populated() {
    const created = create();
    const { sheet } = created;
    const footsteps = sheet.section("audio", { title: "Audio", order: 1 }).group("footsteps", "Footsteps");
    footsteps.choice({ label: "Surface", testId: "footstep-surface", options: [{ value: "Grass", label: "Grass" }, { value: "Stone_Hard", label: "Stone hard" }],
      variables: () => [{ name: "footsteps.surface", value: () => "Grass", status: "presentation" }] });
    footsteps.slider({ label: "Volume", min: 0, max: 100 });
    const legacy = dom.document.createElement("div"); legacy.dataset.testid = "native-locomotion-controls";
    const label = dom.document.createElement("label"); label.append("Movement animation ");
    const select = dom.document.createElement("select"); label.append(select); legacy.append(label);
    const combat = sheet.section("combat", { title: "Combat", order: 2 }).group("cues", "Cues");
    combat.element.append(legacy as unknown as HTMLElement);
    const actions = dom.document.createElement("div"); actions.className = "secondary-actions";
    for (const text of ["Musveren attack", "Fighter death"]) { const button = dom.document.createElement("button"); button.textContent = text; actions.append(button); }
    combat.element.append(actions as unknown as HTMLElement);
    sheet.describe(legacy as unknown as Element, { title: "Gait", variables: () => [{ name: "movement.gait", value: () => "run", status: "unverified" }] });
    return { ...created, footsteps, combat, legacy, actions };
  }

  it("filters rows by label, visible text or variable name across sections", () => {
    const { sheet, footsteps, combat, legacy, actions, element } = populated();
    sheet.setFilter("footsteps.surface");
    expect(element.hasAttribute("data-filtering")).toBe(true);
    const [surface, volume] = footsteps.element.children as unknown as FakeElement[];
    expect(surface!.hasAttribute("data-dev-filtered")).toBe(false);
    expect(volume!.getAttribute("data-dev-filtered")).toBe("out");
    expect((combat.root as unknown as FakeElement).getAttribute("data-dev-filtered")).toBe("out");
    expect((combat.section.element as unknown as FakeElement).hidden).toBe(true);
    expect(footsteps.section.tabCount.textContent).toBe("1");
    sheet.setFilter("movement.gait");
    expect((legacy as FakeElement).hasAttribute("data-dev-filtered")).toBe(false);
    expect((combat.section.element as unknown as FakeElement).hidden).toBe(false);
    sheet.setFilter("musveren");
    const [attack, death] = (actions as FakeElement).children;
    expect(attack!.hasAttribute("data-dev-filtered")).toBe(false);
    expect(death!.getAttribute("data-dev-filtered")).toBe("out");
    expect((actions as FakeElement).hasAttribute("data-dev-filtered")).toBe(false);
    sheet.setFilter("Footsteps");
    expect(volume!.hasAttribute("data-dev-filtered")).toBe(false);
  });

  it("shows an empty state, and Escape in the filter clears it", () => {
    const { sheet, element } = populated();
    sheet.open();
    const input = sheet.filterInput as unknown as FakeElement;
    input.value = "zzz-no-match"; fire(input, "input");
    const empty = element.querySelector(".dev-sheet-empty")!;
    expect(empty.hidden).toBe(false);
    expect(empty.textContent).toContain("zzz-no-match");
    input.focus(); fire(input, "keydown", { key: "Escape" });
    expect(sheet.filter).toBe("");
    expect(sheet.isOpen).toBe(true);
    expect(element.hasAttribute("data-filtering")).toBe(false);
    expect(element.querySelectorAll("[data-dev-filtered]")).toHaveLength(0);
  });

  it("jumps to the first tab with matches and counts them; the clear button resets", () => {
    const { sheet, combat, element } = populated();
    sheet.open();
    expect(sheet.activeSection?.id).toBe("audio");
    sheet.setFilter("musveren");
    expect(sheet.activeSection?.id).toBe("combat");
    expect(combat.section.tab.dataset.matches).toBe("1");
    expect(sheet.section("audio").tab.dataset.matches).toBe("0");
    expect(element.hasAttribute("data-filter-open")).toBe(true);
    const clear = sheet.filterClear as unknown as FakeElement;
    expect(clear.hidden).toBe(false);
    clear.click();
    expect(sheet.filter).toBe("");
    expect(clear.hidden).toBe(true);
    // Clearing lands on the tab that held the matches.
    expect(sheet.activeSection?.id).toBe("combat");
  });

  it("matches single rows inside owner modules and never matches <style> text", () => {
    const { sheet } = create();
    const group = sheet.section("movement", { title: "Movement" }).group("footsteps", "Footsteps");
    const module = dom.document.createElement("section"); module.dataset.testid = "native-footstep-controls";
    const style = dom.document.createElement("style"); style.textContent = ".nfs-chip{border:1px dashed}";
    const surface = dom.document.createElement("fieldset"); surface.append("Surface Grass Stone");
    const variation = dom.document.createElement("fieldset"); variation.append("Variation Random 1 2 3");
    module.append(style, surface, variation);
    group.element.append(module as unknown as HTMLElement);
    sheet.setFilter("dashed");
    expect(sheet.section("movement").tab.dataset.matches).toBe("0");
    sheet.setFilter("surface");
    expect(surface.hasAttribute("data-dev-filtered")).toBe(false);
    expect(variation.getAttribute("data-dev-filtered")).toBe("out");
    expect(module.hasAttribute("data-dev-filtered")).toBe(false);
    expect(group.count.textContent).toBe("1");
  });

  it("focuses the filter with / while open and expands it", () => {
    const { sheet, element } = create({ matchMedia: fakeMedia({ narrow: true }).matchMedia });
    sheet.section("audio", { title: "Audio" });
    fire(dom.document.body, "keydown", { key: "/" });
    expect(dom.document.activeElement).not.toBe(sheet.filterInput);
    sheet.open();
    fire(dom.document.body, "keydown", { key: "/" });
    expect(dom.document.activeElement).toBe(sheet.filterInput);
    expect(element.hasAttribute("data-filter-open")).toBe(true);
    (sheet.closeButton as unknown as FakeElement).focus();
    expect(element.hasAttribute("data-filter-open")).toBe(false);
  });
});

describe("developer sheet hover-cards", () => {
  function variables(state: { surface: string }): () => VariableInfo[] {
    return () => [
      { name: "footsteps.surface", value: () => state.surface, values: "Default | Grass | Stone_Hard", source: "stepsound.uax", status: "presentation" },
      { name: "footsteps.clip", value: () => { throw new Error("not loaded"); }, status: "native" },
    ];
  }

  it("opens a compact read-only card after a hover delay, with live values and no source details", () => {
    vi.useFakeTimers();
    const { sheet } = create();
    sheet.open();
    const state = { surface: "Grass" };
    const row = dom.document.createElement("div");
    sheet.section("audio", { title: "Audio" }).group("footsteps", "Footsteps").element.append(row as unknown as HTMLElement);
    sheet.describe(row as unknown as Element, { title: "Footstep surface", description: "Selects the stepsound group.", variables: variables(state) });
    const card = sheet.cards.element as unknown as FakeElement;
    fire(row, "pointerenter", { pointerType: "mouse" });
    vi.advanceTimersByTime(250);
    expect(card.hidden).toBe(true);
    vi.advanceTimersByTime(60);
    expect(card.hidden).toBe(false);
    expect(card.dataset.trigger).toBe("hover");
    expect(card.getAttribute("role")).toBe("tooltip");
    expect(row.getAttribute("aria-describedby")).toContain(card.id);
    expect(card.querySelector(".dev-hovercard-title")!.textContent).toBe("Footstep surface");
    expect(card.querySelector(".dev-hovercard-description")!.textContent).toBe("Selects the stepsound group.");
    // Names are whole tokens with break chances only after dots.
    const name = card.querySelector(".dev-variable-name code")!;
    expect(name.textContent).toBe("footsteps.surface");
    expect(name.querySelectorAll("wbr")).toHaveLength(1);
    const values = card.querySelectorAll(".dev-variable-value");
    expect(values.map(value => value.textContent)).toEqual(["Grass", "unavailable"]);
    expect(card.querySelectorAll(".dev-badge").map(badge => badge.textContent)).toEqual(["presentation choice", "native data"]);
    // Allowed/source text stays behind the (i) card's "details"; the hover card says so.
    expect(card.querySelector(".dev-variable-values")).toBeNull();
    expect(card.querySelector(".dev-hovercard-close")).toBeNull();
    expect(card.querySelector(".dev-hovercard-hint")!.textContent).toContain("allowed values and sources");
    state.surface = "Stone_Hard";
    vi.advanceTimersByTime(500);
    expect(values[0]!.textContent).toBe("Stone_Hard");
    fire(row, "pointerleave", { pointerType: "mouse" });
    vi.advanceTimersByTime(200);
    expect(card.hidden).toBe(true);
    expect(card.dataset.trigger).toBeUndefined();
    expect(row.hasAttribute("aria-describedby")).toBe(false);
  });

  it("collapses allowed values and sources behind details in the (i) card, which has a close button", () => {
    const { sheet } = create();
    sheet.open();
    const group = sheet.section("audio", { title: "Audio" }).group("footsteps", "Footsteps");
    const surface = group.choice({ label: "Surface", options: [{ value: "Grass", label: "Grass" }], variables: variables({ surface: "Grass" }) });
    const info = (surface.element as unknown as FakeElement).querySelector(".dev-info")!;
    info.click();
    const card = sheet.cards.element as unknown as FakeElement;
    expect(card.dataset.trigger).toBe("button");
    const details = card.querySelector(".dev-variable-meta details")!;
    expect(details.querySelector("summary")!.textContent).toBe("details");
    expect(card.querySelector(".dev-variable-values")!.textContent).toBe("Allowed Default | Grass | Stone_Hard");
    expect(card.querySelector(".dev-variable-source")!.textContent).toBe("Source stepsound.uax");
    expect(card.querySelector(".dev-hovercard-hint")).toBeNull();
    card.querySelector(".dev-hovercard-close")!.click();
    expect(card.hidden).toBe(true);
    expect(info.getAttribute("aria-expanded")).toBe("false");
  });

  it("never opens on hover for HUD buttons, hides a hover card when its anchor is pressed, and moves native titles aside", () => {
    vi.useFakeTimers();
    const { sheet, host } = create();
    const attack = dom.document.createElement("button"); attack.dataset.action = "attack"; attack.setAttribute("title", "Attack!");
    host.append(attack);
    const dispose = sheet.describe(attack as unknown as Element, { title: "Attack" }, { infoButton: "none" });
    expect(attack.hasAttribute("title")).toBe(false);
    expect(attack.getAttribute("data-dev-title")).toBe("Attack!");
    const card = sheet.cards.element as unknown as FakeElement;
    fire(attack, "pointerenter", { pointerType: "mouse" });
    vi.advanceTimersByTime(800);
    expect(card.hidden).toBe(true);
    // Keyboard focus still explains it; pressing the button dismisses the card.
    attack.focus(); vi.advanceTimersByTime(320);
    expect(card.hidden).toBe(false);
    expect(card.dataset.trigger).toBe("focus");
    fire(attack, "pointerdown", { pointerType: "mouse" });
    expect(card.hidden).toBe(true);
    // Long-press on touch opens the interactive card.
    fire(attack, "pointerdown", { pointerType: "touch", clientX: 4, clientY: 4 });
    vi.advanceTimersByTime(520);
    expect(card.hidden).toBe(false);
    expect(card.dataset.trigger).toBe("touch");
    // Plain HUD text (not a control) still opens on hover.
    const location = dom.document.createElement("div"); host.append(location);
    sheet.describe(location as unknown as Element, { title: "Location" }, { infoButton: "none" });
    fire(location, "pointerenter", { pointerType: "mouse" });
    vi.advanceTimersByTime(320);
    expect(sheet.cards.current).toBe(location);
    dispose();
    expect(attack.getAttribute("title")).toBe("Attack!");
    expect(attack.hasAttribute("data-dev-title")).toBe(false);
  });

  it("places phone sheet cards in the world above the sheet, capped to 40% of the viewport", () => {
    dom.window.innerWidth = 390; dom.window.innerHeight = 844;
    const { sheet, element } = create({ matchMedia: fakeMedia({ narrow: true }).matchMedia });
    sheet.open();
    element.rect = { left: 0, top: 404, width: 390, height: 440 };
    const group = sheet.section("audio", { title: "Audio" }).group("footsteps", "Footsteps");
    const row = group.readout({ label: "Ground", value: () => "terrain", hint: "Live support." });
    (row.element as unknown as FakeElement).rect = { left: 12, top: 600, width: 366, height: 44 };
    const card = sheet.cards.element as unknown as FakeElement;
    card.rect = { left: 0, top: 0, width: 320, height: 500 };
    ((row.element as unknown as FakeElement).querySelector(".dev-info")!).click();
    expect(card.dataset.placement).toBe("zone");
    // Bottom edge just above the sheet; never over the anchor or the sheet header.
    expect(card.style.bottom).toBe(`${844 - 396}px`);
    expect(card.style.top).toBe("auto");
    expect(card.style.maxHeight).toBe(`${Math.round(844 * .4)}px`);
  });

  it("opens from the (i) button or a long-press on touch, and dismisses outside or on Escape", () => {
    vi.useFakeTimers();
    const { sheet } = create();
    sheet.open();
    const group = sheet.section("audio", { title: "Audio" }).group("footsteps", "Footsteps");
    const onClick = vi.fn();
    const button = group.button({ label: "Play step", hint: "Plays one clip.", onClick });
    const info = (button as unknown as FakeElement).nextElementSibling!;
    expect(info.classList.contains("dev-info")).toBe(true);
    const card = sheet.cards.element as unknown as FakeElement;
    info.click();
    expect(card.hidden).toBe(false);
    expect(info.getAttribute("aria-expanded")).toBe("true");
    fire(dom.document.body, "pointerdown", { pointerType: "touch" });
    expect(card.hidden).toBe(true);
    fire(button as unknown as FakeElement, "pointerdown", { pointerType: "touch", clientX: 10, clientY: 10 });
    vi.advanceTimersByTime(520);
    expect(card.hidden).toBe(false);
    fire(button as unknown as FakeElement, "pointerup", { pointerType: "touch" });
    (button as unknown as FakeElement).click();
    expect(onClick).not.toHaveBeenCalled();
    fire(dom.document.body, "keydown", { key: "Escape" });
    expect(card.hidden).toBe(true);
    expect(sheet.isOpen).toBe(true);
    (button as unknown as FakeElement).click();
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("adds an (i) button to described legacy DOM inside the sheet but not to HUD elements", () => {
    const { sheet, host } = create();
    const legacy = dom.document.createElement("div"); const status = dom.document.createElement("p");
    legacy.append(status);
    sheet.section("audio", { title: "Audio" }).group("mix", "Mixer").element.append(legacy as unknown as HTMLElement);
    sheet.describe(legacy as unknown as Element, { title: "Mixer" });
    sheet.describe(status as unknown as Element, { title: "Status" });
    expect(legacy.querySelector(".dev-info-corner")).not.toBeNull();
    expect(status.nextElementSibling?.classList.contains("dev-info-after")).toBe(true);
    const fps = dom.document.createElement("output"); host.append(fps);
    const dispose = sheet.describe(fps as unknown as Element, { title: "FPS" });
    expect(fps.nextElementSibling).toBeNull();
    expect(fps.hasAttribute("data-dev-described")).toBe(true);
    dispose();
    expect(fps.hasAttribute("data-dev-described")).toBe(false);
  });
});

describe("developer sheet helpers", () => {
  it("renders choices as segmented controls, chips or selects with disabled options", () => {
    const { sheet } = create();
    const group = sheet.section("audio", { title: "Audio" }).group("footsteps", "Footsteps");
    const surfaces = ["Default", "Grass", "Stone", "Stone_Hard", "Stone_Gritty", "Carpet", "Dirt", "Gravel", "Ice", "Marsh", "Metal", "Sand", "Snow", "Wood", "Water_Shalow", "Water_Deep"];
    const onChange = vi.fn();
    const chips = group.choice({ label: "Surface", testId: "surface", value: "Grass", onChange,
      options: surfaces.map(value => ({ value, label: value, ...(value === "Ice" ? { disabled: true, hint: "No clips staged." } : {}) })) });
    const control = (chips.element as unknown as FakeElement).querySelector(".dev-choice")!;
    expect(control.dataset.display).toBe("chips");
    expect(control.getAttribute("role")).toBe("radiogroup");
    expect(control.children).toHaveLength(16);
    const ice = control.querySelector('[data-value="Ice"]')!;
    expect(ice.getAttribute("aria-disabled")).toBe("true");
    ice.click();
    expect(onChange).not.toHaveBeenCalled();
    control.querySelector('[data-value="Gravel"]')!.click();
    expect(onChange).toHaveBeenLastCalledWith("Gravel");
    expect(chips.value).toBe("Gravel");
    fire(control.querySelector('[data-value="Gravel"]')!, "keydown", { key: "ArrowRight" });
    expect(chips.value).toBe("Marsh");
    expect(control.querySelector('[data-value="Marsh"]')!.getAttribute("aria-checked")).toBe("true");
    const gait = group.choice({ label: "Gait", options: [{ value: "walk", label: "Walk" }, { value: "run", label: "Run" }] });
    expect((gait.element as unknown as FakeElement).querySelector(".dev-choice")!.dataset.display).toBe("segmented");
    const many = group.choice({ label: "Clip", options: Array.from({ length: 20 }, (_, index) => ({ value: String(index), label: `Clip ${index}` })) });
    const select = (many.element as unknown as FakeElement).querySelector("select")!;
    expect(select.options).toHaveLength(20);
    many.set("7");
    expect(select.value).toBe("7");
  });

  it("gives owner .dev-chips radiogroups arrow-key navigation through their own click handlers", () => {
    const { sheet } = create();
    sheet.open();
    const group = sheet.section("audio", { title: "Audio" }).group("ambience", "Ambience");
    const chips = dom.document.createElement("div"); chips.className = "dev-chips"; chips.setAttribute("role", "radiogroup");
    chips.setAttribute("aria-label", "Ambient time of day");
    const clicked: string[] = [];
    for (const [value, disabled] of [["day", false], ["night", true], ["all", false]] as const) {
      const chip = dom.document.createElement("button"); chip.type = "button"; chip.setAttribute("role", "radio");
      chip.setAttribute("aria-checked", String(value === "day")); chip.dataset.value = value; chip.textContent = value;
      if (disabled) chip.disabled = true;
      chip.addEventListener("click", () => {
        clicked.push(value);
        for (const item of chips.children) item.setAttribute("aria-checked", String(item === chip));
      });
      chips.append(chip);
    }
    group.element.append(chips as unknown as HTMLElement);
    const [day, , all] = chips.children;
    day!.focus();
    fire(day!, "keydown", { key: "ArrowRight" });
    // The disabled chip is skipped; the owner's click handler commits.
    expect(clicked).toEqual(["all"]);
    expect(dom.document.activeElement).toBe(all);
    expect(all!.getAttribute("aria-checked")).toBe("true");
    fire(all!, "keydown", { key: "Home" });
    expect(clicked).toEqual(["all", "day"]);
    // Plain buttons outside a .dev-chips group are left alone.
    const plain = dom.document.createElement("button"); plain.setAttribute("role", "radio"); group.element.append(plain as unknown as HTMLElement);
    const event = fire(plain, "keydown", { key: "ArrowRight" });
    expect(event.defaultPrevented).toBe(false);
  });

  it("wires toggles, sliders and readouts", () => {
    const { sheet } = create();
    sheet.open();
    const group = sheet.section("audio", { title: "Audio" }).group("mix", "Mixer");
    const onToggle = vi.fn();
    const mute = group.toggle({ label: "Mute", onChange: onToggle });
    (mute.control as unknown as FakeElement).click();
    expect(onToggle).toHaveBeenCalledWith(true);
    expect(mute.control.getAttribute("aria-checked")).toBe("true");
    expect(mute.control.getAttribute("role")).toBe("switch");
    const onInput = vi.fn();
    const volume = group.slider({ label: "Volume", min: 0, max: 100, value: 80, format: value => `${value}%`, onInput });
    const output = (volume.element as unknown as FakeElement).querySelector(".dev-range-value")!;
    expect(output.textContent).toBe("80%");
    (volume.input as unknown as FakeElement).value = "35"; fire(volume.input as unknown as FakeElement, "input");
    expect(onInput).toHaveBeenCalledWith(35);
    expect(output.textContent).toBe("35%");
    let active = 2;
    const readout = group.readout({ label: "Active sources", value: () => `${active} / 16` });
    expect(readout.output.textContent).toBe("2 / 16");
    active = 5; sheet.update(.1);
    expect(readout.output.textContent).toBe("2 / 16");
    sheet.update(.2);
    expect(readout.output.textContent).toBe("5 / 16");
    const note = group.note("Original clips only.", { tone: "status", testId: "mix-note" });
    expect(note.getAttribute("role")).toBe("status");
  });
});

describe("developer sheet geometry", () => {
  it("chooses the sheet mode from viewport and pointer", () => {
    expect(resolveSheetMode({ narrow: false, coarse: false, shortLandscape: false })).toBe("side");
    expect(resolveSheetMode({ narrow: true, coarse: false, shortLandscape: false })).toBe("bottom");
    expect(resolveSheetMode({ narrow: false, coarse: true, shortLandscape: false })).toBe("bottom");
    expect(resolveSheetMode({ narrow: false, coarse: true, shortLandscape: true })).toBe("side");
  });

  it("sizes snaps from the stage and both HUD reserves, honouring flicks", () => {
    expect(bottomSnapHeights(844, 120, 116, 80)).toEqual({ peek: 116, half: 464, full: 636 });
    // A 390x844 phone: ~120px of chrome leaves more than 60% of the half sheet for content.
    const phone = bottomSnapHeights(844, 120, 120, 80);
    expect((phone.half - 120) / phone.half).toBeGreaterThan(.6);
    const snaps = bottomSnapHeights(800, 90);
    expect(snaps).toEqual({ peek: 116, half: 440, full: 702 });
    expect(resolveSnapRelease(380, 0, snaps)).toBe("half");
    expect(resolveSnapRelease(380, 2, snaps)).toBe("full");
    expect(resolveSnapRelease(200, -2, snaps)).toBe("close");
    expect(resolveSnapRelease(40, 0, snaps)).toBe("close");
  });

  it("widens the desktop sheet with the stage within 380-520px", () => {
    expect(resolveSideSheetWidth(1024, false)).toBe(380);
    expect(resolveSideSheetWidth(1440, false)).toBe(432);
    expect(resolveSideSheetWidth(2560, false)).toBe(520);
    expect(resolveSideSheetWidth(844, true)).toBe(360);
  });

  it("keeps hover-cards inside the viewport and never over their anchor", () => {
    const viewport = { width: 390, height: 844 };
    expect(placeCard({ left: 950, top: 100, width: 300, height: 40 }, { width: 300, height: 200 }, { width: 1280, height: 800 }, ["left"]))
      .toMatchObject({ left: 642, top: 100, placement: "left", bottom: null });
    // HUD Attack at the bottom of a 900px desktop: a 550px card goes above,
    // anchored by its bottom edge and capped to the room, so growth cannot cover the button.
    const attack = { left: 520, top: 812, width: 76, height: 59 };
    const above = placeCard(attack, { width: 320, height: 550 }, { width: 1440, height: 900 }, ["above", "below"]);
    expect(above).toMatchObject({ placement: "above", bottom: 900 - (812 - 8), maxHeight: 812 - 16 });
    expect(above.top + Math.min(550, above.maxHeight)).toBeLessThanOrEqual(attack.top - 8);
    // No side fits: the roomiest side, capped (the card scrolls) instead of overlapping.
    const tight = placeCard({ left: 0, top: 300, width: 390, height: 300 }, { width: 340, height: 400 }, viewport, ["below"]);
    expect(tight).toMatchObject({ placement: "above", bottom: 844 - (300 - 8), maxHeight: 300 - 16 });
    expect(tight.top + tight.maxHeight).toBeLessThanOrEqual(300 - 8);
    const zone = placeCardInZone({ left: 300, top: 600, width: 60, height: 40 }, { width: 320, height: 500 }, { left: 8, top: 8, width: 374, height: 380 }, viewport, 337);
    expect(zone).toMatchObject({ placement: "zone", left: 62, bottom: 844 - 388, maxHeight: 337 });
    const placed = placeCard({ left: 10, top: 800, width: 370, height: 40 }, { width: 340, height: 300 }, viewport, ["below"]);
    expect(placed.placement).toBe("above");
    expect(placed.left + 340).toBeLessThanOrEqual(viewport.width - 8);
    expect(placed.top).toBeGreaterThanOrEqual(8);
    const clamped = placeCard({ left: 0, top: 0, width: 390, height: 844 }, { width: 600, height: 900 }, viewport, ["below"]);
    expect(clamped.left).toBe(8); expect(clamped.top).toBe(8);
  });
});
