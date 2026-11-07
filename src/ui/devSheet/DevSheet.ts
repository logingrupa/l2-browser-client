/**
 * Developer sheet: the single home for developer/debug controls.
 *
 * Layout
 * - Desktop (fine pointer, >=760px) and short landscape: a right-side sheet
 *   (30% of the stage, 380–520px). Tabs sit in one scrolling row with edge
 *   fades; the filter row is below them.
 * - Phones (<760px or coarse pointer): a bottom sheet with compact chrome: a
 *   slim grip, a one-line header (title, Sticky, close) and one toolbar row
 *   (scrolling tabs + a search icon that expands into the filter). Snaps:
 *   peek (chrome only), half (55% of the stage), full (stops below the top
 *   HUD and above the HUD action bar, which stays visible and tappable).
 *   Drag or flick to resize; drag below peek to close. The grip also cycles
 *   snaps and answers ArrowUp/ArrowDown for keyboard users.
 * - The body is the only scroller. Sections are tabs; groups collapse.
 *
 * Sticky (header toggle, `data-testid="dev-sheet-pin"`; on by default)
 * - On: stays open while you play and docks: the 3D canvas shrinks (width on
 *   desktop, height on phones) and a window `resize` event is dispatched,
 *   which EngineHost turns into `engine.resize()`. The orbit camera keeps the
 *   fighter at the centre of the remaining view. Escape closes a sticky
 *   sheet only when focus is inside it.
 * - Off (auto-hide): an overlay. A pointerdown on the world canvas
 *   (`worldTargets`) or Escape closes it; the world still receives that
 *   pointer. Entity labels are not world taps: target, then "Despawn target".
 * - Either way the HUD stays clear: an undocked bottom sheet lifts the HUD
 *   via `--dev-sheet-lift`; an undocked side sheet pads the HUD.
 * - open / sticky / snap / active tab / collapsed groups persist in
 *   localStorage (`l2.devSheet.v1`); every storage access is guarded. The
 *   top/bottom HUD reserves are measured after layout (WorldInterface calls
 *   `layout()` from a ResizeObserver and after fonts load), also on reload.
 * - Keys: backtick toggles the sheet (not while typing), "/" focuses the
 *   filter, Escape closes cards, then clears the filter, then closes.
 *
 * API
 *   sheet.section(id, { title, icon?, order? }) -> DevSection (idempotent)
 *   section.group(id, title, { collapsed?, hint?, variables? }) -> DevGroup
 *   group.element                      plain host for existing control modules
 *   group.button / choice / toggle / slider / readout / note
 *       each takes { label, testId?, hint?, variables?: () => VariableInfo[] }
 *   sheet.describe(element, { title, description?, variables? }) -> dispose
 *       attaches a hover-card to ANY element (inside or outside the sheet)
 *   VariableInfo = { name, value: () => string, values?, source?,
 *                    status: "native" | "presentation" | "unverified" }
 *   Owner modules may render small choices (<=4 options) as
 *     <div class="dev-chips" role="radiogroup" aria-label="…">
 *       <button type="button" role="radio" aria-checked="true|false" data-value="…">…</button>
 *     </div>
 *   The sheet styles them and adds arrow-key navigation (it clicks the next
 *   enabled chip, so the owner's click handler stays the only commit path).
 */
import { applyRowFilter, clearRowFilter, matchesTokens, queryTokens, setFilteredOut } from "./devSheetFilter";
import { DevGroup, DevSection, type DevSheetParent } from "./devSheetParts";
import { defaultDevSheetState, readDevSheetState, resolveDevSheetStorage, writeDevSheetState, type DevSheetState, type DevSheetStorage } from "./devSheetState";
import { devSheetStyles } from "./devSheetStyles";
import { DevHoverCards, type DescribeOptions } from "./hoverCards";
import { iconMarkup } from "./icons";
import {
  bottomSnapHeights, canDockSide, nextSnap, resolveSheetMode, resolveSideSheetWidth, resolveSnapRelease, sheetMediaQueries, type Rect, type SnapHeights,
} from "./sheetGeometry";
import type { DevInfo, DevReadout, DevSectionOptions, DevSheetMode, DevSnap } from "./types";

export { DevGroup, DevSection };

