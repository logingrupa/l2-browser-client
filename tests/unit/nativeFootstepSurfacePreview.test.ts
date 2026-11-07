import { afterEach, describe, expect, it, vi } from "vitest";
import type { AssetPackage } from "../../src/assets/package/readAssetPackage";
import type { NativeActorClock } from "../../src/assets/native/NativeActor";
import type { WorldAudioPlaybackReceipt, WorldAudioVoice, WorldAudioVoiceOptions } from "../../src/audio/WorldAudioMixer";
import {
  FOOTSTEP_SURFACES, FOOTSTEP_WATER_SURFACES, type FootstepSurfaceId, type StepSoundClip, type StepSoundLibrary, type StepSoundSurface,
} from "../../src/audio/footstepSurfaces";
import type { FootstepGroundContext } from "../../src/audio/footstepSurfaceAuto";
import {
  createNativeFootstepPreview, NATIVE_FOOTSTEP_WORLD_DEFAULT, type NativeFootstepDefinition, type NativeFootstepPreview,
  type NativeFootstepPreviewOptions, type NativeFootstepSurfaceSelection,
} from "../../src/audio/nativeFootstepPreview";
import type { WorldGroundContact } from "../../src/world/WorldNavigation";

const asset = { manifest: { id: "synthetic:human", kind: "model" }, files: new Map() } as unknown as AssetPackage;
const clip = (object: string): StepSoundClip => ({ key: `native-stepsound:${object}`, object, dependencyId: `id:${object}`, sha256: "0".repeat(64), durationSeconds: .5 });
const WOOD = "interlude:20_20.StaticMeshActor930";
function library(): StepSoundLibrary {
  const surfaces = new Map<FootstepSurfaceId, StepSoundSurface>();
  for (const id of FOOTSTEP_SURFACES) {
    const water = FOOTSTEP_WATER_SURFACES.has(id), count = id === "Stone" ? 2 : 3;
    const walk = Array.from({ length: count }, (_, i) => clip(water ? `stepsound.water.${id}_0${i + 1}` : `stepsound.${id}.${id}_Walk_0${i + 1}`));
    const run = water ? walk : Array.from({ length: count }, (_, i) => clip(`stepsound.${id}.${id}_Run_0${i + 1}`));
    surfaces.set(id, { id, label: id, group: water ? "water" : id, gaitSplit: !water, walk, run });
  }
  const slots = (["StepSound_1", "StepSound_2", "StepSound_3"] as const).map((property, index) =>
    ({ property, reference: `StepSound.Wood.wood_walk_0${index + 1}`, clip: clip(`stepsound.Wood.wood_walk_0${index + 1}`) }));
  return { manifestSha256: "a".repeat(64), packageSha256: "b".repeat(64), soundCount: 93, surfaces,
    events: { Water_In: clip("stepsound.water.Water_In"), Water_Out: clip("stepsound.water.Water_Out") },
    boots: [1, 2, 3].map(i => clip(`stepsound.noise_boots.noise_0${i}`)),
    placements: new Map([[WOOD, { placementId: WOOD, sourceMesh: "Fort.Stair", slots, clips: slots.map(slot => slot.clip),
      references: slots.map(slot => slot.reference), surface: "Wood" as const }]]),
    sectionManifestSha256: null };
}
const array = (property: string) => [0, 1, 2].map(i => ({ reference: `StepSound.${property}.${i}`, key: `${property}:${i}` }));
const arrays = Object.fromEntries(["DefaultWalkSound", "DefaultRunSound", "GrassWalkSound", "GrassRunSound", "WaterWalkSound", "WaterRunSound",
  "DefaultActorWalkSound", "DefaultActorRunSound"].map(property => [property, array(property)]));
const definitions: NativeFootstepDefinition[] = [
  { asset, clip: "Run", durationSeconds: 1, gait: "run", events: [{ ordinal: 4, notify: "N.Run0", timeSeconds: .25, arrays }, { ordinal: 7, notify: "N.Run1", timeSeconds: .75, arrays }] },
  { asset, clip: "Walk", durationSeconds: 2, gait: "walk", events: [{ ordinal: 12, notify: "N.Walk0", timeSeconds: .5, arrays }] },
];
const clock = (elapsedSeconds: number, clip = "Run", durationSeconds = clip === "Walk" ? 2 : 1): NativeActorClock =>
  ({ clip, mode: "loop", elapsedSeconds, durationSeconds, playing: true, completed: false });
const ground = (patch: Partial<FootstepGroundContext> = {}): FootstepGroundContext => ({ kind: "terrain", meshName: "terrain", sourceId: "20_20.TerrainInfo0",
  material: null, nativeXY: [10000, 95000], decoGrass: null, footVolume: null, detail: null, ...patch });
