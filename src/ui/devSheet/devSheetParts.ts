import type { DescribeOptions } from "./hoverCards";
import { createInfoButton } from "./hoverCards";
import { iconMarkup, isDevIconName } from "./icons";
import type {
  DevButtonOptions, DevChoice, DevChoiceOption, DevChoiceOptions, DevControlInfo, DevGroupOptions, DevIconName, DevInfo,
  DevNoteOptions, DevReadout, DevReadoutOptions, DevSectionOptions, DevSlider, DevSliderOptions, DevToggle, DevToggleOptions,
} from "./types";

/** What sections and groups need from their sheet. */
export interface DevSheetParent {
  describe(element: Element, info: DevInfo, options?: DescribeOptions): () => void;
  isCollapsed(key: string, fallback: boolean): boolean;
  setCollapsed(key: string, collapsed: boolean): void;
  registerReadout(readout: DevReadout): void;
  contentChanged(): void;
  activate(sectionId: string): void;
}

let partSequence = 0;
const nextId = (prefix: string) => `${prefix}-${++partSequence}`;
const safeId = (value: string) => value.replace(/[^a-z0-9_-]+/gi, "-").slice(0, 48) || "item";

export class DevSection {
  readonly element = document.createElement("section");
  readonly tab = document.createElement("button");
  readonly titleElement = document.createElement("h2");
  title: string;
  order: number;
  icon: DevIconName | undefined;
  private readonly groupMap = new Map<string, DevGroup>();
  private readonly tabLabel = document.createElement("span");
  readonly tabCount = document.createElement("span");

  constructor(readonly id: string, options: DevSectionOptions, readonly index: number, private readonly parent: DevSheetParent) {
    this.title = options.title; this.order = options.order ?? 100 + index; this.icon = options.icon;
    const key = safeId(id);
    this.element.className = "dev-panel"; this.element.id = nextId(`dev-panel-${key}`);
    this.element.setAttribute("role", "tabpanel"); this.element.dataset.section = id; this.element.dataset.testid = `dev-section-${key}`;
    this.tab.type = "button"; this.tab.className = "dev-tab"; this.tab.id = nextId(`dev-tab-${key}`);
    this.tab.setAttribute("role", "tab"); this.tab.setAttribute("aria-controls", this.element.id);
    this.tab.setAttribute("aria-selected", "false"); this.tab.tabIndex = -1; this.tab.dataset.section = id; this.tab.dataset.testid = `dev-tab-${key}`;
    this.element.setAttribute("aria-labelledby", this.tab.id);
    this.titleElement.className = "dev-panel-title";
    this.tabCount.className = "dev-tab-count";
    this.element.append(this.titleElement);
    this.update(options);
  }

  /** Updates title/icon/order of an already registered section. */
  update(options: Partial<DevSectionOptions>): void {
    if (options.title) this.title = options.title;
    if (options.order !== undefined) this.order = options.order;
    if (options.icon !== undefined) this.icon = options.icon;
    this.titleElement.textContent = this.title;
    this.tabLabel.textContent = this.title;
    this.tab.innerHTML = isDevIconName(this.icon) ? iconMarkup(this.icon) : "";
    this.tab.append(this.tabLabel, this.tabCount);
  }

  /** Returns the existing group with this id, or creates it. */
  group(id: string, title: string, options: DevGroupOptions = {}): DevGroup {
    const existing = this.groupMap.get(id);
    if (existing) return existing;
    const group = new DevGroup(this, id, title, options, this.parent);
    this.groupMap.set(id, group);
    this.element.append(group.root);
    this.parent.contentChanged();
    return group;
  }

  groups(): DevGroup[] { return [...this.groupMap.values()]; }
  show(): void { this.parent.activate(this.id); }
}

export class DevGroup {
  readonly root = document.createElement("section");
  /** Plain host: append any DOM here (existing control modules work as-is). */
  readonly element = document.createElement("div");
  /** Collapse/expand button in the group heading. */
  readonly header = document.createElement("button");
  readonly count = document.createElement("span");
  private readonly key: string;
  private readonly testKey: string;

