/** Public types for the developer sheet. See DevSheet.ts for the API contract. */

/** native = read from original data; presentation = browser choice where the
 * native rule is unproved; unverified = source-derived but not yet confirmed. */
export type DevVariableStatus = "native" | "presentation" | "unverified";

export interface VariableInfo {
  /** Dotted, searchable name such as `footsteps.surface`. */
  name: string;
  /** Re-read when the card opens and while it stays open. */
  value: () => string;
  /** Allowed values or range, e.g. `Default | Grass | Stone` or `0–100`. */
  values?: string;
  /** Provenance, e.g. `stepsound.uax · ALAudio.int [L2FootStepSound]`. */
  source?: string;
  status: DevVariableStatus;
}

export interface DevInfo {
  title: string;
  description?: string;
  variables?: () => VariableInfo[];
}

/** Shared options for every DevGroup helper. */
export interface DevControlInfo {
  label: string;
  testId?: string;
  /** Short explanation shown in the hover-card, never inline. */
  hint?: string;
  variables?: () => VariableInfo[];
}

export type DevIconName = "general" | "audio" | "movement" | "combat" | "character" | "world" | "effects" | "debug";

export interface DevSectionOptions { title: string; icon?: DevIconName; order?: number }
export interface DevGroupOptions { collapsed?: boolean; hint?: string; variables?: () => VariableInfo[] }

export type DevSnap = "peek" | "half" | "full";
export type DevSheetMode = "side" | "bottom";

export interface DevChoiceOption {
  value: string;
  label: string;
  disabled?: boolean;
  /** Shown as the chip's hover-card (e.g. why it is disabled). */
  hint?: string;
}

export interface DevChoiceOptions extends DevControlInfo {
  options: DevChoiceOption[];
  value?: string;
  /** auto: ≤4 options segmented, ≤18 chips, otherwise a select. */
  display?: "auto" | "segmented" | "chips" | "select";
  disabled?: boolean;
  onChange?: (value: string) => void;
}

export interface DevButtonOptions extends DevControlInfo {
  /** Button text; defaults to label. */
  text?: string;
  disabled?: boolean;
  onClick?: () => void;
}

export interface DevToggleOptions extends DevControlInfo {
  checked?: boolean;
  disabled?: boolean;
  onChange?: (checked: boolean) => void;
}

export interface DevSliderOptions extends DevControlInfo {
  min: number;
  max: number;
  step?: number;
  value?: number;
  disabled?: boolean;
  format?: (value: number) => string;
  onInput?: (value: number) => void;
}

export interface DevReadoutOptions extends DevControlInfo {
  value: () => string;
}

export interface DevNoteOptions {
  tone?: "info" | "status" | "warning";
  testId?: string;
  hint?: string;
  variables?: () => VariableInfo[];
  /** Hover-card title when hint/variables are given. */
  title?: string;
}

export interface DevChoice {
  readonly element: HTMLElement;
  value: string;
  set(value: string): void;
  setOptions(options: DevChoiceOption[]): void;
  setDisabled(disabled: boolean): void;
}

export interface DevToggle {
  readonly element: HTMLElement;
  readonly control: HTMLButtonElement;
  checked: boolean;
  set(checked: boolean): void;
  setDisabled(disabled: boolean): void;
}

export interface DevSlider {
  readonly element: HTMLElement;
  readonly input: HTMLInputElement;
  value: number;
  set(value: number): void;
  setDisabled(disabled: boolean): void;
}

export interface DevReadout {
  readonly element: HTMLElement;
  readonly output: HTMLElement;
  refresh(): void;
}
