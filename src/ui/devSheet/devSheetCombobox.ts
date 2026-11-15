import { matchesTokens, queryTokens } from "./devSheetFilter";
import type { DevCombobox, DevComboboxOption, DevComboboxOptions } from "./types";

export const devSheetComboboxRowLimit = 50;
export const devSheetComboboxLoadingText = "Loading names";

type ComboboxLoadState = "idle" | "loading" | "loaded" | "unavailable";
type ActiveStepKey = "ArrowDown" | "ArrowUp" | "Home" | "End";

interface SearchableOption<Value> {
  readonly option: DevComboboxOption<Value>;
  readonly searchText: string;
}

interface VisibleOptions<Value> {
  readonly shown: readonly DevComboboxOption<Value>[];
  readonly hiddenCount: number;
  readonly matchCount: number;
}

export interface DevComboboxParts<Value> extends Omit<DevCombobox<Value>, "element"> {
  readonly control: HTMLElement;
}

let comboboxSequence = 0;

function searchableOptions<Value>(options: readonly DevComboboxOption<Value>[]): readonly SearchableOption<Value>[] {
  return options.map(option => ({ option, searchText: `${option.name} ${option.identifier} ${option.status}`.toLowerCase() }));
}

function textSpan(className: string, text: string): HTMLSpanElement {
  const span = document.createElement("span");
  span.className = className;
  span.textContent = text;
  return span;
}

function matchCountText(matchCount: number): string {
  return `${matchCount} ${matchCount === 1 ? "match" : "matches"}`;
}

