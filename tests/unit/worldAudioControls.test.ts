import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorldAudioMixer } from "../../src/audio/WorldAudioMixer";
import { attachWorldAudioControls } from "../../src/audio/worldAudioControls";
import type { WorldAmbience } from "../../src/audio/worldAmbience";
import { evidenceStatus, worldAudioVariables } from "../../src/runtime/nativeSliceSheet";
import type { NativePlacementAudio } from "../../src/assets/native/loadNativeWorldAudio";
import type { WorldMusic } from "../../src/audio/worldMusic";
import { fakeMixerContext } from "./fakeWebAudio";
import { MinimalFakeDomElement, minimalFakeDocument } from "./minimalFakeDomElement";

beforeEach(() => { vi.stubGlobal("document", minimalFakeDocument); });
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
  it("renders chip groups, a 0-1000 % music level and live hover-card rows", () => {
    const { makeContext } = fakeMixerContext();
    const mixer = new WorldAudioMixer({ makeContext }), host = new MinimalFakeDomElement("DIV");
    const { ambience, setTimeOfDay } = ambienceStub();
    const controls = attachWorldAudioControls(host as unknown as HTMLElement, mixer, { ambience, isVisible: () => true });
    const time = host.byTestId("world-ambience-time-chips");
    expect(time.className).toContain("dev-chips");
    expect([time.getAttribute("role"), time.getAttribute("aria-label")]).toEqual(["radiogroup", "Ambient game hour"]);
    const chips = time.children as MinimalFakeDomElement[];
    expect(chips.map(chip => [chip.tagName, chip.type, chip.getAttribute("role"), chip.dataset.value, chip.getAttribute("aria-checked")]))
      .toEqual([["BUTTON", "button", "radio", "auto", "true"], ["BUTTON", "button", "radio", "day", "false"], ["BUTTON", "button", "radio", "night", "false"]]);
    chips[2]!.click();
    expect(setTimeOfDay).toHaveBeenCalledWith("night");
    expect(chips[2]!.getAttribute("aria-checked")).toBe("true");
    const musicOff = (host.byTestId("world-audio-mute-music").children as MinimalFakeDomElement[]).find(chip => chip.dataset.value === "off")!;
    musicOff.click();
    expect(mixer.busState("music").muted).toBe(true);
    const level = host.byTestId("world-audio-volume-music-input");
    expect([level.min, level.max, level.value]).toEqual(["0", "1000", "100"]);
    level.value = "300"; level.dispatch("input");
    expect(mixer.busState("music").volume).toBe(3);
    expect(host.byTestId("world-audio-volume-music-value").textContent).toBe("300 %");
    expect(host.byTestId("world-audio-volume-music-gain").textContent).toBe("gain 0.30");
    const sharedLevelColumnRoles = ["dev-range", "dev-range-value", "dev-level-toggle"];
    for (const bus of ["master", "music", "ambience", "effects"]) {
      const line = host.byTestId(`world-audio-volume-${bus}`), control = line.children[1] as MinimalFakeDomElement;
      expect(line.className, bus).toContain("dev-level-row");
      const levelColumnRolesIncludingEmptyMasterToggleSlot = control.children.map(child => (child as MinimalFakeDomElement).className.split(" ").find(name => sharedLevelColumnRoles.includes(name)));
      expect(levelColumnRolesIncludingEmptyMasterToggleSlot, bus).toEqual(["dev-range", "dev-range-value", "dev-level-toggle"]);
    }
    expect(host.byTestId("world-ambience-nearby").textContent).toContain("98 emitters in range · 39 gated (night)");
    expect(host.byTestId("world-ambience-nearby").textContent).toContain("wind_04 13-20 m");
    const hoverCardRows = controls.describe(), existingRowNames = new Set(hoverCardRows.map(row => row.name));
    for (const card of controls.cards()) for (const name of card.rows) expect(existingRowNames.has(name), `${card.testId}: ${name}`).toBe(true);
    for (const card of controls.cards()) expect(host.byTestId(card.testId), card.testId).toBeDefined();
    const evidenceBadgeOfRow = (name: string) => evidenceStatus(hoverCardRows.find(row => row.name === name)!.status);
    expect([evidenceBadgeOfRow("Music rule"), evidenceBadgeOfRow("Ambient gain rule"), evidenceBadgeOfRow("Music region")])
      .toEqual(["unverified", "unverified", "unverified"]);
    expect([evidenceBadgeOfRow("Nearby ambient emitters"), evidenceBadgeOfRow("Ambient range multiplier")]).toEqual(["native", "native"]);
    expect([evidenceBadgeOfRow("Ambient game hour"), evidenceBadgeOfRow("Ambient listener"), evidenceBadgeOfRow("Music listener"), evidenceBadgeOfRow("Limiter"), evidenceBadgeOfRow("Music level")])
      .toEqual(["presentation", "presentation", "presentation", "presentation", "presentation"]);
    const variables = worldAudioVariables(hoverCardRows);
    expect(variables.find(row => row.name === "audio.ambientGameHour")!.value()).toBe("Night → Night (hour 12.0)");
    expect(variables.find(row => row.name === "audio.musicLevel")!.value()).toBe("300 % (off) → gain 0.30");
    controls.dispose();
    expect(host.children).toHaveLength(0);
  });

  it("shows the native gap countdown and the pre-rolled next track", () => {
    const { makeContext } = fakeMixerContext();
    const mixer = new WorldAudioMixer({ makeContext }), host = new MinimalFakeDomElement("DIV");
    const volume = { id: "interlude:20_20.MusicVolume1", musicId: 202002, forcePlayMusic: true, group: 0 };
    const music = { enabled: true, volumes: [], next: vi.fn(),
      inspection: () => ({ sourceMap: "maps/20_20.unr", volumes: [], trackNames: ["F09_F", "F10_S01"], enabled: true, state: "gap", volume, inside: [volume.id], track: null, nextPick: "music:F10_S01", gapRemainingSeconds: 11.2,
        fading: [], candidates: ["music:F09_F", "music:F10_S01"], gain: .1, streaming: "", failures: {}, rules: {}, policy: "" }) };
    const controls = attachWorldAudioControls(host as unknown as HTMLElement, mixer, { music: music as never, isVisible: () => true });
    expect(host.byTestId("world-music-now-playing").textContent)
      .toBe("Gap 12 s left → F10_S01 (native 30 s silence after each track) · 20_20.MusicVolume1 · ID 202002");
    expect(controls.describe().find(row => row.name === "Music rule")!.value()).toBe("gap (12 s left, next F10_S01 pre-rolled to preload)");
    controls.dispose();
  });

  it("describes the selected tile from its loaded manifests and names no fixed tile", () => {
    const { makeContext } = fakeMixerContext();
    const mixer = new WorldAudioMixer({ makeContext }), host = new MinimalFakeDomElement("DIV");
    const volume = { id: "interlude:20_21.MusicVolume5", object: "20_21.MusicVolume5", musicId: 202102, forcePlayMusic: null, group: null,
      boundsNative: { min: [0, 0, 0], max: [1, 1, 1] } };
    const music = { enabled: true, volumes: [volume], next: vi.fn(),
      inspection: () => ({ sourceMap: "maps/20_21.unr", volumes: [volume], trackNames: ["D04_F", "D04_S01"], enabled: true, state: "silent", volume: null,
        inside: [], track: null, nextPick: null, gapRemainingSeconds: null, fading: [], candidates: [], gain: .1, streaming: "", failures: {}, rules: {}, policy: "" }) };
    const { ambience } = ambienceStub();
    const placementAudio = { manifestSha256: "e".repeat(64), sourceMap: "maps/20_21.unr", properties: ["StepSound_1", "StepSound_2"],
      placements: [{ placementId: "interlude:20_21.StaticMeshActor1", sounds: ["marsh_run_01", "marsh_run_02"] },
        { placementId: "interlude:20_21.StaticMeshActor2", sounds: ["marsh_run_01", null] }],
      sounds: new Map([["marsh_run_01", {}], ["marsh_run_02", {}]]), fetchSound: vi.fn() } as unknown as NativePlacementAudio;
    const controls = attachWorldAudioControls(host as unknown as HTMLElement, mixer, { music: music as unknown as WorldMusic, isVisible: () => true });
    controls.setWorldAudio({ music: music as unknown as WorldMusic, ambience: { ...ambience, inspection: () => ({ ...ambience.inspection(), sourceMap: "maps/20_21.unr" }) } as WorldAmbience,
      placementAudio, failure: null });
    expect(host.byTestId("world-music-now-playing").textContent).toBe("Music: outside every MusicVolume, silent; default music unresolved.");
    expect(host.byTestId("world-placement-audio").textContent)
      .toBe("2 placements bind 3 StepSound references to 2 sounds (StepSound_1, StepSound_2); automatic footstep playback is polish (DEC-OWN-1).");
    const nowPlayingCard = controls.cards().find(card => card.testId === "world-music-now-playing")!;
    expect(nowPlayingCard.description).toContain("maps/20_21.unr MusicVolume brushes (1 volumes) → nMusicID → musicinfo.dat strings (D04_F, D04_S01)");
    const rows = controls.describe(), sourceOf = (name: string) => rows.find(row => row.name === name)!.source;
    expect(sourceOf("Now playing")).toContain("scripts/world/world_audio_step.py");
    expect(sourceOf("Nearby ambient emitters")).toBe("AmbientSoundObject fields of maps/20_21.unr, converted by scripts/world/world_audio_step.py; omitted fields use Engine.u class defaults");
    expect(sourceOf("Placement audio")).toContain("StepSound properties of maps/20_21.unr");
    expect(rows.find(row => row.name === "Placement audio")!.status).toContain("polish item (DEC-OWN-1)");
    const everyText = JSON.stringify([controls.cards(), rows.map(row => [row.name, row.values, row.source, row.status])]);
    expect(everyText).not.toContain("20_20");
    controls.dispose();
  });

  it("refreshes only while visible and accepts late world-audio attachment", () => {
    const { makeContext } = fakeMixerContext();
    const mixer = new WorldAudioMixer({ makeContext }), host = new MinimalFakeDomElement("DIV");
    let visible = false;
    const controls = attachWorldAudioControls(host as unknown as HTMLElement, mixer, { worldAudioLoading: true, refreshIntervalMs: 0, isVisible: () => visible });
    const nearby = host.byTestId("world-ambience-nearby");
    expect(nearby.textContent).toBe("Ambience loading…");
    const { ambience } = ambienceStub();
    controls.setWorldAudio({ music: null, ambience, failure: null });
    expect(nearby.textContent).toContain("98 emitters in range");
    mixer.setMuted(true);
    controls.update();
    expect(host.byTestId("mute-world-audio").textContent, "hidden controls skip DOM work").toBe("Mute audio");
    visible = true; controls.update();
    expect(host.byTestId("mute-world-audio").textContent).toBe("Unmute audio");
    controls.setWorldAudio({ music: null, ambience: null, failure: "manifest hash differs" });
    expect(nearby.textContent).toBe("Ambience unavailable: manifest hash differs");
    controls.dispose();
  });

  it("re-renders the status line on the unlock itself, not on the next periodic refresh", async () => {
    const { makeContext } = fakeMixerContext();
    const mixer = new WorldAudioMixer({ makeContext }), host = new MinimalFakeDomElement("DIV");
    const controls = attachWorldAudioControls(host as unknown as HTMLElement, mixer, { refreshIntervalMs: 60_000, isVisible: () => true });
    const status = host.byTestId("world-audio-status");
    expect(status.textContent).toBe("Sound starts on your first tap, click or key press.");
    await mixer.unlock();
    expect(mixer.locked).toBe(false);
    expect(status.textContent).toMatch(/^Audio on/);
    expect(host.byTestId("enable-world-audio").textContent).toBe("Audio enabled");
    controls.dispose(); mixer.dispose();
  });
});