  constructor(readonly section: DevSection, readonly id: string, readonly title: string, options: DevGroupOptions, private readonly parent: DevSheetParent) {
    this.key = `${section.id}/${id}`;
    this.testKey = `${safeId(section.id)}-${safeId(id)}`;
    this.root.className = "dev-group"; this.root.dataset.group = id; this.root.dataset.testid = `dev-group-${this.testKey}`;
    const heading = document.createElement("h3"); heading.className = "dev-group-heading";
    this.header.type = "button"; this.header.className = "dev-group-toggle";
    this.element.className = "dev-group-body"; this.element.id = nextId(`dev-group-body-${this.testKey}`);
    this.header.setAttribute("aria-controls", this.element.id);
    this.header.innerHTML = iconMarkup("chevron");
    const label = document.createElement("span"); label.className = "dev-group-title"; label.textContent = title;
    this.count.className = "dev-group-count";
    this.header.append(label, this.count);
    heading.append(this.header);
    if (options.hint || options.variables) {
      const info = createInfoButton(title);
      heading.append(info);
      parent.describe(this.header, { title, ...(options.hint ? { description: options.hint } : {}), ...(options.variables ? { variables: options.variables } : {}) }, { infoButton: info });
    }
    this.root.append(heading, this.element);
    this.setCollapsed(parent.isCollapsed(this.key, options.collapsed ?? false), false);
    this.header.addEventListener("click", () => this.setCollapsed(!this.collapsed));
  }

  get collapsed(): boolean { return this.root.hasAttribute("data-collapsed"); }

  setCollapsed(collapsed: boolean, persist = true): void {
    if (collapsed) this.root.setAttribute("data-collapsed", ""); else this.root.removeAttribute("data-collapsed");
    this.header.setAttribute("aria-expanded", String(!collapsed));
    if (persist) this.parent.setCollapsed(this.key, collapsed);
  }

  button(options: DevButtonOptions): HTMLButtonElement {
    let grid = this.element.lastElementChild;
    if (!grid || !grid.classList.contains("dev-button-grid")) {
      grid = document.createElement("div"); grid.className = "dev-button-grid"; this.element.append(grid);
    }
    const cell = document.createElement("div"); cell.className = "dev-button-cell";
    const button = document.createElement("button"); button.type = "button"; button.className = "dev-button";
    button.textContent = options.text ?? options.label;
    if (options.text && options.text !== options.label) button.setAttribute("aria-label", options.label);
    if (options.testId) button.dataset.testid = options.testId;
    button.disabled = options.disabled ?? false;
    if (options.onClick) { const onClick = options.onClick; button.addEventListener("click", () => onClick()); }
    cell.append(button);
    const info = this.infoFor(options);
    if (info) { const infoButton = createInfoButton(options.label); cell.append(infoButton); this.parent.describe(button, info, { infoButton }); }
    else button.setAttribute("data-dev-search", options.label);
    grid.append(cell);
    this.parent.contentChanged();
    return button;
  }

