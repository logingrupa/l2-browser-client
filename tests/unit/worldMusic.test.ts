import { describe, expect, it } from "vitest";
import { WorldAudioMixer } from "../../src/audio/WorldAudioMixer";
import { createWorldMusic, musicVolumeContains, nativeMusicRules, selectMusicVolume } from "../../src/audio/worldMusic";
import type { NativeMusic, NativeMusicTrack, NativeMusicVolume } from "../../src/assets/native/loadNativeWorldAudio";
import { FakeMediaElement, fakeMixerContext, flush, type FakeGainNode } from "./fakeWebAudio";

function box(id: string, min: [number, number, number], max: [number, number, number], tracks: string[], forcePlayMusic: boolean | null = null): NativeMusicVolume {
  return { id, object: id, exportIndex: 1, musicId: 100, forcePlayMusic, group: null, tracks, boundsNative: { min, max },
    planes: [[-1, 0, 0, -min[0]], [1, 0, 0, max[0]], [0, -1, 0, -min[1]], [0, 1, 0, max[1]], [0, 0, -1, -min[2]], [0, 0, 1, max[2]]] };
}

function bundle(volumes: NativeMusicVolume[], failFetch = new Set<string>()) {
  const keys = [...new Set(volumes.flatMap(volume => volume.tracks))];
  const tracks = new Map<string, NativeMusicTrack>(keys.map(key => [key, { key, storedString: key.replace("music:", ""), durationSeconds: 30,
    original: { file: "audio/a.ogg", bytes: 1, sha256: "a".repeat(64), mime: "audio/ogg; codecs=vorbis", sourceSha256: "b".repeat(64), sourcePath: "x" },
    derivative: { file: "derived/a.m4a", bytes: 1, sha256: "c".repeat(64), mime: "audio/mp4", label: "derived AAC" } }]));
  const fetched: string[] = [];
  const music: NativeMusic = { manifestSha256: "d".repeat(64), sourceMap: "maps/20_20.unr", volumes, tracks,
    fetchTrack: async (key, variant) => {
      fetched.push(`${variant}:${key}`);
      if (failFetch.has(`${variant}:${key}`)) throw new Error("missing");
      return new Uint8Array([keys.indexOf(key) + 1]);
    } };
  return { music, fetched };
}

const browser = ([x, y, z]: [number, number, number]): [number, number, number] => [x * .01, z * .01, y * .01];

function setup(volumes: NativeMusicVolume[], options: { rolls?: number[]; failFetch?: Set<string>; preferOriginal?: boolean } = {}) {
  const { context, makeContext } = fakeMixerContext();
  const mixer = new WorldAudioMixer({ makeContext });
  const { music, fetched } = bundle(volumes, options.failFetch);
  const elements: FakeMediaElement[] = [], created: string[] = [], revoked: string[] = [];
  const rolls = [...(options.rolls ?? [0])];
  let time = 0, urls = 0;
  const listeners = new Map<string, (event: Event) => void>();
  const world = createWorldMusic(music, mixer, {
    now: () => time, random: () => rolls.length > 1 ? rolls.shift()! : rolls[0]!, preferOriginal: options.preferOriginal ?? true,
    createMediaElement: () => { const element = new FakeMediaElement(); elements.push(element); return element; },
    objectUrls: { create: (bytes, mime) => { const url = `blob:${++urls}:${bytes[0]}:${mime}`; created.push(url); return url; }, revoke: url => { revoked.push(url); } },
    gestureTarget: { addEventListener: (type: string, handler: EventListenerOrEventListenerObject) => listeners.set(type, handler as (event: Event) => void), removeEventListener: () => undefined },
  });
  const at = async (seconds: number, position?: [number, number, number]) => {
    time = seconds; world.update(position ? browser(position) : null, true); await flush(); world.update(null, true); await flush();
  };
  return { context, mixer, world, fetched, elements, created, revoked, listeners, at, setTime: (value: number) => { time = value; } };
}

