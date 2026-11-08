import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DevSheet } from "../../src/ui/devSheet/DevSheet";
import { createDevIdEntry } from "../../src/ui/devSheet/devSheetIdEntry";
import type { DevIdEntryOptions } from "../../src/ui/devSheet/types";
import { fakeMedia, fire, installMiniDom, type FakeElement, type MiniDom } from "./support/miniDom";

let dom: MiniDom;

beforeEach(() => { dom = installMiniDom(); });
afterEach(() => { dom.restore(); });

function mountIdEntry(overrides: Partial<DevIdEntryOptions> = {}) {
  const onSubmit = vi.fn();
  const entry = createDevIdEntry({
    label: "Cast skill", testId: "cast", submitText: "Cast",
    fields: [{ name: "skillId", label: "Skill ID", kind: "integer", minimum: 0 }, { name: "level", label: "Level", kind: "integer", minimum: 1 }],
    onSubmit, ...overrides,
  }, null);
  const form = entry.element as unknown as FakeElement;
  dom.document.body.append(form);
  const field = (name: string) => form.querySelector(`[data-testid="cast-${name}"]`)!;
  const message = form.querySelector('[data-testid="cast-message"]')!;
  const submit = (values: Record<string, string>) => {
    for (const [name, value] of Object.entries(values)) field(name).value = value;
    return fire(form, "submit");
  };
  return { entry, form, onSubmit, message, submit };
}

describe("developer sheet ID entry", () => {
  it("submits validated integers as numbers and clears the message", () => {
    const { onSubmit, message, submit } = mountIdEntry();
    const event = submit({ skillId: "3", level: "1" });
    expect(event.defaultPrevented).toBe(true);
    expect(onSubmit).toHaveBeenCalledWith({ skillId: 3, level: 1 });
    expect(message.hidden).toBe(true);
    expect(message.getAttribute("aria-live")).toBe("polite");
  });

  it.each(["", "-1", "1.5", "abc", "1234567890"])("rejects skill ID %j with a visible message and dispatches nothing", rejected => {
    const { onSubmit, message, submit } = mountIdEntry();
    submit({ skillId: rejected, level: "1" });
    expect(onSubmit).not.toHaveBeenCalled();
    expect(message.hidden).toBe(false);
    expect(message.textContent).toMatch(/^Skill ID /);
  });

  it("enforces the field minimum", () => {
    const { onSubmit, message, submit } = mountIdEntry();
    submit({ skillId: "3", level: "0" });
    expect(onSubmit).not.toHaveBeenCalled();
    expect(message.textContent).toBe("Level must be at least 1.");
  });

  it("accepts bounded interface window names and rejects markup", () => {
    const { onSubmit, message, submit } = mountIdEntry({ fields: [{ name: "name", label: "Window", kind: "name" }] });
    submit({ name: "<img src=x>" });
    expect(onSubmit).not.toHaveBeenCalled();
    expect(message.textContent).toMatch(/^Window must start with a letter/);
    submit({ name: "StatusWnd" });
    expect(onSubmit).toHaveBeenCalledWith({ name: "StatusWnd" });
    expect(message.hidden).toBe(true);
  });

  it("is reachable from a sheet group with a hover-card info button", () => {
    const host = dom.document.createElement("section"); host.className = "world-interface";
    const canvas = dom.document.createElement("canvas");
    const toggle = dom.document.createElement("button");
    host.append(toggle); dom.document.body.append(canvas, host);
    host.rect = { left: 0, top: 0, width: 1280, height: 800 };
    const sheet = new DevSheet({ host: host as unknown as HTMLElement, canvas: canvas as unknown as HTMLCanvasElement,
      toggle: toggle as unknown as HTMLButtonElement, worldTargets: [canvas] as unknown as EventTarget[], storage: null, matchMedia: fakeMedia().matchMedia });
    try {
      const onSubmit = vi.fn();
      const group = sheet.section("sandbox", { title: "Sandbox" }).group("spawn-npc", "Spawn NPC");
      const entry = group.idEntry({ label: "Spawn NPC", testId: "spawn", submitText: "Spawn", hint: "Dispatches spawn-npc.",
        fields: [{ name: "npcId", label: "NPC ID", kind: "integer", minimum: 0 }], onSubmit });
      const form = entry.element as unknown as FakeElement;
      expect((group.element as unknown as FakeElement).contains(form)).toBe(true);
      expect(form.querySelector(".dev-id-entry-actions .dev-info")).not.toBeNull();
      form.querySelector('[data-testid="spawn-npcId"]')!.value = "21622";
      fire(form, "submit");
      expect(onSubmit).toHaveBeenCalledWith({ npcId: 21622 });
    } finally { sheet.dispose(); }
  });
});
