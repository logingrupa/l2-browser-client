import { DevSheetDrag } from "./devSheetDrag";
import { handleChipKey, handleSheetKey, handleTabKey } from "./devSheetKeyboard";
import { DevSheetLayout } from "./devSheetLayout";
import { DevGroup, DevSection, type DevSheetParent } from "./devSheetParts";
import { defaultDevSheetState, readDevSheetState, resolveDevSheetStorage, writeDevSheetState, type DevSheetState, type DevSheetStorage } from "./devSheetState";
import { devSheetStyles } from "./devSheetStyles";
import { DevSheetTabs } from "./devSheetTabs";
import { DevHoverCards, type DescribeOptions } from "./hoverCards";
import { iconMarkup } from "./icons";
import { nextSnap, resolveSheetMode, sheetMediaQueries } from "./sheetGeometry";
import type { DevInfo, DevReadout, DevSectionOptions, DevSheetMode, DevSnap } from "./types";

export { DevGroup, DevSection };

export interface DevSheetOptions {
  host: HTMLElement;
  canvas?: HTMLCanvasElement | null;
  worldTargets?: readonly EventTarget[];
  toggle?: HTMLButtonElement | null;
  storage?: DevSheetStorage | null;
  matchMedia?: ((query: string) => Pick<MediaQueryList, "matches"> & Partial<Pick<MediaQueryList, "addEventListener">>) | null;
  topReserve?: () => number;
  bottomReserve?: () => number;
  onLayoutChange?: () => void;
  title?: string;
}

export interface DevSheetInspection {
  open: boolean; pinned: boolean; sticky: boolean; mode: DevSheetMode; snap: DevSnap; docked: boolean; dock: "width" | "height" | null;
  width: number; height: number | null;
  lift: number; activeSection: string | null; sections: string[]; filter: string; persisted: boolean;
}

let sheetSequence = 0;

export const stickyExplanation = "Sticky on keeps the sheet open while you play (the 3D view resizes beside it); off, a tap on the world closes it.";

const interactiveHudControlSelector = "button, a[href], input, select, textarea, summary, [role='button'], [role='radio'], [role='switch'], [role='tab']";
const readoutRefreshIntervalSeconds = .25;
const hostLayoutProperties = ["--dev-sheet-width", "--dev-sheet-height", "--dev-sheet-lift", "--dev-sheet-dock"];
const hostLayoutAttributes = ["data-dev-lift", "data-dev-docked", "data-dev-sheet", "data-dev-sheet-mode", "data-dev-sheet-open", "data-dev-snap"];

export class DevSheet implements DevSheetParent {
  readonly element = document.createElement("aside");
  readonly body = document.createElement("div");
  readonly cards: DevHoverCards;
  readonly filterInput = document.createElement("input");
  readonly filterClear = document.createElement("button");
  readonly pinButton = document.createElement("button");
  readonly closeButton = document.createElement("button");
  readonly grip = document.createElement("button");
  private readonly toolbar = document.createElement("div");
  private readonly filterBox = document.createElement("div");
  private readonly header = document.createElement("header");
  private readonly statusLine = document.createElement("span");
  private readonly empty = document.createElement("p");
  private readonly stylesheet = document.createElement("style");
  private readonly lifetime = new AbortController();
  private readonly storage: DevSheetStorage | null;
  private readonly state: DevSheetState;
  private readonly readouts = new Set<DevReadout>();
  private readonly sheetTabs: DevSheetTabs;
  private readonly sheetLayout: DevSheetLayout;
  private readonly sheetDrag: DevSheetDrag;
  private refreshElapsed = 0;
  private persisted = true;

