import { placeCard, placeCardInZone, type CardPlacement, type Rect } from "./sheetGeometry";
import type { DevInfo, DevVariableStatus, VariableInfo } from "./types";

export interface DescribeOptions {
  infoButton?: "auto" | "none" | HTMLButtonElement;
}

export interface HoverCardOptions {
  placementFor?: (anchor: Element) => Exclude<CardPlacement, "zone">[];
  zoneFor?: (anchor: Element) => Rect | null;
  autoButton?: (element: Element) => boolean;
  hoverFor?: (anchor: Element) => boolean;
  openDelayMs?: number;
  refreshMs?: number;
  maxHeightFraction?: number;
}

type Trigger = "hover" | "focus" | "touch" | "button";

export const statusLabels: Record<DevVariableStatus, string> = {
  native: "native data", presentation: "presentation choice", unverified: "unverified",
};

const textContentOwnedTags = new Set(["INPUT", "SELECT", "TEXTAREA", "BUTTON", "OUTPUT", "P", "SPAN", "STRONG", "SMALL", "B", "EM",
  "H1", "H2", "H3", "H4", "H5", "H6", "IMG", "CANVAS", "A", "METER", "PROGRESS"]);

const minimumCardZoneHeight = 140;

let cardSequence = 0;

export function createInfoButton(title: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button"; button.className = "dev-info"; button.textContent = "i";
  button.setAttribute("aria-label", `About ${title}`); button.setAttribute("aria-expanded", "false");
  return button;
}

function readValue(variable: VariableInfo): string {
  try {
    const value = String(variable.value());
    return value.length > 240 ? `${value.slice(0, 239)}…` : value;
  } catch { return "unavailable"; }
}

function readVariables(info: DevInfo): VariableInfo[] {
  try { return info.variables?.() ?? []; } catch { return []; }
}

