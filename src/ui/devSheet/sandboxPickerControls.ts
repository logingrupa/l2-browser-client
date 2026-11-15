import { describeNativeCatalogLookup, tableCatalogKey, type NativeCatalogIndex, type NativeCatalogLookup } from "../../assets/native/nativeCatalogIndex";
import { nameIndexRecordId, type NativeTableNameEntry } from "../nativeTables/readNativeTableNameIndex";
import { devSheetComboboxRowLimit } from "./devSheetCombobox";
import type { DevGroup } from "./devSheetParts";
import type { SandboxActionOutcome, SandboxPickerContext } from "./sandboxPickerHost";
import type { DevCombobox, DevComboboxOption, DevComboboxOptionLoad, DevComboboxOptions, VariableInfo } from "./types";

export type SubmittedValues = Readonly<Record<string, number>>;

export const sandboxCatalogIndexSource = "nativeCatalogIndex over /l2/catalog.json and the gap rows of /l2/coverage.json";

export function submittedInteger(values: SubmittedValues, name: string): number {
  const value = values[name];
  if (value === undefined) throw new Error(`Sandbox field ${name} was not submitted.`);
  return value;
}

export function outcomeOfLookup(lookup: NativeCatalogLookup): SandboxActionOutcome {
  return { tone: lookup.status === "converted" ? "info" : "warning", text: describeNativeCatalogLookup(lookup) };
}

export function failureText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

function catalogStatusText(lookup: NativeCatalogLookup): string {
  return describeNativeCatalogLookup(lookup).slice(lookup.key.length + 1);
}

export function catalogKeyOption(identifier: string, lookup: NativeCatalogLookup): DevComboboxOption<string> {
  return { value: identifier, name: identifier, identifier: lookup.key, status: catalogStatusText(lookup), disabled: lookup.status === "gap" };
}

export function catalogKeyOptions(catalogIndex: NativeCatalogIndex, keyPrefix: string): readonly DevComboboxOption<string>[] {
  return catalogIndex.keys(keyPrefix).map(key => catalogKeyOption(key.slice(keyPrefix.length), catalogIndex.lookup(key)));
}

interface PickableComboboxOptions<Value> extends Omit<DevComboboxOptions<Value>, "onSelect" | "testId"> {
  readonly testId: string;
  readonly pickText: string;
  readonly onPick: (value: Value) => void;
}

function attachPickableCombobox<Value>(group: DevGroup, lifetime: SandboxPickerLifetime, options: PickableComboboxOptions<Value>): DevCombobox<Value> {
  const { pickText, onPick, ...comboboxOptions } = options;
  const combobox = group.combobox({ ...comboboxOptions, onSelect: option => { pickButton.disabled = option === null; } });
  const pickButton = group.button({
    label: pickText, testId: `${options.testId}-pick`, disabled: true,
    onClick: () => {
      const option = combobox.selected();
      if (option && lifetime.active()) onPick(option.value);
    },
  });
  return combobox;
}

export interface SandboxCatalogKeyComboboxOptions {
  readonly group: DevGroup;
  readonly lifetime: SandboxPickerLifetime;
  readonly catalogIndex: NativeCatalogIndex;
  readonly options: readonly DevComboboxOption<string>[];
  readonly identifierPattern: RegExp;
  readonly catalogKeyOf: (identifier: string) => string;
  readonly emptyText: string;
  readonly label: string;
  readonly placeholder: string;
  readonly testId: string;
  readonly hint: string;
  readonly pickText: string;
  readonly variables: () => VariableInfo[];
  readonly onPick: (identifier: string) => void;
}

export interface SandboxCatalogKeyCombobox {
  selectedKey(): string;
}

export function attachSandboxCatalogKeyCombobox(options: SandboxCatalogKeyComboboxOptions): SandboxCatalogKeyCombobox {
  const { group, catalogIndex } = options;
  if (options.options.length === 0) group.note(options.emptyText, { tone: "warning", testId: `${options.testId}-empty` });
  const typedOption = (query: string): DevComboboxOption<string> | null => {
    const identifier = query.trim();
    if (!options.identifierPattern.test(identifier)) return null;
    return catalogKeyOption(identifier, catalogIndex.lookup(options.catalogKeyOf(identifier)));
  };
  const combobox = attachPickableCombobox(group, options.lifetime, {
    label: options.label, testId: options.testId, hint: options.hint, variables: options.variables, placeholder: options.placeholder,
    options: options.options, typedOption, pickText: options.pickText, onPick: options.onPick,
  });
  return { selectedKey: () => combobox.selected()?.identifier ?? "none" };
}

