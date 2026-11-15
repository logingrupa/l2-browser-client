import type { DevSheetMode, DevSnap } from "./types";

/** Pure layout rules for the developer sheet, kept DOM-free for unit tests. */

export interface SheetMediaFlags { narrow: boolean; coarse: boolean; shortLandscape: boolean }

export const sheetMediaQueries = {
  narrow: "(max-width: 759.98px)",
  coarse: "(pointer: coarse)",
  // A phone on its side: a bottom sheet would leave almost no world.
  shortLandscape: "(max-height: 500px) and (orientation: landscape) and (min-width: 560px)",
} as const;

/** Phones (<760px or coarse pointer) get a bottom sheet; short landscape and
 * desktop get a right-side sheet. */
export function resolveSheetMode(flags: SheetMediaFlags): DevSheetMode {
  if (flags.shortLandscape) return "side";
  return flags.narrow || flags.coarse ? "bottom" : "side";
}

export const sideSheetWidth = 380;
const maximumSideSheetWidth = 520;
const minimumDockedWorld = 400;

/** Desktop: 30% of the stage, clamped to 380–520px, so long readouts wrap
 * less on wide screens. Short landscape: at most 48% (max 360px). */
export function resolveSideSheetWidth(stageWidth: number, shortLandscape: boolean): number {
  const width = shortLandscape ? Math.min(360, Math.round(stageWidth * .48)) :
    Math.min(maximumSideSheetWidth, Math.max(sideSheetWidth, Math.round(stageWidth * .3)));
  return Math.max(260, Math.min(width, Math.round(stageWidth)));
}

/** Docking must leave a usable world beside the sheet; otherwise a pinned
 * sheet stays open as an overlay. */
export function canDockSide(stageWidth: number, width: number): boolean {
  return stageWidth - width >= Math.min(minimumDockedWorld, stageWidth * .45);
}

export interface SnapHeights { peek: number; half: number; full: number }

/** Half snap as a share of the stage. With the compact phone chrome (~120px)
 * a 390x844 phone gets a ~344px body at half: about 74% of the sheet. */
export const halfSnapFraction = .55;

/** stageHeight: the full world stage (not the HUD root, which shrinks while
 * docked); topReserve: bottom edge of the top HUD (player panel, location,
 * target) measured from the stage top; bottomReserve: the bottom HUD (action
 * bar) that must stay visible and tappable above the full snap. */
export function bottomSnapHeights(stageHeight: number, topReserve: number, peek = 116, bottomReserve = 0): SnapHeights {
  const full = Math.max(peek + 80, Math.round(stageHeight - Math.max(0, topReserve) - Math.max(0, bottomReserve) - 8));
  const half = Math.min(full - 40, Math.max(peek + 40, Math.round(stageHeight * halfSnapFraction)));
  return { peek, half: Math.max(peek, half), full };
}

/** velocity: px per ms, positive while growing (dragging up). A flick carries
 * the release ~180ms forward; releasing well below peek closes the sheet. */
export function resolveSnapRelease(height: number, velocity: number, snaps: SnapHeights): DevSnap | "close" {
  const projected = height + Math.max(-3, Math.min(3, velocity)) * 180;
  if (projected < snaps.peek * .55) return "close";
  let best: DevSnap = "peek", distance = Number.POSITIVE_INFINITY;
  for (const snap of ["peek", "half", "full"] as const) {
    const delta = Math.abs(snaps[snap] - projected);
    if (delta < distance) { best = snap; distance = delta; }
  }
  return best;
}

export function nextSnap(snap: DevSnap, direction: 1 | -1): DevSnap {
  const order: DevSnap[] = ["peek", "half", "full"];
  const index = Math.max(0, Math.min(order.length - 1, order.indexOf(snap) + direction));
  return order[index]!;
}

export interface Rect { left: number; top: number; width: number; height: number }
export type CardPlacement = "left" | "right" | "above" | "below" | "zone";

