import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadNativeWorldAudio, readNativeWorldAudioRecords, type NativeVector } from "../../src/assets/native/loadNativeWorldAudio";
import { WorldAudioMixer } from "../../src/audio/WorldAudioMixer";
import { ambientRangeUnits, ambientValue, createWorldAmbience } from "../../src/audio/worldAmbience";
import { createWorldMusic, musicVolumeContains, nativeMusicRules, selectMusicVolume } from "../../src/audio/worldMusic";
import { nativeFlameNativeToBrowser } from "../../src/scene/world/nativeFlameBillboards";
import { FakeMediaElement, fakeMixerContext, flush } from "./fakeWebAudio";

const root = resolve(__dirname, "../..");
const catalogPath = resolve(root, "public/l2/catalog.json");
const staged = existsSync(catalogPath) && Array.isArray(JSON.parse(readFileSync(catalogPath, "utf8")).worldAudio);
/** Research oracle (native-sound-answers-20261107): PlayerStart10 music + ambience recomputation. */
const oraclePath = resolve(root, "artifacts/native-parity/research/native-sound-answers-20261107/evidence/lead-ps10/ps10_music_ambient.json");
const hasOracle = staged && existsSync(oraclePath);

interface OracleObject {
  object: string; origin: NativeVector; inNativeRangeOfPlayerStart10: boolean; insideMV1: boolean;
  fields: Record<string, { value: number | string; provenance: string }>; export: { wavSha256: string; durationSeconds: number };
}

afterEach(() => { vi.unstubAllGlobals(); });

async function loadStaged() {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(readFileSync(resolve(root, "public", url.slice(1))))));
  const signal = new AbortController().signal;
  return loadNativeWorldAudio(await readNativeWorldAudioRecords(signal), signal);
}