  choice(options: DevChoiceOptions): DevChoice {
    const display = resolveDisplay(options), isSelect = display === "select";
    const control = isSelect ? document.createElement("select") : document.createElement("div");
    const row = this.row(options, control, display === "chips" ? "stacked" : "inline");
    const labelId = row.querySelector(".dev-row-label")?.id ?? "";
    let value = options.value ?? options.options.find(option => !option.disabled)?.value ?? "";
    let choices = options.options, disabled = options.disabled ?? false;
    const lifetime: AbortController[] = [];
    const commit = (next: string) => {
      const option = choices.find(item => item.value === next);
      if (!option || option.disabled || disabled || next === value) return;
      value = next; render(); options.onChange?.(next);
    };
    const render = () => {
      if (isSelect) {
        (control as HTMLSelectElement).value = value; (control as HTMLSelectElement).disabled = disabled;
        return;
      }
      for (const chip of Array.from(control.children) as HTMLButtonElement[]) {
        const checked = chip.dataset.value === value;
        chip.setAttribute("aria-checked", String(checked));
        chip.tabIndex = checked || (!choices.some(item => item.value === value) && chip === control.firstElementChild) ? 0 : -1;
        const option = choices.find(item => item.value === chip.dataset.value);
        if (disabled || option?.disabled) chip.setAttribute("aria-disabled", "true"); else chip.removeAttribute("aria-disabled");
      }
    };
    const build = () => {
      for (const controller of lifetime.splice(0)) controller.abort();
      control.replaceChildren();
      if (isSelect) {
        const select = control as HTMLSelectElement;
        select.className = "dev-select"; select.id = select.id || nextId("dev-select");
        if (labelId) select.setAttribute("aria-labelledby", labelId);
        for (const option of choices) {
          const item = document.createElement("option"); item.value = option.value; item.textContent = option.label; item.disabled = option.disabled ?? false;
          select.append(item);
        }
      } else {
        control.className = "dev-choice"; control.dataset.display = display;
        control.setAttribute("role", "radiogroup"); if (labelId) control.setAttribute("aria-labelledby", labelId);
        for (const option of choices) {
          const chip = document.createElement("button"); chip.type = "button"; chip.className = "dev-chip";
          chip.setAttribute("role", "radio"); chip.dataset.value = option.value; chip.textContent = option.label;
          if (options.testId) chip.dataset.testid = `${options.testId}-option-${safeId(option.value)}`;
          control.append(chip);
          if (option.hint) {
            const controller = new AbortController(); lifetime.push(controller);
            const dispose = this.parent.describe(chip, { title: option.label, description: option.hint }, { infoButton: "none" });
            controller.signal.addEventListener("abort", dispose);
          }
        }
      }
      render();
    };
    if (isSelect) control.addEventListener("change", () => commit((control as HTMLSelectElement).value));
    else {
      control.addEventListener("click", event => {
        const chip = event.target instanceof Element ? event.target.closest<HTMLElement>(".dev-chip") : null;
        if (chip?.dataset.value !== undefined && control.contains(chip)) commit(chip.dataset.value);
      });
      control.addEventListener("keydown", event => {
        const key = (event as KeyboardEvent).key;
        if (!["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"].includes(key) || disabled) return;
        const enabled = (Array.from(control.children) as HTMLButtonElement[]).filter(chip => !choices.find(item => item.value === chip.dataset.value)?.disabled);
        if (!enabled.length) return;
        event.preventDefault();
        const current = Math.max(0, enabled.findIndex(chip => chip.dataset.value === value));
        const next = key === "Home" ? 0 : key === "End" ? enabled.length - 1 :
          (current + (key === "ArrowRight" || key === "ArrowDown" ? 1 : -1) + enabled.length) % enabled.length;
        const chip = enabled[next]!;
        commit(chip.dataset.value ?? ""); chip.focus();
      });
    }
    build();
    return {
      element: row,
      get value() { return value; },
      set value(next: string) { value = next; render(); },
      set(next: string) { value = next; render(); },
      setOptions(next: DevChoiceOption[]) { choices = next; build(); },
      setDisabled(next: boolean) { disabled = next; render(); },
    };
  }

  toggle(options: DevToggleOptions): DevToggle {
    const control = document.createElement("button");
    control.type = "button"; control.className = "dev-switch"; control.setAttribute("role", "switch");
    control.id = nextId("dev-switch");
    control.innerHTML = '<span class="dev-switch-track" aria-hidden="true"><span class="dev-switch-thumb"></span></span>';
    const state = document.createElement("span"); state.className = "dev-switch-state"; state.setAttribute("aria-hidden", "true");
    control.append(state);
    const row = this.row(options, control, "inline");
    const labelId = row.querySelector(".dev-row-label")?.id;
    if (labelId) control.setAttribute("aria-labelledby", labelId);
    let checked = options.checked ?? false;
    const render = () => { control.setAttribute("aria-checked", String(checked)); state.textContent = checked ? "On" : "Off"; };
    control.disabled = options.disabled ?? false;
    control.addEventListener("click", () => { checked = !checked; render(); options.onChange?.(checked); });
    render();
    return {
      element: row, control,
      get checked() { return checked; },
      set checked(next: boolean) { checked = next; render(); },
      set(next: boolean) { checked = next; render(); },
      setDisabled(next: boolean) { control.disabled = next; },
    };
  }