describe("music volume selection (native lookup)", () => {
  const dungeon = box("MusicVolume0", [8356, 74244, -4788], [27804, 82300, -3468], ["music:D03_F"]);
  const fortress = box("MusicVolume1", [8898, 93481, -4675], [14066, 96601, -2675], ["music:F09_F"], true);
  const spawn: [number, number, number] = [10536, 95034, -3374.79];

  it("tests the brush planes and lets a later overlap win only with bForcePlayMusic", () => {
    expect(musicVolumeContains(fortress, spawn)).toBe(true);
    expect(musicVolumeContains(dungeon, spawn)).toBe(false);
    expect(selectMusicVolume([dungeon, fortress], spawn)).toMatchObject({ volume: fortress });
    const plain = box("plain", [0, 90000, -5000], [20000, 99000, 0], ["music:X"]);
    expect(selectMusicVolume([plain, fortress], spawn).volume).toBe(fortress);
    expect(selectMusicVolume([fortress, plain], spawn).volume, "the later hit lacks bForcePlayMusic").toBe(fortress);
    expect(selectMusicVolume([plain, { ...plain, id: "plain2" }], spawn).volume!.id).toBe("plain");
    expect(selectMusicVolume([dungeon, fortress], [20000, 90000, -3455])).toEqual({ volume: null, inside: [] });
  });

  it("counts a listener exactly on a plane as inside, by the manifest insideRule nx*X + ny*Y + nz*Z - W <= 0", () => {
    expect(musicVolumeContains(fortress, [8898, 95034, -3374.79])).toBe(true);
    expect(musicVolumeContains(fortress, [11000, 96601, -2675])).toBe(true);
    expect(musicVolumeContains(fortress, [8897, 95034, -3374.79])).toBe(false);
  });
});