export interface SandboxNameComboboxOptions {
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

export interface SandboxNameCombobox {
  variables(): VariableInfo[];
}

function compareNameEntries(left: NativeTableNameEntry, right: NativeTableNameEntry): number {
  const identifierCount = Math.max(left.identifiers.length, right.identifiers.length);
  for (let position = 0; position < identifierCount; position += 1) {
    const difference = (left.identifiers[position] ?? -1) - (right.identifiers[position] ?? -1);
    if (difference !== 0) return difference;
  }
  return left.sourceOrder - right.sourceOrder;
}

export function attachSandboxNameCombobox(options: SandboxNameComboboxOptions): SandboxNameCombobox {
  const { context, tableId, variablePrefix } = options;
  let indexStatus = "not read";
  const nameEntryOption = (entry: NativeTableNameEntry): DevComboboxOption<NativeTableNameEntry> => {
    const key = options.catalogKeyOf(entry);
    if (key === null) {
      return { value: entry, name: entry.name, identifier: `identifiers ${entry.identifiers.join(":")}`, status: "gives no catalog key", disabled: true };
    }
    const lookup = context.catalogIndex.lookup(key);
    return { value: entry, name: entry.name, identifier: key, status: catalogStatusText(lookup), disabled: lookup.status === "gap" };
  };
  const loadNameOptions = async (): Promise<DevComboboxOptionLoad<NativeTableNameEntry>> => {
    try {
      const read = await context.readNameIndex(tableId, context.signal);
      if (read.status !== "converted") {
        indexStatus = `not-in-catalog: ${read.reason}`;
        const tableLookup = describeNativeCatalogLookup(context.catalogIndex.lookup(tableCatalogKey(tableId)));
        return { status: "unavailable", message: `${read.key} not in catalog: ${read.reason}; ${tableLookup}. ID entry still works.` };
      }
      indexStatus = `converted: ${read.entries.length} entries`;
      return { status: "loaded", options: [...read.entries].sort(compareNameEntries).map(nameEntryOption) };
    } catch (error) {
      const stopped = context.signal.aborted;
      indexStatus = stopped ? "read stopped" : `failed: ${failureText(error)}`;
      return { status: "unavailable", message: stopped ? `${tableId} name index read stopped.` : `${tableId} name index failed: ${failureText(error)}` };
    }
  };
  const selectedKey = () => {
    const option = combobox.selected();
    return option ? options.catalogKeyOf(option.value) ?? "none" : "none";
  };
  const variables = (): VariableInfo[] => [
    { name: `${variablePrefix}.query`, value: () => combobox.query() || "none", values: "words of a name, ID or status | none",
      source: "developer text input; every word must occur in a row's name, ID or status, case-insensitively; names are never changed", status: "presentation" },
    { name: `${variablePrefix}.selected`, value: selectedKey, values: options.catalogKeyValues,
      source: `${tableId} name index entry picked in the list`, status: "native" },
    { name: `${variablePrefix}.nameIndex`, value: () => indexStatus,
      values: "not read | converted: <entries> entries | not-in-catalog: <reason> | failed: <error> | read stopped",
      source: `/l2/catalog.json tables record ${nameIndexRecordId(tableId)}, hash-checked, read on first focus`, status: "native" },
    { name: `${variablePrefix}.matchLimit`, value: () => String(devSheetComboboxRowLimit), values: String(devSheetComboboxRowLimit),
      source: "presentation choice: rows shown per query, ordered by ID, then level, then source order", status: "presentation" },
    ...options.extraVariables(),
  ];
  const combobox = attachPickableCombobox(options.group, options.lifetime, {
    label: options.label, testId: options.testId, hint: options.hint, variables, placeholder: "Name, ID or status",
    options: loadNameOptions, pickText: options.pickText, onPick: options.onPick,
  });
  return { variables };
}