const deco = (expected: number) => ({ status: "sampled" as const, expected, threshold: 2, grass: expected >= 2, sector: 3, quad: [78, 230] as const });
function mixer() {
  let next = 0, accept = true;
  return { stopOwner: vi.fn<(owner: string) => void>(), setAccept(value: boolean) { accept = value; },
    play: vi.fn((key: string, owner: string, offsetSeconds = 0): WorldAudioPlaybackReceipt | null =>
      accept ? { id: ++next, key, owner, offsetSeconds, contextTime: 1, durationSeconds: .5 } : null) };
}
const previews: NativeFootstepPreview[] = [];
function setup(options: NativeFootstepPreviewOptions = {}) {
  const output = mixer(), preview = createNativeFootstepPreview(definitions, output, { stepSounds: library(), random: () => 0, ...options });
  previews.push(preview);
  return { output, preview, player: preview.bindActor("local-player", asset) };
}
const set = (preview: NativeFootstepPreview, patch: Partial<NativeFootstepSurfaceSelection>) =>
  preview.setSurfaceSelection({ ...preview.surfaceSelection(), ...patch });
const keys = (output: ReturnType<typeof mixer>) => output.play.mock.calls.map(call => call[0]);
afterEach(() => { for (const preview of previews.splice(0)) preview.dispose(); });

