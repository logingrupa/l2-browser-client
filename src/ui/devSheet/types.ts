export type DevVariableStatus = "native" | "presentation" | "unverified";

export interface VariableInfo {
  name: string;
  value: () => string;
  values?: string;
  source?: string;
  status: DevVariableStatus;
}

export interface DevInfo {
  title: string;
  description?: string;
  variables?: () => VariableInfo[];
}

export interface DevControlInfo {
  label: string;
  testId?: string;
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
  hint?: string;
}

export interface DevChoiceOptions extends DevControlInfo {
  options: DevChoiceOption[];
  value?: string;
  display?: "auto" | "segmented" | "chips" | "select";
  disabled?: boolean;
  onChange?: (value: string) => void;
}

export interface DevButtonOptions extends DevControlInfo {
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

export interface DevIdEntryField {
  name: string;
  label: string;
  kind: "integer" | "name" | "search" | "tile" | "window";
  minimum?: number;
}

export interface DevIdEntryOptions extends DevControlInfo {
  fields: DevIdEntryField[];
  submitText: string;
  onSubmit: (values: Readonly<Record<string, number | string>>) => void;
}

export interface DevIdEntry {
  readonly element: HTMLElement;
  setMessage(text: string | null): void;
}

export interface DevNoteOptions {
  tone?: "info" | "status" | "warning";
  testId?: string;
  hint?: string;
  variables?: () => VariableInfo[];
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
