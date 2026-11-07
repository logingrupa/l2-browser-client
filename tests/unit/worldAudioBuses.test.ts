import { describe, expect, it } from "vitest";
import { WorldAudioMixer, worldAudioLimiterDefaults } from "../../src/audio/WorldAudioMixer";
import { applyWorldAudioDefaults, worldAudioDefaults } from "../../src/audio/worldAudioControls";
import { FakeMediaElement, fakeMixerContext, flush, type FakeGainNode } from "./fakeWebAudio";

class GestureTarget {
  listeners = new Map<string, { handler: (event: Event) => void; options: AddEventListenerOptions }>();
  addEventListener(type: string, handler: (event: Event) => void, options: AddEventListenerOptions): void {
    this.listeners.set(type, { handler, options });
    options.signal?.addEventListener("abort", () => this.listeners.delete(type));
  }
  removeEventListener(type: string): void { this.listeners.delete(type); }
  fire(type: string, isTrusted = true): void { this.listeners.get(type)?.handler({ type, isTrusted } as Event); }
}

async function running(options: ConstructorParameters<typeof WorldAudioMixer>[0] = {}) {
  const { context, makeContext } = fakeMixerContext();
  const mixer = new WorldAudioMixer({ ...options, makeContext });
  for (const key of ["cue", "loop", "track"]) mixer.register(key, new Uint8Array([key.length]));
  await mixer.unlock(); await flush();
  return { context, mixer };
}

describe("world audio output stage", () => {
  it("adds −3 dB headroom and a DynamicsCompressor limiter before the measured output", async () => {
    const { context, mixer } = await running();
    const [master, headroom] = context.gains, limiter = context.compressors[0]!, analyser = context.analysers[0]!;
    expect(master!.connections).toEqual([headroom]);
    expect(headroom!.gain.value).toBeCloseTo(10 ** (-3 / 20));
    expect(headroom!.connections).toEqual([limiter]);
    expect(limiter.connections).toEqual([analyser]);
    expect(analyser.connections).toEqual([context.destination]);
    expect([limiter.threshold.value, limiter.knee.value, limiter.ratio.value, limiter.attack.value, limiter.release.value])
      .toEqual([worldAudioLimiterDefaults.thresholdDb, worldAudioLimiterDefaults.kneeDb, worldAudioLimiterDefaults.ratio,
        worldAudioLimiterDefaults.attackSeconds, worldAudioLimiterDefaults.releaseSeconds]);
    expect(mixer.inspection().limiter).toMatchObject({ active: true, reductionDb: -1.5, headroomDb: -3 });
    expect(mixer.inspection().limiter!.policy).toMatch(/presentation choice/i);
    mixer.play("cue", "actor");
    expect(context.sources[0]!.connections).toEqual([master]);
    mixer.dispose();
  });

  it("keeps the original graph when the limiter is disabled", async () => {
    const { context, mixer } = await running({ limiter: false });
    expect(context.compressors).toHaveLength(0);
    expect(context.gains[0]!.connections).toEqual([context.analysers[0]]);
    expect(mixer.inspection().limiter).toBeNull();
  });
});