describe.runIf(hasOracle)("20_20 world audio against the PlayerStart10 research oracle", () => {
  const oracle = hasOracle ? JSON.parse(readFileSync(oraclePath, "utf8")) as {
    music: { PlayerStart10: { location: NativeVector }; PlayerStart34: { location: NativeVector }; mv1WorldAABB: [NativeVector, NativeVector]; mv1Footprint: [number, number][] };
    ambientSummary: { inNativeRange: number; distinctSoundsInRange: number; inRangeByType: Record<string, number>; radiusMultiplier: number };
    ambientObjects: OracleObject[];
  } : null;

  it("places PlayerStart10 inside MusicVolume1 with the bundle's pipeline-derived brush planes", async () => {
    const world = await loadStaged(), music = oracle!.music;
    const mv1 = world.music!.volumes.find(volume => volume.object === "20_20.MusicVolume1")!;
    expect(mv1).toMatchObject({ musicId: 202002, forcePlayMusic: true });
    expect(mv1.tracks.map(key => key.replace("music:", ""))).toEqual(["F09_F", "F09_S01", "F10_F", "F10_S01", "F04_F", "F04_S01"]);
    expect(mv1.planes).toHaveLength(10);
    for (const start of [music.PlayerStart10.location, music.PlayerStart34.location]) {
      expect(selectMusicVolume(world.music!.volumes, start).volume?.object).toBe("20_20.MusicVolume1");
    }
    for (let axis = 0; axis < 3; axis++) {
      expect(mv1.boundsNative.min[axis]).toBeCloseTo(music.mv1WorldAABB[0][axis]!, 2);
      expect(mv1.boundsNative.max[axis]).toBeCloseTo(music.mv1WorldAABB[1][axis]!, 2);
    }
    const [x, y] = [music.PlayerStart10.location[0], music.PlayerStart10.location[1]];
    expect(musicVolumeContains(mv1, [x, y, -4674])).toBe(true);
    expect(musicVolumeContains(mv1, [x, y, -2676])).toBe(true);
    expect(musicVolumeContains(mv1, [x, y, -2600])).toBe(false); // above Z max (not the Polys32 top -435)
    expect(musicVolumeContains(mv1, [x, y, -4700])).toBe(false);
    // Octagon footprint vertices lie on the boundary; 2 units outward is outside.
    const centre = [(8898 + 14066) / 2, (93481 + 96601) / 2];
    for (const [vx, vy] of music.mv1Footprint) {
      expect(musicVolumeContains(mv1, [vx, vy, -3675])).toBe(true);
      const dx = vx - centre[0]!, dy = vy - centre[1]!, length = Math.hypot(dx, dy);
      expect(musicVolumeContains(mv1, [vx + 2 * dx / length, vy + 2 * dy / length, -3675])).toBe(false);
    }
    for (const object of oracle!.ambientObjects) expect([object.object, musicVolumeContains(mv1, object.origin)]).toEqual([object.object, object.insideMV1]);
  });

  it("matches the canonical ambient decode: 98 candidates within SoundRadius × 50 of PlayerStart10, same fields and WAVs", async () => {
    const world = await loadStaged(), ambience = world.ambience!, start = oracle!.music.PlayerStart10.location;
    expect(ambience.radiusMultiplier.value).toBe(oracle!.ambientSummary.radiusMultiplier);
    const candidates = ambience.emitters.filter(e => e.sound && Math.hypot(e.native[0] - start[0], e.native[1] - start[1], e.native[2] - start[2]) <= ambientRangeUnits(e, 50));
    expect(candidates).toHaveLength(oracle!.ambientSummary.inNativeRange);
    expect(new Set(candidates.map(e => e.sound)).size).toBe(oracle!.ambientSummary.distinctSoundsInRange);
    expect(new Set(candidates.map(e => e.id))).toEqual(new Set(oracle!.ambientObjects.filter(o => o.inNativeRangeOfPlayerStart10).map(o => o.object)));
    const types = { 0: 0, 1: 0, 2: 0 } as Record<number, number>;
    for (const e of candidates) types[ambientValue(e, "ambientSoundType")]!++;
    expect(types).toEqual({ 0: oracle!.ambientSummary.inRangeByType["AST1_Always (default)"], 1: oracle!.ambientSummary.inRangeByType.AST1_Day, 2: oracle!.ambientSummary.inRangeByType.AST1_Night });
    const fields = { AmbientSoundType: "ambientSoundType", AmbientRandom: "ambientRandom", AmbientSoundStartTime: "ambientSoundStartTime",
      SoundRadius: "soundRadius", SoundVolume: "soundVolume", SoundPitch: "soundPitch" } as const;
    for (const object of oracle!.ambientObjects) {
      const row = ambience.emitters.find(e => e.id === object.object)!;
      expect(row.native).toEqual(object.origin);
      for (const [name, field] of Object.entries(fields)) {
        expect([object.object, name, ambientValue(row, field)]).toEqual([object.object, name, object.fields[name]!.value]);
        expect(row.defaults.includes(field)).toBe(object.fields[name]!.provenance === "class default");
      }
      const sound = ambience.sounds.get(row.sound!)!;
      expect(sound.sha256).toBe(object.export.wavSha256);
      expect(sound.durationSeconds).toBeCloseTo(object.export.durationSeconds, 9);
    }
  });

  it("runs music and ambience at PlayerStart10 after the first trusted gesture (fake AudioContext)", async () => {
    const world = await loadStaged();
    const { context, makeContext } = fakeMixerContext();
    const mixer = new WorldAudioMixer({ makeContext });
    let time = 0;
    const listener = nativeFlameNativeToBrowser(oracle!.music.PlayerStart10.location);
    const ambience = createWorldAmbience(world.ambience!, mixer, { now: () => time, clockHour: () => 12 });
    const elements: FakeMediaElement[] = [];
    const music = createWorldMusic(world.music!, mixer, { now: () => time, preferOriginal: true, gestureTarget: null,
      createMediaElement: () => { const element = new FakeMediaElement(); elements.push(element); return element; },
      objectUrls: { create: (_bytes, mime) => `blob:${mime}`, revoke: () => undefined } });
    const gestures = new Map<string, (event: Event) => void>();
    mixer.attachGestureUnlock({ addEventListener: (type: string, handler: EventListenerOrEventListenerObject) => gestures.set(type, handler as (event: Event) => void),
      removeEventListener: () => undefined });
    mixer.register("cue", new Uint8Array([1]));
    const frame = async () => {
      time += .6;
      mixer.setListener(listener, [0, 0, -1]);
      ambience.update(listener); music.update(listener);
      await new Promise(resolve => setTimeout(resolve, 0)); await flush();
    };
    for (let i = 0; i < 4; i++) await frame();
    expect(mixer.locked).toBe(true);
    expect(music.inspection()).toMatchObject({ state: "waiting-for-unlock", volume: { id: "interlude:20_20.MusicVolume1", musicId: 202002, forcePlayMusic: true },
      candidates: ["music:F09_F", "music:F09_S01", "music:F10_F", "music:F10_S01", "music:F04_F", "music:F04_S01"] });
    expect(ambience.inspection()).toMatchObject({ candidates: 98, gated: 39, inRange: 59, isDay: true });
    gestures.get("touchend")!({ type: "touchend", isTrusted: true } as Event);
    expect(context.resumes).toBe(1);
    expect(elements.some(element => element.plays.some(src => src.startsWith("blob:audio/ogg")))).toBe(true); // started inside the gesture
    for (let i = 0; i < 8; i++) await frame();
    const state = mixer.inspection();
    expect(state).toMatchObject({ state: "running", locked: false, nowPlaying: { owner: "music:slot-0" } });
    expect(music.inspection()).toMatchObject({ state: "playing", gain: nativeMusicRules.musicVolume });
    const nearby = ambience.inspection();
    expect(nearby.loops.length).toBeGreaterThan(0);
    expect(nearby.loops.length).toBeLessThanOrEqual(8);
    expect(nearby.voices.active).toBeLessThanOrEqual(16);
    expect(nearby.loops.some(loop => /wind/.test(loop.sound))).toBe(true);
    expect(state.buses.ambience.active).toBeLessThanOrEqual(16);
    expect(nearby.sounds.loaded).toBeLessThan(world.ambience!.sounds.size); // lazy by proximity, never all 106
    for (let i = 0; i < 16; i++) expect(mixer.play("cue", `actor-${i}`)).not.toBeNull(); // effects keep their full budget
    ambience.dispose(); music.dispose(); mixer.dispose();
  });
});