export interface DevSheetOptions {
  /** Positioned container the sheet lives in (the HUD root). */
  host: HTMLElement;
  /** Docking shrinks this canvas while sticky (width on desktop, height on phones). */
  canvas?: HTMLCanvasElement | null;
  /** A pointerdown on these (the world canvas) closes an auto-hide sheet. */
  worldTargets?: readonly EventTarget[];
  /** HUD button that opens/closes the sheet. */
  toggle?: HTMLButtonElement | null;
  /** undefined: window.localStorage; null: no persistence. */
  storage?: DevSheetStorage | null;
  /** Injected for tests; defaults to window.matchMedia. */
  matchMedia?: ((query: string) => Pick<MediaQueryList, "matches"> & Partial<Pick<MediaQueryList, "addEventListener">>) | null;
  /** Distance from the stage top to the bottom of the top HUD (player panel,
   * location, target panel). The full bottom snap stops below it. */
  topReserve?: () => number;
  /** Height of the bottom HUD (action bar and anything that must stay
   * visible above a full bottom sheet), including its padding. */
  bottomReserve?: () => number;
  /** Called after docking/lift changes so the HUD can re-measure. */
  onLayoutChange?: () => void;
  title?: string;
}

export interface DevSheetInspection {
  open: boolean; pinned: boolean; sticky: boolean; mode: DevSheetMode; snap: DevSnap; docked: boolean; dock: "width" | "height" | null;
  /** Side sheet width (px). */
  width: number;
  /** Open bottom sheet height (px), else null. */
  height: number | null;
  lift: number; activeSection: string | null; sections: string[]; filter: string; persisted: boolean;
}

let sheetSequence = 0;

/** One-line explanation used by the Sticky hover-card and the header flash. */
export const stickyExplanation = "Sticky on keeps the sheet open while you play (the 3D view resizes beside it); off, a tap on the world closes it.";

function isTypingTarget(target: Element | null): boolean {
  if (!target) return false;
  if (target.tagName === "TEXTAREA" || target.tagName === "SELECT") return true;
  if (target.tagName === "INPUT") return !["range", "checkbox", "radio", "button", "submit", "reset", "color"].includes((target.getAttribute("type") ?? "text").toLowerCase());
  return (target as HTMLElement).isContentEditable === true;
}

const interactiveSelector = "button, a[href], input, select, textarea, summary, [role='button'], [role='radio'], [role='switch'], [role='tab']";

