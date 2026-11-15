import "../../../src/style.css";
import { DevSheet } from "../../../src/ui/devSheet/DevSheet";
import type { DevComboboxOption } from "../../../src/ui/devSheet/types";

const harnessComboboxTestId = "harness-combobox";

const harnessHost = document.getElementById("dev-sheet-combobox-harness");
const harnessToggle = document.getElementById("dev-sheet-combobox-harness-toggle");
if (!(harnessHost instanceof HTMLElement) || !(harnessToggle instanceof HTMLButtonElement)) {
  throw new Error("Developer sheet combobox harness page is missing its host or toggle.");
}

function harnessOption(position: number, disabled: boolean): DevComboboxOption<number> {
  return { value: position, name: `Harness row ${position}`, identifier: `harness:${position}`,
    status: disabled ? "gap: harness row is disabled" : "converted", disabled };
}

const harnessOptions = [1, 2, 3, 4, 5].map(position => harnessOption(position, position === 2));
const sheet = new DevSheet({ host: harnessHost, toggle: harnessToggle, storage: null });
sheet.open();
sheet.section("harness", { title: "Harness" }).group("rows", "Rows").combobox({
  label: "Harness rows", testId: harnessComboboxTestId, placeholder: "Row words", options: harnessOptions,
  onSelect: option => { harnessHost.dataset.picked = option === null ? "" : option.identifier; },
});
harnessHost.dataset.status = "ready";
