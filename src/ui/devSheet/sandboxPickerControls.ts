import { describeNativeCatalogLookup, tableCatalogKey, type NativeCatalogLookup } from "../../assets/native/nativeCatalogIndex";
import { nameIndexRecordId, type NativeTableNameEntry } from "../nativeTables/readNativeTableNameIndex";
import type { DevGroup } from "./devSheetParts";
import type { SandboxActionOutcome, SandboxPickerContext } from "./sandboxPickerHost";
import { matchNativeNameEntries, sandboxPickerMatchLimit } from "./sandboxPickerMatches";
import type { VariableInfo } from "./types";

export type SubmittedValues = Readonly<Record<string, number | string>>;

export const sandboxCatalogIndexSource = "nativeCatalogIndex over /l2/catalog.json and the gap rows of /l2/coverage.json";

export function submittedInteger(values: SubmittedValues, name: string): number {
  const value = values[name];
  if (typeof value !== "number") throw new Error(`Sandbox field ${name} was not submitted as an integer.`);
  return value;
}

export function submittedText(values: SubmittedValues, name: string): string {
  const value = values[name];
  if (typeof value !== "string") throw new Error(`Sandbox field ${name} was not submitted as text.`);
  return value;
}

export function outcomeOfLookup(lookup: NativeCatalogLookup): SandboxActionOutcome {
  return { tone: lookup.status === "converted" ? "info" : "warning", text: describeNativeCatalogLookup(lookup) };
}

export interface SandboxPickerLifetime {
  active(): boolean;
  release(): void;
}

export function startPickerLifetime(group: DevGroup): SandboxPickerLifetime {
  const nodesBeforeAttach = new Set<Element>(Array.from(group.element.children));
  let active = true;
  return {
    active: () => active,
    release: () => {
      if (!active) return;
      active = false;
      for (const node of Array.from(group.element.children)) if (!nodesBeforeAttach.has(node)) node.remove();
    },
  };
}

export interface SandboxResultNote {
  show(outcome: SandboxActionOutcome): void;
  current(): string;
}

export function createSandboxResultNote(group: DevGroup, lifetime: SandboxPickerLifetime, testId: string): SandboxResultNote {
  let note: HTMLParagraphElement | null = null;
  let currentText = "none";
  return {
    show(outcome) {
      if (!lifetime.active()) return;
      note?.remove();
      note = group.note(outcome.text, { tone: outcome.tone, testId });
      currentText = outcome.text;
    },
    current: () => currentText,
  };
}

export function lastLookupVariable(variablePrefix: string, result: SandboxResultNote, values: string): VariableInfo {
  return { name: `${variablePrefix}.lookup`, value: () => result.current(), values, source: sandboxCatalogIndexSource, status: "native" };
}

export interface SandboxCatalogKeyChoiceOptions {
  readonly group: DevGroup;
  readonly context: SandboxPickerContext;
  readonly lifetime: SandboxPickerLifetime;
  readonly keyPrefix: string;
  readonly label: string;
  readonly testId: string;
  readonly pickText: string;
  readonly onPick: (identifier: string) => void;
}

export interface SandboxCatalogKeyChoice {
  selectedKey(): string;
}

export function attachSandboxCatalogKeyChoice(options: SandboxCatalogKeyChoiceOptions): SandboxCatalogKeyChoice {
  const { group, context, lifetime, keyPrefix } = options;
  const keys = context.catalogIndex.keys(keyPrefix);
  if (keys.length === 0) {
    group.note(`The catalog index lists no ${keyPrefix} keys.`, { tone: "warning", testId: `${options.testId}-empty` });
    return { selectedKey: () => "none" };
  }
  const keyChoice = group.choice({
    label: options.label, testId: options.testId, display: "select",
    options: keys.map(key => ({ value: key, label: describeNativeCatalogLookup(context.catalogIndex.lookup(key)) })),
  });
  group.button({
    label: options.pickText, testId: `${options.testId}-pick`,
    onClick: () => { if (lifetime.active() && keyChoice.value.startsWith(keyPrefix)) options.onPick(keyChoice.value.slice(keyPrefix.length)); },
  });
  return { selectedKey: () => keyChoice.value || "none" };
}

export interface SandboxNameSearchOptions {
  readonly group: DevGroup;
  readonly context: SandboxPickerContext;
  readonly lifetime: SandboxPickerLifetime;
  readonly tableId: string;
  readonly variablePrefix: string;
  readonly label: string;
  readonly testId: string;
  readonly hint: string;
  readonly pickText: string;
  readonly catalogKeyValues: string;
  readonly catalogKeyOf: (entry: NativeTableNameEntry) => string | null;
  readonly onPick: (entry: NativeTableNameEntry) => void;
  readonly extraVariables: () => VariableInfo[];
}

