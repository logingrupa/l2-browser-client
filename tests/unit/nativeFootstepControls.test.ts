import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssetPackage } from "../../src/assets/package/readAssetPackage";
import type { WorldAudioPlaybackReceipt } from "../../src/audio/WorldAudioMixer";
import {
  FOOTSTEP_SURFACES, FOOTSTEP_WATER_SURFACES, type FootstepSurfaceId, type StepSoundClip, type StepSoundLibrary, type StepSoundSurface,
} from "../../src/audio/footstepSurfaces";
import type { FootstepGroundContext } from "../../src/audio/footstepSurfaceAuto";
import { attachNativeFootstepControls } from "../../src/audio/nativeFootstepControls";
import { createNativeFootstepPreview, NATIVE_FOOTSTEP_WORLD_DEFAULT } from "../../src/audio/nativeFootstepPreview";

/** Minimal DOM: enough for createElement/append/dataset/attributes/events. */
class FakeElement extends EventTarget {
  children: FakeElement[] = []; parent: FakeElement | null = null; dataset: Record<string, string> = {};
  attributes = new Map<string, string>(); textContent = ""; className = ""; type = ""; disabled = false; hidden = false;
  constructor(readonly tagName: string) { super(); }
  append(...nodes: (FakeElement | string)[]) {
    for (const node of nodes) if (typeof node !== "string") { node.parent = this; this.children.push(node); } else this.textContent += node;
  }
  remove() { if (this.parent) { this.parent.children = this.parent.children.filter(child => child !== this); this.parent = null; } }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  click() { this.dispatchEvent(new Event("click")); }
  all(): FakeElement[] { return [this, ...this.children.flatMap(child => child.all())]; }
  find(testid: string) { const found = this.all().find(element => element.dataset.testid === testid); if (!found) throw new Error(`missing ${testid}`); return found; }
}

const asset = { manifest: { id: "synthetic:human" }, files: new Map() } as unknown as AssetPackage;
const clip = (object: string): StepSoundClip => ({ key: `native-stepsound:${object}`, object, dependencyId: object, sha256: "0".repeat(64), durationSeconds: .5 });
function library(): StepSoundLibrary {
  const surfaces = new Map<FootstepSurfaceId, StepSoundSurface>();
  for (const id of FOOTSTEP_SURFACES) {
    const water = FOOTSTEP_WATER_SURFACES.has(id), count = id === "Stone" ? 2 : 3;
    const walk = Array.from({ length: count }, (_, i) => clip(`stepsound.${id}.walk_0${i + 1}`));
    surfaces.set(id, { id, label: id, group: id, gaitSplit: !water, walk, run: water ? walk : walk.map(row => clip(row.object.replace("walk", "run"))) });
  }
  return { manifestSha256: "a".repeat(64), packageSha256: "e".repeat(64), soundCount: 93, surfaces,
    events: { Water_In: clip("stepsound.water.Water_In"), Water_Out: clip("stepsound.water.Water_Out") },
    boots: [1, 2, 3].map(i => clip(`stepsound.noise_boots.noise_0${i}`)), placements: new Map(), sectionManifestSha256: null };
}
const definitions = [{ asset, clip: "Run", durationSeconds: 1, gait: "run" as const,
  events: [{ ordinal: 1, notify: "N", timeSeconds: .25, arrays: { GrassRunSound: [{ reference: "StepSound.Grass.grass_run_01", key: "grass-run0" }],
    DefaultRunSound: [{ reference: "StepSound.Default.default_run_01", key: "def-run0" }] } }] }];
const grass: FootstepGroundContext = { kind: "terrain", meshName: "terrain", sourceId: "20_20.TerrainInfo0", material: null, nativeXY: [1, 2],
  decoGrass: { status: "sampled", expected: 3.24, threshold: 2, grass: true, sector: 4, quad: [1, 2] }, footVolume: null, detail: null };