  constructor(private readonly options: DevSheetOptions) {
    const signal = this.lifetime.signal, id = `dev-sheet-${++sheetSequence}`;
    this.storage = resolveDevSheetStorage(options.storage);
    this.state = this.storage ? readDevSheetState(this.storage) : defaultDevSheetState();
    this.stylesheet.textContent = devSheetStyles;
    this.stylesheet.dataset.devSheet = "";
    document.head?.append(this.stylesheet);
    const sheet = this.element;
    this.sheetTabs = new DevSheetTabs({ sheet, body: this.body, empty: this.empty, header: this.header, statusLine: this.statusLine, state: this.state,
      save: () => this.save(), statusText: () => this.sheetLayout.statusText() });
    this.sheetLayout = new DevSheetLayout({ options, state: this.state, sheet, toolbar: this.toolbar, pinButton: this.pinButton, statusLine: this.statusLine,
      isDragMoved: () => this.sheetDrag.moved, isFlashing: () => this.sheetTabs.flashing,
      updateTabFades: () => this.sheetTabs.updateTabFades(), positionCards: () => this.cards.position() });
    this.sheetDrag = new DevSheetDrag({ sheet, header: this.header, state: this.state, layout: this.sheetLayout,
      close: () => this.close(), setSnap: snap => this.setSnap(snap) });
    this.buildChrome(id);
    options.host.append(sheet);
    this.cards = new DevHoverCards(options.host, {
      autoButton: element => sheet.contains(element),
      hoverFor: anchor => sheet.contains(anchor) || !anchor.matches(interactiveHudControlSelector),
      zoneFor: anchor => this.sheetLayout.cardZone(anchor),
      placementFor: anchor => sheet.contains(anchor) ? this.sheetLayout.mode === "side" ? ["left", "below", "above"] : ["above", "below"] : ["above", "below", "left", "right"],
    });
    this.describe(this.pinButton, {
      title: "Sticky",
      description: stickyExplanation,
      variables: () => [
        { name: "devSheet.sticky", value: () => this.state.pinned ? "on" : "off", values: "on | off", source: "this browser (localStorage l2.devSheet.v1)", status: "presentation" },
        { name: "devSheet.layout", value: () => this.sheetLayout.layoutName(), values: "closed | overlay | pinned | docked", source: "presentation choice: docking shrinks the 3D canvas", status: "presentation" },
        { name: "devSheet.mode", value: () => this.sheetLayout.mode, values: "side | bottom", source: "viewport width, pointer type", status: "presentation" },
      ],
    }, { infoButton: "none" });
    this.listen(signal, id);
    this.watchMedia(signal);
    this.sheetLayout.apply();
  }

  get isOpen(): boolean { return this.state.open; }
  get isPinned(): boolean { return this.state.pinned; }
  get isSticky(): boolean { return this.state.pinned; }
  get isDocked(): boolean { return this.sheetLayout.docked; }
  get mode(): DevSheetMode { return this.sheetLayout.mode; }
  get snap(): DevSnap { return this.state.snap; }
  get filter(): string { return this.sheetTabs.query; }
  get activeSection(): DevSection | undefined { return this.sheetTabs.effectiveSection(); }

  section(id: string, options?: DevSectionOptions): DevSection {
    const existing = this.sheetTabs.sectionMap.get(id);
    if (existing) {
      if (options) { existing.update(options); this.sheetTabs.renderSections(); }
      return existing;
    }
    const section = new DevSection(id, options ?? { title: id }, this.sheetTabs.sectionMap.size, this);
    this.sheetTabs.sectionMap.set(id, section);
    this.sheetTabs.renderSections();
    return section;
  }

  sections(): DevSection[] { return this.sheetTabs.sections(); }

  describe(element: Element, info: DevInfo, options?: DescribeOptions): () => void {
    const dispose = this.cards.describe(element, info, options);
    this.contentChanged();
    return dispose;
  }

  open(options: { focus?: boolean } = {}): void {
    if (this.state.open || this.sheetLayout.disposed) return;
    this.state.open = true; this.save(); this.sheetLayout.apply();
    if (options.focus) (this.sheetTabs.effectiveSection()?.tab ?? this.closeButton).focus({ preventScroll: true });
  }

