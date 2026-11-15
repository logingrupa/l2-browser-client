import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DevSheet } from "../../src/ui/devSheet/DevSheet";
import { devSheetComboboxLoadingText, devSheetComboboxRowLimit } from "../../src/ui/devSheet/devSheetCombobox";
import type { DevComboboxOption, DevComboboxOptionLoad, DevComboboxOptions } from "../../src/ui/devSheet/types";
import { comboboxRows, comboboxRowTexts, openCombobox, settleMicrotasks, typeIntoCombobox } from "./support/comboboxDriver";
import { fakeMedia, fire, installMiniDom, type FakeElement, type MiniDom } from "./support/miniDom";

const testId = "skill-picker";

let dom: MiniDom;
const openSheets: DevSheet[] = [];

beforeEach(() => { dom = installMiniDom(); });
afterEach(() => { for (const sheet of openSheets.splice(0)) sheet.dispose(); dom.restore(); });

function skillOption(skillId: number, name: string, status = "converted"): DevComboboxOption<number> {
  return { value: skillId, name, identifier: `skill:${skillId}:1`, status, disabled: status.startsWith("gap") };
}

const skillOptions: readonly DevComboboxOption<number>[] = [
  skillOption(3, "Power Strike"),
  skillOption(4, "Power Strike Mastery", "gap: native-skill-dispatch-required"),
  skillOption(56, "Power Shot", "not in catalog"),
  skillOption(57, "Mortal Blow"),
];

type MountOverrides = Partial<Omit<DevComboboxOptions<number>, "onSelect">>;

function mountCombobox(overrides: MountOverrides = {}) {
  const host = dom.document.createElement("section"); host.className = "world-interface";
  const canvas = dom.document.createElement("canvas");
  const toggle = dom.document.createElement("button");
  const outside = dom.document.createElement("button");
  host.append(toggle); dom.document.body.append(canvas, host, outside);
  host.rect = { left: 0, top: 0, width: 1280, height: 800 };
  const sheet = new DevSheet({ host: host as unknown as HTMLElement, canvas: canvas as unknown as HTMLCanvasElement,
    toggle: toggle as unknown as HTMLButtonElement, worldTargets: [canvas] as unknown as EventTarget[], storage: null, matchMedia: fakeMedia().matchMedia });
  openSheets.push(sheet);
  const group = sheet.section("sandbox", { title: "Sandbox" }).group("cast", "Cast");
  const onSelect = vi.fn<(option: DevComboboxOption<number> | null) => void>();
  const combobox = group.combobox({ label: "Skill", testId, placeholder: "Name, ID or status", options: skillOptions, onSelect, ...overrides });
  const root = group.element as unknown as FakeElement;
  const input = combobox.input as unknown as FakeElement;
  const listbox = root.querySelector(`[data-testid="${testId}-list"]`)!;
  const message = root.querySelector(`[data-testid="${testId}-message"]`)!;
  const press = (key: string) => fire(input, "keydown", { key });
  return { sheet, combobox, root, input, listbox, message, onSelect, press, outside };
}