function rectOf(element: Element): Rect {
  const rect = element.getBoundingClientRect();
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

function codeBreakingOnlyAfterDots(name: string): HTMLElement {
  const code = document.createElement("code");
  const parts = name.split(".");
  parts.forEach((part, index) => {
    code.append(index < parts.length - 1 ? `${part}.` : part);
    if (index < parts.length - 1) code.append(document.createElement("wbr"));
  });
  return code;
}

interface Registration {
  info: DevInfo; button: HTMLButtonElement | null; ownsButton: boolean; lifetime: AbortController;
  movedNativeTitles: { element: Element; title: string }[];
}

export class DevHoverCards {
  readonly element = document.createElement("div");
  private readonly registrations = new WeakMap<Element, Registration>();
  private readonly lifetime = new AbortController();
  private anchor: Element | null = null;
  private trigger: Trigger | null = null;
  private showTimer: ReturnType<typeof setTimeout> | undefined;
  private hideTimer: ReturnType<typeof setTimeout> | undefined;
  private refreshTimer: ReturnType<typeof setInterval> | undefined;
  private values: { variable: VariableInfo; output: HTMLElement }[] = [];
  private readonly openDelay: number;
  private readonly refreshInterval: number;
  private readonly heightFraction: number;
  private readonly resizeObserver: ResizeObserver | null;
  private positioning = false;
  private lastSize = "";

  constructor(host: HTMLElement, private readonly options: HoverCardOptions = {}) {
    this.openDelay = options.openDelayMs ?? 300;
    this.refreshInterval = options.refreshMs ?? 500;
    this.heightFraction = options.maxHeightFraction ?? .4;
    this.element.className = "dev-hovercard";
    this.element.id = `dev-hovercard-${++cardSequence}`;
    this.element.setAttribute("role", "tooltip");
    this.element.dataset.testid = "dev-hovercard";
    this.element.hidden = true;
    host.append(this.element);
    this.resizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(() => {
      const rect = this.element.getBoundingClientRect(), size = `${Math.round(rect.width)}x${Math.round(rect.height)}`;
      if (size !== this.lastSize) this.position();
    }) : null;
    const signal = this.lifetime.signal;
    this.element.addEventListener("pointerenter", () => this.cancelHide(), { signal });
    this.element.addEventListener("pointerleave", event => {
      if (this.trigger === "hover" && (event as PointerEvent).pointerType !== "touch") this.scheduleHide(140);
    }, { signal });
    document.addEventListener("pointerdown", event => {
      if (!this.anchor || !(event.target instanceof Element)) return;
      const target = event.target, registration = this.registrations.get(this.anchor);
      if (this.element.contains(target) || registration?.button?.contains(target)) return;
      if (this.anchor.contains(target) && this.trigger !== "hover" && this.trigger !== "focus") return;
      this.hide();
    }, { signal, capture: true });
  }

  get isOpen(): boolean { return this.anchor !== null; }
  get current(): Element | null { return this.anchor; }
  get currentTrigger(): Trigger | null { return this.trigger; }
  info(element: Element): DevInfo | undefined { return this.registrations.get(element)?.info; }

  describe(element: Element, info: DevInfo, options: DescribeOptions = {}): () => void {
    const previous = this.registrations.get(element);
    previous?.lifetime.abort();
    const lifetime = new AbortController(), signal = lifetime.signal;
    let button: HTMLButtonElement | null = null, ownsButton = false;
    const mode = options.infoButton ?? "auto";
    if (typeof mode === "object") button = mode;
    else if (mode === "auto" && (this.options.autoButton?.(element) ?? false)) {
      button = createInfoButton(info.title); ownsButton = true;
      if (textContentOwnedTags.has(element.tagName)) {
        button.classList.add("dev-info-after");
        if (element.parentElement) element.after(button); else { button = null; ownsButton = false; }
      } else {
        if (element.tagName !== "LABEL") button.classList.add("dev-info-corner");
        element.append(button);
      }
    }
    if (button) {
      button.setAttribute("aria-label", `About ${info.title}`);
      button.setAttribute("aria-controls", this.element.id);
      button.addEventListener("click", event => {
        event.stopPropagation();
        if (this.anchor === element && this.trigger !== "hover" && this.trigger !== "focus") this.hide();
        else this.show(element, "button");
      }, { signal });
    }
    const titles = previous?.movedNativeTitles ?? [];
    for (const titled of [element, element.parentElement?.closest("label") ?? null]) {
      const title = titled?.getAttribute("title");
      if (!titled || !title) continue;
      titles.push({ element: titled, title });
      titled.setAttribute("data-dev-title", title); titled.removeAttribute("title");
    }
    const registration: Registration = { info, button, ownsButton, lifetime, movedNativeTitles: titles };
    this.registrations.set(element, registration);
    element.setAttribute("data-dev-search", [info.title, ...readVariables(info).map(variable => variable.name)].join(" "));
    element.setAttribute("data-dev-described", "");
    const targets: Element[] = button && !element.contains(button) ? [element, button] : [element];
    let pressTimer: ReturnType<typeof setTimeout> | undefined, pressX = 0, pressY = 0, suppressClick = false;
    const cancelPress = () => { if (pressTimer !== undefined) clearTimeout(pressTimer); pressTimer = undefined; };
    const hoverAllowed = () => this.options.hoverFor?.(element) ?? true;
    for (const target of targets) {
      target.addEventListener("pointerenter", event => {
        if ((event as PointerEvent).pointerType === "touch") return;
        if (target === element && !hoverAllowed()) return;
        this.cancelHide();
        if (this.anchor === element) return;
        this.scheduleShow(element, "hover");
      }, { signal });
      target.addEventListener("pointerleave", event => {
        if ((event as PointerEvent).pointerType === "touch") return;
        this.cancelShow();
        if (this.anchor === element && this.trigger === "hover") this.scheduleHide(140);
      }, { signal });
      target.addEventListener("focusin", event => {
        if (this.anchor === element && this.trigger !== "focus") return;
        let keyboard = true;
        try { keyboard = !(event.target instanceof Element) || event.target.matches(":focus-visible"); } catch { keyboard = true; }
        if (!keyboard) return;
        this.cancelHide();
        this.scheduleShow(element, "focus");
      }, { signal });
      target.addEventListener("focusout", event => {
        const next = (event as FocusEvent).relatedTarget;
        if (next instanceof Element && targets.some(item => item.contains(next))) return;
        this.cancelShow();
        if (this.anchor === element && this.trigger === "focus") this.scheduleHide(80);
      }, { signal });
    }
    element.addEventListener("pointerdown", event => {
      const pointer = event as PointerEvent;
      if (pointer.pointerType !== "touch" || (button && event.target instanceof Element && button.contains(event.target))) return;
      cancelPress(); pressX = pointer.clientX; pressY = pointer.clientY;
      pressTimer = setTimeout(() => { pressTimer = undefined; suppressClick = true; this.show(element, "touch"); }, 500);
    }, { signal, passive: true });
    element.addEventListener("pointermove", event => {
      const pointer = event as PointerEvent;
      if (pressTimer !== undefined && Math.hypot(pointer.clientX - pressX, pointer.clientY - pressY) > 10) cancelPress();
    }, { signal, passive: true });
    for (const type of ["pointerup", "pointercancel"]) element.addEventListener(type, cancelPress, { signal, passive: true });
    element.addEventListener("click", event => {
      if (!suppressClick) return;
      suppressClick = false; event.preventDefault(); event.stopImmediatePropagation();
    }, { signal, capture: true });
    element.addEventListener("contextmenu", event => { if (suppressClick || pressTimer !== undefined) event.preventDefault(); }, { signal });
    return () => {
      if (this.registrations.get(element) !== registration) return;
      if (this.anchor === element) this.hide();
      cancelPress(); lifetime.abort(); this.registrations.delete(element);
      element.removeAttribute("data-dev-described");
      for (const { element: titled, title } of titles) {
        if (titled.getAttribute("data-dev-title") === title) { titled.setAttribute("title", title); titled.removeAttribute("data-dev-title"); }
      }
      if (ownsButton) button?.remove();
    };
  }

  show(anchor: Element, trigger: Trigger = "button"): void {
    const registration = this.registrations.get(anchor);
    if (!registration || this.lifetime.signal.aborted) return;
    this.cancelShow(); this.cancelHide();
    if (this.anchor && this.anchor !== anchor) this.detachAnchor();
    this.anchor = anchor; this.trigger = trigger;
    this.element.dataset.trigger = trigger;
    this.render(registration.info, trigger === "button" || trigger === "touch", registration.button !== null);
    const described = (anchor.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean);
    if (!described.includes(this.element.id)) anchor.setAttribute("aria-describedby", [...described, this.element.id].join(" "));
    registration.button?.setAttribute("aria-expanded", "true");
    this.element.hidden = false;
    this.position();
    this.resizeObserver?.observe(this.element);
    if (this.refreshTimer === undefined) this.refreshTimer = setInterval(() => this.refresh(), this.refreshInterval);
  }

  hide(): void {
    this.cancelShow(); this.cancelHide();
    if (!this.anchor) return;
    this.detachAnchor();
    this.resizeObserver?.unobserve(this.element);
    this.element.hidden = true;
    this.element.replaceChildren();
    delete this.element.dataset.trigger;
    this.values = [];
    this.lastSize = "";
    if (this.refreshTimer !== undefined) clearInterval(this.refreshTimer);
    this.refreshTimer = undefined;
  }

  refresh(): void {
    if (!this.anchor) return;
    if (!this.anchor.isConnected) { this.hide(); return; }
    let changed = false;
    for (const { variable, output } of this.values) {
      const value = readValue(variable);
      if (output.textContent !== value) { output.textContent = value; changed = true; }
    }
    if (changed && !this.resizeObserver) this.position();
  }

  position(): void {
    if (!this.anchor || this.element.hidden || this.positioning) return;
    this.positioning = true;
    try {
      const style = this.element.style;
      const viewport = { width: window.innerWidth || 1024, height: window.innerHeight || 768 };
      const cap = Math.max(120, Math.round(viewport.height * this.heightFraction));
      Object.assign(style, { left: "0px", top: "0px", bottom: "auto", maxHeight: `${cap}px`, maxWidth: "", visibility: "hidden" });
      const card = this.element.getBoundingClientRect();
      const size = { width: card.width || 320, height: card.height || 160 };
      const anchor = rectOf(this.anchor);
      const zone = this.options.zoneFor?.(this.anchor) ?? null;
      const placed = zone && zone.height >= minimumCardZoneHeight && zone.width >= 200 ? placeCardInZone(anchor, size, zone, viewport, cap) :
        placeCard(anchor, size, viewport, this.options.placementFor?.(this.anchor) ?? ["below", "above", "right", "left"]);
      const maxHeight = Math.min(cap, placed.maxHeight), maxWidth = Math.min(placed.maxWidth, Math.ceil(size.width));
      Object.assign(style, { left: `${placed.left}px`, maxHeight: `${maxHeight}px`, maxWidth: `${maxWidth}px`, visibility: "" });
      if (placed.bottom !== null) Object.assign(style, { top: "auto", bottom: `${placed.bottom}px` });
      else Object.assign(style, { top: `${placed.top}px`, bottom: "auto" });
      this.element.dataset.placement = placed.placement;
      const final = this.element.getBoundingClientRect();
      this.lastSize = `${Math.round(final.width)}x${Math.round(final.height)}`;
    } finally { this.positioning = false; }
  }

  dispose(): void {
    this.hide();
    this.resizeObserver?.disconnect();
    this.lifetime.abort();
    this.element.remove();
  }

  private detachAnchor(): void {
    const anchor = this.anchor;
    if (!anchor) return;
    const remaining = (anchor.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(id => id && id !== this.element.id);
    if (remaining.length) anchor.setAttribute("aria-describedby", remaining.join(" "));
    else anchor.removeAttribute("aria-describedby");
    this.registrations.get(anchor)?.button?.setAttribute("aria-expanded", "false");
    this.anchor = null; this.trigger = null;
  }

  private render(info: DevInfo, interactive: boolean, hasInfoButton: boolean): void {
    const head = document.createElement("div"); head.className = "dev-hovercard-head";
    const title = document.createElement("strong"); title.className = "dev-hovercard-title"; title.textContent = info.title;
    head.append(title);
    if (interactive) {
      const close = document.createElement("button");
      close.type = "button"; close.className = "dev-hovercard-close"; close.setAttribute("aria-label", "Close");
      close.textContent = "×";
      close.addEventListener("click", event => { event.stopPropagation(); this.hide(); });
      head.append(close);
    }
    const parts: Element[] = [head];
    if (info.description) {
      const description = document.createElement("p"); description.className = "dev-hovercard-description";
      description.textContent = info.description; parts.push(description);
    }
    const variables = readVariables(info);
    this.values = [];
    let hiddenDetails = false;
    if (variables.length) {
      const list = document.createElement("dl"); list.className = "dev-variables"; list.setAttribute("aria-label", "Variables");
      for (const variable of variables) {
        const item = document.createElement("div"); item.className = "dev-variable"; item.dataset.variable = variable.name;
        const term = document.createElement("dt"); term.className = "dev-variable-name"; term.append(codeBreakingOnlyAfterDots(variable.name));
        const data = document.createElement("dd"); data.className = "dev-variable-data";
        const output = document.createElement("output"); output.className = "dev-variable-value"; output.textContent = readValue(variable);
        const badge = document.createElement("span"); badge.className = "dev-badge"; badge.dataset.status = variable.status;
        badge.textContent = statusLabels[variable.status] ?? variable.status;
        data.append(output, badge);
        item.append(term, data);
        const meta = ([["dev-variable-values", "Allowed", variable.values], ["dev-variable-source", "Source", variable.source]] as const)
          .filter(([, , text]) => Boolean(text));
        if (meta.length && interactive) {
          const metaCell = document.createElement("dd"); metaCell.className = "dev-variable-meta";
          const details = document.createElement("details"), summary = document.createElement("summary");
          summary.textContent = "details"; details.append(summary);
          for (const [className, caption, text] of meta) {
            const line = document.createElement("span"), term = document.createElement("span");
            line.className = className; term.className = "dev-meta-label"; term.textContent = caption;
            line.append(term, ` ${text}`); details.append(line);
          }
          metaCell.append(details); item.append(metaCell);
        } else if (meta.length) hiddenDetails = true;
        list.append(item);
        this.values.push({ variable, output });
      }
      parts.push(list);
    }
    if (!interactive && (hiddenDetails || (info.description?.length ?? 0) > 180)) {
      const hint = document.createElement("p"); hint.className = "dev-hovercard-hint";
      hint.textContent = hasInfoButton ? "(i) for allowed values and sources" : "Long-press (touch) for allowed values and sources";
      parts.push(hint);
    }
    this.element.replaceChildren(...parts);
  }

  private scheduleShow(anchor: Element, trigger: Trigger): void {
    this.cancelShow();
    this.showTimer = setTimeout(() => { this.showTimer = undefined; this.show(anchor, trigger); }, this.openDelay);
  }

  private cancelShow(): void { if (this.showTimer !== undefined) clearTimeout(this.showTimer); this.showTimer = undefined; }
  private scheduleHide(delay: number): void {
    this.cancelHide();
    this.hideTimer = setTimeout(() => { this.hideTimer = undefined; this.hide(); }, delay);
  }
  private cancelHide(): void { if (this.hideTimer !== undefined) clearTimeout(this.hideTimer); this.hideTimer = undefined; }
}
