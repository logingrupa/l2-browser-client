import type { NativeMusic, NativeMusicVolume, NativeVector } from "../assets/native/loadNativeWorldAudio";
import { nativeFlameBrowserToNative } from "../scene/world/nativeFlameBillboards";
import type { WorldAudioMediaVoice, WorldAudioMixer } from "./WorldAudioMixer";

function runIgnoringUnloadedMediaElementError(action: () => void): void {
  try { action(); } catch { return; }
}

export const nativeMusicRules = {
  musicVolume: .1,
  gapSeconds: 30,
  changeFadeSeconds: 2.5,
  fadeInSeconds: 0,
  loop: false,
  selection: "uniform-random",
  outside: "finish-then-silence",
  evidence: "native-sound-answers-20261107/REPORT.md Q2: ALineagePlayerController::Tick 0x105d5420, GetMusicName 0x1045f850, ALAudio PlayMusic 0x10007560 (flags 0x1c), Alaudio.int [MusicVolume] MaxTime=30, pinned l2.ini MusicVolume=0.1",
} as const;

export type MusicVariant = "original" | "derivative";
export type MusicPhase = "idle" | "loading" | "waiting-for-unlock" | "playing" | "gap" | "silent" | "failed";

export interface MusicMediaElement {
  src: string;
  preload: string;
  loop: boolean;
  readonly paused: boolean;
  currentTime: number;
  play(): Promise<void>;
  pause(): void;
  load(): void;
  removeAttribute(name: string): void;
  addEventListener(type: "ended" | "error", listener: () => void, options?: AddEventListenerOptions): void;
}

export interface MusicObjectUrls { create(bytes: Uint8Array, mime: string): string; revoke(url: string): void }

export interface WorldMusicOptions {
  now?: () => number;
  random?: () => number;
  updateIntervalSeconds?: number;
  preferOriginal?: boolean;
  createMediaElement?: () => MusicMediaElement;
  objectUrls?: MusicObjectUrls;
  gestureTarget?: Pick<EventTarget, "addEventListener" | "removeEventListener"> | null;
}

export interface WorldMusicVolumeSummary {
  id: string;
  object: string;
  musicId: number;
  boundsNative: { min: NativeVector; max: NativeVector };
}

export interface WorldMusicInspection {
  sourceMap: string | null;
  volumes: WorldMusicVolumeSummary[];
  trackNames: string[];
  enabled: boolean;
  state: MusicPhase;
  volume: { id: string; musicId: number; forcePlayMusic: boolean | null; group: string | null } | null;
  inside: string[];
  track: { key: string; storedString: string; volumeId: string; variant: MusicVariant; durationSeconds: number; positionSeconds: number | null } | null;
  nextPick: string | null;
  gapRemainingSeconds: number | null;
  fading: string[];
  candidates: string[];
  gain: number;
  streaming: string;
  failures: Record<string, string>;
  rules: typeof nativeMusicRules;
  policy: string;
}

const POLICY = "Native (REPORT.md Q2): uniform random track, no loop, no fade-in, 30 s gap then re-pick, 2.5 s linear fade-out on volume change, finish-then-silence outside volumes, gain = l2.ini MusicVolume 0.1 × your music level. Presentation choice: the listener (local pawn) stands in for Pawn.Location; tracks stream through HTMLMediaElement; AAC derivative only when Ogg cannot play.";
const EPSILON = 1e-3;

export function musicVolumeContains(volume: NativeMusicVolume, native: NativeVector): boolean {
  return volume.planes.every(([nx, ny, nz, w]) => nx * native[0] + ny * native[1] + nz * native[2] - w <= EPSILON);
}

export function selectMusicVolume(volumes: readonly NativeMusicVolume[], native: NativeVector):
  { volume: NativeMusicVolume | null; inside: NativeMusicVolume[] } {
  const inside = volumes.filter(volume => musicVolumeContains(volume, native));
  let chosen: NativeMusicVolume | null = null;
  for (const volume of inside) if (!chosen || volume.forcePlayMusic === true) chosen = volume;
  return { volume: chosen, inside };
}

function canPlayOgg(): boolean {
  try {
    if (typeof document === "undefined") return true;
    return document.createElement("audio").canPlayType('audio/ogg; codecs="vorbis"') !== "";
  } catch { return true; }
}

