import { afterEach, describe, expect, it, vi } from "vitest";
import type { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import type { Scene } from "@babylonjs/core/scene";
import { attachNativeSliceDebugSection } from "../../src/runtime/nativeSliceDebug";
import { defaultNativePlayerProfile } from "../../src/assets/native/loadNativePlayerProfiles";
import type { EntityRegistry } from "../../src/entities/EntityRegistry";
import type { DevSection } from "../../src/ui/devSheet/DevSheet";

interface RecordedButton { label: string; testId: string; disabled: boolean; element: EventTarget }

function debugSectionAt(href: string) {
  const assign = vi.fn();
  vi.stubGlobal("location", { href, search: new URL(href).search, assign });
  const readoutTestIds: string[] = [], buttons: RecordedButton[] = [];
  const group = {
    readout(options: { testId: string }) { readoutTestIds.push(options.testId); },
    button(options: { label: string; testId: string; disabled: boolean }) {
      const element = new EventTarget();
      buttons.push({ ...options, element });
      return element;
    },
  };
  const section = { group: () => group } as unknown as DevSection;
  const events = new AbortController();
  attachNativeSliceDebugSection(section, {
    scene: {} as Scene, camera: {} as ArcRotateCamera, registry: () => ({}) as EntityRegistry,
    playerProfile: defaultNativePlayerProfile, playerChoices: new Map([[defaultNativePlayerProfile.id, defaultNativePlayerProfile]]),
    events: events.signal,
  });
  const button = (testId: string) => buttons.find(candidate => candidate.testId === testId)!;
  return { assign, readoutTestIds, button };
}

afterEach(() => vi.unstubAllGlobals());

describe("native debug URL parameters", () => {
  it("offers authored and character readouts and no world parameter", () => {
    const { readoutTestIds } = debugSectionAt("http://127.0.0.1:5173/");
    expect(readoutTestIds).toContain("native-debug-url-authored");
    expect(readoutTestIds).toContain("native-debug-url-character");
    expect(readoutTestIds).not.toContain("native-debug-url-world");
  });

  it("opens the authored world on the native route while keeping the selected character", () => {
    const { assign, button } = debugSectionAt("http://127.0.0.1:5173/?character=human-female-fighter");
    expect(button("native-debug-open-source").disabled).toBe(true);
    expect(button("native-debug-open-authored").disabled).toBe(false);
    button("native-debug-open-authored").element.dispatchEvent(new Event("click"));
    expect(assign).toHaveBeenCalledExactlyOnceWith("http://127.0.0.1:5173/?character=human-female-fighter&authored=1");
  });

  it("returns to the source world by dropping only authored and never writes a world parameter", () => {
    const { assign, button } = debugSectionAt("http://127.0.0.1:5173/?authored=1");
    expect(button("native-debug-open-authored").disabled).toBe(true);
    button("native-debug-open-source").element.dispatchEvent(new Event("click"));
    expect(assign).toHaveBeenCalledExactlyOnceWith("http://127.0.0.1:5173/");
    expect(new URL(String(assign.mock.calls[0]![0])).searchParams.has("world")).toBe(false);
  });
});
