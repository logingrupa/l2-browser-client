import { describe, expect, it } from "vitest";
import { WorldAudioMixer } from "../../src/audio/WorldAudioMixer";
import { ambientGain, ambientIsDay, ambientLoops, ambientPeriodIndex, ambientPlaybackRate, ambientRangeUnits, ambientSoundObjectDefaults,
  ambientTypeAllowed, ambientValue, createWorldAmbience } from "../../src/audio/worldAmbience";
import type { NativeAmbience, NativeAmbientEmitter, NativeAmbientSound } from "../../src/assets/native/loadNativeWorldAudio";
import { nativeFlameNativeToBrowser } from "../../src/scene/world/nativeFlameBillboards";
import { fakeMixerContext, flush, type FakeGainNode } from "./fakeWebAudio";

function emitter(id: string, native: [number, number, number], fields: Partial<NativeAmbientEmitter> = {}): NativeAmbientEmitter {
  return { id, exportIndex: 1, native, position: nativeFlameNativeToBrowser(native), soundRadius: 90, soundVolume: 255, soundPitch: null,
    ambientSoundType: null, ambientRandom: null, ambientSoundStartTime: null, sound: "wind", zone: null, zoneNumber: null, group: "None,s_wind",
    defaults: [], ...fields };
}

function bundle(emitters: NativeAmbientEmitter[]) {
  const sounds = new Map<string, NativeAmbientSound>([["wind", 1], ["bird", 2]].map(([key, first]) =>
    [key as string, { key: key as string, object: `AmbSound.${key}`, file: "audio/x.wav", bytes: 1, sha256: "a".repeat(64), mime: "audio/wav", durationSeconds: 2, first }]));
  const fetches: string[] = [];
  const ambience: NativeAmbience = { manifestSha256: "b".repeat(64), emitters, sounds,
    radiusMultiplier: { value: 50, symbol: "?GAudioMaxRadiusMultiplier@@3MA", status: "static", imageSha256: "c".repeat(64) },
    fetchSound: async key => { fetches.push(key); return new Uint8Array([key === "wind" ? 1 : 2]); } };
  return { ambience, fetches };
}

const ear = (native: [number, number, number]) => nativeFlameNativeToBrowser(native);

async function setup(emitters: NativeAmbientEmitter[], options: Parameters<typeof createWorldAmbience>[2] = {}) {
  const { context, makeContext } = fakeMixerContext();
  const mixer = new WorldAudioMixer({ makeContext });
  const { ambience, fetches } = bundle(emitters);
  let time = 0, roll = 0;
  const world = createWorldAmbience(ambience, mixer, { now: () => time, random: () => roll, clockHour: () => 12, ...options });
  const at = async (seconds: number, listener: [number, number, number] = [0, 0, 0]) => {
    time = seconds; world.update(ear(listener)); await flush();
  };
  return { context, mixer, world, fetches, at, setRoll: (value: number) => { roll = value; } };
}

describe("native ambient field rules", () => {
  it("uses class defaults for omitted fields", () => {
    const row = emitter("e", [0, 0, 0], { soundPitch: null, ambientRandom: null, ambientSoundType: null, ambientSoundStartTime: null });
    expect(ambientSoundObjectDefaults).toEqual({ ambientRandom: 100, soundRadius: 64, soundVolume: 190, soundPitch: 64, ambientSoundType: 0, ambientSoundStartTime: 0 });
    expect([ambientValue(row, "soundPitch"), ambientValue(row, "ambientRandom"), ambientValue(row, "ambientSoundStartTime")]).toEqual([64, 100, 0]);
    expect(ambientLoops(row)).toBe(true);
    expect(ambientPlaybackRate(row)).toBe(1);
    expect(ambientTypeAllowed(null, false)).toBe(true);
  });

  it("computes gain = clamp((Vol/255)·(50R − d)/(50R)) × R/(R + 0.5(d − R)) in source units", () => {
    const row = emitter("e", [0, 0, 0], { soundRadius: 120, soundVolume: 250 });
    expect(ambientRangeUnits(row, 50)).toBe(6000);
    expect(ambientGain(row, 0, 50)).toBeCloseTo(250 / 255);
    expect(ambientGain(row, 120, 50)).toBeCloseTo(250 / 255 * (5880 / 6000));
    expect(ambientGain(row, 1250, 50)).toBeCloseTo(250 / 255 * (4750 / 6000) * (120 / (120 + .5 * 1130)));
    expect(ambientGain(row, 6000, 50)).toBe(0);
    expect(ambientGain(row, 6001, 50)).toBe(0);
  });

  it("gates Day at hour >= 6, Night before, Water only in water; rate clamps Pitch/64", () => {
    expect([ambientIsDay(5.99), ambientIsDay(6), ambientIsDay(23.9)]).toEqual([false, true, true]);
    expect([ambientTypeAllowed(1, true), ambientTypeAllowed(1, false), ambientTypeAllowed(2, false), ambientTypeAllowed(2, true)]).toEqual([true, false, true, false]);
    expect([ambientTypeAllowed(3, true), ambientTypeAllowed(3, true, true), ambientTypeAllowed(0, true, true), ambientTypeAllowed(7, true)]).toEqual([false, true, false, false]);
    expect(ambientPlaybackRate(emitter("e", [0, 0, 0], { soundPitch: 55 }))).toBeCloseTo(55 / 64);
    expect(ambientPlaybackRate(emitter("e", [0, 0, 0], { soundPitch: 10 }))).toBe(.5);
    expect(ambientPlaybackRate(emitter("e", [0, 0, 0], { soundPitch: 255 }))).toBe(2);
    expect([ambientPeriodIndex(10, 0, 2), ambientPeriodIndex(10, 17017694, 2), ambientPeriodIndex(10.5, 1, 2)]).toEqual([5, -8508842, 4]);
  });
});