function silentWav(): string {
  const samples = 800, bytes = new Uint8Array(44 + samples), view = new DataView(bytes.buffer);
  const ascii = (offset: number, text: string) => { for (let i = 0; i < text.length; i++) bytes[offset + i] = text.charCodeAt(i); };
  ascii(0, "RIFF"); view.setUint32(4, 36 + samples, true); ascii(8, "WAVE"); ascii(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 8000, true);
  view.setUint32(28, 8000, true); view.setUint16(32, 1, true); view.setUint16(34, 8, true); ascii(36, "data"); view.setUint32(40, samples, true);
  bytes.fill(128, 44);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:audio/wav;base64,${btoa(binary)}`;
}

const defaultObjectUrls: MusicObjectUrls = {
  create: (bytes, mime) => URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: mime.split(";")[0]! })),
  revoke: url => URL.revokeObjectURL(url),
};

interface Slot {
  element: MusicMediaElement;
  voice: WorldAudioMediaVoice;
  key: string | null;
  volumeId: string | null;
  url: string | null;
  fadeEndsAt: number | null;
  blessed: boolean;
}

interface LoadedTrack { variant: MusicVariant; url: string }

export function createWorldMusic(music: NativeMusic, mixer: WorldAudioMixer, options: WorldMusicOptions = {}) {
  const now = options.now ?? (() => performance.now() / 1000), random = options.random ?? Math.random;
  const interval = options.updateIntervalSeconds ?? .5, rules = nativeMusicRules;
  const createElement = options.createMediaElement ?? (() => document.createElement("audio") as MusicMediaElement);
  const urls = options.objectUrls ?? defaultObjectUrls;
  const gestureTarget = options.gestureTarget === undefined ? (typeof window === "undefined" ? null : window) : options.gestureTarget;
  const lifetime = new AbortController();
  const preferOriginal = options.preferOriginal ?? canPlayOgg();
  const variantFor = new Map<string, MusicVariant>(), failures = new Map<string, string>();
  const loaded = new Map<string, LoadedTrack>(), fetching = new Set<string>();
  const slots: Slot[] = [];
  let silent: string | null = null;
  let enabled = true, disposed = false, lastUpdate = -Infinity, needsGesture = false;
  let inside: NativeMusicVolume[] = [], current: NativeMusicVolume | null = null;
  let playing: Slot | null = null, pending: { volume: NativeMusicVolume; key: string } | null = null;
  let nextPick: string | null = null, gapUntil: number | null = null, phase: MusicPhase = "idle";

  const variant = (key: string): MusicVariant => variantFor.get(key) ?? (preferOriginal ? "original" : "derivative");
  const message = (reason: unknown) => reason instanceof Error ? reason.message : String(reason);
  const pick = (volume: NativeMusicVolume) => volume.tracks[Math.min(volume.tracks.length - 1, Math.floor(random() * volume.tracks.length))]!;

  const load = (key: string) => {
    const chosen = variant(key), token = `${chosen}:${key}`;
    if (loaded.get(key)?.variant === chosen || fetching.has(token) || failures.has(key) || disposed) return;
    fetching.add(token);
    music.fetchTrack(key, chosen, lifetime.signal).then(bytes => {
      if (disposed || variant(key) !== chosen) return;
      const track = music.tracks.get(key)!, previous = loaded.get(key);
      const url = urls.create(bytes, chosen === "original" ? track.original.mime : track.derivative.mime);
      loaded.set(key, { variant: chosen, url });
      if (previous && !slots.some(slot => slot.url === previous.url)) urls.revoke(previous.url);
      update(null, true);
    }, reason => {
      if (disposed) return;
      if (chosen === "original") variantFor.set(key, "derivative"); else failures.set(key, message(reason));
      update(null, true);
    }).finally(() => { fetching.delete(token); });
  };

  const release = () => {
    const keep = new Set<string>([...slots.flatMap(slot => slot.key ? [slot.key] : []), ...(pending ? [pending.key] : []), ...(nextPick ? [nextPick] : [])]);
    for (const [key, track] of loaded) {
      if (keep.has(key) || slots.some(slot => slot.url === track.url)) continue;
      urls.revoke(track.url); loaded.delete(key);
    }
  };

  const ensureSlots = (): boolean => {
    if (slots.length) return true;
    if (mixer.contextState() === "locked" || mixer.contextState() === "disposed") return false;
    for (let index = 0; index < 2; index++) {
      const element = createElement();
      element.preload = "auto"; element.loop = rules.loop;
      const voice = mixer.connectMedia(element as unknown as HTMLMediaElement, { bus: "music", owner: `music:slot-${index}`, gain: rules.musicVolume });
      if (!voice) { for (const slot of slots) slot.voice.disconnect(); slots.length = 0; return false; }
      const slot: Slot = { element, voice, key: null, volumeId: null, url: null, fadeEndsAt: null, blessed: false };
      element.addEventListener("ended", () => onEnded(slot), { signal: lifetime.signal });
      element.addEventListener("error", () => onError(slot), { signal: lifetime.signal });
      slots.push(slot);
    }
    return true;
  };

  const gesture = () => {
    if (disposed || !ensureSlots()) return;
    needsGesture = false;
    for (const slot of slots) {
      if (slot.blessed || slot.key) continue;
      slot.blessed = true;
      try {
        silent ??= silentWav();
        slot.element.src = silent;
        void slot.element.play().then(() => { if (!slot.key) slot.element.pause(); }, reason => {
          if (!slot.key && (reason as { name?: string } | null)?.name === "NotAllowedError") slot.blessed = false;
        });
      } catch { slot.blessed = false; }
    }
    if (pending && loaded.has(pending.key)) start(true);
  };
  const removeUnlockHook = mixer.addUnlockHook(gesture);
  const gestureHandler = (event: Event) => { if (event.isTrusted && needsGesture) gesture(); };
  for (const type of ["pointerdown", "touchend", "click", "keydown"]) {
    gestureTarget?.addEventListener(type, gestureHandler, { capture: true, passive: true, signal: lifetime.signal });
  }

  const stopSlot = (slot: Slot) => {
    slot.fadeEndsAt = null;
    runIgnoringUnloadedMediaElementError(() => slot.element.pause());
    slot.voice.setKey(null); slot.key = null; slot.volumeId = null; slot.url = null;
    if (playing === slot) playing = null;
  };

  const fadeOut = (slot: Slot, seconds: number) => {
    if (!slot.key) return;
    slot.voice.fadeOut(seconds);
    slot.fadeEndsAt = now() + seconds;
    if (playing === slot) playing = null;
  };

  const start = (inGesture = false) => {
    if (!pending || !enabled || disposed) return;
    const track = loaded.get(pending.key);
    if (!track) { phase = "loading"; load(pending.key); return; }
    const state = mixer.contextState();
    if ((state !== "running" && !(inGesture && state === "suspended")) || !ensureSlots()) { phase = "waiting-for-unlock"; return; }
    const slot = slots.find(item => !item.key) ?? slots.find(item => item.fadeEndsAt !== null) ?? slots[0]!;
    if (slot.key) stopSlot(slot);
    const { volume, key } = pending;
    pending = null; gapUntil = null;
    slot.key = key; slot.volumeId = volume.id; slot.url = track.url; slot.fadeEndsAt = null;
    slot.voice.resetFade(); slot.voice.setGain(rules.musicVolume, 0); slot.voice.setKey(key);
    playing = slot; phase = "playing";
    slot.element.loop = rules.loop;
    slot.element.src = track.url;
    let result: Promise<void> | undefined;
    try { result = slot.element.play(); } catch (reason) { result = Promise.reject(reason); }
    void result?.then(() => { slot.blessed = true; }, reason => {
      if (disposed || slot.key !== key) return;
      if ((reason as { name?: string } | null)?.name === "NotAllowedError") {
        stopSlot(slot); pending = { volume, key }; needsGesture = true; phase = "waiting-for-unlock";
      } else if ((reason as { name?: string } | null)?.name !== "AbortError") onError(slot);
    });
    nextPick = pick(volume); load(nextPick);
    release();
  };

  const onEnded = (slot: Slot) => {
    if (disposed || !slot.key) return;
    const wasPlaying = playing === slot, volumeId = slot.volumeId;
    stopSlot(slot);
    if (!wasPlaying) return;
    if (current && current.id === volumeId) { gapUntil = now() + rules.gapSeconds; phase = "gap"; }
    else { gapUntil = null; phase = "silent"; }
    update(null, true);
  };

  const onError = (slot: Slot) => {
    if (disposed || !slot.key || slot.element.src === silent) return;
    const key = slot.key, volume = music.volumes.find(item => item.id === slot.volumeId) ?? current, wasPlaying = playing === slot;
    stopSlot(slot);
    if (variant(key) === "original") {
      variantFor.set(key, "derivative");
      const old = loaded.get(key);
      if (old) { urls.revoke(old.url); loaded.delete(key); }
    } else failures.set(key, "The browser could not play this track.");
    if (wasPlaying && volume && !failures.has(key)) { pending = { volume, key }; start(); }
    else if (wasPlaying) { pending = null; gapUntil = now(); }
    if (music.volumes.every(item => item.tracks.every(track => failures.has(track)))) phase = "failed";
  };

  const update = (listener: NativeVector | null, force = false) => {
    if (disposed) return;
    const time = now();
    if (!force && time - lastUpdate < interval) return;
    lastUpdate = time;
    for (const slot of slots) if (slot.fadeEndsAt !== null && time >= slot.fadeEndsAt) stopSlot(slot);
    if (listener) {
      const chosen = selectMusicVolume(music.volumes, nativeFlameBrowserToNative(listener));
      inside = chosen.inside;
      if (chosen.volume !== current) {
        current = chosen.volume; gapUntil = null;
        if (current && enabled) {
          if (!(playing && playing.volumeId === current.id)) {
            if (playing) fadeOut(playing, rules.changeFadeSeconds);
            pending = { volume: current, key: pick(current) };
          }
        } else {
          pending = null; nextPick = null;
        }
        release();
      }
    }
    if (!enabled) { phase = "idle"; return; }
    if (current && !playing && !pending) {
      if (gapUntil === null) gapUntil = time;
      if (time < gapUntil) { phase = "gap"; return; }
      const usable = current.tracks.filter(item => !failures.has(item));
      if (!usable.length) { phase = "failed"; return; }
      pending = { volume: current, key: nextPick && usable.includes(nextPick) ? nextPick : pick(current) };
    }
    if (pending && failures.has(pending.key)) {
      const usable = pending.volume.tracks.filter(item => !failures.has(item));
      if (!usable.length) { pending = null; phase = "failed"; return; }
      pending = { volume: pending.volume, key: usable[Math.min(usable.length - 1, Math.floor(random() * usable.length))]! };
    }
    if (pending) start();
    else phase = playing ? "playing" : current ? phase : "silent";
  };

  return {
    update,
    setEnabled(value: boolean) {
      if (typeof value !== "boolean") throw new TypeError("Music enabled must be boolean.");
      if (value === enabled) return;
      enabled = value;
      if (!value) {
        for (const slot of slots) if (slot.key) fadeOut(slot, rules.changeFadeSeconds);
        pending = null; gapUntil = null;
      } else if (current) pending = { volume: current, key: pick(current) };
      update(null, true);
    },
    next() {
      if (!current || !enabled) return;
      if (playing) fadeOut(playing, rules.changeFadeSeconds);
      pending = { volume: current, key: pick(current) }; gapUntil = null;
      update(null, true);
    },
    get enabled() { return enabled; },
    get volumes(): readonly NativeMusicVolume[] { return music.volumes; },
    inspection(): WorldMusicInspection {
      const slot = playing, key = slot?.key ?? null, track = key ? music.tracks.get(key) : undefined;
      const position = slot ? Number(slot.element.currentTime) : NaN;
      return { sourceMap: music.sourceMap, enabled, state: phase,
        volumes: music.volumes.map(volume => ({ id: volume.id, object: volume.object, musicId: volume.musicId, boundsNative: volume.boundsNative })),
        trackNames: [...music.tracks.values()].map(track => track.storedString),
        volume: current ? { id: current.id, musicId: current.musicId, forcePlayMusic: current.forcePlayMusic, group: current.group } : null,
        inside: inside.map(volume => volume.id),
        track: slot && track ? { key: track.key, storedString: track.storedString, volumeId: slot.volumeId ?? "", variant: variant(track.key),
          durationSeconds: track.durationSeconds, positionSeconds: Number.isFinite(position) ? position : null } : null,
        nextPick: pending?.key ?? nextPick,
        gapRemainingSeconds: !playing && !pending && gapUntil !== null ? Math.max(0, gapUntil - now()) : null,
        fading: slots.filter(item => item.fadeEndsAt !== null && item.key).map(item => item.key!),
        candidates: current ? [...current.tracks] : [],
        gain: rules.musicVolume, streaming: "HTMLMediaElement → MediaElementAudioSourceNode (hash-verified bytes as an object URL)",
        failures: Object.fromEntries(failures), rules, policy: POLICY };
    },
    dispose() {
      if (disposed) return;
      disposed = true; lifetime.abort(); removeUnlockHook();
      for (const slot of slots) {
        stopSlot(slot);
        runIgnoringUnloadedMediaElementError(() => { slot.element.removeAttribute("src"); slot.element.load(); });
        slot.voice.disconnect();
      }
      slots.length = 0;
      for (const track of loaded.values()) urls.revoke(track.url);
      loaded.clear();
    },
  };
}

export type WorldMusic = ReturnType<typeof createWorldMusic>;