const clock = (elapsedSeconds: number) => ({ clip: "Run", mode: "loop" as const, elapsedSeconds, durationSeconds: 1, playing: true, completed: false });
let host: FakeElement;
beforeEach(() => {
  vi.stubGlobal("document", { createElement: (tag: string) => new FakeElement(tag) });
  host = new FakeElement("div");
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
function setup(withLibrary = true, options: Parameters<typeof attachNativeFootstepControls>[3] = {}) {
  const play = vi.fn((key: string, owner: string, offsetSeconds = 0): WorldAudioPlaybackReceipt => ({ id: 1, key, owner, offsetSeconds, contextTime: 0, durationSeconds: 1 }));
  const preview = createNativeFootstepPreview(definitions, { play, stopOwner: vi.fn() },
    { stepSounds: withLibrary ? library() : null, initialSelection: NATIVE_FOOTSTEP_WORLD_DEFAULT, random: () => 0, surfaceContext: () => grass });
  const controls = attachNativeFootstepControls(host as unknown as HTMLElement, preview, null, { refreshMs: 60_000, ...options });
  return { preview, controls, play, root: controls.element as unknown as FakeElement };
}
const checked = (element: FakeElement) => element.getAttribute("aria-checked") === "true";
const step = (preview: ReturnType<typeof setup>["preview"]) => { const player = preview.bindActor("local-player", asset); player.start(clock(0)); player.advance(clock(0), clock(.5)); };

describe("footstep dev controls", () => {
  it("renders every small choice as a chip radiogroup with the world default Auto, RenderDeco on and boots off", () => {
    const { root, controls } = setup();
    expect(host.children).toEqual([root]);
    const groups = root.all().filter(element => element.className === "dev-chips");
    expect(groups.map(group => group.getAttribute("aria-label"))).toEqual(["Footstep mode", "RenderDeco grass footsteps", "Footstep surface",
      "Footstep variation", "Boot noise layer"]);
    expect(groups.every(group => group.getAttribute("role") === "radiogroup" &&
      group.children.every(chip => chip.tagName === "button" && chip.type === "button" && chip.getAttribute("role") === "radio" &&
        chip.getAttribute("aria-checked") !== null && !!chip.dataset.value))).toBe(true);
    expect(root.find("native-footstep-mode-auto").getAttribute("aria-checked")).toBe("true");
    expect(checked(root.find("native-footstep-render-deco-on"))).toBe(true);
    expect(checked(root.find("native-footstep-boots-off"))).toBe(true);
    expect(root.find("native-footstep-status").hidden).toBe(true);
    expect(root.all().some(element => element.tagName === "style" || element.tagName === "select")).toBe(false);
    controls.dispose(); controls.dispose(); expect(host.children).toEqual([]);
  });

  it("keeps surface chips enabled in Auto: a tap switches to Manual with a short hint that clears", () => {
    vi.useFakeTimers();
    const { root, preview } = setup(true, { hintMs: 1000 });
    expect(FOOTSTEP_SURFACES.every(surface => !root.find(`native-footstep-surface-${surface}`).disabled)).toBe(true);
    root.find("native-footstep-surface-Stone").click();
    expect(preview.surfaceSelection()).toEqual({ mode: "manual", surface: "Stone", variation: "random" });
    expect(root.find("native-footstep-hint")).toMatchObject({ hidden: false, textContent: "Manual: Stone. Tap Auto to return to the native order." });
    expect(checked(root.find("native-footstep-surface-Stone"))).toBe(true);
    expect(() => root.find("native-footstep-variation-3")).toThrow("missing");
    vi.advanceTimersByTime(1100); expect(root.find("native-footstep-hint").hidden).toBe(true);
    root.find("native-footstep-variation-2").click(); expect(preview.surfaceSelection().variation).toBe(1);
    root.find("native-footstep-surface-Water_Shalow").click();
    expect(root.all().filter(element => element.dataset.testid?.startsWith("native-footstep-variation-")).length).toBe(4);
    root.find("native-footstep-mode-auto").click(); expect(preview.surfaceSelection().mode).toBe("auto");
    expect(FOOTSTEP_SURFACES.every(surface => !checked(root.find(`native-footstep-surface-${surface}`)))).toBe(true);
  });

  it("toggles RenderDeco grass, boots and water test actions", () => {
    const { root, preview, play } = setup();
    root.find("native-footstep-render-deco-off").click(); expect(preview.autoSurface().renderDecoGrass()).toBe(false);
    expect(checked(root.find("native-footstep-render-deco-off"))).toBe(true);
    root.find("native-footstep-boots-on").click(); expect(preview.inspection().bootsLayer).toBe(true);
    root.find("native-footstep-water-in").click();
    expect(play).toHaveBeenCalledWith("native-stepsound:stepsound.water.Water_In", "native-footstep:test-action", 0);
  });

  it("shows compact live readouts and an Auto legend, with details only in live hover-card rows", () => {
    const { root, preview, controls } = setup();
    const rows = controls.describe();
    expect(rows.find(row => row.name === "footsteps.auto.rule")!.status).toBe("presentation");
    step(preview); controls.refresh();
    expect(root.find("native-footstep-readout-surface").textContent).toBe("Grass · deco ≈ 3.2 ≥ 2");
    expect(root.find("native-footstep-readout-clip").textContent).toBe("run · grass_run_01 #1 · played");
    expect(root.find("native-footstep-surface").children[0]!.textContent).toBe("Surface · auto → Grass");
    expect(root.find("native-footstep-surface-Grass").dataset.auto).toBe("true");
    const surface = rows.find(row => row.name === "footsteps.surface")!;
    expect(surface.value()).toBe("auto → Grass (manual: Default)");
    expect(rows.find(row => row.name === "footsteps.auto.rule")!.source).toContain("approximation of native deco instance count");
    expect(rows.find(row => row.name === "footsteps.auto.terrain")!.value()).toBe("GRASS · deco ≈ 3.24 (≥ 2 → Grass)");
    expect(rows.find(row => row.name === "footsteps.gait")!.value()).toBe("run (clip; clip run)");
    root.find("native-footstep-surface-Ice").click();
    expect(surface.value()).toBe("Ice"); expect(surface.status).toBe("native");
    expect(rows.map(row => row.name)).toEqual(["footsteps.mode", "footsteps.surface", "footsteps.variation", "footsteps.gait", "footsteps.auto.rule",
      "footsteps.auto.support", "footsteps.auto.supportStepSounds", "footsteps.auto.actor", "footsteps.auto.terrain", "footsteps.renderDecoGrass",
      "footsteps.bootsLayer", "footsteps.waterTransitions", "footsteps.playback", "footsteps.lastClip"]);
    expect(rows.every(row => ["native", "presentation", "unverified"].includes(row.status) && row.source.length > 0 && typeof row.value() === "string")).toBe(true);
    expect(rows.find(row => row.name === "footsteps.auto.actor")!.source).toContain("Not ordinary Stone");
    expect(root.all().every(element => (element.textContent ?? "").length < 120)).toBe(true);
  });

  it("disables Manual and package actions when unstaged and refreshes on its interval only while visible", () => {
    vi.useFakeTimers();
    let visible = false;
    const play = vi.fn(() => null);
    const preview = createNativeFootstepPreview(definitions, { play, stopOwner: vi.fn() });
    const controls = attachNativeFootstepControls(host as unknown as HTMLElement, preview, null,
      { stepSoundFailure: "HTTP 404", refreshMs: 100, isVisible: () => visible });
    const root = controls.element as unknown as FakeElement;
    expect(root.find("native-footstep-mode-manual").disabled).toBe(true);
    expect(root.find("native-footstep-boots-on").disabled).toBe(true); expect(root.find("native-footstep-water-out").disabled).toBe(true);
    expect(root.find("native-footstep-status")).toMatchObject({ hidden: false });
    expect(root.find("native-footstep-status").textContent).toContain("HTTP 404");
    preview.setSurfaceSelection(NATIVE_FOOTSTEP_WORLD_DEFAULT); vi.advanceTimersByTime(250);
    expect(checked(root.find("native-footstep-mode-auto"))).toBe(false);
    visible = true; vi.advanceTimersByTime(150);
    expect(checked(root.find("native-footstep-mode-auto"))).toBe(true);
    controls.dispose(); preview.setSurfaceSelection({ ...NATIVE_FOOTSTEP_WORLD_DEFAULT, mode: "off" }); vi.advanceTimersByTime(500);
    expect(checked(root.find("native-footstep-mode-auto"))).toBe(true);
  });
});
