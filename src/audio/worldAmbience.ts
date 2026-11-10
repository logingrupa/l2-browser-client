import type { NativeAmbience, NativeAmbientEmitter, NativeVector } from "../assets/native/loadNativeWorldAudio";
import { nativeFlameBrowserToNative } from "../scene/world/nativeFlameBillboards";
import type { WorldAudioMixer, WorldAudioVoice } from "./WorldAudioMixer";

export const ambientSoundObjectDefaults = {
  ambientRandom: 100, soundRadius: 64, soundVolume: 190, soundPitch: 64, ambientSoundType: 0, ambientSoundStartTime: 0,
} as const;

export const nativeAmbientRules = {
  soundVolume: 1, rolloff: .5, slots: 16, dayStartHour: 6,
  evidence: "native-sound-answers-20261107/REPORT.md Q3: ALAudio.dll 1a589f91 UALAudioSubsystem::Update 0x1000d5a1..0x1000d966; IsSoundDay/IsSoundNight 0x10514310/0x10514350; ALAudio.int [AmbientSound] AmbientSoundSlot=16; pinned l2.ini SoundVolume 1.0, RollOff 0.5",
} as const;

export type AmbienceTimeOfDay = "auto" | "day" | "night";
export const ambienceTimeChoices: readonly AmbienceTimeOfDay[] = ["auto", "day", "night"];

export interface WorldAmbienceOptions {
  now?: () => number;
  random?: () => number;
  clockHour?: () => number;
  updateIntervalSeconds?: number;
  prefetchMarginUnits?: number;
  releaseAfterSeconds?: number;
  maxLoopVoices?: number;
  maxVoices?: number;
  maxConcurrentFetches?: number;
  timeOfDay?: AmbienceTimeOfDay;
}

export interface WorldAmbienceInspection {
  sourceMap: string | null;
  enabled: boolean;
  timeOfDay: AmbienceTimeOfDay;
  isDay: boolean;
  hour: number;
  emitters: number;
  candidates: number;
  inRange: number;
  gated: number;
  sounds: { loaded: number; loading: number; released: number; failed: Record<string, string> };
  loops: { id: string; sound: string; distance: number; distanceUnits: number; gain: number }[];
  oneShots: { started: number; active: number; rolls: number; skippedForVoices: number };
  voices: { active: number; limit: number; loopLimit: number };
  radiusMultiplier: number;
  listener: NativeVector | null;
  listenerPolicy: string;
  policy: string;
}

interface Candidate { emitter: NativeAmbientEmitter; distanceUnits: number; gain: number; loop: boolean }
interface ActiveLoop { voice: WorldAudioVoice; emitter: NativeAmbientEmitter; gain: number; distanceUnits: number }

const POLICY = "Native (REPORT.md Q3): class defaults for omitted fields, candidate within SoundRadius × 50, Day/Night gate, AmbientRandom 100 loops and 1–99 rolls once per WAV length from StartTime, gain (Vol/255) × (50R − d)/(50R) × R/(R + 0.5(d − R)), pitch/64 clamped 0.5–2, 16 slots, no object twice. Presentation choice: listener = local pawn, game hour from the chips (Auto = local clock), ≤ 8 loops loudest-first, pan-only panner, 50 ms anti-click ramp, no browser water volumes.";
const LISTENER_POLICY = "Presentation choice — native listener source (camera or pawn) unproved: the local pawn Location is used.";
const RAMP = .05;

export const ambientValue = <K extends keyof typeof ambientSoundObjectDefaults>(emitter: NativeAmbientEmitter, field: K): number => {
  const value = (emitter as unknown as Record<string, number | null | undefined>)[field];
  return typeof value === "number" && Number.isFinite(value) ? value : ambientSoundObjectDefaults[field];
};

export function ambientRangeUnits(emitter: NativeAmbientEmitter, multiplier: number): number {
  return ambientValue(emitter, "soundRadius") * multiplier;
}

export function ambientGain(emitter: NativeAmbientEmitter, distanceUnits: number, multiplier: number,
  soundVolume: number = nativeAmbientRules.soundVolume, rolloff: number = nativeAmbientRules.rolloff): number {
  const radius = ambientValue(emitter, "soundRadius"), outer = radius * multiplier;
  if (!(distanceUnits <= outer) || outer <= 0) return 0;
  const linear = Math.min(1, Math.max(0, ambientValue(emitter, "soundVolume") / 255 * soundVolume * (outer - distanceUnits) / outer));
  const reference = Math.max(radius, 1);
  const inverse = distanceUnits > reference ? reference / (reference + rolloff * (distanceUnits - reference)) : 1;
  return linear * inverse;
}

const ambientSoundTypeAlways = 0;
const ambientSoundTypeDay = 1;
const ambientSoundTypeNight = 2;
const ambientSoundTypeWater = 3;

export const ambientIsDay =(hour: number): boolean => hour >= nativeAmbientRules.dayStartHour;