describe("world ambience playback", () => {
  it("loops Random-100 emitters from sample 0 with a level node, inside 50R only", async () => {
    const near = emitter("near", [100, 0, 0], { soundRadius: 120, soundVolume: 250, soundPitch: 58 });
    const far = emitter("far", [7000, 0, 0], { soundRadius: 120 });
    const { context, mixer, world, fetches, at } = await setup([near, far]);
    await at(0);
    expect(fetches).toEqual(["wind"]); // the far emitter is outside 50R + margin
    await mixer.unlock(); await flush();
    await at(1);
    const source = context.sources[0]!;
    expect(source.loop).toBe(true);
    expect(source.starts[0]).toEqual([10, 0]);
    expect(source.playbackRate.value).toBeCloseTo(58 / 64);
    const fade = source.connections[0] as FakeGainNode, level = fade.connections[0] as FakeGainNode;
    expect(level.gain.value).toBeCloseTo(ambientGain(near, 100, 50));
    expect(fade.gain.pending(10)).toEqual([["set", 0, 10], ["ramp", 1, 10.05]]);
    expect(world.inspection()).toMatchObject({ candidates: 1, inRange: 1, loops: [{ id: "near", distanceUnits: 100 }], voices: { limit: 16, loopLimit: 8 } });
    await at(2, [3000, 0, 0]);
    expect(level.gain.events.at(-1)![1]).toBeCloseTo(ambientGain(near, 2900, 50));
    expect(fade.gain.pending(10)).toEqual([["set", 0, 10], ["ramp", 1, 10.05]]); // fade untouched by level updates
  });

  it("rolls one-shots once per WAV length from StartTime with p = Random/100 and never plays an object twice", async () => {
    const bird = emitter("bird", [0, 0, 0], { sound: "bird", ambientRandom: 40, ambientSoundStartTime: .5, ambientSoundType: 1 });
    const { context, mixer, world, at, setRoll } = await setup([bird]);
    await mixer.unlock(); await at(0); await flush();
    await at(.3); // period index (0.3 − 0.5)/2 → -1, same as the first observation: no roll
    expect(world.inspection().oneShots).toMatchObject({ rolls: 0, started: 0 });
    setRoll(.39); await at(2.6); // crossed into period 1: 39 < 40 → plays
    expect(world.inspection().oneShots).toMatchObject({ rolls: 1, started: 1, active: 1 });
    expect(context.sources[0]!.loop).toBe(false);
    setRoll(0); await at(4.6); // next period, but the same object is still playing
    expect(world.inspection().oneShots).toMatchObject({ rolls: 1, started: 1 });
    context.sources[0]!.end();
    setRoll(.4); await at(6.6); // 40 is not < 40 → no play
    expect(world.inspection().oneShots).toMatchObject({ rolls: 2, started: 1, active: 0 });
  });

  it("gates by the game-hour chips (Auto uses the local clock) and caps voices at 16 with ≤ 8 loops", async () => {
    const emitters = [
      ...Array.from({ length: 12 }, (_, i) => emitter(`loop-${i}`, [i * 10, 0, 0])),
      ...Array.from({ length: 12 }, (_, i) => emitter(`day-${i}`, [i * 10, 50, 0], { sound: "bird", ambientRandom: 99, ambientSoundType: 1 })),
      emitter("night", [0, 60, 0], { sound: "bird", ambientRandom: 99, ambientSoundType: 2 }),
    ];
    let hour = 3;
    const { mixer, world, at } = await setup(emitters, { clockHour: () => hour });
    await mixer.unlock(); await at(0); await flush(); await at(.3);
    expect(world.inspection()).toMatchObject({ timeOfDay: "auto", isDay: false, candidates: 25, gated: 12, inRange: 13 });
    hour = 9; await at(.6);
    expect(world.inspection()).toMatchObject({ isDay: true, gated: 1, inRange: 24 });
    await at(2.1); // every day bird crosses a period boundary
    const state = world.inspection();
    expect(state.loops).toHaveLength(8);
    expect(state.voices.active).toBe(16);
    expect(state.oneShots.skippedForVoices).toBeGreaterThan(0);
    expect(mixer.inspection().buses.ambience.active).toBeLessThanOrEqual(16);
    world.setTimeOfDay("night"); await at(2.2);
    expect(world.inspection()).toMatchObject({ timeOfDay: "night", isDay: false });
    expect(() => world.setTimeOfDay("all" as never)).toThrow(TypeError);
  });

  it("decodes only nearby sounds and releases them after they stay far away", async () => {
    const near = emitter("near", [0, 0, 0]);
    const { mixer, world, fetches, at } = await setup([near], { releaseAfterSeconds: 5 });
    await mixer.unlock(); await at(0); await flush();
    expect(mixer.isRegistered("ambience:wind")).toBe(true);
    world.setEnabled(false); await at(1);
    world.setEnabled(true); await at(2, [20000, 0, 0]);
    await at(8, [20000, 0, 0]);
    expect(mixer.isRegistered("ambience:wind")).toBe(false);
    expect(world.inspection().sounds).toMatchObject({ loaded: 0, released: 1 });
    await at(9, [0, 0, 0]); await flush();
    expect(fetches).toEqual(["wind", "wind"]);
    world.dispose();
    expect(mixer.isRegistered("ambience:wind")).toBe(false);
  });
});
