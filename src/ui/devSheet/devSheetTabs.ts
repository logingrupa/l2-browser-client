import { applyRowFilter, clearRowFilter, matchesTokens, queryTokens, setFilteredOut } from "./devSheetFilter";
import type { DevSection } from "./devSheetParts";
import type { DevSheetState } from "./devSheetState";

const flashDurationMs = 2600;
const overflowThresholdPx = 2;

function scrollTabIntoView(tab: HTMLElement): void {
  try { tab.scrollIntoView?.({ block: "nearest", inline: "center" }); } catch { return; }
}

export interface DevSheetTabsContext {
  readonly sheet: HTMLElement;
  readonly body: HTMLElement;
  readonly empty: HTMLElement;
  readonly header: HTMLElement;
  readonly statusLine: HTMLElement;
  readonly state: DevSheetState;
  save(): void;
  statusText(): string;
}

export class DevSheetTabs {
  readonly element = document.createElement("div");
  readonly sectionMap = new Map<string, DevSection>();
  query = "";
  private tokens: string[] = [];
  private readonly sectionMatches = new Map<string, number>();
  private matchSignature = "";
  private flashTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly context: DevSheetTabsContext) {
    this.element.className = "dev-tabs"; this.element.setAttribute("role", "tablist"); this.element.setAttribute("aria-label", "Developer sections");
  }

  get filtering(): boolean { return this.tokens.length > 0; }
  get flashing(): boolean { return this.flashTimer !== undefined; }

  setQuery(query: string): void {
    this.query = query;
    this.tokens = queryTokens(query);
  }

  sections(): DevSection[] {
    return [...this.sectionMap.values()].sort((left, right) => left.order - right.order || left.index - right.index);
  }

  navigableSections(): DevSection[] {
    return this.sections().filter(section => !this.filtering || (this.sectionMatches.get(section.id) ?? 0) > 0);
  }

  effectiveSection(): DevSection | undefined {
    const desired = this.context.state.tab ? this.sectionMap.get(this.context.state.tab) : undefined;
    return desired ?? this.sections()[0];
  }

  activate(sectionId: string): void {
    const section = this.sectionMap.get(sectionId);
    if (!section) return;
    this.context.state.tab = sectionId; this.context.save();
    this.renderActivation();
    if (this.filtering) section.element.scrollIntoView?.({ block: "start" });
    else this.context.body.scrollTop = 0;
    this.revealTab(section);
  }

  renderSections(): void {
    const sorted = this.sections();
    this.element.append(...sorted.map(section => section.tab));
    this.context.body.append(...sorted.map(section => section.element), this.context.empty);
    this.renderActivation();
    this.updateTabFades();
  }

  applyFilter(): void {
    const tokens = this.tokens, filtering = this.filtering, { sheet, body, empty } = this.context;
    if (filtering) sheet.setAttribute("data-filtering", ""); else sheet.removeAttribute("data-filtering");
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
    if (!filtering) { clearRowFilter(body); this.matchSignature = ""; }
    else this.moveToFirstMatchingTab();
    empty.hidden = !filtering || total > 0;
    empty.textContent = filtering && total === 0 ? `No controls or variables match “${this.query.trim()}”.` : "";
    this.renderActivation();
    this.updateTabFades();
  }

  revealTab(section: DevSection): void {
    scrollTabIntoView(section.tab);
    this.updateTabFades();
  }

  updateTabFades(): void {
    const tabs = this.element as HTMLElement & { scrollLeft?: number; scrollWidth?: number; clientWidth?: number };
    const left = tabs.scrollLeft ?? 0, width = tabs.scrollWidth ?? 0, client = tabs.clientWidth ?? 0;
    const start = left > overflowThresholdPx, end = width - client - left > overflowThresholdPx;
    const value = start && end ? "both" : start ? "start" : end ? "end" : "";
    if (value) tabs.dataset.overflow = value; else delete tabs.dataset.overflow;
  }

  scrollTabsWithVerticalWheel(wheel: WheelEvent): void {
    const tabs = this.element;
    if (Math.abs(wheel.deltaY) <= Math.abs(wheel.deltaX) || tabs.scrollWidth <= tabs.clientWidth) return;
    tabs.scrollLeft += wheel.deltaY; wheel.preventDefault();
  }

  setFilterOpen(open: boolean): void {
    if (open) this.context.sheet.setAttribute("data-filter-open", ""); else this.context.sheet.removeAttribute("data-filter-open");
  }

  flash(text: string): void {
    const { header, statusLine } = this.context;
    this.stopFlash();
    header.setAttribute("data-flash", "");
    statusLine.textContent = text;
    this.flashTimer = setTimeout(() => {
      this.flashTimer = undefined;
      header.removeAttribute("data-flash");
      statusLine.textContent = this.context.statusText();
    }, flashDurationMs);
  }

  stopFlash(): void {
    if (this.flashTimer !== undefined) clearTimeout(this.flashTimer);
    this.flashTimer = undefined;
  }

  private renderActivation(): void {
    const active = this.effectiveSection(), filtering = this.filtering;
    for (const section of this.sectionMap.values()) {
      const selected = section === active;
      section.tab.setAttribute("aria-selected", String(selected));
      section.tab.tabIndex = selected ? 0 : -1;
      section.element.hidden = filtering ? (this.sectionMatches.get(section.id) ?? 0) === 0 : !selected;
    }
  }

  private moveToFirstMatchingTab(): void {
    const matching = this.sections().filter(section => (this.sectionMatches.get(section.id) ?? 0) > 0);
    const active = this.effectiveSection();
    if (matching.length && (!active || (this.sectionMatches.get(active.id) ?? 0) === 0)) { this.context.state.tab = matching[0]!.id; this.context.save(); }
    const signature = matching.map(section => section.id).join(",");
    if (signature === this.matchSignature) return;
    this.matchSignature = signature;
    const reveal = this.effectiveSection();
    if (reveal && matching.includes(reveal)) this.revealTab(reveal);
  }
}
