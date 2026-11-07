import { afterEach, describe, expect, it, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { GetEnvironmentBRDFTexture } from "@babylonjs/core/Misc/brdfTextureTools";
import { NativeActor, type NativeActorClock } from "../../src/assets/native/NativeActor";
import type { AssetPackage } from "../../src/assets/package/readAssetPackage";
import type { WorldAudioPlaybackReceipt } from "../../src/audio/WorldAudioMixer";
import { createNativeFootstepPreview, NATIVE_FOOTSTEP_WORLD_DEFAULT, type NativeFootstepDefinition, type NativeFootstepEvent,
  type NativeFootstepPreview, type NativeFootstepPreviewOptions } from "../../src/audio/nativeFootstepPreview";
import type { FootstepGroundContext } from "../../src/audio/footstepSurfaceAuto";
import { nativeVisualClips, nativeVisualFixture } from "../fixtures/nativeVisualFixture";

const asset = { manifest: { id: "synthetic:human", kind: "model" }, files: new Map() } as unknown as AssetPackage;
const arrays = {
  DefaultRunSound: [{ reference: "Step.Default.Run0", key: "def-run0" }, { reference: "Step.Default.Run1", key: "def-run1" }, { reference: "Step.Default.Run1", key: "def-run1" }],
  DefaultWalkSound: [{ reference: "Step.Default.Walk0", key: "def-walk0" }, { reference: "Step.Default.Walk1", key: "def-walk1" }, { reference: "Step.Default.Walk2", key: "def-walk2" }],
  GrassRunSound: [{ reference: "Step.Grass.Run0", key: "grass0" }, { reference: "Step.Grass.Run1", key: "grass1" }, { reference: "Step.Grass.Run2", key: "grass2" }],
  WaterRunSound: [{ reference: "Step.Water.Run0", key: "water0" }],
  DefaultActorRunSound: [{ reference: "Step.Actor.Run0", key: "actor0" }],
};
const event = (ordinal: number, timeSeconds: number, notify = `Fixture.Footstep${ordinal}`): NativeFootstepEvent => ({ ordinal, timeSeconds, notify, arrays });
const definition = (events: readonly NativeFootstepEvent[] = [event(4, .25), event(7, .75)], patch: Partial<NativeFootstepDefinition> = {}): NativeFootstepDefinition =>
  ({ asset, clip: "Run", durationSeconds: 1, gait: "run", events, ...patch });
const clock = (elapsedSeconds: number, patch: Partial<NativeActorClock> = {}): NativeActorClock =>
  ({ clip: "Run", mode: "loop", elapsedSeconds, durationSeconds: 1, playing: true, completed: false, ...patch });
function mixer(maxOffset = Infinity) {
  let state: "running" | "locked" | "muted" | "paused" = "running", next = 0;
  return { stopOwner: vi.fn<(owner: string) => void>(),
    play: vi.fn((key: string, owner: string, offsetSeconds = 0): WorldAudioPlaybackReceipt | null =>
      state === "running" && offsetSeconds <= maxOffset ? { id: ++next, key, owner, offsetSeconds, contextTime: 10, durationSeconds: 2 } : null),
    setState(value: typeof state) { state = value; } };
}
const previews: NativeFootstepPreview[] = [];
function setup(definitions = [definition()], maxOffset = Infinity, options: NativeFootstepPreviewOptions = {}) {
  const output = mixer(maxOffset), preview = createNativeFootstepPreview(definitions, output, { random: () => 0, ...options });
  previews.push(preview);
  return { output, preview, player: preview.bindActor("human", definitions[0]!.asset) };
}
/** Auto without a support context resolves LAND: the authored Default{Walk,Run}Sound arrays. */
const select = (preview: NativeFootstepPreview) => preview.setSurfaceSelection(NATIVE_FOOTSTEP_WORLD_DEFAULT);
const off = (preview: NativeFootstepPreview) => preview.setSurfaceSelection({ ...NATIVE_FOOTSTEP_WORLD_DEFAULT, mode: "off" });
const grassTerrain: FootstepGroundContext = { kind: "terrain", meshName: "terrain", sourceId: "20_20.TerrainInfo0", material: null, nativeXY: [0, 0],
  decoGrass: { status: "sampled", expected: 4, threshold: 2, grass: true, sector: 0, quad: [0, 0] }, footVolume: null, detail: null };
afterEach(() => { for (const preview of previews.splice(0)) preview.dispose(); vi.restoreAllMocks(); });

describe("original-notify footstep timing", () => {
  it("starts disabled and consumes off events without replay when enabled", () => {
    const { output, preview, player } = setup();
    expect(preview.inspection()).toMatchObject({ enabled: false, available: 2, played: 0, dropped: 0,
      nativeBackendVerified: false, nativeAttenuationVerified: false, surfaceSelection: { mode: "off" } });
    player.start(clock(0)); player.advance(clock(0), clock(.5));
    expect(output.play).not.toHaveBeenCalled(); expect(preview.inspection().dropped).toBe(1);
    select(preview); player.advance(clock(0), clock(.6)); expect(output.play).not.toHaveBeenCalled();
    player.advance(clock(.6), clock(.8)); expect(output.play).toHaveBeenCalledTimes(1);
    expect(preview.inspection().recent.map(row => [row.ordinal, row.reason])).toEqual([[4, "disabled"], [7, "played"]]);
  });

  it("preserves exact source times, repeated notify ordinals and offsets", () => {
    const { output, preview, player } = setup([definition([event(3, .25, "Fixture.SameNotify"), event(8, .25, "Fixture.SameNotify")])]);
    select(preview); player.start(clock(0)); player.advance(clock(0), clock(.24)); expect(output.play).not.toHaveBeenCalled();
    player.advance(clock(.24), clock(.3));
    expect(output.play).toHaveBeenCalledTimes(2);
    expect(preview.inspection().recent.map(row => [row.ordinal, row.sourceTimeSeconds, row.occurrenceTimeSeconds, row.observedTimeSeconds]))
      .toEqual([[3, .25, .25, .3], [8, .25, .25, .3]]);
    for (const row of preview.inspection().recent) expect(row.offsetSeconds).toBeCloseTo(.05, 12);
    player.advance(clock(.24), clock(.3)); player.advance(clock(.3), clock(.3));
    expect(output.play).toHaveBeenCalledTimes(2);
  });

  it("keeps zero/end boundary events distinct over loops and rejects overlapping duplicate intervals", () => {
    const { output, preview, player } = setup([definition([event(0, 0), event(1, .25), event(2, .75), event(3, 1)])]);
    select(preview); player.start(clock(0)); player.advance(clock(0), clock(0)); expect(output.play).not.toHaveBeenCalled();
    player.advance(clock(0), clock(.1)); player.advance(clock(.1), clock(1));
    expect(preview.inspection().recent.map(row => [row.ordinal, row.occurrenceTimeSeconds])).toEqual([[0, 0], [1, .25], [2, .75], [0, 1], [3, 1]]);
    player.advance(clock(0), clock(1)); player.advance(clock(1), clock(1)); expect(output.play).toHaveBeenCalledTimes(5);
    player.advance(clock(.75), clock(2)); expect(output.play).toHaveBeenCalledTimes(9);
    expect(preview.inspection().recent.slice(5).map(row => [row.ordinal, row.occurrenceTimeSeconds])).toEqual([[1, 1.25], [2, 1.75], [0, 2], [3, 2]]);
  });

  it("bounds long-gap dispatch work while counting omitted/stale occurrences and retaining only recent receipts", () => {
    const { output, preview, player } = setup([definition([event(4, .25)])], .25);
    select(preview); player.start(clock(0)); player.advance(clock(0), clock(1_000_000.3));
    expect(output.play).toHaveBeenCalledTimes(2);
    expect(preview.inspection()).toMatchObject({ played: 1, dropped: 1_000_000, skippedByCatchup: 999_999 });
    expect(preview.inspection().recent.map(row => row.occurrenceTimeSeconds)).toEqual([999_999.25, 1_000_000.25]);
    for (let i = 0; i < 70; i++) player.advance(clock(1_000_000.3 + i), clock(1_000_001.3 + i));
    expect(preview.inspection().recent).toHaveLength(64);
    expect(preview.inspection().played).toBe(71);
  });

  it.each(["locked", "muted", "paused"] as const)("consumes mixer-%s events without delayed replay", state => {
    const { output, preview, player } = setup(); select(preview); output.setState(state);
    player.start(clock(0)); player.advance(clock(0), clock(.5)); expect(preview.inspection()).toMatchObject({ played: 0, dropped: 1 });
    output.setState("running"); player.advance(clock(0), clock(.6)); expect(output.play).toHaveBeenCalledTimes(1);
    player.advance(clock(.6), clock(.8)); expect(preview.inspection()).toMatchObject({ played: 1, dropped: 1 });
    expect(preview.inspection().recent.map(row => row.reason)).toEqual(["mixer-rejected", "played"]);
  });

  it("stops paused actors, consumes advancing paused clocks and keeps a frozen resume from duplicating events", () => {
    const { output, preview, player } = setup(); select(preview); player.start(clock(0));
    player.advance(clock(0), clock(.25)); expect(output.play).toHaveBeenCalledTimes(1);
    const owner = output.play.mock.calls[0]![1]; output.stopOwner.mockClear();
    player.advance(clock(.25), clock(.25, { playing: false })); expect(output.stopOwner).toHaveBeenCalledWith(owner);
    player.advance(clock(.25, { playing: false }), clock(.25)); expect(output.play).toHaveBeenCalledTimes(1);
    player.advance(clock(.25), clock(.8, { playing: false })); expect(preview.inspection().recent.at(-1)?.reason).toBe("actor-paused");
    player.advance(clock(.8, { playing: false }), clock(.8)); player.advance(clock(.8), clock(1.25));
    expect(output.play).toHaveBeenCalledTimes(2); expect(preview.inspection()).toMatchObject({ played: 2, dropped: 1 });
  });

  it("does not resurrect a zero-time onset paused at initial time zero", () => {
    const { output, preview, player } = setup([definition([event(0, 0)])]); select(preview); player.start(clock(0));
    player.advance(clock(0), clock(0, { playing: false })); player.advance(clock(0, { playing: false }), clock(0));
    player.advance(clock(0), clock(.1)); expect(output.play).not.toHaveBeenCalled();
    player.advance(clock(.1), clock(1)); expect(output.play).toHaveBeenCalledTimes(1);
    expect(preview.inspection().recent[0]?.occurrenceTimeSeconds).toBe(1);
  });

  it.each([
    { elapsedSeconds: NaN }, { elapsedSeconds: Infinity }, { elapsedSeconds: -1 }, { elapsedSeconds: 1e100 },
    { durationSeconds: 2 }, { mode: "once" as const }, { clip: "Other" }, { completed: true },
  ])("invalidates corrupt or mismatched clocks %j until explicit restart", patch => {
    const { output, preview, player } = setup(); select(preview); player.start(clock(0));
    player.advance(clock(0), clock(.1)); output.stopOwner.mockClear();
    player.advance(clock(.1), clock(.5, patch)); player.advance(clock(.5), clock(.8));
    expect(output.play).not.toHaveBeenCalled(); expect(output.stopOwner).toHaveBeenCalledTimes(1); expect(preview.inspection().invalidClocks).toBe(1);
    player.start(clock(0)); player.advance(clock(0), clock(.25)); expect(output.play).toHaveBeenCalledTimes(1);
  });

  it("rejects a backwards seek, reversed interval and nonfinite previous clock without replay", () => {
    for (const previous of [clock(.5), clock(2), clock(NaN)]) {
      const { output, preview, player } = setup(); select(preview); player.start(clock(0)); player.advance(clock(0), clock(.5));
      player.advance(previous, clock(.1)); player.advance(clock(.1), clock(.8));
      expect(output.play).toHaveBeenCalledTimes(1); expect(preview.inspection().invalidClocks).toBe(1);
    }
  });

  it("consumes omitted callback gaps instead of replaying their cues and can bind mid-loop", () => {
    const { output, preview, player } = setup(); select(preview); player.start(clock(0)); player.advance(clock(.5), clock(.8));
    expect(preview.inspection()).toMatchObject({ skippedClockGap: 1, dropped: 1, played: 1 });
    expect(preview.inspection().recent[0]?.ordinal).toBe(7);
    player.start(clock(2.5)); player.advance(clock(2.5), clock(2.8));
    expect(output.play).toHaveBeenCalledTimes(2); expect(preview.inspection().recent.at(-1)?.occurrenceTimeSeconds).toBe(2.75);
  });

  it("draws uniform authored-array slots, keeps repeated source slots and changes mode without resetting the clock", () => {
    const draws = [.5, .9, .1];
    const { output, preview, player } = setup([definition()], Infinity, { random: () => draws.shift() ?? 0 });
    select(preview); player.start(clock(0)); player.advance(clock(0), clock(.25));
    expect(output.play.mock.calls[0]![0]).toBe("def-run1");
    const owner = output.play.mock.calls[0]![1]; output.stopOwner.mockClear();
    preview.setSurfaceSelection({ mode: "manual", surface: "Grass", variation: 0 }); expect(output.stopOwner).toHaveBeenCalledExactlyOnceWith(owner);
    // Manual needs the stepsound package; without it the step stays unresolved.
    player.advance(clock(.25), clock(.75)); expect(preview.inspection().recent.at(-1)).toMatchObject({ mode: "manual", reason: "unresolved-selection" });
    select(preview); player.advance(clock(.75), clock(1.25));
    // Slot 2 of DefaultRunSound repeats Run1 in the source array.
    expect(output.play.mock.calls[1]![0]).toBe("def-run1");
    expect(preview.inspection().recent.map(row => [row.property, row.variationIndex])).toEqual([["DefaultRunSound", 1], [null, null], ["DefaultRunSound", 2]]);
    expect(preview.inspection().recent.at(-1)).toMatchObject({ group: "LAND", generation: 1, occurrenceTimeSeconds: 1.25 });
    off(preview); player.advance(clock(1.25), clock(1.75)); expect(preview.inspection().recent.at(-1)?.reason).toBe("disabled");
  });

  it("selects walk/run properties by the admitted clip and stops old sources on transitions/restarts", () => {
    const { output, preview, player } = setup([definition(), definition([event(12, .5)], { clip: "Walk", gait: "walk" })]);
    select(preview); player.start(clock(0)); player.advance(clock(0), clock(.25));
    const owner = output.play.mock.calls[0]![1]; output.stopOwner.mockClear();
    player.start(clock(0, { clip: "Walk" })); player.advance(clock(0, { clip: "Walk" }), clock(.5, { clip: "Walk" }));
    expect(output.play.mock.calls[1]![0]).toBe("def-walk0");
    player.start(clock(0, { clip: "Idle" })); player.advance(clock(0, { clip: "Idle" }), clock(.5, { clip: "Idle" }));
    player.start(clock(0)); player.advance(clock(0), clock(.25));
    expect(output.stopOwner.mock.calls).toEqual([[owner], [owner], [owner]]);
    expect(preview.inspection().recent.map(row => row.generation)).toEqual([1, 2, 4]);
  });

  it("leaves missing original array slots unresolved instead of choosing aliases or another variant", () => {
    const input = definition([{ ...event(4, .25), arrays: { DefRunSound: arrays.DefaultRunSound } }, { ...event(7, .75), arrays: { GrassRunSound: arrays.GrassRunSound } }]);
    const { output, preview, player } = setup([input]); select(preview); player.start(clock(0)); player.advance(clock(0), clock(.75));
    expect(output.play).not.toHaveBeenCalled(); expect(preview.inspection().recent.map(row => [row.property, row.reason]))
      .toEqual([["DefaultRunSound", "unresolved-selection"], ["DefaultRunSound", "unresolved-selection"]]);
  });

  it("isolates actor playback owners and makes disposal idempotent without touching other mixer owners", () => {
    const { output, preview, player } = setup(); const second = preview.bindActor("human", asset); select(preview);
    player.start(clock(0)); second.start(clock(0)); player.advance(clock(0), clock(.25)); second.advance(clock(0), clock(.25));
    const owners = output.play.mock.calls.map(row => row[1]); expect(new Set(owners).size).toBe(2);
    output.stopOwner.mockClear(); player.dispose(); player.dispose(); expect(output.stopOwner.mock.calls).toEqual([[owners[0]]]);
    player.advance(clock(.25), clock(.75)); second.advance(clock(.25), clock(.75)); expect(output.play).toHaveBeenCalledTimes(3);
    preview.dispose(); preview.dispose(); expect(output.stopOwner.mock.calls).toEqual([[owners[0]], [owners[1]]]);
    const late = preview.bindActor("late", asset); late.start(clock(0)); late.advance(clock(0), clock(1)); late.dispose();
    expect(output.play).toHaveBeenCalledTimes(3); expect(preview.inspection()).toMatchObject({ disposed: true, enabled: false, activeOwners: 0 });
  });

  it("copies source arrays and dispatch receipts and never binds equipment by matching an asset id", () => {
    const source = { ...structuredClone(definition()), asset };
    const { output, preview, player } = setup([source], Infinity, { surfaceContext: () => grassTerrain, localPlayer: () => true }); select(preview);
    (source.events[0]!.arrays.GrassRunSound![0] as { key: string }).key = "corrupt-after-admission";
    player.start(clock(0)); player.advance(clock(0), clock(.25)); expect(output.play.mock.calls[0]![0]).toBe("grass0");
    const copy = { ...asset, manifest: { ...asset.manifest } }, equipment = preview.bindActor("equipment", copy);
    equipment.start(clock(0)); equipment.advance(clock(0), clock(1)); expect(output.play).toHaveBeenCalledTimes(1);
    const inspection = preview.inspection(); (inspection.recent[0] as { surface: string }).surface = "Water";
    (inspection.recent[0]!.context!.decoGrass as { expected: number }).expected = 0;
    expect(preview.inspection().recent[0]).toMatchObject({ surface: "Grass", group: "GRASS", context: { decoGrass: { expected: 4 } } });
  });

  it("rejects ambiguous definitions, duplicate ordinals, invalid onsets and invalid preview choices", () => {
    const output = mixer();
    for (const definitions of [[definition(), definition()], [definition([event(1, .2), event(1, .3)])],
      [definition([event(1, NaN)])], [definition([event(1, 2)])], [definition([], { durationSeconds: 0 })]]) {
      expect(() => createNativeFootstepPreview(definitions, output)).toThrow("Native footstep preview");
    }
    const { preview } = setup();
    for (const value of [{ mode: "actor-arrays", surface: "Default", variation: 0 }, { mode: "auto", surface: "Water_In", variation: 0 },
      { mode: "manual", surface: "Grass", variation: Number.NaN }, { mode: "manual", surface: "Grass", variation: -1 }]) {
      expect(() => preview.setSurfaceSelection(value as never)).toThrow("selection");
    }
    expect(preview.surfaceSelection().mode).toBe("off"); expect(output.play).not.toHaveBeenCalled();
  });

  it("uses one real NativeActor base clock across equipment replacement and loop boundaries", async () => {
    const engine = new NullEngine(), scene = new Scene(engine); GetEnvironmentBRDFTexture(scene);
    const body = await nativeVisualFixture(), shirt = await nativeVisualFixture({ parts: ["Upper"], material: "shirt" });
    const actor = await NativeActor.create(scene, body, new AbortController().signal);
    const { preview, player, output } = setup([definition([event(1, .5), event(2, 1.5)], { asset: body, clip: nativeVisualClips.run, durationSeconds: 2 })]);
    try {
      select(preview); actor.play(nativeVisualClips.run, "loop"); player.start(actor.clock());
      let previous = actor.clock(); actor.update(.6); player.advance(previous, actor.clock()); expect(output.play).toHaveBeenCalledTimes(1);
      const beforeEquipment = actor.clock(); await actor.replacePart("Fixture.Upper", shirt); expect(actor.clock()).toEqual(beforeEquipment);
      player.advance(previous, actor.clock()); expect(output.play).toHaveBeenCalledTimes(1);
      previous = actor.clock(); actor.update(1); player.advance(previous, actor.clock()); expect(output.play).toHaveBeenCalledTimes(2);
      await actor.replacePart("Fixture.Upper", null); previous = actor.clock(); actor.update(1); player.advance(previous, actor.clock());
      expect(output.play).toHaveBeenCalledTimes(3);
      expect(preview.inspection().recent.map(row => row.occurrenceTimeSeconds)).toEqual([.5, 1.5, 2.5]);
      expect(new Set(output.play.mock.calls.map(row => row[1])).size).toBe(1);
    } finally { player.dispose(); actor.dispose(); scene.dispose(); engine.dispose(); }
  });
});