describe("Auto footsteps in the native decision order", () => {
  it("defaults to off and accepts the world default Auto", () => {
    expect(setup().preview.inspection()).toMatchObject({ enabled: false, surfaceSelection: { mode: "off" }, bootsLayer: false, renderDecoGrass: true,
      stepSounds: { sounds: 93, placements: 1 } });
    expect(setup({ initialSelection: NATIVE_FOOTSTEP_WORLD_DEFAULT }).preview.surfaceSelection()).toEqual({ mode: "auto", surface: "Default", variation: "random" });
  });

  it("plays the support Wood StepSound_1 (2/3) / StepSound_3 (1/3), never StepSound_2, for both gaits", () => {
    const draws = [.9, .1, .9, .1, .1, .9, .1, .1];
    const { output, preview, player } = setup({ surfaceContext: () => ground({ kind: "placement", sourceId: WOOD }), random: () => draws.shift() ?? 0,
      initialSelection: NATIVE_FOOTSTEP_WORLD_DEFAULT });
    player.start(clock(0)); player.advance(clock(0), clock(1));
    player.start(clock(0, "Walk")); player.advance(clock(0, "Walk"), clock(.6, "Walk"));
    expect(keys(output)).toEqual(["native-stepsound:stepsound.Wood.wood_walk_01", "native-stepsound:stepsound.Wood.wood_walk_01",
      "native-stepsound:stepsound.Wood.wood_walk_03"]);
    expect(preview.inspection().recent.map(row => [row.gait, row.property, row.group, row.resolution?.rule, row.resolution?.status])).toEqual([
      ["run", "StepSound_1", null, "support-step-sound", "native"], ["run", "StepSound_1", null, "support-step-sound", "native"],
      ["walk", "StepSound_3", null, "support-step-sound", "native"]]);
  });

  it("uses DefaultActorWalkSound (Stone_Hard walk set) on other non-terrain support even while running", () => {
    const { output, preview, player } = setup({ surfaceContext: () => ground({ kind: "bsp", sourceId: "interlude:20_20.Model798.Brush397" }),
      initialSelection: NATIVE_FOOTSTEP_WORLD_DEFAULT });
    player.start(clock(0)); player.advance(clock(0), clock(.3));
    expect(keys(output)).toEqual(["DefaultActorWalkSound:0"]);
    expect(preview.latest()).toMatchObject({ gait: "run", property: "DefaultActorWalkSound", group: "ACTOR", surface: "Stone_Hard" });
  });

  it("plays GRASS or LAND on terrain by the expected deco count, for the local player only, and LAND with RenderDeco off", () => {
    let context = ground({ decoGrass: deco(3) });
    const { output, preview, player } = setup({ surfaceContext: () => context, initialSelection: NATIVE_FOOTSTEP_WORLD_DEFAULT });
    player.start(clock(0)); player.advance(clock(0), clock(.3));
    context = ground({ decoGrass: deco(1) }); player.advance(clock(.3), clock(.8));
    preview.autoSurface().setRenderDecoGrass(false); context = ground({ decoGrass: deco(9) }); player.advance(clock(.8), clock(1.3));
    expect(keys(output)).toEqual(["GrassRunSound:0", "DefaultRunSound:0", "DefaultRunSound:0"]);
    expect(preview.inspection().recent.map(row => row.resolution?.summary)).toEqual(["Grass · deco ≈ 3 ≥ 2", "Default · deco ≈ 1 < 2",
      "Default · terrain (RenderDeco off)"]);
    const other = preview.bindActor("remote-pawn", asset);
    preview.autoSurface().setRenderDecoGrass(true); other.start(clock(0)); other.advance(clock(0), clock(.3));
    expect(preview.latest()).toMatchObject({ owner: "remote-pawn", group: "LAND" });
  });

  it("takes walk/run from the movement state (Controller.MoveType), not the playing clip", () => {
    let gait: "walk" | "run" = "walk";
    const { output, preview, player } = setup({ gait: () => gait, initialSelection: NATIVE_FOOTSTEP_WORLD_DEFAULT });
    player.start(clock(0)); player.advance(clock(0), clock(.3));
    gait = "run"; player.start(clock(0, "Walk")); player.advance(clock(0, "Walk"), clock(.6, "Walk"));
    expect(keys(output)).toEqual(["DefaultWalkSound:0", "DefaultRunSound:0"]);
    expect(preview.inspection().recent.map(row => [row.gait, row.gaitSource, row.clipGait])).toEqual([["walk", "movement-state", "run"], ["run", "movement-state", "walk"]]);
  });

  it("keeps the water-volume hook (WATER arrays, Water_In/Out on transitions) and native silence when the pawn is in water", () => {
    let context = ground();
    const { output, preview, player } = setup({ surfaceContext: () => context, initialSelection: NATIVE_FOOTSTEP_WORLD_DEFAULT });
    player.start(clock(0)); player.advance(clock(0), clock(.3));
    context = ground({ footVolume: { water: true, pawnInWater: false, stepSound: null } }); player.advance(clock(.3), clock(.8));
    expect(preview.latest()).toMatchObject({ group: "WATER", property: "WaterRunSound" });
    expect(preview.latest()!.layers.map(layer => layer.kind)).toEqual(["water-in"]);
    context = ground({ footVolume: { water: true, pawnInWater: true, stepSound: null } }); player.advance(clock(.8), clock(1.3));
    expect(preview.latest()).toMatchObject({ reason: "native-silent", key: null });
    context = ground(); player.advance(clock(1.3), clock(1.8));
    expect(preview.latest()!.layers.map(layer => layer.kind)).toEqual(["water-out"]);
    expect(keys(output).filter(key => /Water_(In|Out)$/.test(key))).toEqual(["native-stepsound:stepsound.water.Water_In", "native-stepsound:stepsound.water.Water_Out"]);
  });

  it("adds boot noise first (default off) and keeps the chain going even when the surface step is silent", () => {
    let context = ground();
    const { output, preview, player } = setup({ surfaceContext: () => context, initialSelection: NATIVE_FOOTSTEP_WORLD_DEFAULT });
    player.start(clock(0)); player.advance(clock(0), clock(.3)); expect(keys(output)).toEqual(["DefaultRunSound:0"]);
    preview.setBootsLayer(true); player.advance(clock(.3), clock(.8));
    expect(keys(output).slice(1)).toEqual(["native-stepsound:stepsound.noise_boots.noise_01", "DefaultRunSound:0"]);
    context = ground({ footVolume: { water: true, pawnInWater: true, stepSound: null } }); player.advance(clock(.8), clock(1.3));
    expect(preview.latest()!.layers.map(layer => [layer.kind, layer.accepted])).toEqual([["boots", true], ["water-in", true]]);
    expect(preview.latest()!.reason).toBe("native-silent");
  });

  it("plays at the pawn with gain 250/255 and the labelled ambient curve, falling back to non-spatial without a listener", () => {
    const voices: WorldAudioVoiceOptions[] = [];
    const output = { ...mixer(), startVoice: vi.fn((key: string, options: WorldAudioVoiceOptions): WorldAudioVoice | null => {
      voices.push(options);
      return { id: voices.length, key, owner: options.owner, bus: options.bus, loop: false, durationSeconds: .5, startedAt: 2,
        active: () => true, setGain() {}, setPosition() {}, stop() {} };
    }) };
    let listener: [number, number, number] | null = [1, 0, 0];
    const positions: Record<string, [number, number, number]> = { "local-player": [1, 0, 0], remote: [1, 0, 1.5] };
    const preview = createNativeFootstepPreview(definitions, output, { random: () => 0, initialSelection: NATIVE_FOOTSTEP_WORLD_DEFAULT,
      spatial: { position: owner => positions[owner] ?? null, listener: () => listener, sourceUnitsPerMetre: 100 } });
    previews.push(preview);
    const local = preview.bindActor("local-player", asset), remote = preview.bindActor("remote", asset);
    local.start(clock(0)); local.advance(clock(0), clock(.3));
    expect(voices[0]).toMatchObject({ bus: "effects", position: [1, 0, 0] }); expect(voices[0]!.gain).toBeCloseTo(250 / 255, 12);
    expect(preview.latest()).toMatchObject({ reason: "played", spatial: { distanceUnits: 0 }, playback: { contextTime: 2 } });
    remote.start(clock(0)); remote.advance(clock(0), clock(.3));
    expect(voices[1]!.gain).toBeCloseTo(250 / 255 * (1500 - 150) / 1500 * 30 / 90, 12);
    listener = null; local.advance(clock(.3), clock(.8));
    expect(output.play).toHaveBeenCalledTimes(1); expect(preview.latest()!.spatial).toBeNull();
  });

  it("draws from a seeded generator by default, so two previews dispatch the same slots", () => {
    const runs = [0, 1].map(() => {
      const output = mixer(), preview = createNativeFootstepPreview(definitions, output, { initialSelection: NATIVE_FOOTSTEP_WORLD_DEFAULT });
      previews.push(preview); const player = preview.bindActor("local-player", asset);
      player.start(clock(0)); for (let time = 0; time < 20; time += .5) player.advance(clock(time), clock(time + .5));
      expect(preview.inspection().random.seed).not.toBeNull();
      return keys(output);
    });
    expect(runs[0]).toHaveLength(40); expect(runs[1]).toEqual(runs[0]);
    expect(new Set(runs[0]).size).toBe(3);
  });
});

