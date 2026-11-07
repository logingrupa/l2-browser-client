import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorldAudioMixer } from "../../src/audio/WorldAudioMixer";
import { attachWorldAudioControls } from "../../src/audio/worldAudioControls";
import type { WorldAmbience } from "../../src/audio/worldAmbience";
import { evidenceStatus, worldAudioVariables } from "../../src/runtime/nativeSliceSheet";
import { fakeMixerContext } from "./fakeWebAudio";

/** Just enough DOM for the plain control module (the unit suite has no jsdom). */
class FakeElement {
  children: (FakeElement | string)[] = [];
  parent: FakeElement | null = null;
  dataset: Record<string, string> = {};
  attributes = new Map<string, string>();
  className = ""; type = ""; value = ""; min = ""; max = ""; step = ""; id = ""; disabled = false; tabIndex = 0;
  private text = "";
  private listeners = new Map<string, ((event: unknown) => void)[]>();
  constructor(readonly tagName: string) {}
  get textContent(): string { return this.text + this.children.map(child => typeof child === "string" ? child : child.textContent).join(""); }
  set textContent(value: string) { this.text = value; this.children = []; }
  get isConnected(): boolean { return true; }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
  append(...nodes: (FakeElement | string)[]): void { for (const node of nodes) { if (typeof node !== "string") node.parent = this; this.children.push(node); } }
  remove(): void { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); this.parent = null; }
  addEventListener(type: string, listener: (event: unknown) => void, options?: { signal?: AbortSignal }): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
    options?.signal?.addEventListener("abort", () => this.listeners.set(type, []));
  }
  dispatch(type: string, event: unknown = { type }): void { for (const listener of this.listeners.get(type) ?? []) listener(event); }
  click(): void { this.dispatch("click"); }
  focus(): void {}
  getClientRects(): unknown[] { return [1]; }
  all(): FakeElement[] { return this.children.flatMap(child => typeof child === "string" ? [] : [child, ...child.all()]); }
  byTestId(id: string): FakeElement { return this.all().find(element => element.dataset.testid === id)!; }
}

beforeEach(() => { vi.stubGlobal("document", { createElement: (tag: string) => new FakeElement(tag.toUpperCase()) }); });
afterEach(() => { vi.unstubAllGlobals(); });

function ambienceStub() {
  let time: "auto" | "day" | "night" = "auto";
  const setTimeOfDay = vi.fn((value: typeof time) => { time = value; });
  const stub = {
    get timeOfDay() { return time; }, setTimeOfDay, get enabled() { return true; },
    inspection: () => ({ enabled: true, timeOfDay: time, isDay: time !== "night", hour: 12, emitters: 2622, candidates: 98, inRange: 59, gated: 39,
      sounds: { loaded: 20, loading: 0, released: 0, failed: {} },
      loops: [{ id: "a", sound: "ambsound.wind.wind_04", distance: 12.5, distanceUnits: 1250, gain: .13 }, { id: "b", sound: "ambsound.wind.wind_04", distance: 20, distanceUnits: 2000, gain: .05 }],
      oneShots: { started: 3, active: 2, rolls: 10, skippedForVoices: 0 }, voices: { active: 4, limit: 16, loopLimit: 8 },
      radiusMultiplier: 50, listener: null, listenerPolicy: "", policy: "" }),
  };
  return { ambience: stub as unknown as WorldAmbience, setTimeOfDay };
}