export interface SandboxNameSearch {
  variables(): VariableInfo[];
}

export function failureText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function attachSandboxNameSearch(options: SandboxNameSearchOptions): SandboxNameSearch {
  const { group, context, lifetime, tableId, variablePrefix } = options;
  let query = "", indexStatus = "not read", searchSequence = 0;
  let matches: readonly NativeTableNameEntry[] = [];
  const selectedEntry = (): NativeTableNameEntry | null => matches[Number(matchChoice.value)] ?? null;
  const selectedKey = () => { const entry = selectedEntry(); return entry ? options.catalogKeyOf(entry) ?? "none" : "none"; };
  const variables = (): VariableInfo[] => [
    { name: `${variablePrefix}.query`, value: () => query || "none", values: "name substring | ID digits | none",
      source: "developer text input; names are matched case-insensitively and never changed", status: "presentation" },
    { name: `${variablePrefix}.selected`, value: selectedKey, values: options.catalogKeyValues,
      source: `${tableId} name index entry picked in the match list`, status: "native" },
    { name: `${variablePrefix}.nameIndex`, value: () => indexStatus,
      values: "not read | converted: <entries> entries | not-in-catalog: <reason> | failed: <error> | read stopped",
      source: `/l2/catalog.json tables record ${nameIndexRecordId(tableId)}, hash-checked`, status: "native" },
    { name: `${variablePrefix}.matchLimit`, value: () => String(sandboxPickerMatchLimit), values: String(sandboxPickerMatchLimit),
      source: "presentation choice: matches shown per search, ordered by ID, then level, then source order", status: "presentation" },
    ...options.extraVariables(),
  ];
  const entryLabel = (entry: NativeTableNameEntry): string => {
    const key = options.catalogKeyOf(entry);
    if (key === null) return `${entry.name} (identifiers ${entry.identifiers.join(":")} give no catalog key)`;
    return `${entry.name} (${describeNativeCatalogLookup(context.catalogIndex.lookup(key))})`;
  };
  const search = group.idEntry({
    label: options.label, testId: options.testId, submitText: "Find", hint: options.hint, variables,
    fields: [{ name: "query", label: "Name or ID", kind: "search" }],
    onSubmit: values => { void runSearch(submittedText(values, "query")); },
  });
  const matchChoice = group.choice({ label: "Matches", testId: `${options.testId}-matches`, display: "select", options: [] });
  const pickButton = group.button({
    label: options.pickText, testId: `${options.testId}-pick`, disabled: true,
    onClick: () => {
      const entry = selectedEntry();
      if (entry && lifetime.active() && options.catalogKeyOf(entry) !== null) options.onPick(entry);
    },
  });
  const showMatches = (next: readonly NativeTableNameEntry[]) => {
    matches = next;
    matchChoice.setOptions(next.map((entry, position) => ({
      value: String(position), label: entryLabel(entry), disabled: options.catalogKeyOf(entry) === null,
    })));
    matchChoice.set(next.length ? "0" : "");
    matchChoice.element.hidden = next.length === 0;
    pickButton.disabled = next.length === 0;
  };
  const runSearch = async (text: string) => {
    const sequence = ++searchSequence;
    query = text;
    const isCurrent = () => lifetime.active() && sequence === searchSequence;
    if (!text) {
      showMatches([]);
      search.setMessage(`Type a name or an ID to search ${tableId}.`);
      return;
    }
    try {
      const read = await context.readNameIndex(tableId, context.signal);
      if (!isCurrent()) return;
      if (read.status !== "converted") {
        showMatches([]);
        indexStatus = `not-in-catalog: ${read.reason}`;
        const tableLookup = describeNativeCatalogLookup(context.catalogIndex.lookup(tableCatalogKey(tableId)));
        search.setMessage(`${read.key} not in catalog: ${read.reason}; ${tableLookup}. ID entry still works.`);
        return;
      }
      indexStatus = `converted: ${read.entries.length} entries`;
      const found = matchNativeNameEntries(read.entries, text);
      showMatches(found.entries);
      search.setMessage(found.matchCount === 0 ? `No ${tableId} name or ID matches "${text}".`
        : `${found.entries.length} of ${found.matchCount} matches, ordered by ID.`);
    } catch (error) {
      if (!isCurrent()) return;
      showMatches([]);
      indexStatus = context.signal.aborted ? "read stopped" : `failed: ${failureText(error)}`;
      search.setMessage(context.signal.aborted ? `${tableId} name index read stopped.` : `${tableId} name index failed: ${failureText(error)}`);
    }
  };
  showMatches([]);
  return { variables };
}
