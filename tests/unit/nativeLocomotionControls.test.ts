import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NativeSliceAdapter, nativeSliceSpeedProfile } from "../../src/world/NativeSliceAdapter";
import { attachNativeLocomotionControls } from "../../src/ui/nativeLocomotionControls";

class FakeElement extends EventTarget {
  children: FakeElement[] = []; parent: FakeElement | null = null; dataset: Record<string, string> = {};
  attributes = new Map<string, string>(); textContent = ""; className = ""; type = ""; disabled = false;
  constructor(readonly tagName: string) { super(); }
  append(...nodes: FakeElement[]) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
  remove() { if (this.parent) { this.parent.children = this.parent.children.filter(child => child !== this); this.parent = null; } }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  click() { this.dispatchEvent(new Event("click")); }
  all(): FakeElement[] { return [this, ...this.children.flatMap(child => child.all())]; }
  find(testid: string) { const found = this.all().find(element => element.dataset.testid === testid); if (!found) throw new Error(`missing ${testid}`); return found; }
}
let host: FakeElement;
beforeEach(() => { vi.stubGlobal("document", { createElement: (tag: string) => new FakeElement(tag) }); host = new FakeElement("div"); });
afterEach(() => vi.unstubAllGlobals());

describe("walk/run dev controls", () => {
  it("shows the armed gait as a chip radiogroup with the aCis speeds and dispatches set-locomotion", () => {
    const adapter = new NativeSliceAdapter({ x: 0, y: 0, z: 0 }, undefined, null, undefined, { walkSupported: true, speed: nativeSliceSpeedProfile(100) });
    const controls = attachNativeLocomotionControls(host as unknown as HTMLElement, adapter, true, null);
    const group = host.all().find(element => element.className === "dev-chips")!;
    expect([group.getAttribute("role"), group.getAttribute("aria-label")]).toEqual(["radiogroup", "Movement gait"]);
    expect(group.children.map(chip => [chip.dataset.value, chip.getAttribute("role"), chip.getAttribute("aria-checked")])).toEqual([
      ["walk", "radio", "false"], ["run", "radio", "true"]]);
    expect(host.find("native-locomotion-speed").textContent).toBe("1.15 m/s (walk speed for the first 0.4 s)");
    host.find("native-locomotion-walk").click();
    expect(adapter.locomotionMode).toBe("walk");
    expect(host.find("native-locomotion-walk").getAttribute("aria-checked")).toBe("true");
    expect(host.find("native-locomotion-speed").textContent).toBe("0.80 m/s");
    adapter.dispatch({ type: "set-locomotion", mode: "run" });
    expect(host.find("native-locomotion-run").getAttribute("aria-checked")).toBe("true");
    controls.dispose(); expect(host.children).toEqual([]);
    adapter.dispose();
  });

  it("disables Walk without a verified walk clip and shows the reason", () => {
    const adapter = new NativeSliceAdapter({ x: 0, y: 0, z: 0 });
    attachNativeLocomotionControls(host as unknown as HTMLElement, adapter, false, "Walking needs one verified walk/run pair for this character.");
    expect(host.find("native-locomotion-walk").disabled).toBe(true);
    expect(host.all().some(element => element.textContent.startsWith("Walking needs"))).toBe(true);
    adapter.dispose();
  });
});