export function ambientTypeAllowed(type: number | null, isDay: boolean, listenerInWater = false): boolean {
  const value = type ?? ambientSoundObjectDefaults.ambientSoundType;
  if (value === ambientSoundTypeAlways) return !listenerInWater;
  if (value === ambientSoundTypeDay) return isDay && !listenerInWater;
  if (value === ambientSoundTypeNight) return !isDay && !listenerInWater;
  if (value === ambientSoundTypeWater) return listenerInWater;
  return false;
}

export function ambientLoops(emitter: NativeAmbientEmitter): boolean {
  const chance = ambientValue(emitter, "ambientRandom");
  return chance <= 0 || chance >= 100;
}

export function ambientPlaybackRate(emitter: NativeAmbientEmitter): number {
  return Math.min(2, Math.max(.5, ambientValue(emitter, "soundPitch") / 64));
}

export function ambientPeriodIndex(time: number, startTime: number, wavSeconds: number): number {
  return Math.floor((time - startTime) / wavSeconds);
}

const localHour = () => { const date = new Date(); return date.getHours() + date.getMinutes() / 60; };

export function createWorldAmbience(ambience: NativeAmbience, mixer: WorldAudioMixer, options: WorldAmbienceOptions = {}) {
  const now = options.now ?? (() => performance.now() / 1000), random = options.random ?? Math.random;
  const clockHour = options.clockHour ?? localHour;
  const interval = options.updateIntervalSeconds ?? .25, margin = options.prefetchMarginUnits ?? 1200;
  const releaseAfter = options.releaseAfterSeconds ?? 20;
  const maxVoices = options.maxVoices ?? nativeAmbientRules.slots, maxLoops = Math.min(maxVoices, options.maxLoopVoices ?? 8);
  const maxFetches = options.maxConcurrentFetches ?? 4;
  const multiplier = ambience.radiusMultiplier.value;
  const lifetime = new AbortController();
  const loaded = new Set<string>(), loading = new Set<string>(), failed = new Map<string, string>(), lastNeeded = new Map<string, number>();
  const loops = new Map<string, ActiveLoop>(), oneShots = new Map<string, WorldAudioVoice>();
  const periods = new Map<string, number>();
  const mixerKey = (key: string) => `ambience:${key}`;
  let enabled = true, disposed = false, timeOfDay: AmbienceTimeOfDay = options.timeOfDay ?? "auto";
  let lastUpdate = -Infinity, listener: NativeVector | null = null, candidatesCount = 0, inRange = 0, gated = 0;
  let started = 0, skipped = 0, rolls = 0, released = 0, hour = 12;

  const fetchSound = (key: string) => {
    if (loaded.has(key) || loading.has(key) || failed.has(key) || loading.size >= maxFetches || disposed) return;
    loading.add(key);
    ambience.fetchSound(key, lifetime.signal).then(bytes => {
      if (disposed) return;
      mixer.register(mixerKey(key), bytes);
      loaded.add(key);
    }, reason => { if (!disposed) failed.set(key, reason instanceof Error ? reason.message : String(reason)); })
      .finally(() => { loading.delete(key); });
  };

  const stopLoop = (id: string, fade = .3) => {
    const active = loops.get(id);
    if (!active) return;
    loops.delete(id);
    active.voice.stop(fade);
  };

  const activeShots = () => { let count = 0; for (const voice of oneShots.values()) if (voice.active()) count++; return count; };

  const update = (position: NativeVector | null, force = false) => {
    if (disposed) return;
    const native = position ? nativeFlameBrowserToNative(position) : null;
    listener = native;
    const time = now();
    if (!force && time - lastUpdate < interval) return;
    lastUpdate = time;
    for (const [id, voice] of oneShots) if (!voice.active()) oneShots.delete(id);
    for (const [id, loop] of loops) if (!loop.voice.active()) loops.delete(id);
    if (!enabled || !native) {
      for (const id of [...loops.keys()]) stopLoop(id);
      return;
    }
    hour = timeOfDay === "day" ? 12 : timeOfDay === "night" ? 0 : clockHour();
    const isDay = ambientIsDay(hour);
    const candidates: Candidate[] = [];
    candidatesCount = 0; inRange = 0; gated = 0;
    for (const emitter of ambience.emitters) {
      if (!emitter.sound) continue;
      const [x, y, z] = emitter.native;
      const distanceUnits = Math.hypot(x - native[0], y - native[1], z - native[2]);
      const range = ambientRangeUnits(emitter, multiplier);
      if (distanceUnits > range + margin) continue;
      const allowed = ambientTypeAllowed(emitter.ambientSoundType, isDay);
      if (distanceUnits <= range) { candidatesCount++; if (!allowed) gated++; }
      if (!allowed) continue;
      lastNeeded.set(emitter.sound, time);
      fetchSound(emitter.sound);
      if (distanceUnits > range) continue;
      inRange++;
      candidates.push({ emitter, distanceUnits, gain: ambientGain(emitter, distanceUnits, multiplier), loop: ambientLoops(emitter) });
    }
    const running = mixer.contextState() === "running" && !mixer.isPaused;
    const wanted = candidates.filter(candidate => candidate.loop && candidate.gain > 0 && loaded.has(candidate.emitter.sound!))
      .sort((a, b) => (loops.has(b.emitter.id) ? b.gain * 1.2 : b.gain) - (loops.has(a.emitter.id) ? a.gain * 1.2 : a.gain))
      .slice(0, maxLoops);
    const keep = new Set(wanted.map(candidate => candidate.emitter.id));
    for (const id of [...loops.keys()]) if (!keep.has(id)) stopLoop(id);
    for (const candidate of wanted) {
      const active = loops.get(candidate.emitter.id);
      if (active) { active.voice.setGain(candidate.gain, interval); active.gain = candidate.gain; active.distanceUnits = candidate.distanceUnits; continue; }
      if (!running || loops.size + activeShots() >= maxVoices) continue;
      const key = mixerKey(candidate.emitter.sound!);
      if (!mixer.isDecoded(key)) { void mixer.prepare(key); continue; }
      const voice = mixer.startVoice(key, { bus: "ambience", owner: `ambience:${candidate.emitter.id}`, loop: true, gain: candidate.gain,
        playbackRate: ambientPlaybackRate(candidate.emitter), fadeInSeconds: RAMP, position: candidate.emitter.position });
      if (voice) loops.set(candidate.emitter.id, { voice, emitter: candidate.emitter, gain: candidate.gain, distanceUnits: candidate.distanceUnits });
    }
    const visible = new Set<string>();
    for (const candidate of candidates) {
      if (candidate.loop) continue;
      const emitter = candidate.emitter, sound = ambience.sounds.get(emitter.sound!)!;
      visible.add(emitter.id);
      const index = ambientPeriodIndex(time, ambientValue(emitter, "ambientSoundStartTime"), sound.durationSeconds);
      const previous = periods.get(emitter.id);
      periods.set(emitter.id, index);
      const shot = oneShots.get(emitter.id);
      const sameObjectStillPlaying = shot?.active() ? shot : null;
      if (sameObjectStillPlaying) { sameObjectStillPlaying.setGain(candidate.gain, interval); continue; }
      if (previous === undefined || previous === index || !running || candidate.gain <= 0) continue;
      rolls++;
      if (random() * 100 >= ambientValue(emitter, "ambientRandom")) continue;
      const key = mixerKey(emitter.sound!);
      if (!loaded.has(emitter.sound!) || !mixer.isDecoded(key)) { if (loaded.has(emitter.sound!)) void mixer.prepare(key); continue; }
      if (loops.size + activeShots() >= maxVoices) { skipped++; continue; }
      const voice = mixer.startVoice(key, { bus: "ambience", owner: `ambience:${emitter.id}`, gain: candidate.gain,
        playbackRate: ambientPlaybackRate(emitter), fadeInSeconds: RAMP, position: emitter.position });
      if (voice) { oneShots.set(emitter.id, voice); started++; } else skipped++;
    }
    for (const id of [...periods.keys()]) if (!visible.has(id)) periods.delete(id);
    for (const key of [...loaded]) {
      if (time - (lastNeeded.get(key) ?? -Infinity) < releaseAfter) continue;
      if (mixer.unregister(mixerKey(key))) { loaded.delete(key); lastNeeded.delete(key); released++; }
    }
  };

  return {
    update,
    setEnabled(value: boolean) {
      if (typeof value !== "boolean") throw new TypeError("Ambience enabled must be boolean.");
      enabled = value;
      if (!value) { for (const id of [...loops.keys()]) stopLoop(id); for (const voice of oneShots.values()) voice.stop(.3); oneShots.clear(); }
      lastUpdate = -Infinity;
    },
    setTimeOfDay(value: AmbienceTimeOfDay) {
      if (!ambienceTimeChoices.includes(value)) throw new TypeError("Invalid ambience time of day.");
      timeOfDay = value; lastUpdate = -Infinity;
    },
    get enabled() { return enabled; },
    get timeOfDay() { return timeOfDay; },
    inspection(): WorldAmbienceInspection {
      return { sourceMap: ambience.sourceMap, enabled, timeOfDay, isDay: ambientIsDay(hour), hour, emitters: ambience.emitters.length, candidates: candidatesCount, inRange, gated,
        sounds: { loaded: loaded.size, loading: loading.size, released, failed: Object.fromEntries(failed) },
        loops: [...loops.values()].map(loop => ({ id: loop.emitter.id, sound: loop.emitter.sound!, distanceUnits: loop.distanceUnits,
          distance: loop.distanceUnits * .01, gain: loop.gain })).sort((a, b) => b.gain - a.gain),
        oneShots: { started, active: activeShots(), rolls, skippedForVoices: skipped },
        voices: { active: loops.size + activeShots(), limit: maxVoices, loopLimit: maxLoops },
        radiusMultiplier: multiplier, listener, listenerPolicy: LISTENER_POLICY, policy: POLICY };
    },
    dispose() {
      if (disposed) return;
      disposed = true; lifetime.abort();
      for (const id of [...loops.keys()]) stopLoop(id, 0);
      for (const voice of oneShots.values()) voice.stop(0);
      oneShots.clear();
      for (const key of loaded) mixer.unregister(mixerKey(key));
      loaded.clear();
    },
  };
}

export type WorldAmbience = ReturnType<typeof createWorldAmbience>;
