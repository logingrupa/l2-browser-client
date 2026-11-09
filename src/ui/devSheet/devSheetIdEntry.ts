import { tileIdPattern, windowIdPattern } from "../../assets/native/nativeCatalogRecords";
import type { DevIdEntry, DevIdEntryField, DevIdEntryOptions } from "./types";

const integerInputPattern = /^\d{1,9}$/;
const maximumSearchTextLength = 64;

let idEntrySequence = 0;

type FieldReading = { readonly value: number | string } | { readonly rejection: string };

function readIdEntryField(field: DevIdEntryField, rawText: string): FieldReading {
  const text = rawText.trim();
  if (field.kind === "search") {
    return text.length <= maximumSearchTextLength ? { value: text } : { rejection: `${field.label} must be at most ${maximumSearchTextLength} characters.` };
  }
  if (!text) return { rejection: `${field.label} is required.` };
  if (field.kind === "tile") {
    return tileIdPattern.test(text) ? { value: text } : { rejection: `${field.label} must be two two-digit numbers joined by an underscore (XX_YY).` };
  }
  if (field.kind === "window") {
    return windowIdPattern.test(text) ? { value: text }
      : { rejection: `${field.label} must start with a letter and use only letters, digits and underscores, at most 64 characters, optionally followed by #<ordinal>.` };
  }
  if (!integerInputPattern.test(text)) return { rejection: `${field.label} must be a whole number of at most 9 digits.` };
  const value = Number(text);
  if (!Number.isSafeInteger(value)) return { rejection: `${field.label} must be a safe whole number.` };
  if (field.minimum !== undefined && value < field.minimum) return { rejection: `${field.label} must be at least ${field.minimum}.` };
  return { value };
}

export function createDevIdEntry(options: DevIdEntryOptions, infoButton: HTMLElement | null): DevIdEntry {
  const sequence = ++idEntrySequence;
  const form = document.createElement("form");
  form.className = "dev-id-entry";
  form.noValidate = true;
  form.setAttribute("aria-label", options.label);
  form.setAttribute("data-dev-search", options.label);
  if (options.testId) form.dataset.testid = options.testId;
  const inputs = options.fields.map(field => {
    const row = document.createElement("div"); row.className = "dev-row"; row.dataset.layout = "inline";
    const input = document.createElement("input");
    input.type = "text"; input.name = field.name; input.id = `dev-id-entry-${sequence}-${field.name}`;
    input.autocomplete = "off"; input.spellcheck = false;
    if (field.kind === "integer") input.inputMode = "numeric";
    if (options.testId) input.dataset.testid = `${options.testId}-${field.name}`;
    const label = document.createElement("label"); label.className = "dev-row-label"; label.htmlFor = input.id; label.textContent = field.label;
    const cell = document.createElement("div"); cell.className = "dev-row-control"; cell.append(input);
    row.append(label, cell);
    form.append(row);
    return { field, input };
  });
  const actions = document.createElement("div"); actions.className = "dev-id-entry-actions";
  const submit = document.createElement("button"); submit.type = "submit"; submit.className = "dev-button"; submit.textContent = options.submitText;
  if (options.testId) submit.dataset.testid = `${options.testId}-submit`;
  actions.append(submit);
  if (infoButton) actions.append(infoButton);
  const message = document.createElement("p"); message.className = "dev-id-entry-message";
  message.setAttribute("aria-live", "polite"); message.hidden = true;
  if (options.testId) message.dataset.testid = `${options.testId}-message`;
  form.append(actions, message);
  const setMessage = (text: string | null) => { message.textContent = text ?? ""; message.hidden = text === null; };
  form.addEventListener("submit", event => {
    event.preventDefault();
    const values: Record<string, number | string> = {};
    for (const { field, input } of inputs) {
      const reading = readIdEntryField(field, input.value);
      if ("rejection" in reading) { setMessage(reading.rejection); return; }
      values[field.name] = reading.value;
    }
    setMessage(null);
    options.onSubmit(Object.freeze(values));
  });
  return { element: form, setMessage };
}
