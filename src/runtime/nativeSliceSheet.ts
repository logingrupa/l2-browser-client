import type { DevGroup, DevSheet } from "../ui/devSheet/DevSheet";
import type { DevInfo, DevVariableStatus, VariableInfo } from "../ui/devSheet/types";
import type { EntityRegistry } from "../entities/EntityRegistry";

export const PRESENTATION_CHOICE = "presentation choice - native rule unverified";

export function evidenceStatus(text: string): DevVariableStatus {
  if (/presentation|browser state|browser readout/i.test(text)) return "presentation";
  if (/unverified|unobserved|unproved|unrecovered|not staged|candidate/i.test(text)) return "unverified";
  return "native";
}

const camelCaseIdentifier = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+([a-z0-9])/g, (_, letter: string) => letter.toUpperCase()).replace(/[^a-zA-Z0-9]/g, "");

export function worldAudioVariables(rows: readonly { name: string; value(): string | number | boolean; values: string; source: string; status: string }[]): VariableInfo[] {
  return rows.map(row => ({ name: `audio.${camelCaseIdentifier(row.name)}`, value: () => String(row.value()), values: row.values,
    source: `${row.source}. ${row.status}`, status: evidenceStatus(row.status) }));
}

export interface DescribedRow { readonly name: string; value(): string; readonly values?: string; readonly source?: string; readonly status: DevVariableStatus; readonly detail?: string }
export const pickRows = (rows: readonly DescribedRow[], names: readonly string[]): VariableInfo[] =>
  names.flatMap(name => rows.filter(row => row.name === name)).map(row => ({ name: row.name, value: () => row.value(),
    ...(row.values !== undefined ? { values: row.values } : {}), ...(row.source !== undefined ? { source: row.source } : {}), status: row.status }));

export class SheetDescriber {
  constructor(private readonly sheet: DevSheet, private readonly addRelease: (release: () => void) => void) {}

  element(element: Element | null | undefined, info: DevInfo, infoButton: "auto" | "none" = "auto"): void {
    if (element) this.addRelease(this.sheet.describe(element, info, { infoButton }));
  }

  testId(root: ParentNode | null | undefined, testId: string, info: DevInfo, infoButton: "auto" | "none" = "auto"): void {
    this.element(root?.querySelector?.(`[data-testid="${testId}"]`), info, infoButton);
  }

  foldStaticNoteIntoDescription(note: HTMLElement | null | undefined): string {
    if (!note) return "";
    const text = note.textContent?.trim() ?? "";
    note.hidden = true;
    return text;
  }
}

export function readout(group: DevGroup, label: string, value: () => string, testId: string, hint: string, variables?: () => VariableInfo[]) {
  return group.readout({ label, value, testId, hint, ...(variables ? { variables } : {}) });
}

export interface SheetButtonInfo { testId?: string; hint?: string; variables?: () => VariableInfo[]; disabled?: boolean }

export interface NativeSliceSheetTools {
  describe: SheetDescriber;
  events: AbortSignal;
  button(group: DevGroup, label: string, action: () => void, info?: SheetButtonInfo): HTMLElement;
  actorVariables(id: string, label: string): VariableInfo[];
}

export function createNativeSliceSheetTools(sheet: DevSheet, registry: EntityRegistry, events: AbortSignal,
  addRelease: (release: () => void) => void): NativeSliceSheetTools {
  const entityState = (id: string) => () => {
    const entity = registry.entity(id);
    return entity ? `${entity.animation}${entity.actionPreview ? ` (${entity.actionPreview})` : ""} · HP ${entity.health}/${entity.maximumHealth}` : "despawned";
  };
  const sourceClipOf = (id: string) => () => registry.sourceClock(id)?.clip ?? "-";
  return {
    describe: new SheetDescriber(sheet, addRelease),
    events,
    button(group, label, action, info = {}) {
      const element = group.button({ label, ...info });
      element.addEventListener("click", action, { signal: events });
      return element;
    },
    actorVariables: (id, label) => [
      { name: `${label}.state`, value: entityState(id), values: "idle | run | attack · HP (last requested action)", source: "NativeSliceAdapter (synthetic behavior); the clip actually playing is the .clip row", status: "presentation" },
      { name: `${label}.clip`, value: sourceClipOf(id), values: "original clip names", source: "actor package animation (source clock)", status: "native" },
    ],
  };
}