describe("world music playback (native rules)", () => {
  const volume = box("MusicVolume1", [0, 0, -100], [100, 100, 100], ["music:F09_F", "music:F09_S01", "music:F10_F", "music:F10_S01", "music:F04_F", "music:F04_S01"], true);
  const other = box("MusicVolume0", [200, 0, -100], [300, 100, 100], ["music:D03_F", "music:D03_S01"]);

  it("starts a uniform random pick inside the unlock gesture at gain 0.1, no loop, no fade-in", async () => {
    const { context, mixer, world, elements, fetched, at } = setup([volume], { rolls: [.5, .99] });
    await at(0, [50, 50, 0]);
    expect(world.inspection()).toMatchObject({ state: "waiting-for-unlock", volume: { id: "MusicVolume1", forcePlayMusic: true }, nextPick: "music:F10_S01" });
    expect(fetched).toEqual(["original:music:F10_S01"]);
    expect(elements, "no element before the first gesture").toHaveLength(0);
    void mixer.unlock();
    expect(elements, "inside the same synchronous gesture the elements exist, are blessed and the pick plays").toHaveLength(2);
    const [first, second] = elements;
    expect(first!.plays.at(-1)).toMatch(/^blob:1:4:audio\/ogg/);
    expect(first!.loop).toBe(false);
    expect(second!.plays[0]).toMatch(/^data:audio\/wav;base64,/);
    const level = (context.media[0]!.connections[0] as FakeGainNode).connections[0] as FakeGainNode;
    expect(level.gain.value).toBe(nativeMusicRules.musicVolume);
    expect((context.media[0]!.connections[0] as FakeGainNode).gain.value, "no fade-in").toBe(1);
    await flush();
    expect(world.inspection()).toMatchObject({ state: "playing", track: { storedString: "F10_S01", variant: "original", volumeId: "MusicVolume1" },
      nextPick: "music:F04_S01", gain: .1 });
    expect(mixer.inspection().nowPlaying).toMatchObject({ key: "music:F10_S01" });
  });

  it("waits 30 s after a natural end, then picks again (repeats allowed)", async () => {
    const { mixer, world, elements, at } = setup([volume], { rolls: [0, 0, 0, 0] });
    await at(0, [50, 50, 0]);
    await mixer.unlock(); await flush();
    expect(world.inspection().track?.storedString).toBe("F09_F");
    elements[0]!.fire("ended");
    expect(world.inspection()).toMatchObject({ state: "gap", track: null });
    await at(29.9, [50, 50, 0]);
    expect(world.inspection().state).toBe("gap");
    expect(world.inspection().gapRemainingSeconds).toBeCloseTo(.1);
    await at(30.1, [50, 50, 0]);
    expect(world.inspection(), "the same track may play again").toMatchObject({ state: "playing", track: { storedString: "F09_F" } });
    expect(elements.flatMap(element => element.plays).filter(src => src.startsWith("blob:"))).toHaveLength(2);
  });

  it("fades the old track out linearly over 2.5 s and starts the new volume's pick at once", async () => {
    const { context, mixer, world, elements, at } = setup([volume, other], { rolls: [0] });
    await at(0, [50, 50, 0]);
    await mixer.unlock(); await flush();
    const firstFade = context.media[0]!.connections[0] as FakeGainNode;
    await at(1, [250, 50, 0]);
    expect(firstFade.gain.pending(10).at(-1)).toEqual(["ramp", 0, 12.5]);
    expect(world.inspection()).toMatchObject({ state: "playing", volume: { id: "MusicVolume0" }, track: { storedString: "D03_F" }, fading: ["music:F09_F"] });
    expect(elements[1]!.plays.at(-1)).toMatch(/^blob:.*audio\/ogg/);
    expect(elements[0]!.paused).toBe(false);
    await at(3.6, [250, 50, 0]);
    expect(elements[0]!.paused).toBe(true);
    expect(world.inspection().fading).toEqual([]);
  });

  it("lets the current track finish outside every volume, then stays silent", async () => {
    const { mixer, world, elements, at } = setup([volume], { rolls: [0] });
    await at(0, [50, 50, 0]);
    await mixer.unlock(); await flush();
    await at(5, [500, 500, 0]);
    expect(world.inspection()).toMatchObject({ state: "playing", volume: null, track: { storedString: "F09_F" } });
    expect(elements[0]!.paused, "never stopped on leaving").toBe(false);
    elements[0]!.fire("ended");
    await at(100, [500, 500, 0]);
    expect(world.inspection()).toMatchObject({ state: "silent", track: null, nextPick: null });
    await at(101, [50, 50, 0]);
    expect(world.inspection(), "re-entering starts a pick at once").toMatchObject({ state: "playing", volume: { id: "MusicVolume1" } });
  });

  it("falls back to the labelled AAC derivative when the browser cannot play the Ogg", async () => {
    const { mixer, world, elements, fetched, at } = setup([volume], { rolls: [0] });
    await at(0, [50, 50, 0]);
    await mixer.unlock(); await flush();
    elements[0]!.fire("error");
    await flush(); world.update(null, true); await flush();
    expect(fetched).toEqual(["original:music:F09_F", "derivative:music:F09_F"]);
    expect(world.inspection()).toMatchObject({ state: "playing", track: { storedString: "F09_F", variant: "derivative" } });
    expect(elements[0]!.plays.at(-1)).toMatch(/audio\/mp4$/);
  });

  it("retries a refused play() inside the next trusted gesture (iOS autoplay)", async () => {
    const { mixer, world, elements, listeners, at } = setup([volume], { rolls: [0] });
    const unlockedBeforeTheMusicHadAPick = mixer.unlock();
    await unlockedBeforeTheMusicHadAPick; await flush();
    await at(0, [50, 50, 0]);
    expect(elements).toHaveLength(2);
    for (const element of elements) element.refuse = "NotAllowedError";
    world.next(); await flush();
    expect(world.inspection().state).toBe("waiting-for-unlock");
    for (const element of elements) element.refuse = null;
    listeners.get("touchend")!({ type: "touchend", isTrusted: true } as Event);
    await flush();
    expect(world.inspection().state).toBe("playing");
  });

  it("disables with the 2.5 s fade, and dispose revokes object URLs and unloads elements", async () => {
    const { mixer, world, elements, created, revoked, at } = setup([volume], { rolls: [0] });
    await at(0, [50, 50, 0]);
    await mixer.unlock(); await flush();
    world.setEnabled(false);
    expect(world.inspection()).toMatchObject({ enabled: false, state: "idle", fading: ["music:F09_F"] });
    world.setEnabled(true);
    await at(1, [50, 50, 0]);
    expect(world.inspection().state).toBe("playing");
    world.dispose();
    expect(new Set(revoked)).toEqual(new Set(created));
    expect(elements.every(element => element.src === "" && element.loads === 1)).toBe(true);
    expect(mixer.inspection().nowPlaying).toBeNull();
  });
});