describe("Manual footsteps (all 16 surfaces)", () => {
  it("plays the chosen surface by gait with variations from the actual clips (Stone has two)", () => {
    const { output, preview, player } = setup(); set(preview, { mode: "manual", surface: "Grass", variation: 1 });
    player.start(clock(0)); player.advance(clock(0), clock(.5));
    player.start(clock(0, "Walk")); player.advance(clock(0, "Walk"), clock(.6, "Walk"));
    expect(keys(output)).toEqual(["native-stepsound:stepsound.Grass.Grass_Run_02", "native-stepsound:stepsound.Grass.Grass_Walk_02"]);
    set(preview, { surface: "Stone", variation: 2 }); player.start(clock(0)); player.advance(clock(0), clock(.3));
    expect(keys(output).at(-1)).toBe("native-stepsound:stepsound.Stone.Stone_Run_02"); expect(preview.latest()!.variationIndex).toBe(1);
    set(preview, { surface: "Water_Shalow", variation: 0 }); player.advance(clock(.3), clock(.8));
    expect(keys(output).at(-1)).toBe("native-stepsound:stepsound.water.Water_Shalow_01");
    // The readout still records what Auto would resolve underfoot.
    expect(preview.latest()!.resolution?.rule).toBe("no-support");
  });

  it("exposes water test actions and stops owned sources when the selection changes", () => {
    const { output, preview, player } = setup(); set(preview, { mode: "manual", surface: "Snow" });
    expect(preview.playWaterEvent("Water_Out")).toMatchObject({ key: "native-stepsound:stepsound.water.Water_Out" });
    expect(output.play).toHaveBeenCalledWith("native-stepsound:stepsound.water.Water_Out", "native-footstep:test-action", 0);
    player.start(clock(0)); output.stopOwner.mockClear();
    set(preview, { surface: "Snow" }); expect(output.stopOwner).not.toHaveBeenCalled();
    set(preview, { surface: "Ice" }); expect(output.stopOwner).toHaveBeenCalledWith("native-footstep:1:local-player");
    const unstaged = createNativeFootstepPreview(definitions, mixer()); previews.push(unstaged);
    expect(unstaged.playWaterEvent("Water_In")).toBeNull();
    preview.dispose(); expect(preview.inspection()).toMatchObject({ disposed: true, enabled: false });
  });

  it("observes the dispatch-time accepted support for every enabled mode", () => {
    const contact: WorldGroundContact = { queryPosition: { x: 0, y: 0, z: 0 }, position: { x: 0, y: 0, z: 0 }, controllingSample: 0, samples: [] };
    const surfaceContext = vi.fn((_owner: string, _contact: WorldGroundContact | null) => ground()), groundContact = vi.fn(() => contact);
    const { preview, player } = setup({ surfaceContext, groundContact, initialSelection: NATIVE_FOOTSTEP_WORLD_DEFAULT });
    player.start(clock(0)); player.advance(clock(0), clock(.3)); set(preview, { mode: "manual" }); player.advance(clock(.3), clock(.8));
    expect(surfaceContext.mock.calls.every(call => call[0] === "local-player" && call[1] === contact)).toBe(true);
    expect(groundContact).toHaveBeenCalledTimes(2);
  });
});
