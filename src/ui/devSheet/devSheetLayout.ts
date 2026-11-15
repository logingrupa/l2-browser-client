import type { DevSheetOptions } from "./DevSheet";
import type { DevSheetState } from "./devSheetState";
import { iconMarkup } from "./icons";
import { bottomSnapHeights, canDockSide, resolveSideSheetWidth, type Rect, type SnapHeights } from "./sheetGeometry";
import type { DevSheetMode } from "./types";

type DockAxis = "width" | "height";

const defaultPeekHeightPx = 116;
const minimumMeasuredChromeHeightPx = 40;
const peekChromePaddingPx = 8;
const minimumWorldHeightBesideDockPx = 96;
const cardZoneMarginPx = 8;
const fallbackStageWidthPx = 1280;
const fallbackStageHeightPx = 640;

export interface DevSheetLayoutContext {
  readonly options: Pick<DevSheetOptions, "host" | "canvas" | "toggle" | "topReserve" | "bottomReserve" | "onLayoutChange">;
  readonly state: DevSheetState;
  readonly sheet: HTMLElement;
  readonly toolbar: HTMLElement;
  readonly pinButton: HTMLButtonElement;
  readonly statusLine: HTMLElement;
  isDragMoved(): boolean;
  isFlashing(): boolean;
  updateTabFades(): void;
  positionCards(): void;
}

function readReserve(reserve: (() => number) | undefined): number {
  try { return Math.max(0, reserve?.() ?? 0); } catch { return 0; }
}

export class DevSheetLayout {
  mode: DevSheetMode = "side";
  shortLandscape = false;
  docked = false;
  dockAxis: DockAxis = "width";
  lift = 0;
  sheetHeight: number | null = null;
  sideWidth = 0;
  dragHeight: number | null = null;
  dispatchingResize = false;
  disposed = false;
  private dockedSize = 0;
  private canvasSizeBefore = "";
  private applying = false;
  private layoutPending = false;

  constructor(private readonly context: DevSheetLayoutContext) {}

  apply(): void {
    if (this.applying) { this.layoutPending = true; return; }
    this.applying = true;
    try {
      do { this.layoutPending = false; this.applyOnce(); } while (this.layoutPending && !this.disposed);
    } finally { this.applying = false; }
  }

  layoutName(): string {
    const { state } = this.context;
    return !state.open ? "closed" : this.docked ? "docked" : state.pinned ? "pinned" : "overlay";
  }

  statusText(): string {
    const { state } = this.context;
    return !state.open ? "Closed" : this.docked ? "Sticky · docked beside the world" :
      state.pinned ? "Sticky · stays open while you play" : "Auto-hide · tap the world to close";
  }

  snapHeights(): SnapHeights { return this.snapContext().snaps; }

  cardZone(anchor: Element): Rect | null {
    const { state, sheet, options } = this.context;
    if (this.mode !== "bottom" || !state.open || !sheet.contains(anchor) || typeof window === "undefined") return null;
    const bottomHud = readReserve(options.bottomReserve);
    const sheetTop = sheet.getBoundingClientRect().top, width = window.innerWidth || 0, top = cardZoneMarginPx;
    return { left: cardZoneMarginPx, top, width: Math.max(0, width - 2 * cardZoneMarginPx),
      height: Math.max(0, sheetTop - Math.max(cardZoneMarginPx, bottomHud) - top) };
  }

  setDocked(dock: boolean, axis: DockAxis, size: number): void {
    const { canvas, host } = this.context.options;
    if (!canvas || this.disposed) return;
    if (dock === this.docked && (!dock || (axis === this.dockAxis && size === this.dockedSize))) return;
    const style = canvas.style as CSSStyleDeclaration & Record<DockAxis, string>;
    if (this.docked) style[this.dockAxis] = this.canvasSizeBefore;
    if (dock) { this.canvasSizeBefore = style[axis]; style[axis] = `calc(100% - ${size}px)`; }
    this.docked = dock; this.dockAxis = axis; this.dockedSize = dock ? size : 0;
    if (dock) host.setAttribute("data-dev-docked", ""); else host.removeAttribute("data-dev-docked");
    if (dock && axis === "height") host.style.setProperty("--dev-sheet-dock", `${size}px`); else host.style.removeProperty("--dev-sheet-dock");
    this.notifyResize();
  }