export interface PlacedCard {
  left: number;
  /** Top edge for below/left/right/zone placements. */
  top: number;
  /** Distance from the viewport bottom to the card's bottom edge for "above"
   * and "zone": growth then extends away from the anchor, never over it. */
  bottom: number | null;
  placement: CardPlacement;
  /** The room on the chosen side; the card scrolls inside it. */
  maxHeight: number;
  maxWidth: number;
}

/** Places a card next to its anchor, inside the viewport, and never over the
 * anchor: it takes the first preferred side that fits, otherwise the side
 * with the most room, and caps the card to that room (it scrolls inside). */
export function placeCard(anchor: Rect, size: { width: number; height: number }, viewport: { width: number; height: number },
  prefer: readonly Exclude<CardPlacement, "zone">[], margin = 8, gap = 8): PlacedCard {
  const width = Math.min(size.width, viewport.width - margin * 2), height = Math.min(size.height, viewport.height - margin * 2);
  const room: Record<Exclude<CardPlacement, "zone">, number> = {
    left: anchor.left - gap - margin, right: viewport.width - (anchor.left + anchor.width) - gap - margin,
    above: anchor.top - gap - margin, below: viewport.height - (anchor.top + anchor.height) - gap - margin,
  };
  const fits = (placement: Exclude<CardPlacement, "zone">) => placement === "left" || placement === "right" ? room[placement] >= width : room[placement] >= height;
  const order = [...prefer, ...(["below", "above", "right", "left"] as const).filter(item => !prefer.includes(item))];
  const placement = order.find(fits) ?? order.reduce((best, item) => room[item] > room[best] ? item : best, order[0]!);
  const clamp = (value: number, extent: number, limit: number) => Math.max(margin, Math.min(value, limit - margin - extent));
  if (room[placement] < 48) {
    // The anchor fills the viewport (no side has room): overlap, clamped inside.
    return { left: Math.round(clamp(anchor.left, width, viewport.width)), top: Math.round(clamp(anchor.top, height, viewport.height)), bottom: null,
      placement, maxHeight: Math.max(0, viewport.height - margin * 2), maxWidth: Math.max(0, viewport.width - margin * 2) };
  }
  const vertical = placement === "above" || placement === "below";
  const maxHeight = Math.max(0, Math.floor(vertical ? room[placement] : viewport.height - margin * 2));
  const maxWidth = Math.max(0, Math.floor(vertical ? viewport.width - margin * 2 : room[placement]));
  const cardWidth = Math.min(width, maxWidth), cardHeight = Math.min(height, maxHeight);
  if (vertical) {
    const left = Math.round(clamp(anchor.left, cardWidth, viewport.width));
    if (placement === "above") {
      const bottom = Math.round(viewport.height - (anchor.top - gap));
      return { left, top: Math.round(anchor.top - gap - cardHeight), bottom, placement, maxHeight, maxWidth };
    }
    return { left, top: Math.round(anchor.top + anchor.height + gap), bottom: null, placement, maxHeight, maxWidth };
  }
  const left = Math.round(placement === "left" ? anchor.left - gap - cardWidth : anchor.left + anchor.width + gap);
  return { left, top: Math.round(clamp(anchor.top, cardHeight, viewport.height)), bottom: null, placement, maxHeight, maxWidth };
}

/** Phone bottom sheet: cards for sheet controls sit in the world area above
 * the sheet (never over the sheet header, the control or its anchor), close
 * to the anchor horizontally, and grow upward from just above the sheet. */
export function placeCardInZone(anchor: Rect, size: { width: number; height: number }, zone: Rect,
  viewport: { width: number; height: number }, cap: number): PlacedCard {
  const maxWidth = Math.max(0, Math.floor(zone.width)), maxHeight = Math.max(0, Math.floor(Math.min(cap, zone.height)));
  const width = Math.min(size.width, maxWidth);
  const left = Math.round(Math.max(zone.left, Math.min(anchor.left, zone.left + zone.width - width)));
  const bottom = Math.round(viewport.height - (zone.top + zone.height));
  return { left, top: Math.round(zone.top + zone.height - Math.min(size.height, maxHeight)), bottom, placement: "zone", maxHeight, maxWidth };
}