describe("developer sheet combobox", () => {
  it("wires the combobox and listbox ARIA roles, states and the active descendant", async () => {
    const { root, input, listbox } = mountCombobox();
    expect(input.getAttribute("role")).toBe("combobox");
    expect(input.getAttribute("aria-autocomplete")).toBe("list");
    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect(input.getAttribute("aria-controls")).toBe(listbox.id);
    expect(listbox.getAttribute("role")).toBe("listbox");
    expect(listbox.getAttribute("aria-label")).toBe("Skill");
    expect(root.querySelector(`label[for="${input.id}"]`)!.textContent).toBe("Skill");
    await openCombobox(root, testId);
    expect(input.getAttribute("aria-expanded")).toBe("true");
    const rows = comboboxRows(root, testId);
    expect(rows.map(row => row.getAttribute("role"))).toEqual(["option", "option", "option", "option"]);
    expect(input.getAttribute("aria-activedescendant")).toBe(rows[0]!.id);
    expect(rows.map(row => row.getAttribute("aria-selected"))).toEqual(["true", "false", "false", "false"]);
  });

  it("filters live on every word of the name, identifier or status in any order", async () => {
    const { root, message } = mountCombobox();
    await typeIntoCombobox(root, testId, "strike power");
    expect(comboboxRowTexts(root, testId)).toEqual(["Power Strike skill:3:1 converted", "Power Strike Mastery skill:4:1 gap: native-skill-dispatch-required"]);
    expect(message.textContent).toBe("2 matches");
    await typeIntoCombobox(root, testId, "CONVERTED");
    expect(comboboxRowTexts(root, testId)).toEqual(["Power Strike skill:3:1 converted", "Mortal Blow skill:57:1 converted"]);
    await typeIntoCombobox(root, testId, "skill:56");
    expect(comboboxRowTexts(root, testId)).toEqual(["Power Shot skill:56:1 not in catalog"]);
    await typeIntoCombobox(root, testId, "nothing like this");
    expect(comboboxRowTexts(root, testId)).toEqual([]);
    expect(root.querySelector(`[data-testid="${testId}-list"]`)!.hidden).toBe(true);
    expect(message.textContent).toBe("0 matches");
  });

  it("keeps only the first rows in the list and a keep-typing row for the rest", async () => {
    const manyOptions = Array.from({ length: devSheetComboboxRowLimit + 70 }, (_, position) => skillOption(position, `Skill ${position}`));
    const { root } = mountCombobox({ options: manyOptions });
    await openCombobox(root, testId);
    expect(comboboxRows(root, testId)).toHaveLength(devSheetComboboxRowLimit);
    const moreRow = root.querySelector(`[data-testid="${testId}-more"]`)!;
    expect(moreRow.textContent).toBe("70 more, keep typing");
    expect(moreRow.getAttribute("aria-disabled")).toBe("true");
    await typeIntoCombobox(root, testId, "skill 11");
    expect(comboboxRowTexts(root, testId)).toEqual(["Skill 11 skill:11:1 converted", "Skill 110 skill:110:1 converted", "Skill 111 skill:111:1 converted",
      "Skill 112 skill:112:1 converted", "Skill 113 skill:113:1 converted", "Skill 114 skill:114:1 converted", "Skill 115 skill:115:1 converted",
      "Skill 116 skill:116:1 converted", "Skill 117 skill:117:1 converted", "Skill 118 skill:118:1 converted", "Skill 119 skill:119:1 converted"]);
    expect(root.querySelector(`[data-testid="${testId}-more"]`)).toBeNull();
  });

  it("moves the active row with Down, Up, Home and End past disabled rows and picks it with Enter", () => {
    const { combobox, input, press, onSelect, root } = mountCombobox();
    input.focus();
    expect(press("ArrowDown").defaultPrevented).toBe(true);
    const activeName = () => root.querySelector(`#${input.getAttribute("aria-activedescendant")}`)!.querySelector(".dev-combobox-option-name")!.textContent;
    expect(activeName()).toBe("Power Strike");
    press("ArrowDown");
    expect(activeName()).toBe("Power Shot");
    press("End");
    expect(activeName()).toBe("Mortal Blow");
    press("ArrowDown");
    expect(activeName()).toBe("Power Strike");
    press("ArrowUp");
    expect(activeName()).toBe("Mortal Blow");
    press("Home");
    expect(activeName()).toBe("Power Strike");
    press("ArrowDown");
    const enter = press("Enter");
    expect(enter.defaultPrevented).toBe(true);
    expect(onSelect).toHaveBeenLastCalledWith(skillOptions[2]);
    expect(combobox.selected()).toBe(skillOptions[2]);
    expect(input.value).toBe("Power Shot");
    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect(input.hasAttribute("aria-activedescendant")).toBe(false);
    expect(root.querySelector(`[data-testid="${testId}-message"]`)!.textContent).toBe("skill:56:1 not in catalog");
  });

  it("opens on Up at the last enabled row", () => {
    const { input, press, root } = mountCombobox();
    input.focus();
    press("ArrowUp");
    expect(root.querySelector(`#${input.getAttribute("aria-activedescendant")}`)!.textContent).toBe("Mortal Blow skill:57:1 converted");
  });

  it("closes on Escape without letting the sheet close, and lets a second Escape close the sheet", () => {
    const { sheet, input, press } = mountCombobox();
    sheet.open();
    input.focus();
    press("ArrowDown");
    const escape = press("Escape");
    expect(escape.defaultPrevented).toBe(true);
    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect(sheet.isOpen).toBe(true);
    press("Escape");
    expect(sheet.isOpen).toBe(false);
  });

  it("closes on Tab without picking and when focus leaves the combobox", async () => {
    const { input, press, onSelect, root, outside } = mountCombobox();
    input.focus();
    press("ArrowDown");
    const tab = press("Tab");
    expect(tab.defaultPrevented).toBe(false);
    expect(input.getAttribute("aria-expanded")).toBe("false");
    await openCombobox(root, testId);
    outside.focus();
    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("marks gap rows aria-disabled and never picks them by click", async () => {
    const { root, onSelect, combobox } = mountCombobox();
    await openCombobox(root, testId);
    const gapRow = comboboxRows(root, testId)[1]!;
    expect(gapRow.getAttribute("aria-disabled")).toBe("true");
    gapRow.click();
    expect(onSelect).not.toHaveBeenCalled();
    expect(combobox.selected()).toBeNull();
  });

  it("keeps focus in the input on a row press and picks the row on click, then clears the pick when the text changes", async () => {
    const { root, input, onSelect, combobox } = mountCombobox();
    await openCombobox(root, testId);
    const row = comboboxRows(root, testId)[3]!;
    expect(fire(row.querySelector(".dev-combobox-option-name")!, "mousedown").defaultPrevented).toBe(true);
    row.querySelector(".dev-combobox-option-name")!.click();
    expect(onSelect).toHaveBeenLastCalledWith(skillOptions[3]);
    expect(dom.document.activeElement).toBe(input);
    await typeIntoCombobox(root, testId, "Mortal");
    expect(onSelect).toHaveBeenLastCalledWith(null);
    expect(combobox.selected()).toBeNull();
    expect(combobox.query()).toBe("Mortal");
  });

  it("offers a typed option only when no row matches the query", async () => {
    const typedOption = (query: string) => /^\d+$/.test(query.trim()) ? skillOption(Number(query), query.trim(), "not in catalog") : null;
    const { root } = mountCombobox({ typedOption });
    await typeIntoCombobox(root, testId, "5");
    expect(comboboxRowTexts(root, testId)).toEqual(["Power Shot skill:56:1 not in catalog", "Mortal Blow skill:57:1 converted"]);
    await typeIntoCombobox(root, testId, "9");
    expect(comboboxRowTexts(root, testId)).toEqual(["9 skill:9:1 not in catalog"]);
  });

  it("starts on the picked row when the list reopens", async () => {
    const twinOptions = [skillOption(3, "Power Strike"), skillOption(5, "Power Strike")];
    const { root, input, press } = mountCombobox({ options: twinOptions });
    input.focus();
    press("ArrowDown");
    press("ArrowDown");
    press("Enter");
    expect(input.value).toBe("Power Strike");
    await openCombobox(root, testId);
    const rows = comboboxRows(root, testId);
    expect(rows.map(row => row.textContent)).toEqual(["Power Strike skill:3:1 converted", "Power Strike skill:5:1 converted"]);
    expect(input.getAttribute("aria-activedescendant")).toBe(rows[1]!.id);
  });

  it("reports aria-expanded from the visible list: false while loading, with no matches and when names are unavailable", async () => {
    let resolveLoad: (load: DevComboboxOptionLoad<number>) => void = () => undefined;
    const loading = mountCombobox({ options: () => new Promise(resolve => { resolveLoad = resolve; }) });
    await openCombobox(loading.root, testId);
    expect(loading.input.getAttribute("aria-expanded")).toBe("false");
    resolveLoad({ status: "loaded", options: skillOptions });
    await settleMicrotasks();
    expect(loading.input.getAttribute("aria-expanded")).toBe("true");
    await typeIntoCombobox(loading.root, testId, "nothing like this");
    expect(loading.input.getAttribute("aria-expanded")).toBe("false");
    expect(loading.input.hasAttribute("aria-activedescendant")).toBe(false);
    const unavailable = mountCombobox({ options: async () => ({ status: "unavailable", message: "no names" }) });
    await openCombobox(unavailable.root, testId);
    expect(unavailable.input.getAttribute("aria-expanded")).toBe("false");
  });

  it("lets Escape reach the sheet while no list is visible", async () => {
    const { sheet, root, input, press } = mountCombobox();
    sheet.open();
    await typeIntoCombobox(root, testId, "nothing like this");
    const escape = press("Escape");
    expect(escape.defaultPrevented).toBe(true);
    expect(sheet.isOpen).toBe(false);
    expect(input.getAttribute("aria-expanded")).toBe("false");
  });

  it("shows a rejected load as unavailable with its message and no rows", async () => {
    const { root, input, message } = mountCombobox({ options: () => Promise.reject(new Error("name index fetch refused")) });
    await openCombobox(root, testId);
    expect(message.textContent).toBe("Names failed to load: name index fetch refused");
    expect(comboboxRows(root, testId)).toEqual([]);
    expect(input.getAttribute("aria-expanded")).toBe("false");
  });

  it("loads options once on first focus with a loading state, then filters them locally", async () => {
    let resolveLoad: (load: DevComboboxOptionLoad<number>) => void = () => undefined;
    const load = vi.fn(() => new Promise<DevComboboxOptionLoad<number>>(resolve => { resolveLoad = resolve; }));
    const { root, input, message } = mountCombobox({ options: load });
    expect(load).not.toHaveBeenCalled();
    expect(message.hidden).toBe(true);
    input.focus();
    expect(load).toHaveBeenCalledTimes(1);
    expect(message.textContent).toBe(devSheetComboboxLoadingText);
    input.click();
    expect(comboboxRows(root, testId)).toEqual([]);
    resolveLoad({ status: "loaded", options: skillOptions });
    await settleMicrotasks();
    expect(comboboxRows(root, testId)).toHaveLength(4);
    await typeIntoCombobox(root, testId, "mortal");
    expect(comboboxRowTexts(root, testId)).toEqual(["Mortal Blow skill:57:1 converted"]);
    input.blur();
    input.focus();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("shows the unavailable message of a load and no rows", async () => {
    const { root, message } = mountCombobox({ options: async () => ({ status: "unavailable", message: "table:skillname_e_names not in catalog" }) });
    await openCombobox(root, testId);
    expect(message.textContent).toBe("table:skillname_e_names not in catalog");
    expect(comboboxRows(root, testId)).toEqual([]);
    expect(root.querySelector(`[data-testid="${testId}-list"]`)!.hidden).toBe(true);
  });
});