  private notifyResize(): void {
    if (this.dispatchingResize) return;
    this.dispatchingResize = true;
    try { if (typeof window !== "undefined") window.dispatchEvent(new Event("resize")); }
    finally { this.dispatchingResize = false; }
    this.context.options.onLayoutChange?.();
  }

  private stageSize(): { width: number; height: number } {
    const { canvas, host } = this.context.options;
    const rect = canvas?.parentElement?.getBoundingClientRect();
    const fallbackWidth = typeof window !== "undefined" && window.innerWidth > 0 ? window.innerWidth : fallbackStageWidthPx;
    const fallbackHeight = typeof window !== "undefined" && window.innerHeight > 0 ? window.innerHeight :
      host.getBoundingClientRect().height || fallbackStageHeightPx;
    return { width: rect && rect.width > 0 ? rect.width : fallbackWidth, height: rect && rect.height > 0 ? rect.height : fallbackHeight };
  }

  private snapContext(): { snaps: SnapHeights; stageHeight: number } {
    const { state, sheet, toolbar, options } = this.context;
    const stage = this.stageSize();
    let peek = defaultPeekHeightPx;
    if (state.open) {
      const top = sheet.getBoundingClientRect().top, toolbarBottom = toolbar.getBoundingClientRect().bottom;
      if (toolbarBottom - top > minimumMeasuredChromeHeightPx) peek = Math.round(toolbarBottom - top + peekChromePaddingPx);
    }
    return { snaps: bottomSnapHeights(stage.height, readReserve(options.topReserve), peek, readReserve(options.bottomReserve)), stageHeight: stage.height };
  }

  private applyOnce(): void {
    const { state, sheet, options, pinButton, statusLine } = this.context;
    const { open, pinned, snap } = state, mode = this.mode, host = options.host;
    sheet.dataset.mode = mode; sheet.dataset.state = open ? "open" : "closed";
    sheet.dataset.pinned = String(pinned); sheet.dataset.snap = snap;
    if (open) sheet.removeAttribute("inert"); else sheet.setAttribute("inert", "");
    host.dataset.devSheetMode = mode;
    host.dataset.devSnap = snap;
    if (open) host.setAttribute("data-dev-sheet-open", ""); else host.removeAttribute("data-dev-sheet-open");
    const stage = this.stageSize(), width = resolveSideSheetWidth(stage.width, this.shortLandscape);
    host.style.setProperty("--dev-sheet-width", `${width}px`);
    this.sideWidth = width;
    const dragging = this.context.isDragMoved();
    let lift = 0, dock = false, axis: DockAxis = "width", size = width;
    if (mode === "bottom") {
      const { snaps, stageHeight } = this.snapContext(), settled = snaps[snap], height = Math.round(this.dragHeight ?? settled);
      host.style.setProperty("--dev-sheet-height", `${height}px`);
      this.sheetHeight = open ? height : null;
      axis = "height";
      if (dragging) { dock = this.docked && this.dockAxis === "height"; size = this.dockedSize; }
      else { dock = open && pinned && !!options.canvas && stageHeight - settled >= minimumWorldHeightBesideDockPx; size = settled; }
      if (open && !dock) lift = Math.round(Math.min(settled, snaps.full));
    } else {
      host.style.removeProperty("--dev-sheet-height");
      this.sheetHeight = null;
      dock = open && pinned && !!options.canvas && canDockSide(stage.width, width);
    }
    this.applyLift(lift);
    if (pinButton.getAttribute("aria-pressed") !== String(pinned)) {
      pinButton.setAttribute("aria-pressed", String(pinned));
      pinButton.innerHTML = `${iconMarkup(pinned ? "pinned" : "pin")}<span class="dev-pin-label" aria-hidden="true">Sticky</span>` +
        `<span class="dev-pin-state" aria-hidden="true">${pinned ? "On" : "Off"}</span>`;
    }
    options.toggle?.setAttribute("aria-expanded", String(open));
    this.setDocked(dock, axis, size);
    host.dataset.devSheet = this.layoutName();
    if (!this.context.isFlashing()) statusLine.textContent = this.statusText();
    this.context.updateTabFades();
    this.context.positionCards();
  }

  private applyLift(lift: number): void {
    if (lift === this.lift) return;
    const host = this.context.options.host;
    this.lift = lift;
    if (lift > 0) { host.style.setProperty("--dev-sheet-lift", `${lift}px`); host.setAttribute("data-dev-lift", ""); }
    else { host.style.removeProperty("--dev-sheet-lift"); host.removeAttribute("data-dev-lift"); }
  }
}