export function createDevCombobox<Value>(options: DevComboboxOptions<Value>): DevComboboxParts<Value> {
  const sequence = ++comboboxSequence;
  const listboxId = `dev-combobox-${sequence}-list`;
  const optionSource = options.options;
  const control = document.createElement("div"); control.className = "dev-combobox";
  const input = document.createElement("input");
  input.type = "text"; input.className = "dev-combobox-input"; input.id = `dev-combobox-${sequence}-input`;
  input.autocomplete = "off"; input.spellcheck = false; input.placeholder = options.placeholder;
  input.setAttribute("role", "combobox"); input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-expanded", "false"); input.setAttribute("aria-controls", listboxId);
  const listbox = document.createElement("div");
  listbox.className = "dev-combobox-list"; listbox.id = listboxId; listbox.hidden = true;
  listbox.setAttribute("role", "listbox"); listbox.setAttribute("aria-label", options.label);
  const status = document.createElement("p");
  status.className = "dev-combobox-status"; status.setAttribute("aria-live", "polite"); status.hidden = true;
  if (options.testId) {
    input.dataset.testid = `${options.testId}-input`;
    listbox.dataset.testid = `${options.testId}-list`;
    status.dataset.testid = `${options.testId}-message`;
  }
  control.append(input, listbox, status);

  let loadState: ComboboxLoadState = typeof optionSource === "function" ? "idle" : "loaded";
  let searchable: readonly SearchableOption<Value>[] = typeof optionSource === "function" ? [] : searchableOptions(optionSource);
  let unavailableMessage = "";
  let expanded = false;
  let selectedOption: DevComboboxOption<Value> | null = null;
  let renderedOptions: readonly DevComboboxOption<Value>[] = [];
  let optionRows: HTMLElement[] = [];
  let activePosition = -1;

  const optionRowId = (position: number) => `${listboxId}-option-${position}`;

  const visibleOptions = (): VisibleOptions<Value> => {
    const tokens = queryTokens(input.value);
    const matches = searchable.filter(item => matchesTokens(item.searchText, tokens)).map(item => item.option);
    const typedOption = matches.length === 0 ? options.typedOption?.(input.value) ?? null : null;
    const all = typedOption ? [typedOption] : matches;
    return { shown: all.slice(0, devSheetComboboxRowLimit), hiddenCount: Math.max(0, all.length - devSheetComboboxRowLimit), matchCount: all.length };
  };

  const optionRow = (option: DevComboboxOption<Value>, position: number): HTMLElement => {
    const row = document.createElement("div");
    row.className = "dev-combobox-option"; row.id = optionRowId(position);
    row.setAttribute("role", "option"); row.setAttribute("aria-selected", "false");
    if (option.disabled) row.setAttribute("aria-disabled", "true");
    row.dataset.position = String(position);
    if (options.testId) row.dataset.testid = `${options.testId}-option-${position}`;
    row.append(textSpan("dev-combobox-option-name", option.name), " ", textSpan("dev-combobox-option-identifier", option.identifier), " ",
      textSpan("dev-combobox-option-status", option.status));
    return row;
  };

  const overflowRow = (hiddenCount: number): HTMLElement => {
    const row = document.createElement("div");
    row.className = "dev-combobox-more"; row.id = `${listboxId}-more`;
    row.setAttribute("role", "option"); row.setAttribute("aria-disabled", "true");
    if (options.testId) row.dataset.testid = `${options.testId}-more`;
    row.textContent = `${hiddenCount} more, keep typing`;
    return row;
  };

  const statusText = (matchCount: number): string | null => {
    if (loadState === "loading") return devSheetComboboxLoadingText;
    if (loadState === "unavailable") return unavailableMessage;
    if (loadState === "idle") return null;
    if (expanded) return matchCountText(matchCount);
    return selectedOption ? `${selectedOption.identifier} ${selectedOption.status}` : null;
  };

  const setActive = (position: number) => {
    activePosition = position;
    optionRows.forEach((row, rowPosition) => row.setAttribute("aria-selected", String(rowPosition === position)));
    const activeRow = optionRows[position];
    if (!activeRow) { input.removeAttribute("aria-activedescendant"); return; }
    input.setAttribute("aria-activedescendant", activeRow.id);
    activeRow.scrollIntoView({ block: "nearest" });
  };

  const enabledPositions = (): number[] => renderedOptions.flatMap((option, position) => option.disabled ? [] : [position]);

  const render = () => {
    const visible: VisibleOptions<Value> = expanded && loadState === "loaded" ? visibleOptions() : { shown: [], hiddenCount: 0, matchCount: 0 };
    renderedOptions = visible.shown;
    optionRows = visible.shown.map(optionRow);
    const rows = visible.hiddenCount > 0 ? [...optionRows, overflowRow(visible.hiddenCount)] : optionRows;
    listbox.replaceChildren(...rows);
    listbox.hidden = rows.length === 0;
    input.setAttribute("aria-expanded", String(!listbox.hidden));
    const text = statusText(visible.matchCount);
    status.textContent = text ?? ""; status.hidden = text === null;
    const pickedPosition = renderedOptions.findIndex(option => option === selectedOption);
    setActive(pickedPosition >= 0 ? pickedPosition : enabledPositions()[0] ?? -1);
  };

  const showUnavailable = (message: string) => {
    loadState = "unavailable";
    unavailableMessage = message;
    render();
  };

  const ensureLoaded = () => {
    if (loadState !== "idle" || typeof optionSource !== "function") return;
    loadState = "loading";
    render();
    void optionSource().then(load => {
      if (load.status === "unavailable") { showUnavailable(load.message); return; }
      loadState = "loaded";
      searchable = searchableOptions(load.options);
      render();
    }, (failure: unknown) => showUnavailable(`Names failed to load: ${failure instanceof Error ? failure.message : String(failure)}`));
  };

  const setExpanded = (next: boolean) => {
    expanded = next;
    if (next) ensureLoaded();
    render();
  };

  const stepActive = (key: ActiveStepKey) => {
    const positions = enabledPositions();
    const lastIndex = positions.length - 1;
    if (lastIndex < 0) return;
    const current = positions.indexOf(activePosition);
    const nextIndex = key === "Home" ? 0 : key === "End" ? lastIndex
      : current < 0 ? (key === "ArrowDown" ? 0 : lastIndex)
      : (current + (key === "ArrowDown" ? 1 : -1) + positions.length) % positions.length;
    setActive(positions[nextIndex]!);
  };

  const pick = (option: DevComboboxOption<Value>) => {
    if (option.disabled) return;
    selectedOption = option;
    input.value = option.name;
    setExpanded(false);
    options.onSelect(option);
  };

  input.addEventListener("focusin", ensureLoaded);
  input.addEventListener("click", () => { if (!expanded) setExpanded(true); });
  input.addEventListener("input", () => {
    if (selectedOption) { selectedOption = null; options.onSelect(null); }
    if (expanded) render(); else setExpanded(true);
  });
  input.addEventListener("keydown", event => {
    const key = event.key;
    if (key === "ArrowDown" || key === "ArrowUp") {
      event.preventDefault();
      if (expanded) { stepActive(key); return; }
      setExpanded(true);
      if (key === "ArrowUp") stepActive("End");
      return;
    }
    if (!expanded) return;
    if (key === "Home" || key === "End") { event.preventDefault(); stepActive(key); return; }
    if (key === "Escape") {
      if (!listbox.hidden) event.preventDefault();
      setExpanded(false);
      return;
    }
    if (key === "Tab") { setExpanded(false); return; }
    const activeOption = renderedOptions[activePosition];
    if (key === "Enter" && activeOption) { event.preventDefault(); pick(activeOption); }
  });
  control.addEventListener("focusout", event => {
    const next = event.relatedTarget;
    if (!expanded || (next instanceof Node && control.contains(next))) return;
    setExpanded(false);
  });
  listbox.addEventListener("mousedown", event => event.preventDefault());
  listbox.addEventListener("click", event => {
    const row = event.target instanceof Element ? event.target.closest<HTMLElement>("[role='option']") : null;
    const position = row?.dataset.position;
    const option = position === undefined ? undefined : renderedOptions[Number(position)];
    if (option) pick(option);
  });

  return {
    control,
    input,
    selected: () => selectedOption,
    query: () => input.value.trim(),
  };
}