export class DevSheet implements DevSheetParent {
  readonly element = document.createElement("aside");
  readonly body = document.createElement("div");
  readonly cards: DevHoverCards;
  readonly filterInput = document.createElement("input");
  readonly filterClear = document.createElement("button");
  readonly pinButton = document.createElement("button");
  readonly closeButton = document.createElement("button");
  readonly grip = document.createElement("button");
  private readonly tabs = document.createElement("div");
  private readonly toolbar = document.createElement("div");
  private readonly filterBox = document.createElement("div");
  private readonly header = document.createElement("header");
  private readonly statusLine = document.createElement("span");
  private readonly empty = document.createElement("p");
  private readonly stylesheet = document.createElement("style");
  private readonly lifetime = new AbortController();
  private readonly storage: DevSheetStorage | null;
  private readonly state: DevSheetState;
  private readonly sectionMap = new Map<string, DevSection>();
  private readonly sectionMatches = new Map<string, number>();
  private readonly readouts = new Set<DevReadout>();
  private modeValue: DevSheetMode = "side";
  private shortLandscape = false;
  private docked = false;
  private dockAxis: "width" | "height" = "width";
  private dockedSize = 0;
  private canvasSizeBefore = "";
  private dispatchingResize = false;
  private applying = false;
  private layoutPending = false;
  private tokens: string[] = [];
  private query = "";
  private matchSignature = "";
  private refreshElapsed = 0;
  private drag: { pointerId: number; startY: number; startHeight: number; samples: { y: number; t: number }[]; moved: boolean } | null = null;
  private dragHeight: number | null = null;
  private suppressGripClick = false;
  private lift = 0;
  private sheetHeight: number | null = null;
  private sideWidth = 0;
  private persisted = true;
  private disposed = false;
  private flashTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly options: DevSheetOptions) {
    const signal = this.lifetime.signal, id = `dev-sheet-${++sheetSequence}`;
    this.storage = resolveDevSheetStorage(options.storage);
    this.state = this.storage ? readDevSheetState(this.storage) : defaultDevSheetState();
    this.stylesheet.textContent = devSheetStyles;
    this.stylesheet.dataset.devSheet = "";
    document.head?.append(this.stylesheet);

    const sheet = this.element;
    sheet.className = "dev-sheet"; sheet.id = id; sheet.dataset.testid = "dev-sheet";
    sheet.setAttribute("aria-label", options.title ?? "Developer sheet");
    this.grip.type = "button"; this.grip.className = "dev-sheet-grip"; this.grip.dataset.testid = "dev-sheet-grip";
    this.grip.setAttribute("aria-label", "Resize developer sheet");
    this.grip.setAttribute("aria-keyshortcuts", "ArrowUp ArrowDown");
    this.header.className = "dev-sheet-header";
    const heading = document.createElement("div"); heading.className = "dev-sheet-heading";
    heading.innerHTML = iconMarkup("sheet");
    const titles = document.createElement("div"); titles.className = "dev-sheet-titles";
    const title = document.createElement("h2"); title.textContent = options.title ?? "Developer";
    this.statusLine.className = "dev-sheet-status"; this.statusLine.dataset.testid = "dev-sheet-status";
    this.statusLine.setAttribute("aria-live", "polite");
    titles.append(title, this.statusLine); heading.append(titles);
    this.pinButton.type = "button"; this.pinButton.className = "dev-pin"; this.pinButton.dataset.testid = "dev-sheet-pin";
    // Constant accessible name; aria-pressed and the visible On/Off carry state.
    this.pinButton.setAttribute("aria-label", "Sticky");
    this.closeButton.type = "button"; this.closeButton.className = "dev-close"; this.closeButton.dataset.testid = "dev-sheet-close";
    this.closeButton.setAttribute("aria-label", "Close developer sheet"); this.closeButton.innerHTML = iconMarkup("close");
    this.header.append(heading, this.pinButton, this.closeButton);

    this.toolbar.className = "dev-sheet-toolbar";
    this.tabs.className = "dev-tabs"; this.tabs.setAttribute("role", "tablist"); this.tabs.setAttribute("aria-label", "Developer sections");
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
    this.toolbar.append(this.tabs, this.filterBox);

    this.body.className = "dev-sheet-body"; this.body.dataset.testid = "dev-sheet-body";
    this.empty.className = "dev-sheet-empty"; this.empty.hidden = true; this.empty.setAttribute("role", "status");
    this.body.append(this.empty);
    sheet.append(this.grip, this.header, this.toolbar, this.body);
    options.host.append(sheet);

    this.cards = new DevHoverCards(options.host, {
      autoButton: element => sheet.contains(element),
      // HUD action buttons never open a card on hover while playing; focus,
      // long-press and (i) still do. Sheet controls and plain HUD text do.
      hoverFor: anchor => sheet.contains(anchor) || !anchor.matches(interactiveSelector),
      zoneFor: anchor => this.cardZone(anchor),
      placementFor: anchor => sheet.contains(anchor) ? this.modeValue === "side" ? ["left", "below", "above"] : ["above", "below"] : ["above", "below", "left", "right"],
    });
    this.describe(this.pinButton, {
      title: "Sticky",
      description: stickyExplanation,
      variables: () => [
        { name: "devSheet.sticky", value: () => this.state.pinned ? "on" : "off", values: "on | off", source: "this browser (localStorage l2.devSheet.v1)", status: "presentation" },
        { name: "devSheet.layout", value: () => this.layoutName(), values: "closed | overlay | pinned | docked", source: "presentation choice: docking shrinks the 3D canvas", status: "presentation" },
        { name: "devSheet.mode", value: () => this.modeValue, values: "side | bottom", source: "viewport width, pointer type", status: "presentation" },
      ],
    }, { infoButton: "none" });

    const toggle = options.toggle ?? null;
    if (toggle) {
      toggle.setAttribute("aria-controls", id);
      toggle.setAttribute("aria-keyshortcuts", "`");
      toggle.addEventListener("click", () => this.toggle({ focus: true }), { signal });
    }
    this.pinButton.addEventListener("click", () => {
      this.setPinned(!this.state.pinned);
      this.flash(this.state.pinned ? "Sticky on · stays open while you play" : "Sticky off · tap the world to close");
    }, { signal });
    this.closeButton.addEventListener("click", () => this.close(), { signal });
    this.filterInput.addEventListener("input", () => this.setFilter(this.filterInput.value), { signal });
    this.filterBox.addEventListener("focusin", () => this.setFilterOpen(true), { signal });
    this.filterBox.addEventListener("focusout", event => {
      const next = (event as FocusEvent).relatedTarget;
      if (next instanceof Element && this.filterBox.contains(next)) return;
      if (!this.filterInput.value) this.setFilterOpen(false);
    }, { signal });
    this.filterClear.addEventListener("click", () => { this.setFilter(""); this.filterInput.focus({ preventScroll: true }); }, { signal });
    this.tabs.addEventListener("click", event => {
      const tab = event.target instanceof Element ? event.target.closest<HTMLElement>(".dev-tab") : null;
      if (tab?.dataset.section) this.activate(tab.dataset.section);
    }, { signal });
    this.tabs.addEventListener("keydown", event => this.handleTabKey(event), { signal });
    this.tabs.addEventListener("scroll", () => this.updateTabFades(), { signal, passive: true });
    // A vertical mouse wheel scrolls the single tab row sideways.
    this.tabs.addEventListener("wheel", event => {
      const wheel = event as WheelEvent, tabs = this.tabs;
      if (Math.abs(wheel.deltaY) <= Math.abs(wheel.deltaX) || tabs.scrollWidth <= tabs.clientWidth) return;
      tabs.scrollLeft += wheel.deltaY; wheel.preventDefault();
    }, { signal, passive: false });
    this.body.addEventListener("keydown", event => this.handleChipKey(event), { signal });
    this.grip.addEventListener("click", () => {
      if (this.suppressGripClick) { this.suppressGripClick = false; return; }
      this.setSnap(this.state.snap === "full" ? "peek" : nextSnap(this.state.snap, 1));
    }, { signal });
    this.grip.addEventListener("keydown", event => {
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
      event.preventDefault(); this.setSnap(nextSnap(this.state.snap, event.key === "ArrowUp" ? 1 : -1));
    }, { signal });
    for (const handle of [this.grip, this.header]) handle.addEventListener("pointerdown", event => this.startDrag(event as PointerEvent, handle), { signal });
    sheet.addEventListener("pointermove", event => this.moveDrag(event as PointerEvent), { signal });
    sheet.addEventListener("pointerup", event => this.endDrag(event as PointerEvent, false), { signal });
    sheet.addEventListener("pointercancel", event => this.endDrag(event as PointerEvent, true), { signal });
    for (const target of options.worldTargets ?? []) {
      target.addEventListener("pointerdown", () => { if (this.state.open && !this.state.pinned) this.close({ restoreFocus: false }); }, { signal, capture: true, passive: true });
    }
    document.addEventListener("keydown", event => this.handleKey(event), { signal });
    if (typeof window !== "undefined") window.addEventListener("resize", () => { if (!this.dispatchingResize) this.layout(); }, { signal });

    const matchMedia = options.matchMedia === undefined ? (typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia.bind(window) : null) : options.matchMedia;
    const lists = matchMedia ? {
      narrow: matchMedia(sheetMediaQueries.narrow), coarse: matchMedia(sheetMediaQueries.coarse), shortLandscape: matchMedia(sheetMediaQueries.shortLandscape),
    } : null;
    const readMedia = () => {
      const flags = { narrow: lists?.narrow.matches ?? false, coarse: lists?.coarse.matches ?? false, shortLandscape: lists?.shortLandscape.matches ?? false };
      this.shortLandscape = flags.shortLandscape;
      this.modeValue = resolveSheetMode(flags);
    };
    readMedia();
    for (const list of lists ? Object.values(lists) : []) list.addEventListener?.("change", () => { readMedia(); this.layout(); }, { signal });
    this.applyLayout();
  }

  get isOpen(): boolean { return this.state.open; }
  /** Sticky (historically "pinned"). */
  get isPinned(): boolean { return this.state.pinned; }
  get isSticky(): boolean { return this.state.pinned; }
  get isDocked(): boolean { return this.docked; }
  get mode(): DevSheetMode { return this.modeValue; }
  get snap(): DevSnap { return this.state.snap; }
  get filter(): string { return this.query; }
  get activeSection(): DevSection | undefined { return this.effectiveSection(); }

  /** Returns the existing section with this id (updating any given options),
   * or registers a new tab. */
  section(id: string, options?: DevSectionOptions): DevSection {
    const existing = this.sectionMap.get(id);
    if (existing) {
      if (options) { existing.update(options); this.renderSections(); }
      return existing;
    }
    const section = new DevSection(id, options ?? { title: id }, this.sectionMap.size, this);
    this.sectionMap.set(id, section);
    this.renderSections();
    return section;
  }

  sections(): DevSection[] {
    return [...this.sectionMap.values()].sort((left, right) => left.order - right.order || left.index - right.index);
  }

  describe(element: Element, info: DevInfo, options?: DescribeOptions): () => void {
    const dispose = this.cards.describe(element, info, options);
    this.contentChanged();
    return dispose;
  }

  open(options: { focus?: boolean } = {}): void {
    if (this.state.open || this.disposed) return;
    this.state.open = true; this.save(); this.applyLayout();
    if (options.focus) (this.effectiveSection()?.tab ?? this.closeButton).focus({ preventScroll: true });
  }

  close(options: { restoreFocus?: boolean } = {}): void {
    if (!this.state.open) return;
    const active = document.activeElement;
    const hadFocus = active instanceof Element && this.element.contains(active);
    this.state.open = false; this.drag = null; this.dragHeight = null;
    this.element.removeAttribute("data-dragging");
    this.cards.hide(); this.save(); this.applyLayout();
    if (hadFocus && options.restoreFocus !== false) this.options.toggle?.focus({ preventScroll: true });
  }

  toggle(options: { focus?: boolean } = {}): void {
    if (this.state.open) this.close(); else this.open(options);
  }

  /** Sticky on/off. */
  setPinned(pinned: boolean): void {
    if (this.state.pinned === pinned) return;
    this.state.pinned = pinned; this.save(); this.applyLayout();
  }

  setSticky(sticky: boolean): void { this.setPinned(sticky); }

  setSnap(snap: DevSnap): void {
    this.state.snap = snap; this.save(); this.applyLayout();
  }

  activate(sectionId: string): void {
    const section = this.sectionMap.get(sectionId);
    if (!section) return;
    this.state.tab = sectionId; this.save();
    this.renderActivation();
    if (this.tokens.length) section.element.scrollIntoView?.({ block: "start" });
    else this.body.scrollTop = 0;
    this.revealTab(section);
  }

  setFilter(query: string): void {
    this.query = query;
    this.tokens = queryTokens(query);
    if (this.filterInput.value !== query) this.filterInput.value = query;
    this.filterClear.hidden = query.length === 0;
    if (query.length) this.setFilterOpen(true);
    else if (document.activeElement !== this.filterInput) this.setFilterOpen(false);
    this.applyFilter();
  }

  /** Call from the frame loop; refreshes readouts and a live filter at 4 Hz
   * while the sheet is open. */
  update(deltaSeconds: number): void {
    if (!this.state.open) return;
    this.refreshElapsed += deltaSeconds;
    if (this.refreshElapsed < .25) return;
    this.refreshElapsed = 0;
    this.refresh();
    if (this.tokens.length) this.applyFilter();
  }

  refresh(): void {
    for (const readout of this.readouts) {
      if (!readout.element.isConnected) { this.readouts.delete(readout); continue; }
      readout.refresh();
    }
  }

  /** Re-measures after host bounds, HUD size or media changes. */
  layout(): void { if (!this.disposed) this.applyLayout(); }

  inspect(): DevSheetInspection {
    return {
      open: this.state.open, pinned: this.state.pinned, sticky: this.state.pinned, mode: this.modeValue, snap: this.state.snap,
      docked: this.docked, dock: this.docked ? this.dockAxis : null, width: this.sideWidth, height: this.sheetHeight, lift: this.lift,
      activeSection: this.effectiveSection()?.id ?? null, sections: this.sections().map(section => section.id), filter: this.query, persisted: this.persisted,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.setDocked(false, this.dockAxis, 0);
    this.disposed = true;
    if (this.flashTimer !== undefined) clearTimeout(this.flashTimer);
    this.lifetime.abort();
    this.cards.dispose();
    this.element.remove();
    this.stylesheet.remove();
    for (const property of ["--dev-sheet-width", "--dev-sheet-height", "--dev-sheet-lift", "--dev-sheet-dock"]) this.options.host.style.removeProperty(property);
    for (const attribute of ["data-dev-lift", "data-dev-docked", "data-dev-sheet", "data-dev-sheet-mode", "data-dev-sheet-open", "data-dev-snap"]) this.options.host.removeAttribute(attribute);
    this.options.toggle?.setAttribute("aria-expanded", "false");
  }

  // DevSheetParent
  isCollapsed(key: string, fallback: boolean): boolean { return this.state.collapsed[key] ?? fallback; }
  setCollapsed(key: string, collapsed: boolean): void { this.state.collapsed[key] = collapsed; this.save(); }
  registerReadout(readout: DevReadout): void { this.readouts.add(readout); }
  contentChanged(): void { if (this.tokens.length) this.applyFilter(); }

  private save(): void { this.persisted = writeDevSheetState(this.storage, this.state); }

  private effectiveSection(): DevSection | undefined {
    const desired = this.state.tab ? this.sectionMap.get(this.state.tab) : undefined;
    return desired ?? this.sections()[0];
  }

  private renderSections(): void {
    const sorted = this.sections();
    this.tabs.append(...sorted.map(section => section.tab));
    this.body.append(...sorted.map(section => section.element), this.empty);
    this.renderActivation();
    this.updateTabFades();
  }

  private renderActivation(): void {
    const active = this.effectiveSection(), filtering = this.tokens.length > 0;
    for (const section of this.sectionMap.values()) {
      const selected = section === active;
      section.tab.setAttribute("aria-selected", String(selected));
      section.tab.tabIndex = selected ? 0 : -1;
      section.element.hidden = filtering ? (this.sectionMatches.get(section.id) ?? 0) === 0 : !selected;
    }
  }

  private applyFilter(): void {
    const tokens = this.tokens, filtering = tokens.length > 0;
    if (filtering) this.element.setAttribute("data-filtering", ""); else this.element.removeAttribute("data-filtering");
    this.sectionMatches.clear();
    let total = 0;
    for (const section of this.sectionMap.values()) {
      if (!filtering) {
        section.tabCount.textContent = ""; section.tab.removeAttribute("data-matches");
        for (const group of section.groups()) group.count.textContent = "";
        continue;
      }
      const sectionForce = matchesTokens(`${section.title} ${section.id}`, tokens);
      let count = 0;
      for (const group of section.groups()) {
        const groupForce = sectionForce || matchesTokens(`${group.title} ${group.id}`, tokens);
        const matches = applyRowFilter(group.element, tokens, groupForce);
        setFilteredOut(group.root, matches === 0 && !groupForce);
        group.count.textContent = String(matches);
        count += matches === 0 && groupForce ? 1 : matches;
      }
      section.tabCount.textContent = String(count); section.tab.dataset.matches = String(count);
      this.sectionMatches.set(section.id, count);
      total += count;
    }
    if (!filtering) { clearRowFilter(this.body); this.matchSignature = ""; }
    else {
      // Jump to the first tab with matches: it becomes the active tab (so
      // clearing the filter lands there) and scrolls into view.
      const matching = this.sections().filter(section => (this.sectionMatches.get(section.id) ?? 0) > 0);
      const active = this.effectiveSection();
      if (matching.length && (!active || (this.sectionMatches.get(active.id) ?? 0) === 0)) { this.state.tab = matching[0]!.id; this.save(); }
      const signature = matching.map(section => section.id).join(",");
      if (signature !== this.matchSignature) {
        this.matchSignature = signature;
        const reveal = this.effectiveSection();
        if (reveal && matching.includes(reveal)) this.revealTab(reveal);
      }
    }
    this.empty.hidden = !filtering || total > 0;
    this.empty.textContent = filtering && total === 0 ? `No controls or variables match “${this.query.trim()}”.` : "";
    this.renderActivation();
    this.updateTabFades();
  }

  private revealTab(section: DevSection): void {
    try { section.tab.scrollIntoView?.({ block: "nearest", inline: "center" }); } catch { /* optional */ }
    this.updateTabFades();
  }

  /** Edge fades only on the sides that actually overflow. */
  private updateTabFades(): void {
    const tabs = this.tabs as HTMLElement & { scrollLeft?: number; scrollWidth?: number; clientWidth?: number };
    const left = tabs.scrollLeft ?? 0, width = tabs.scrollWidth ?? 0, client = tabs.clientWidth ?? 0;
    const start = left > 2, end = width - client - left > 2;
    const value = start && end ? "both" : start ? "start" : end ? "end" : "";
    if (value) tabs.dataset.overflow = value; else delete tabs.dataset.overflow;
  }

  private setFilterOpen(open: boolean): void {
    if (open) this.element.setAttribute("data-filter-open", ""); else this.element.removeAttribute("data-filter-open");
  }

  private flash(text: string): void {
    if (this.flashTimer !== undefined) clearTimeout(this.flashTimer);
    this.header.setAttribute("data-flash", "");
    this.statusLine.textContent = text;
    this.flashTimer = setTimeout(() => {
      this.flashTimer = undefined;
      this.header.removeAttribute("data-flash");
      this.statusLine.textContent = this.statusText();
    }, 2600);
  }

  private handleTabKey(event: KeyboardEvent): void {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    const sorted = this.sections().filter(section => !this.tokens.length || (this.sectionMatches.get(section.id) ?? 0) > 0);
    const current = this.effectiveSection();
    if (!sorted.length) return;
    event.preventDefault();
    const index = Math.max(0, sorted.findIndex(section => section === current));
    const next = event.key === "Home" ? 0 : event.key === "End" ? sorted.length - 1 :
      (index + (event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1) + sorted.length) % sorted.length;
    const section = sorted[next]!;
    this.activate(section.id); section.tab.focus();
  }

  /** Arrow keys inside an owner's `.dev-chips` radiogroup move to (and click)
   * the next enabled chip. */
  private handleChipKey(event: KeyboardEvent): void {
    if (!["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const target = event.target instanceof Element ? event.target : null;
    const chip = target?.closest<HTMLElement>("[role='radio']");
    const group = chip?.parentElement;
    if (!chip || !group || !group.classList.contains("dev-chips")) return;
    const chips = (Array.from(group.children) as HTMLElement[]).filter(item => item.getAttribute("role") === "radio" &&
      !item.hasAttribute("disabled") && item.getAttribute("aria-disabled") !== "true");
    if (!chips.length) return;
    event.preventDefault();
    const index = Math.max(0, chips.indexOf(chip));
    const next = event.key === "Home" ? 0 : event.key === "End" ? chips.length - 1 :
      (index + (event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1) + chips.length) % chips.length;
    const item = chips[next]!;
    item.focus();
    if (item.getAttribute("aria-checked") !== "true") item.click();
  }

  private handleKey(event: KeyboardEvent): void {
    if (event.defaultPrevented) return;
    const target = event.target instanceof Element ? event.target : null;
    if (event.key === "Escape") {
      if (target?.closest("dialog")) return;
      if (this.cards.isOpen) { this.cards.hide(); event.preventDefault(); return; }
      if (target === this.filterInput && this.filterInput.value) { this.setFilter(""); event.preventDefault(); return; }
      if (!this.state.open) return;
      if (this.state.pinned && !(target && this.element.contains(target))) return;
      event.preventDefault(); this.close();
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey || isTypingTarget(target) || target?.closest("dialog")) return;
    if (event.key === "`") { event.preventDefault(); this.toggle(); return; }
    if (event.key === "/" && this.state.open) { event.preventDefault(); this.setFilterOpen(true); this.filterInput.focus({ preventScroll: true }); }
  }

  private layoutName(): string {
    return !this.state.open ? "closed" : this.docked ? "docked" : this.state.pinned ? "pinned" : "overlay";
  }

  private statusText(): string {
    return !this.state.open ? "Closed" : this.docked ? "Sticky · docked beside the world" :
      this.state.pinned ? "Sticky · stays open while you play" : "Auto-hide · tap the world to close";
  }

  private stageSize(): { width: number; height: number } {
    const rect = this.options.canvas?.parentElement?.getBoundingClientRect();
    const fallbackWidth = typeof window !== "undefined" && window.innerWidth > 0 ? window.innerWidth : 1280;
    const fallbackHeight = typeof window !== "undefined" && window.innerHeight > 0 ? window.innerHeight :
      this.options.host.getBoundingClientRect().height || 640;
    return { width: rect && rect.width > 0 ? rect.width : fallbackWidth, height: rect && rect.height > 0 ? rect.height : fallbackHeight };
  }

  private snapHeights(): SnapHeights { return this.snapContext().snaps; }

  private snapContext(): { snaps: SnapHeights; stageHeight: number } {
    const stage = this.stageSize();
    let peek = 116;
    if (this.state.open) {
      const top = this.element.getBoundingClientRect().top, toolbar = this.toolbar.getBoundingClientRect().bottom;
      if (toolbar - top > 40) peek = Math.round(toolbar - top + 8);
    }
    const read = (reserve: (() => number) | undefined) => { try { return Math.max(0, reserve?.() ?? 0); } catch { return 0; } };
    return { snaps: bottomSnapHeights(stage.height, read(this.options.topReserve), peek, read(this.options.bottomReserve)), stageHeight: stage.height };
  }

  /** Phone bottom sheet: cards for sheet controls go in the world area above
   * the sheet and above the HUD action bar, so they never cover the sheet
   * header, the control, its anchor or the actions. (Too little room, as at
   * the full snap: the card falls back to placement beside its anchor.) */
  private cardZone(anchor: Element): Rect | null {
    if (this.modeValue !== "bottom" || !this.state.open || !this.element.contains(anchor) || typeof window === "undefined") return null;
    let bottomHud = 0;
    try { bottomHud = Math.max(0, this.options.bottomReserve?.() ?? 0); } catch { bottomHud = 0; }
    const sheetTop = this.element.getBoundingClientRect().top, width = window.innerWidth || 0, top = 8;
    return { left: 8, top, width: Math.max(0, width - 16), height: Math.max(0, sheetTop - Math.max(8, bottomHud) - top) };
  }

  private applyLayout(): void {
    if (this.applying) { this.layoutPending = true; return; }
    this.applying = true;
    try {
      do { this.layoutPending = false; this.applyLayoutOnce(); } while (this.layoutPending && !this.disposed);
    } finally { this.applying = false; }
  }

  private applyLayoutOnce(): void {
    const { open, pinned, snap } = this.state, mode = this.modeValue, sheet = this.element, host = this.options.host;
    sheet.dataset.mode = mode; sheet.dataset.state = open ? "open" : "closed";
    sheet.dataset.pinned = String(pinned); sheet.dataset.snap = snap;
    if (open) sheet.removeAttribute("inert"); else sheet.setAttribute("inert", "");
    // HUD compaction rules key off these; set them before measuring reserves.
    host.dataset.devSheetMode = mode;
    host.dataset.devSnap = snap;
    if (open) host.setAttribute("data-dev-sheet-open", ""); else host.removeAttribute("data-dev-sheet-open");
    const stage = this.stageSize(), width = resolveSideSheetWidth(stage.width, this.shortLandscape);
    host.style.setProperty("--dev-sheet-width", `${width}px`);
    this.sideWidth = width;
    const dragging = this.drag?.moved === true;
    let lift = 0, dock = false, axis: "width" | "height" = "width", size = width;
    if (mode === "bottom") {
      const { snaps, stageHeight } = this.snapContext(), settled = snaps[snap], height = Math.round(this.dragHeight ?? settled);
      host.style.setProperty("--dev-sheet-height", `${height}px`);
      this.sheetHeight = open ? height : null;
      axis = "height";
      if (dragging) { dock = this.docked && this.dockAxis === "height"; size = this.dockedSize; }
      else { dock = open && pinned && !!this.options.canvas && stageHeight - settled >= 96; size = settled; }
      // An undocked open sheet lifts the HUD to sit above it. The HUD stays
      // still while dragging and settles on the chosen snap; the cap (the
      // full snap) keeps the action bar between the top HUD and the sheet.
      if (open && !dock) lift = Math.round(Math.min(settled, snaps.full));
    } else {
      host.style.removeProperty("--dev-sheet-height");
      this.sheetHeight = null;
      dock = open && pinned && !!this.options.canvas && canDockSide(stage.width, width);
    }
    if (lift !== this.lift) {
      this.lift = lift;
      if (lift > 0) { host.style.setProperty("--dev-sheet-lift", `${lift}px`); host.setAttribute("data-dev-lift", ""); }
      else { host.style.removeProperty("--dev-sheet-lift"); host.removeAttribute("data-dev-lift"); }
    }
    if (this.pinButton.getAttribute("aria-pressed") !== String(pinned)) {
      this.pinButton.setAttribute("aria-pressed", String(pinned));
      this.pinButton.innerHTML = `${iconMarkup(pinned ? "pinned" : "pin")}<span class="dev-pin-label" aria-hidden="true">Sticky</span>` +
        `<span class="dev-pin-state" aria-hidden="true">${pinned ? "On" : "Off"}</span>`;
    }
    this.options.toggle?.setAttribute("aria-expanded", String(open));
    this.setDocked(dock, axis, size);
    host.dataset.devSheet = this.layoutName();
    if (this.flashTimer === undefined) this.statusLine.textContent = this.statusText();
    this.updateTabFades();
    this.cards.position();
  }

  private setDocked(dock: boolean, axis: "width" | "height", size: number): void {
    const canvas = this.options.canvas;
    if (!canvas || this.disposed) return;
    if (dock === this.docked && (!dock || (axis === this.dockAxis && size === this.dockedSize))) return;
    const style = canvas.style as CSSStyleDeclaration & Record<"width" | "height", string>;
    if (this.docked) style[this.dockAxis] = this.canvasSizeBefore;
    if (dock) { this.canvasSizeBefore = style[axis]; style[axis] = `calc(100% - ${size}px)`; }
    this.docked = dock; this.dockAxis = axis; this.dockedSize = dock ? size : 0;
    const host = this.options.host;
    if (dock) host.setAttribute("data-dev-docked", ""); else host.removeAttribute("data-dev-docked");
    if (dock && axis === "height") host.style.setProperty("--dev-sheet-dock", `${size}px`); else host.style.removeProperty("--dev-sheet-dock");
    this.notifyResize();
  }

  /** EngineHost resizes the engine on window `resize`; the canvas changed
   * size without the window doing so. */
  private notifyResize(): void {
    if (this.dispatchingResize) return;
    this.dispatchingResize = true;
    try { if (typeof window !== "undefined") window.dispatchEvent(new Event("resize")); }
    finally { this.dispatchingResize = false; }
    this.options.onLayoutChange?.();
  }

  private startDrag(event: PointerEvent, handle: HTMLElement): void {
    if (this.modeValue !== "bottom" || !this.state.open || event.button !== 0) return;
    const target = event.target instanceof Element ? event.target : null;
    if (handle === this.header && target?.closest("button, input, select, textarea, a")) return;
    const snaps = this.snapHeights();
    this.drag = { pointerId: event.pointerId, startY: event.clientY, startHeight: snaps[this.state.snap], samples: [{ y: event.clientY, t: event.timeStamp }], moved: false };
    try { handle.setPointerCapture?.(event.pointerId); } catch { /* capture is optional */ }
  }

  private moveDrag(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    const delta = drag.startY - event.clientY;
    if (!drag.moved && Math.abs(delta) < 6) return;
    if (!drag.moved) { drag.moved = true; this.element.setAttribute("data-dragging", ""); }
    const snaps = this.snapHeights();
    this.dragHeight = Math.max(0, Math.min(snaps.full, drag.startHeight + delta));
    drag.samples.push({ y: event.clientY, t: event.timeStamp });
    if (drag.samples.length > 6) drag.samples.shift();
    this.applyLayout();
  }

  private endDrag(event: PointerEvent, cancelled: boolean): void {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    this.drag = null;
    this.element.removeAttribute("data-dragging");
    if (!drag.moved) { this.dragHeight = null; return; }
    this.suppressGripClick = true;
    setTimeout(() => { this.suppressGripClick = false; }, 0);
    const height = this.dragHeight ?? 0;
    this.dragHeight = null;
    const last = { y: event.clientY, t: event.timeStamp };
    const first = drag.samples.find(sample => last.t - sample.t <= 100) ?? last;
    const velocity = last.t > first.t ? (first.y - last.y) / (last.t - first.t) : 0;
    const result = cancelled ? this.state.snap : resolveSnapRelease(height, velocity, this.snapHeights());
    if (result === "close") this.close();
    else this.setSnap(result);
  }
}
