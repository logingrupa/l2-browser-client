import type { DevGroup, DevSheet } from "../ui/devSheet/DevSheet";
import type { DevInfo, DevVariableStatus, VariableInfo } from "../ui/devSheet/types";

/** Wording required wherever a browser rule stands in for an unproved native one. */
export const PRESENTATION_CHOICE = "presentation choice — native rule unverified";

/** Settled startup task: optional loaders must never reject the world. */
export type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };
export const settle = <T>(task: Promise<T>): Promise<Settled<T>> =>
  task.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
export const failureText = (error: unknown, fallback: string): string => error instanceof Error ? error.message : fallback;

/** Owner control modules describe rows with free-text evidence; the sheet
 * needs one of three badges. Anything not clearly native stays qualified. */
export function evidenceStatus(text: string): DevVariableStatus {
  if (/presentation|browser state|browser readout/i.test(text)) return "presentation";
  if (/unverified|unobserved|unproved|unrecovered|not staged|candidate/i.test(text)) return "unverified";
  return "native";
}

const camel = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+([a-z0-9])/g, (_, letter: string) => letter.toUpperCase()).replace(/[^a-zA-Z0-9]/g, "");

/** worldAudioControls describe() rows → hover-card variables. */
export function worldAudioVariables(rows: readonly { name: string; value(): string | number | boolean; values: string; source: string; status: string }[]): VariableInfo[] {
  return rows.map(row => ({ name: `audio.${camel(row.name)}`, value: () => String(row.value()), values: row.values,
    source: `${row.source}. ${row.status}`, status: evidenceStatus(row.status) }));
}

/** Rows already shaped like VariableInfo (footstep/combat owners), optionally with a detail note. */
export interface DescribedRow { readonly name: string; value(): string; readonly values?: string; readonly source?: string; readonly status: DevVariableStatus; readonly detail?: string }
export const pickRows = (rows: readonly DescribedRow[], names: readonly string[]): VariableInfo[] =>
  names.flatMap(name => rows.filter(row => row.name === name)).map(row => ({ name: row.name, value: () => row.value(),
    ...(row.values !== undefined ? { values: row.values } : {}), ...(row.source !== undefined ? { source: row.source } : {}), status: row.status }));

/** Attaches cards to existing module DOM. Every disposer joins `cleanup`. */
export class SheetDescriber {
  constructor(private readonly sheet: DevSheet, private readonly cleanup: (() => void)[]) {}

  element(element: Element | null | undefined, info: DevInfo, infoButton: "auto" | "none" = "auto"): void {
    if (element) this.cleanup.push(this.sheet.describe(element, info, { infoButton }));
  }

  testId(root: ParentNode | null | undefined, testId: string, info: DevInfo, infoButton: "auto" | "none" = "auto"): void {
    this.element(root?.querySelector?.(`[data-testid="${testId}"]`), info, infoButton);
  }

  /** Hides a static disclaimer and returns its text for a hover-card description. */
  fold(note: HTMLElement | null | undefined): string {
    if (!note) return "";
    const text = note.textContent?.trim() ?? "";
    note.hidden = true;
    return text;
  }
}

/** Live readout row with a hover-card. */
export function readout(group: DevGroup, label: string, value: () => string, testId: string, hint: string, variables?: () => VariableInfo[]) {
  return group.readout({ label, value, testId, hint, ...(variables ? { variables } : {}) });
}