describe("world audio controls", () => {
  it("renders chip groups, a 0–1000 % music level and live hover-card rows", () => {
    const { makeContext } = fakeMixerContext();
    const mixer = new WorldAudioMixer({ makeContext }), host = new FakeElement("DIV");
    const { ambience, setTimeOfDay } = ambienceStub();
    const controls = attachWorldAudioControls(host as unknown as HTMLElement, mixer, { ambience, isVisible: () => true });
    const time = host.byTestId("world-ambience-time-chips");
    expect(time.className).toContain("dev-chips");
    expect([time.getAttribute("role"), time.getAttribute("aria-label")]).toEqual(["radiogroup", "Ambient game hour"]);
    const chips = time.children as FakeElement[];
    expect(chips.map(chip => [chip.tagName, chip.type, chip.getAttribute("role"), chip.dataset.value, chip.getAttribute("aria-checked")]))
      .toEqual([["BUTTON", "button", "radio", "auto", "true"], ["BUTTON", "button", "radio", "day", "false"], ["BUTTON", "button", "radio", "night", "false"]]);
    chips[2]!.click();
    expect(setTimeOfDay).toHaveBeenCalledWith("night");
    expect(chips[2]!.getAttribute("aria-checked")).toBe("true");
    const musicOff = (host.byTestId("world-audio-mute-music").children as FakeElement[]).find(chip => chip.dataset.value === "off")!;
    musicOff.click();
    expect(mixer.busState("music").muted).toBe(true);
    const level = host.byTestId("world-audio-volume-music-input");
    expect([level.min, level.max, level.value]).toEqual(["0", "1000", "100"]);
    level.value = "300"; level.dispatch("input");
    expect(mixer.busState("music").volume).toBe(3);
    expect(host.byTestId("world-audio-volume-music").textContent).toContain("300 % (gain 0.30)");
    expect(host.byTestId("world-ambience-nearby").textContent).toContain("98 emitters in range · 39 gated (night)");
    expect(host.byTestId("world-ambience-nearby").textContent).toContain("wind_04 13–20 m");
    // Every card names rows that exist; statuses map to the right badges.
    const rows = controls.describe(), names = new Set(rows.map(row => row.name));
    for (const card of controls.cards()) for (const name of card.rows) expect(names.has(name), `${card.testId}: ${name}`).toBe(true);
    for (const card of controls.cards()) expect(host.byTestId(card.testId), card.testId).toBeDefined();
    const badge = (name: string) => evidenceStatus(rows.find(row => row.name === name)!.status);
    expect([badge("Music rule"), badge("Ambient gain rule"), badge("Music region"), badge("Nearby ambient emitters")]).toEqual(["native", "native", "native", "native"]);
    expect([badge("Ambient game hour"), badge("Ambient listener"), badge("Music listener"), badge("Limiter"), badge("Music level")])
      .toEqual(["presentation", "presentation", "presentation", "presentation", "presentation"]);
    const variables = worldAudioVariables(rows);
    expect(variables.find(row => row.name === "audio.ambientGameHour")!.value()).toBe("Night → Night (hour 12.0)");
    expect(variables.find(row => row.name === "audio.musicLevel")!.value()).toBe("300 % (off) → gain 0.30");
    controls.dispose();
    expect(host.children).toHaveLength(0);
  });

  it("refreshes only while visible and accepts late world-audio attachment", () => {
    const { makeContext } = fakeMixerContext();
    const mixer = new WorldAudioMixer({ makeContext }), host = new FakeElement("DIV");
    let visible = false;
    const controls = attachWorldAudioControls(host as unknown as HTMLElement, mixer, { worldAudioLoading: true, refreshIntervalMs: 0, isVisible: () => visible });
    const nearby = host.byTestId("world-ambience-nearby");
    expect(nearby.textContent).toBe("Ambience loading…");
    const { ambience } = ambienceStub();
    controls.setWorldAudio({ music: null, ambience, failure: null });
    expect(nearby.textContent).toContain("98 emitters in range");
    mixer.setMuted(true);
    controls.update();
    expect(host.byTestId("mute-world-audio").textContent).toBe("Mute audio"); // hidden: no DOM work
    visible = true; controls.update();
    expect(host.byTestId("mute-world-audio").textContent).toBe("Unmute audio");
    controls.setWorldAudio({ music: null, ambience: null, failure: "manifest hash differs" });
    expect(nearby.textContent).toBe("Ambience unavailable: manifest hash differs");
    controls.dispose();
  });
});