  close(options: { restoreFocus?: boolean } = {}): void {
    if (!this.state.open) return;
    const active = document.activeElement;
    const hadFocus = active instanceof Element && this.element.contains(active);
    this.state.open = false; this.sheetDrag.cancel();
    this.cards.hide(); this.save(); this.sheetLayout.apply();
    if (hadFocus && options.restoreFocus !== false) this.options.toggle?.focus({ preventScroll: true });
  }

  toggle(options: { focus?: boolean } = {}): void {
    if (this.state.open) this.close(); else this.open(options);
  }

  setPinned(pinned: boolean): void {
    if (this.state.pinned === pinned) return;
    this.state.pinned = pinned; this.save(); this.sheetLayout.apply();
  }

  setSticky(sticky: boolean): void { this.setPinned(sticky); }

  setSnap(snap: DevSnap): void {
    this.state.snap = snap; this.save(); this.sheetLayout.apply();
  }

  activate(sectionId: string): void { this.sheetTabs.activate(sectionId); }

  setFilter(query: string): void {
    this.sheetTabs.setQuery(query);
    if (this.filterInput.value !== query) this.filterInput.value = query;
    this.filterClear.hidden = query.length === 0;
    if (query.length) this.sheetTabs.setFilterOpen(true);
    else if (document.activeElement !== this.filterInput) this.sheetTabs.setFilterOpen(false);
    this.sheetTabs.applyFilter();
  }

  update(deltaSeconds: number): void {
    if (!this.state.open) return;
    this.refreshElapsed += deltaSeconds;
    if (this.refreshElapsed < readoutRefreshIntervalSeconds) return;
    this.refreshElapsed = 0;
    this.refresh();
    if (this.sheetTabs.filtering) this.sheetTabs.applyFilter();
  }

  refresh(): void {
    for (const readout of this.readouts) {
      if (!readout.element.isConnected) { this.readouts.delete(readout); continue; }
      readout.refresh();
    }
  }

  layout(): void { if (!this.sheetLayout.disposed) this.sheetLayout.apply(); }

  inspect(): DevSheetInspection {
    const layout = this.sheetLayout;
    return {
      open: this.state.open, pinned: this.state.pinned, sticky: this.state.pinned, mode: layout.mode, snap: this.state.snap,
      docked: layout.docked, dock: layout.docked ? layout.dockAxis : null, width: layout.sideWidth, height: layout.sheetHeight, lift: layout.lift,
      activeSection: this.sheetTabs.effectiveSection()?.id ?? null, sections: this.sections().map(section => section.id), filter: this.sheetTabs.query,
      persisted: this.persisted,
    };
  }

  dispose(): void {
    if (this.sheetLayout.disposed) return;
    this.sheetLayout.setDocked(false, this.sheetLayout.dockAxis, 0);
    this.sheetLayout.disposed = true;
    this.sheetTabs.stopFlash();
    this.lifetime.abort();
    this.cards.dispose();
    this.element.remove();
    this.stylesheet.remove();
    for (const property of hostLayoutProperties) this.options.host.style.removeProperty(property);
    for (const attribute of hostLayoutAttributes) this.options.host.removeAttribute(attribute);
    this.options.toggle?.setAttribute("aria-expanded", "false");
  }

  isCollapsed(key: string, fallback: boolean): boolean { return this.state.collapsed[key] ?? fallback; }
  setCollapsed(key: string, collapsed: boolean): void { this.state.collapsed[key] = collapsed; this.save(); }
  registerReadout(readout: DevReadout): void { this.readouts.add(readout); }
  contentChanged(): void { if (this.sheetTabs.filtering) this.sheetTabs.applyFilter(); }

  private save(): void { this.persisted = writeDevSheetState(this.storage, this.state); }

