import { fire, type FakeElement } from "./miniDom";

export async function settleMicrotasks(): Promise<void> {
  for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
}

function comboboxInput(root: FakeElement, testId: string): FakeElement {
  const input = root.querySelector(`[data-testid="${testId}-input"]`);
  if (!input) throw new Error(`No combobox input ${testId}-input.`);
  return input;
}

export async function openCombobox(root: FakeElement, testId: string): Promise<FakeElement> {
  const input = comboboxInput(root, testId);
  input.focus();
  input.click();
  await settleMicrotasks();
  return input;
}

export async function typeIntoCombobox(root: FakeElement, testId: string, text: string): Promise<FakeElement> {
  const input = comboboxInput(root, testId);
  input.focus();
  input.value = text;
  fire(input, "input");
  await settleMicrotasks();
  return input;
}

export function comboboxRows(root: FakeElement, testId: string): FakeElement[] {
  return root.querySelectorAll(`[data-testid="${testId}-list"] .dev-combobox-option`);
}

export function comboboxRowTexts(root: FakeElement, testId: string): string[] {
  return comboboxRows(root, testId).map(row => row.textContent);
}

export async function pickComboboxRow(root: FakeElement, testId: string, position: number): Promise<void> {
  root.querySelector(`[data-testid="${testId}-option-${position}"]`)!.click();
  root.querySelector(`[data-testid="${testId}-pick"]`)!.click();
  await settleMicrotasks();
}

export async function pickTypedComboboxRow(root: FakeElement, testId: string, text: string): Promise<void> {
  await typeIntoCombobox(root, testId, text);
  await pickComboboxRow(root, testId, 0);
}