describe("world audio buses", () => {
  it("separates the fade node from the level node so setGain never cancels a fade-in", async () => {
    const { context, mixer } = await running();
    const master = context.gains[0]!;
    const voice = mixer.startVoice("track", { bus: "ambience", owner: "ambience:e1", loop: true, gain: .5, fadeInSeconds: 1.2 })!;
    const fade = context.sources[0]!.connections[0] as FakeGainNode, level = fade.connections[0] as FakeGainNode;
    const bus = level.connections[0] as FakeGainNode;
    expect(bus.connections).toContain(master);
    expect(fade.gain.pending(10)).toEqual([["set", 0, 10], ["ramp", 1, 11.2]]);
    expect(level.gain.value).toBe(.5);
    context.currentTime = 10.25;
    voice.setGain(.3, .25);
    // The level change cancels only the level node's schedule; the fade ramp survives.
    expect(fade.gain.pending(10.25)).toEqual([["ramp", 1, 11.2]]);
    expect(level.gain.events.at(-1)).toEqual(["target", .3, 10.25]);
    voice.stop(.5);
    expect(fade.gain.pending(10.25).at(-1)).toEqual(["ramp", 0, 10.75]);
    expect(context.sources[0]!.stops).toEqual([10.75]);
    expect(voice.active()).toBe(true);
    context.sources[0]!.end();
    expect(voice.active()).toBe(false);
  });

  it("applies independent bus volume/mute (music up to 1000 %) and keeps cue voices unstarved", async () => {
    const { context, mixer } = await running({ maxActiveSources: 2, maxAmbienceVoices: 3 });
    mixer.setBusVolume("ambience", .5);
    mixer.setBusMuted("music", true);
    mixer.setBusVolume("music", 10);
    expect(mixer.busState("music")).toEqual({ volume: 10, muted: true });
    for (let i = 0; i < 5; i++) mixer.startVoice("loop", { bus: "ambience", owner: `ambience:${i}`, loop: true, position: [i, 0, 0] });
    expect(mixer.inspection().buses.ambience.active).toBe(3);
    expect(mixer.inspection().lastDropReason).toBe("voice-limit");
    expect(mixer.play("cue", "a")).not.toBeNull();
    expect(mixer.play("cue", "b")).not.toBeNull();
    expect(mixer.play("cue", "c")).toBeNull();
    expect(context.panners).toHaveLength(3);
    expect(context.panners[2]!).toMatchObject({ panningModel: "equalpower", rolloffFactor: 0 });
    expect(context.panners[2]!.positionX.value).toBe(2);
    expect(() => mixer.setBusVolume("ambience", 10.5)).toThrow(RangeError);
    expect(() => mixer.setBusVolume("voice" as never, .5)).toThrow(TypeError);
    expect(mixer.startVoice("loop", { bus: "ambience", owner: "x", gain: -1 })).toBeNull();
    expect(new WorldAudioMixer().inspection().buses.ambience.limit).toBe(16); // native AmbientSoundSlot
  });

  it("stops cues on pause but silences and keeps long-lived voices", async () => {
    const { context, mixer } = await running();
    mixer.play("cue", "actor");
    const loop = mixer.startVoice("loop", { bus: "ambience", owner: "ambience:1", loop: true, offsetSeconds: 5 })!;
    expect(context.sources[1]!.starts[0]![1]).toBe(1); // 5 s wrapped into the 2 s looped buffer
    mixer.setPaused(true);
    expect(mixer.isPaused).toBe(true);
    const ambienceBus = context.gains.find(gain => gain.connections.includes(context.gains[0]!))!;
    expect(mixer.inspection().buses.effects.active).toBe(0);
    expect(loop.active()).toBe(true);
    expect(ambienceBus.gain.value).toBe(0);
    expect(mixer.startVoice("loop", { bus: "ambience", owner: "late" })).toBeNull();
    mixer.setPaused(false);
    expect(ambienceBus.gain.value).toBe(1);
    mixer.dispose();
    expect(loop.active()).toBe(false);
  });

  it("routes a media element through fade and level nodes into the music bus", async () => {
    const { context, mixer } = await running();
    const element = new FakeMediaElement();
    const voice = mixer.connectMedia(element as unknown as HTMLMediaElement, { bus: "music", owner: "music:slot-0", gain: .1 })!;
    const source = context.media[0]!, fade = source.connections[0] as FakeGainNode, level = fade.connections[0] as FakeGainNode;
    expect(level.gain.value).toBe(.1);
    expect(level.connections[0]!.connections).toContain(context.gains[0]);
    voice.setKey("music:F09_F");
    expect(mixer.inspection()).toMatchObject({ nowPlaying: { key: "music:F09_F", owner: "music:slot-0" },
      buses: { music: { active: 1, voices: [{ owner: "music:slot-0", key: "music:F09_F", loop: false }] } } });
    voice.fadeOut(2.5);
    expect(fade.gain.pending(10)).toEqual([["set", 1, 10], ["ramp", 0, 12.5]]);
    voice.resetFade();
    expect(fade.gain.value).toBe(1);
    voice.disconnect();
    expect(mixer.inspection().nowPlaying).toBeNull();
    expect(source.connections).toEqual([]);
  });

  it("realises pre-unlock bus defaults, positions the listener and unregisters only idle sounds", async () => {
    const { context, makeContext } = fakeMixerContext();
    const mixer = new WorldAudioMixer({ makeContext });
    applyWorldAudioDefaults(mixer);
    expect(mixer.busState("music")).toEqual({ volume: worldAudioDefaults.music, muted: false });
    expect(worldAudioDefaults).toEqual({ music: 1, ambience: 1, effects: 1 });
    mixer.setBusVolume("music", 2);
    mixer.setListener([1, 2, 3], [0, 0, -1]);
    mixer.register("track", new Uint8Array([7]));
    expect(await mixer.prepare("track")).toBe(false);
    await mixer.unlock();
    expect(await mixer.prepare("track")).toBe(true);
    expect(context.gains.some(gain => gain.gain.value === 2)).toBe(true);
    expect([context.listener.positionX.value, context.listener.positionY.value, context.listener.positionZ.value]).toEqual([1, 2, 3]);
    const voice = mixer.startVoice("track", { bus: "music", owner: "m" })!;
    expect(mixer.unregister("track")).toBe(false);
    voice.stop();
    expect(mixer.unregister("track")).toBe(true);
    expect(mixer.isRegistered("track")).toBe(false);
    expect(() => mixer.setListener([NaN, 0, 0])).toThrow(TypeError);
  });

  it("limits parallel decodes and lets prepare() jump the queue", async () => {
    const { context, makeContext } = fakeMixerContext();
    const mixer = new WorldAudioMixer({ makeContext, maxConcurrentDecodes: 2 });
    for (let i = 1; i <= 6; i++) mixer.register(`cue-${i}`, new Uint8Array([i]));
    const unlocked = mixer.unlock();
    mixer.register("urgent", new Uint8Array([9]));
    const urgent = mixer.prepare("urgent");
    expect(mixer.inspection().queuedDecodes).toBeGreaterThan(0);
    await unlocked; await flush();
    expect(await urgent).toBe(true);
    expect(context.decodes).toBe(7);
    expect(mixer.inspection()).toMatchObject({ decoded: 7, queuedDecodes: 0 });
    mixer.register("released", new Uint8Array([3]));
    mixer.unregister("released");
    await flush();
    expect(context.decodes).toBe(7 + (mixer.isRegistered("released") ? 1 : 0));
  });
});