  private buildChrome(id: string): void {
    const sheet = this.element;
    sheet.className = "dev-sheet"; sheet.id = id; sheet.dataset.testid = "dev-sheet";
    sheet.setAttribute("aria-label", this.options.title ?? "Developer sheet");
    this.grip.type = "button"; this.grip.className = "dev-sheet-grip"; this.grip.dataset.testid = "dev-sheet-grip";
    this.grip.setAttribute("aria-label", "Resize developer sheet");
    this.grip.setAttribute("aria-keyshortcuts", "ArrowUp ArrowDown");
    this.header.className = "dev-sheet-header";
    const heading = document.createElement("div"); heading.className = "dev-sheet-heading";
    heading.innerHTML = iconMarkup("sheet");
    const titles = document.createElement("div"); titles.className = "dev-sheet-titles";
    const title = document.createElement("h2"); title.textContent = this.options.title ?? "Developer";
    this.statusLine.className = "dev-sheet-status"; this.statusLine.dataset.testid = "dev-sheet-status";
    this.statusLine.setAttribute("aria-live", "polite");
    titles.append(title, this.statusLine); heading.append(titles);
    this.pinButton.type = "button"; this.pinButton.className = "dev-pin"; this.pinButton.dataset.testid = "dev-sheet-pin";
    this.pinButton.setAttribute("aria-label", "Sticky");
    this.closeButton.type = "button"; this.closeButton.className = "dev-close"; this.closeButton.dataset.testid = "dev-sheet-close";
    this.closeButton.setAttribute("aria-label", "Close developer sheet"); this.closeButton.innerHTML = iconMarkup("close");
    this.header.append(heading, this.pinButton, this.closeButton);
    this.toolbar.className = "dev-sheet-toolbar";
    this.filterBox.className = "dev-filter";
    const field = document.createElement("label"); field.className = "dev-filter-field";
    field.innerHTML = iconMarkup("search");
    this.filterInput.type = "search"; this.filterInput.placeholder = "Filter controls or variables";
    this.filterInput.setAttribute("aria-label", "Filter controls or variables"); this.filterInput.dataset.testid = "dev-sheet-filter";
    this.filterInput.setAttribute("aria-keyshortcuts", "/");
    this.filterInput.setAttribute("autocomplete", "off"); this.filterInput.setAttribute("spellcheck", "false");
    this.filterInput.setAttribute("enterkeyhint", "search");
    field.append(this.filterInput);
    this.filterClear.type = "button"; this.filterClear.className = "dev-filter-clear"; this.filterClear.dataset.testid = "dev-sheet-filter-clear";
    this.filterClear.setAttribute("aria-label", "Clear filter"); this.filterClear.innerHTML = iconMarkup("close"); this.filterClear.hidden = true;
    this.filterBox.append(field, this.filterClear);
    this.toolbar.append(this.sheetTabs.element, this.filterBox);
    this.body.className = "dev-sheet-body"; this.body.dataset.testid = "dev-sheet-body";
    this.empty.className = "dev-sheet-empty"; this.empty.hidden = true; this.empty.setAttribute("role", "status");
    this.body.append(this.empty);
    sheet.append(this.grip, this.header, this.toolbar, this.body);
  }

