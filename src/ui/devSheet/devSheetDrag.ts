import type { DevSheetLayout } from "./devSheetLayout";
import type { DevSheetState } from "./devSheetState";
import { resolveSnapRelease } from "./sheetGeometry";
import type { DevSnap } from "./types";

interface PointerSample { readonly y: number; readonly t: number }

interface DragGesture {
  readonly pointerId: number;
  readonly startY: number;
  readonly startHeight: number;
  readonly samples: PointerSample[];
  moved: boolean;
}

const dragStartThresholdPx = 6;
const keptPointerSampleCount = 6;
const releaseVelocityWindowMs = 100;
const headerControlSelector = "button, input, select, textarea, a";

export interface DevSheetDragContext {
  readonly sheet: HTMLElement;
  readonly header: HTMLElement;
  readonly state: DevSheetState;
  readonly layout: DevSheetLayout;
  close(): void;
  setSnap(snap: DevSnap): void;
}

function capturePointer(handle: HTMLElement, pointerId: number): void {
  try { handle.setPointerCapture?.(pointerId); } catch { return; }
}

export class DevSheetDrag {
  private gesture: DragGesture | null = null;
  private suppressGripClick = false;

  constructor(private readonly context: DevSheetDragContext) {}

  get moved(): boolean { return this.gesture?.moved === true; }

  consumeSuppressedGripClick(): boolean {
    if (!this.suppressGripClick) return false;
    this.suppressGripClick = false;
    return true;
  }

  cancel(): void {
    this.gesture = null;
    this.context.layout.dragHeight = null;
    this.context.sheet.removeAttribute("data-dragging");
  }

  start(event: PointerEvent, handle: HTMLElement): void {
    const { layout, state, header } = this.context;
    if (layout.mode !== "bottom" || !state.open || event.button !== 0) return;
    const target = event.target instanceof Element ? event.target : null;
    if (handle === header && target?.closest(headerControlSelector)) return;
    const snaps = layout.snapHeights();
    this.gesture = { pointerId: event.pointerId, startY: event.clientY, startHeight: snaps[state.snap], samples: [{ y: event.clientY, t: event.timeStamp }], moved: false };
    capturePointer(handle, event.pointerId);
  }

  move(event: PointerEvent): void {
    const gesture = this.gesture, { layout, sheet } = this.context;
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const delta = gesture.startY - event.clientY;
    if (!gesture.moved && Math.abs(delta) < dragStartThresholdPx) return;
    if (!gesture.moved) { gesture.moved = true; sheet.setAttribute("data-dragging", ""); }
    const snaps = layout.snapHeights();
    layout.dragHeight = Math.max(0, Math.min(snaps.full, gesture.startHeight + delta));
    gesture.samples.push({ y: event.clientY, t: event.timeStamp });
    if (gesture.samples.length > keptPointerSampleCount) gesture.samples.shift();
    layout.apply();
  }

  end(event: PointerEvent, cancelled: boolean): void {
    const gesture = this.gesture, { layout, sheet, state } = this.context;
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    this.gesture = null;
    sheet.removeAttribute("data-dragging");
    if (!gesture.moved) { layout.dragHeight = null; return; }
    this.suppressGripClick = true;
    setTimeout(() => { this.suppressGripClick = false; }, 0);
    const height = layout.dragHeight ?? 0;
    layout.dragHeight = null;
    const last = { y: event.clientY, t: event.timeStamp };
    const first = gesture.samples.find(sample => last.t - sample.t <= releaseVelocityWindowMs) ?? last;
    const velocity = last.t > first.t ? (first.y - last.y) / (last.t - first.t) : 0;
    const result = cancelled ? state.snap : resolveSnapRelease(height, velocity, layout.snapHeights());
    if (result === "close") this.context.close();
    else this.context.setSnap(result);
  }
}