  slider(options: DevSliderOptions): DevSlider {
    const wrapper = document.createElement("div"); wrapper.className = "dev-range-control";
    const input = document.createElement("input"); input.type = "range"; input.className = "dev-range"; input.id = nextId("dev-range");
    input.min = String(options.min); input.max = String(options.max); input.step = String(options.step ?? 1);
    const output = document.createElement("output"); output.className = "dev-range-value"; output.setAttribute("for", input.id);
    wrapper.append(input, output);
    const row = this.row(options, wrapper, "inline", input);
    const format = options.format ?? ((value: number) => String(value));
    const render = (value: number) => { input.value = String(value); output.textContent = format(value); };
    render(options.value ?? options.min);
    input.disabled = options.disabled ?? false;
    input.addEventListener("input", () => { const value = Number(input.value); output.textContent = format(value); options.onInput?.(value); });
    return {
      element: row, input,
      get value() { return Number(input.value); },
      set value(next: number) { render(next); },
      set(next: number) { render(next); },
      setDisabled(next: boolean) { input.disabled = next; },
    };
  }

  readout(options: DevReadoutOptions): DevReadout {
    const output = document.createElement("output"); output.className = "dev-readout";
    const row = this.row(options, output, "inline");
    const labelId = row.querySelector(".dev-row-label")?.id;
    if (labelId) output.setAttribute("aria-labelledby", labelId);
    const readout: DevReadout = {
      element: row, output,
      refresh() {
        let text: string;
        try { text = String(options.value()); } catch { text = "unavailable"; }
        if (output.textContent !== text) output.textContent = text;
      },
    };
    readout.refresh();
    this.parent.registerReadout(readout);
    return readout;
  }

  note(text: string, options: DevNoteOptions = {}): HTMLParagraphElement {
    const note = document.createElement("p"); note.className = "dev-note"; note.textContent = text;
    note.dataset.tone = options.tone ?? "info";
    if (options.tone === "status") note.setAttribute("role", "status");
    if (options.testId) note.dataset.testid = options.testId;
    if (options.hint || options.variables) {
      const wrapper = document.createElement("div"); wrapper.className = "dev-note-row";
      const info = createInfoButton(options.title ?? text);
      wrapper.append(note, info); this.element.append(wrapper);
      this.parent.describe(note, { title: options.title ?? text, ...(options.hint ? { description: options.hint } : {}), ...(options.variables ? { variables: options.variables } : {}) }, { infoButton: info });
    } else this.element.append(note);
    this.parent.contentChanged();
    return note;
  }

  /** Attaches a hover-card to any element (typically DOM appended here by an
   * existing control module). Returns a disposer. */
  describe(element: Element, info: DevInfo, options?: DescribeOptions): () => void {
    return this.parent.describe(element, info, options);
  }

  private infoFor(options: DevControlInfo): DevInfo | null {
    if (!options.hint && !options.variables) return null;
    return { title: options.label, ...(options.hint ? { description: options.hint } : {}), ...(options.variables ? { variables: options.variables } : {}) };
  }

  /** label | control | (i) row. `labelFor` gets a real <label for>. */
  private row(options: DevControlInfo, control: HTMLElement, layout: "inline" | "stacked", labelFor: HTMLElement = control): HTMLElement {
    const row = document.createElement("div"); row.className = "dev-row"; row.dataset.layout = layout;
    if (options.testId) row.dataset.testid = options.testId;
    const forLabel = labelFor.tagName === "SELECT" || labelFor.tagName === "INPUT" || labelFor.tagName === "BUTTON";
    const label = document.createElement(forLabel ? "label" : "span");
    label.className = "dev-row-label"; label.id = nextId("dev-label"); label.textContent = options.label;
    if (forLabel) { labelFor.id = labelFor.id || nextId("dev-control"); label.setAttribute("for", labelFor.id); }
    const cell = document.createElement("div"); cell.className = "dev-row-control"; cell.append(control);
    row.append(label, cell);
    row.setAttribute("data-dev-search", options.label);
    const info = this.infoFor(options);
    if (info) {
      const infoButton = createInfoButton(options.label); row.append(infoButton); row.dataset.info = "";
      this.parent.describe(row, info, { infoButton });
    }
    this.element.append(row);
    this.parent.contentChanged();
    return row;
  }
}

function resolveDisplay(options: DevChoiceOptions): "segmented" | "chips" | "select" {
  if (options.display && options.display !== "auto") return options.display;
  const count = options.options.length;
  return count <= 4 ? "segmented" : count <= 18 ? "chips" : "select";
}