  private listen(signal: AbortSignal, id: string): void {
    const toggle = this.options.toggle ?? null, tabs = this.sheetTabs, tabElement = tabs.element;
    if (toggle) {
      toggle.setAttribute("aria-controls", id);
      toggle.setAttribute("aria-keyshortcuts", "`");
      toggle.addEventListener("click", () => this.toggle({ focus: true }), { signal });
    }
    this.pinButton.addEventListener("click", () => {
      this.setPinned(!this.state.pinned);
      tabs.flash(this.state.pinned ? "Sticky on · stays open while you play" : "Sticky off · tap the world to close");
    }, { signal });
    this.closeButton.addEventListener("click", () => this.close(), { signal });
    this.filterInput.addEventListener("input", () => this.setFilter(this.filterInput.value), { signal });
    this.filterBox.addEventListener("focusin", () => tabs.setFilterOpen(true), { signal });
    this.filterBox.addEventListener("focusout", event => {
      const next = (event as FocusEvent).relatedTarget;
      if (next instanceof Element && this.filterBox.contains(next)) return;
      if (!this.filterInput.value) tabs.setFilterOpen(false);
    }, { signal });
    this.filterClear.addEventListener("click", () => { this.setFilter(""); this.filterInput.focus({ preventScroll: true }); }, { signal });
    tabElement.addEventListener("click", event => {
      const tab = event.target instanceof Element ? event.target.closest<HTMLElement>(".dev-tab") : null;
      if (tab?.dataset.section) this.activate(tab.dataset.section);
    }, { signal });
    tabElement.addEventListener("keydown", event => handleTabKey(event as KeyboardEvent, () => tabs.navigableSections(), () => tabs.effectiveSection(),
      sectionId => this.activate(sectionId)), { signal });
    tabElement.addEventListener("scroll", () => tabs.updateTabFades(), { signal, passive: true });
    tabElement.addEventListener("wheel", event => tabs.scrollTabsWithVerticalWheel(event as WheelEvent), { signal, passive: false });
    this.body.addEventListener("keydown", event => handleChipKey(event as KeyboardEvent), { signal });
    this.grip.addEventListener("click", () => {
      if (this.sheetDrag.consumeSuppressedGripClick()) return;
      this.setSnap(this.state.snap === "full" ? "peek" : nextSnap(this.state.snap, 1));
    }, { signal });
    this.grip.addEventListener("keydown", event => {
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
      event.preventDefault(); this.setSnap(nextSnap(this.state.snap, event.key === "ArrowUp" ? 1 : -1));
    }, { signal });
    for (const handle of [this.grip, this.header]) handle.addEventListener("pointerdown", event => this.sheetDrag.start(event as PointerEvent, handle), { signal });
    this.element.addEventListener("pointermove", event => this.sheetDrag.move(event as PointerEvent), { signal });
    this.element.addEventListener("pointerup", event => this.sheetDrag.end(event as PointerEvent, false), { signal });
    this.element.addEventListener("pointercancel", event => this.sheetDrag.end(event as PointerEvent, true), { signal });
    for (const target of this.options.worldTargets ?? []) {
      target.addEventListener("pointerdown", () => { if (this.state.open && !this.state.pinned) this.close({ restoreFocus: false }); }, { signal, capture: true, passive: true });
    }
    document.addEventListener("keydown", event => handleSheetKey(event, {
      state: this.state, sheet: this.element, filterInput: this.filterInput, cards: this.cards,
      setFilter: query => this.setFilter(query), close: () => this.close(), toggle: () => this.toggle(),
      openFilter: () => { tabs.setFilterOpen(true); this.filterInput.focus({ preventScroll: true }); },
    }), { signal });
    if (typeof window !== "undefined") window.addEventListener("resize", () => { if (!this.sheetLayout.dispatchingResize) this.layout(); }, { signal });
  }

  private watchMedia(signal: AbortSignal): void {
    const option = this.options.matchMedia;
    const matchMedia = option === undefined ? (typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia.bind(window) : null) : option;
    const lists = matchMedia ? {
      narrow: matchMedia(sheetMediaQueries.narrow), coarse: matchMedia(sheetMediaQueries.coarse), shortLandscape: matchMedia(sheetMediaQueries.shortLandscape),
    } : null;
    const readMedia = () => {
      const flags = { narrow: lists?.narrow.matches ?? false, coarse: lists?.coarse.matches ?? false, shortLandscape: lists?.shortLandscape.matches ?? false };
      this.sheetLayout.shortLandscape = flags.shortLandscape;
      this.sheetLayout.mode = resolveSheetMode(flags);
    };
    readMedia();
    for (const list of lists ? Object.values(lists) : []) list.addEventListener?.("change", () => { readMedia(); this.layout(); }, { signal });
  }
}