describe("gesture unlock and lock state", () => {
  it("resumes synchronously inside trusted gestures, runs unlock hooks and reports the locked state", async () => {
    const { context, makeContext } = fakeMixerContext();
    context.autoResume = false;
    const mixer = new WorldAudioMixer({ makeContext }), target = new GestureTarget();
    const changes: boolean[] = [], hooks: string[] = [];
    mixer.onLockChange(locked => changes.push(locked));
    mixer.addUnlockHook(() => hooks.push(context.state));
    expect(mixer.locked).toBe(true);
    const detach = mixer.attachGestureUnlock(target);
    expect([...target.listeners.keys()]).toEqual(["pointerdown", "touchend", "click", "keydown"]);
    expect(target.listeners.get("touchend")!.options).toMatchObject({ capture: true, passive: true });
    target.fire("click", false);
    expect(context.resumes).toBe(0);
    target.fire("touchend");
    expect(context.resumes).toBe(1); // resumed before any await
    expect(hooks).toEqual(["suspended"]); // hook ran inside the gesture, before the resume settled
    expect(mixer.locked).toBe(true);
    context.settleResume(); await flush();
    expect(mixer.locked).toBe(false);
    expect(changes).toEqual([false]);
    expect(mixer.inspection()).toMatchObject({ locked: false, gestureUnlock: { attached: true, attempts: 1, lastEvent: "touchend" } });
    target.fire("keydown");
    expect(context.resumes).toBe(1); // already running
    context.state = "interrupted" as AudioContextState; context.emitState(); // e.g. iOS interruption
    expect(changes).toEqual([false, true]);
    context.autoResume = true;
    target.fire("pointerdown");
    expect(context.resumes).toBe(2);
    mixer.detachGestureUnlock();
    expect(target.listeners.size).toBe(0);
    expect(mixer.inspection().gestureUnlock.attached).toBe(false);
    detach();
    mixer.attachGestureUnlock(target);
    mixer.dispose();
    expect(target.listeners.size).toBe(0);
  });
});
