import type { DevSnap } from "./types";

/** Per-viewer conveniences only. Storage may be missing, full or throw
 * (private windows, blocked site data); every access is guarded and the sheet
 * works identically with in-memory state. */
export interface DevSheetState {
  open: boolean;
  pinned: boolean;
  snap: DevSnap;
  tab: string | null;
  /** `section/group` -> collapsed; only groups the viewer toggled. */
  collapsed: Record<string, boolean>;
}

export type DevSheetStorage = Pick<Storage, "getItem" | "setItem">;

export const devSheetStorageKey = "l2.devSheet.v1";

/** Sticky by default (`pinned`, kept as the storage key; presentation
 * choice): opening the sheet docks it beside (desktop) or below (phone) the
 * world instead of covering it; Sticky off gives an auto-hiding overlay. */
export function defaultDevSheetState(): DevSheetState {
  return { open: false, pinned: true, snap: "half", tab: null, collapsed: {} };
}

/** `undefined` selects window.localStorage; `null` disables persistence. */
export function resolveDevSheetStorage(explicit?: DevSheetStorage | null): DevSheetStorage | null {
  if (explicit !== undefined) return explicit;
  try { return typeof window === "undefined" ? null : window.localStorage ?? null; }
  catch { return null; }
}

const snaps: readonly DevSnap[] = ["peek", "half", "full"];

export function readDevSheetState(storage: DevSheetStorage | null): DevSheetState {
  const state = defaultDevSheetState();
  if (!storage) return state;
  let parsed: unknown;
  try {
    const raw = storage.getItem(devSheetStorageKey);
    if (raw === null) return state;
    parsed = JSON.parse(raw);
  } catch { return state; }
  if (typeof parsed !== "object" || parsed === null) return state;
  const record = parsed as Record<string, unknown>;
  if (typeof record.open === "boolean") state.open = record.open;
  if (typeof record.pinned === "boolean") state.pinned = record.pinned;
  if (typeof record.snap === "string" && (snaps as readonly string[]).includes(record.snap)) state.snap = record.snap as DevSnap;
  if (typeof record.tab === "string" && record.tab.length <= 64) state.tab = record.tab;
  if (typeof record.collapsed === "object" && record.collapsed !== null && !Array.isArray(record.collapsed)) {
    for (const [key, value] of Object.entries(record.collapsed as Record<string, unknown>).slice(0, 200)) {
      if (key.length <= 160 && key !== "__proto__" && typeof value === "boolean") state.collapsed[key] = value;
    }
  }
  return state;
}

/** Returns false when storage refused the write; callers keep in-memory state. */
export function writeDevSheetState(storage: DevSheetStorage | null, state: DevSheetState): boolean {
  if (!storage) return false;
  try { storage.setItem(devSheetStorageKey, JSON.stringify(state)); return true; }
  catch { return false; }
}
