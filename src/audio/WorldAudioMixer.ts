/** One world-owned output graph for exact, externally selected source cues.
 * This is a preview graph, not a native trigger, loop, random, surface, listener,
 * attenuation or spatial policy. Registration never fetches or unlocks audio.
 *
 * Buses (presentation): master ← {music, ambience, effects}. Bus nodes are
 * created on first use or first adjustment, so the default effects path keeps
 * the original source → master cue graph. Each bus has its own voice limit so
 * ambience/music never starve cues.
 *
 * Output stage (presentation choice — native rule unverified): master → −3 dB
 * headroom → DynamicsCompressorNode limiter (−6 dBFS, ratio 20, knee 0) →
 * analyser → destination, so overlapping combat cues cannot clip. Contexts
 * without createDynamicsCompressor keep master → analyser → destination. */
export type WorldAudioBus = "music" | "ambience" | "effects";
export const worldAudioBuses: readonly WorldAudioBus[] = ["music", "ambience", "effects"];
/** Highest bus level (1000 %): the music level multiplies the native l2.ini MusicVolume 0.1. */
export const WORLD_AUDIO_MAX_BUS_VOLUME = 10;

export interface WorldAudioLimiterSettings {
  headroomDb: number; thresholdDb: number; kneeDb: number; ratio: number; attackSeconds: number; releaseSeconds: number;
}

/** Presentation choice — native rule unverified (no native limiter is known). */
export const worldAudioLimiterDefaults: Readonly<WorldAudioLimiterSettings> = {
  headroomDb: -3, thresholdDb: -6, kneeDb: 0, ratio: 20, attackSeconds: .002, releaseSeconds: .15,
};

export interface WorldAudioMixerOptions {
  makeContext?: () => AudioContext;
  /** Effects-bus voice limit (the original cue preview limit). */
  maxActiveSources?: number;
  maxCatchupOffsetSeconds?: number;
  /** Default 16 = ALAudio.int [AmbientSound] AmbientSoundSlot (native). */
  maxAmbienceVoices?: number;
  maxMusicVoices?: number;
  /** Parallel decodeAudioData calls; the rest queue (avoids a first-tap CPU/memory spike). */
  maxConcurrentDecodes?: number;
  /** false disables the master limiter stage. */
  limiter?: boolean;
}

export interface WorldAudioPlaybackReceipt {
  id: number;
  key: string;
  owner: string;
  contextTime: number;
  offsetSeconds: number;
  durationSeconds: number;
}

export type WorldAudioVector = readonly [number, number, number];

export interface WorldAudioVoiceOptions {
  bus: WorldAudioBus;
  owner: string;
  loop?: boolean;
  /** Linear voice gain in [0, 4]. */
  gain?: number;
  /** Clamped to [0.25, 4]. */
  playbackRate?: number;
  /** Start position inside the buffer; wrapped for loops. */
  offsetSeconds?: number;
  /** Linear fade from 0 on a separate fade node; setGain never cancels it. */
  fadeInSeconds?: number;
  /** Browser world metres. Enables a pan-only PannerNode (distance gain stays with the caller). */
  position?: WorldAudioVector;
  onEnded?: (reason: "natural" | "stopped") => void;
}

export interface WorldAudioVoice {
  readonly id: number;
  readonly key: string;
  readonly owner: string;
  readonly bus: WorldAudioBus;
  readonly loop: boolean;
  readonly durationSeconds: number;
  readonly startedAt: number;
  active(): boolean;
  setGain(value: number, rampSeconds?: number): void;
  setPosition(position: WorldAudioVector): void;
  stop(fadeSeconds?: number): void;
}

/** An HTMLMediaElement routed through MediaElementAudioSourceNode into a bus
 * (streamed music; no full decodeAudioData). */
export interface WorldAudioMediaVoice {
  readonly owner: string;
  readonly bus: WorldAudioBus;
  /** Linear level in [0, 4] (e.g. native MusicVolume 0.1). */
  setGain(value: number, rampSeconds?: number): void;
  /** Linear ramp of the fade node to 0 over `seconds`. */
  fadeOut(seconds: number): void;
  /** Resets the fade node to full immediately (new track, no fade-in). */
  resetFade(): void;
  /** Track label for inspection; null while idle. */
  setKey(key: string | null): void;
  disconnect(): void;
}

interface BusLevel { volume: number; muted: boolean; rms: number | null; peak: number | null }
export interface WorldAudioBusInspection extends BusLevel {
  created: boolean;
  active: number;
  limit: number;
  voices: { owner: string; key: string; loop: boolean }[];
}

export interface WorldAudioInspection {
  state: AudioContextState | "locked" | "unlocking" | "error" | "disposed";
  /** True until the context runs (HUD "Tap anywhere for sound"). */
  locked: boolean;
  error: string | null;
  muted: boolean;
  volume: number;
  paused: boolean;
  registered: number;
  decoded: number;
  decoding: number;
  queuedDecodes: number;
  active: number;
  played: number;
  dropped: number;
  lastDropReason: string | null;
  decodeErrors: Record<string, string>;
  limits: { maxActiveSources: number; maxCatchupOffsetSeconds: number; policy: "source-cue-preview" };
  output: { available: boolean; rms: number | null; peak: number | null; sampledAtContextTime: number | null };
  limiter: (WorldAudioLimiterSettings & { active: boolean; reductionDb: number | null; policy: string }) | null;
  buses: { master: BusLevel } & Record<WorldAudioBus, WorldAudioBusInspection>;
  listener: { position: WorldAudioVector; forward: WorldAudioVector | null } | null;
  nowPlaying: { key: string; owner: string; startedAt: number } | null;
  gestureUnlock: { attached: boolean; attempts: number; lastEvent: string | null };
}

interface RegisteredSound {
  bytes: Uint8Array;
  buffer?: AudioBuffer;
  pending?: Promise<void>;
  error?: string;
  released?: boolean;
}

interface Voice {
  owner: string; key: string; bus: WorldAudioBus; loop: boolean; source: AudioBufferSourceNode;
  fade?: GainNode | undefined; gain?: GainNode | undefined; panner?: PannerNode | undefined; startedAt: number; stopping: boolean;
  onEnded?: ((reason: "natural" | "stopped") => void) | undefined;
}

interface MediaVoice { owner: string; bus: WorldAudioBus; key: string | null; source: AudioNode; fade: GainNode; gain: GainNode; startedAt: number }

interface Bus { gain: GainNode; analyser?: AnalyserNode | undefined }

const message = (reason: unknown): string => reason instanceof Error ? reason.message : String(reason);
const identifier = (value: string): boolean => typeof value === "string" && value.trim().length > 0;
const finiteVector = (value: unknown): value is WorldAudioVector =>
  Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
const gestureEvents = ["pointerdown", "touchend", "click", "keydown"] as const;
const dbToGain = (db: number) => 10 ** (db / 20);
const LIMITER_POLICY = "Presentation choice — native rule unverified: −3 dB headroom then a DynamicsCompressorNode limiter so overlapping cues never clip.";

function setParam(param: AudioParam, value: number, context: AudioContext | undefined, ramp = .04): void {
  if (context && ramp > 0 && typeof param.setTargetAtTime === "function") {
    try { param.cancelScheduledValues?.(context.currentTime); param.setTargetAtTime(value, context.currentTime, ramp / 3); return; }
    catch { /* Fall back to an immediate value. */ }
  }
  param.value = value;
}

function setVector(target: { positionX?: AudioParam; positionY?: AudioParam; positionZ?: AudioParam; setPosition?: (x: number, y: number, z: number) => void },
  [x, y, z]: WorldAudioVector): void {
  if (target.positionX && target.positionY && target.positionZ) {
    target.positionX.value = x; target.positionY.value = y; target.positionZ.value = z;
  } else target.setPosition?.(x, y, z);
}

function rampFade(param: AudioParam, context: AudioContext, from: number, to: number, seconds: number): void {
  const now = context.currentTime;
  try {
    param.cancelScheduledValues?.(now);
    param.setValueAtTime?.(from, now);
    if (seconds > 0 && typeof param.linearRampToValueAtTime === "function") param.linearRampToValueAtTime(to, now + seconds);
    else param.value = to;
  } catch { param.value = to; }
}

export class WorldAudioMixer {
  private readonly makeContext: () => AudioContext;
  private readonly maxActiveSources: number;
  private readonly maxCatchupOffsetSeconds: number;
  private readonly maxConcurrentDecodes: number;
  private readonly useLimiter: boolean;
  private readonly busLimits: Record<WorldAudioBus, number>;
  private readonly sounds = new Map<string, RegisteredSound>();
  private readonly voices = new Map<number, Voice>();
  private readonly media = new Set<MediaVoice>();
  private readonly closed = new WeakSet<AudioContext>();
  private readonly sampleBuffers = new WeakMap<AnalyserNode, Float32Array<ArrayBuffer>>();
  private readonly buses = new Map<WorldAudioBus, Bus>();
  private readonly busSettings: Record<WorldAudioBus, { volume: number; muted: boolean }> = {
    music: { volume: 1, muted: false }, ambience: { volume: 1, muted: false }, effects: { volume: 1, muted: false },
  };
  private readonly unlockHooks = new Set<(context: AudioContext) => void>();
  private readonly lockListeners = new Set<(locked: boolean) => void>();
  private readonly decodeQueue: (() => void)[] = [];
  private activeDecodes = 0;
  private context: AudioContext | undefined;
  private master: GainNode | undefined;
  private headroom: GainNode | undefined;
  private limiter: DynamicsCompressorNode | undefined;
  private analyser: AnalyserNode | undefined;
  private capture: MediaStreamAudioDestinationNode | undefined;
  private disposed = false;
  private muted = false;
  private volume = 1;
  private paused = false;
  private unlocking = 0;
  private error: string | null = null;
  private played = 0;
  private dropped = 0;
  private lastDropReason: string | null = null;
  private nextId = 1;
  private listener: { position: WorldAudioVector; forward: WorldAudioVector | null; up: WorldAudioVector } | null = null;
  private nowPlaying: { key: string; owner: string; startedAt: number; id: number } | null = null;
  private detachGesture: (() => void) | undefined;
  private gestureAttempts = 0;
  private lastGestureEvent: string | null = null;
  private lastLocked = true;

  constructor(options: WorldAudioMixerOptions = {}) {
    this.makeContext = options.makeContext ?? (() => new AudioContext());
    this.maxActiveSources = options.maxActiveSources ?? 16;
    this.maxCatchupOffsetSeconds = options.maxCatchupOffsetSeconds ?? .25;
    this.maxConcurrentDecodes = options.maxConcurrentDecodes ?? 4;
    this.useLimiter = options.limiter !== false;
    this.busLimits = { effects: this.maxActiveSources, ambience: options.maxAmbienceVoices ?? 16, music: options.maxMusicVoices ?? 2 };
    if (!Number.isInteger(this.maxActiveSources) || this.maxActiveSources < 1 || this.maxActiveSources > 128 ||
        !Number.isFinite(this.maxCatchupOffsetSeconds) || this.maxCatchupOffsetSeconds < 0 || this.maxCatchupOffsetSeconds > 5 ||
        !Number.isInteger(this.maxConcurrentDecodes) || this.maxConcurrentDecodes < 1 || this.maxConcurrentDecodes > 64 ||
        ![this.busLimits.ambience, this.busLimits.music].every(limit => Number.isInteger(limit) && limit >= 1 && limit <= 64)) {
      throw new RangeError("Invalid audio preview limits (1–128 voices; 0–5 seconds catch-up; 1–64 bus voices and decodes).");
    }
  }

  register(key: string, bytes: Uint8Array): void {
    if (this.disposed) return;
    if (!identifier(key) || !(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
      throw new TypeError("Audio registration requires a nonempty key and bytes.");
    }
    const existing = this.sounds.get(key);
    if (existing) {
      if (bytes.length !== existing.bytes.length || bytes.some((value, index) => value !== existing.bytes[index])) {
        throw new Error(`Audio key already identifies different bytes: ${key}`);
      }
      return;
    }
    const sound: RegisteredSound = { bytes: new Uint8Array(bytes) };
    this.sounds.set(key, sound);
    // Late source registration may decode into an already user-opened context;
    // it never creates or resumes a context and never starts playback itself.
    if (this.context && this.context.state !== "closed") void this.decode(sound, this.context);
  }

  /** Release a registered sound and its decoded buffer when no voice uses it. */
  unregister(key: string): boolean {
    if ([...this.voices.values()].some(voice => voice.key === key)) return false;
    const sound = this.sounds.get(key);
    if (sound) sound.released = true;
    return this.sounds.delete(key);
  }

  isRegistered(key: string): boolean { return this.sounds.has(key); }
  isDecoded(key: string): boolean { return Boolean(this.sounds.get(key)?.buffer); }
  decodeError(key: string): string | null { return this.sounds.get(key)?.error ?? null; }

  /** Resolves true once decoded, false after a decode failure or while locked.
   * A prepare request jumps the decode queue. */
  prepare(key: string): Promise<boolean> {
    const sound = this.sounds.get(key);
    if (!sound || this.disposed) return Promise.resolve(false);
    if (sound.buffer) return Promise.resolve(true);
    if (!this.context || this.context.state === "closed") return Promise.resolve(false);
    return this.decode(sound, this.context, true).then(() => Boolean(sound.buffer));
  }

  /** True until the AudioContext is running (locked, suspended, interrupted). */
  get locked(): boolean { return !this.disposed && this.context?.state !== "running"; }

  /** Notified whenever `locked` changes; returns an unsubscribe function. */
  onLockChange(listener: (locked: boolean) => void): () => void {
    this.lockListeners.add(listener);
    return () => { this.lockListeners.delete(listener); };
  }

  /** Runs synchronously inside unlock(), i.e. inside the trusted gesture
   * (iOS: create/play media elements there). Returns an unsubscribe function. */
  addUnlockHook(hook: (context: AudioContext) => void): () => void {
    this.unlockHooks.add(hook);
    return () => { this.unlockHooks.delete(hook); };
  }

  /** Call directly from a trusted user action, before the caller awaits work.
   * Creation AND resume are synchronous in this method. Failures are inspectable
   * and retryable; failed decodes are not permanently cached as successes. */
  unlock(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    let context: AudioContext;
    let resume: Promise<void>;
    try {
      context = this.context ?? this.createContext();
      if (context.state === "closed") throw new Error("World audio context is closed.");
      resume = context.resume();
      this.error = null;
    } catch (reason) {
      this.error = message(reason);
      return Promise.resolve();
    }
    try {
      // iOS: route Web Audio through the playback session so the ringer switch
      // does not silence it. Presentation choice; absent elsewhere.
      const session = (globalThis.navigator as { audioSession?: { type?: string } } | undefined)?.audioSession;
      if (session && session.type !== "playback") session.type = "playback";
    } catch { /* Unsupported audio-session API. */ }
    for (const hook of [...this.unlockHooks]) {
      try { hook(context); } catch (reason) { this.error ??= message(reason); }
    }
    this.unlocking++;
    const decodes = [...this.sounds.values()].map(sound => this.decode(sound, context));
    // Lock state follows the resume, not the (queued) decodes.
    void resume.then(() => this.emitLock(), () => this.emitLock());
    return Promise.all([resume, ...decodes]).then(() => { this.applyListener(); }, reason => {
      if (!this.disposed) this.error = message(reason);
    }).finally(() => { this.unlocking--; this.emitLock(); });
  }

  /** The first trusted pointerdown/touchend/click/keydown anywhere unlocks audio
   * (resume inside the gesture; iOS requires touchend/click). Listeners stay
   * attached so a later gesture can resume an interrupted/suspended context. */
  attachGestureUnlock(target: Pick<EventTarget, "addEventListener" | "removeEventListener"> = globalThis as unknown as EventTarget): () => void {
    if (this.disposed) return () => undefined;
    this.detachGesture?.();
    const lifetime = new AbortController();
    const handler = (event: Event) => {
      if (!event.isTrusted || this.disposed) return;
      if (this.context?.state === "running" && !this.unlocking) return;
      this.gestureAttempts++; this.lastGestureEvent = event.type;
      void this.unlock();
    };
    for (const type of gestureEvents) target.addEventListener(type, handler, { capture: true, passive: true, signal: lifetime.signal });
    const detach = () => { lifetime.abort(); if (this.detachGesture === detach) this.detachGesture = undefined; };
    this.detachGesture = detach;
    return detach;
  }

  /** Removes the gesture listeners (e.g. measurement runs that must stay silent). */
  detachGestureUnlock(): void { this.detachGesture?.(); }

  contextState(): AudioContextState | "locked" | "disposed" {
    return this.disposed ? "disposed" : this.context?.state ?? "locked";
  }

  contextTime(): number | null { return this.context && this.context.state !== "closed" ? this.context.currentTime : null; }

  setMuted(value: boolean): void {
    if (typeof value !== "boolean") throw new TypeError("Audio mute must be boolean.");
    if (this.disposed) return;
    this.muted = value;
    this.updateGain();
  }

  setVolume(value: number): void {
    if (!Number.isFinite(value) || value < 0 || value > 1) throw new RangeError("Audio volume must be in [0, 1].");
    if (this.disposed) return;
    this.volume = value;
    this.updateGain();
  }

  /** Bus level in [0, 10] (0–1000 %). */
  setBusVolume(bus: WorldAudioBus, value: number): void {
    if (!worldAudioBuses.includes(bus)) throw new TypeError("Unknown audio bus.");
    if (!Number.isFinite(value) || value < 0 || value > WORLD_AUDIO_MAX_BUS_VOLUME) throw new RangeError("Bus volume must be in [0, 10].");
    if (this.disposed) return;
    this.busSettings[bus].volume = value;
    this.updateBus(bus, true);
  }

  setBusMuted(bus: WorldAudioBus, value: boolean): void {
    if (!worldAudioBuses.includes(bus)) throw new TypeError("Unknown audio bus.");
    if (typeof value !== "boolean") throw new TypeError("Bus mute must be boolean.");
    if (this.disposed) return;
    this.busSettings[bus].muted = value;
    this.updateBus(bus, true);
  }

  busState(bus: WorldAudioBus): { volume: number; muted: boolean } { return { ...this.busSettings[bus] }; }

  setPaused(value: boolean): void {
    if (typeof value !== "boolean") throw new TypeError("Audio pause must be boolean.");
    if (this.disposed) return;
    const changed = this.paused !== value;
    this.paused = value;
    // Cues stop; long-lived music/ambience voices are silenced and continue.
    if (value) this.stopAll("effects");
    if (changed) { this.updateBus("music"); this.updateBus("ambience"); }
    // Resume does not replay missed cues or restart stopped sources.
  }

  get isPaused(): boolean { return this.paused; }

  /** Listener in browser world metres (forward/up optional). */
  setListener(position: WorldAudioVector, forward?: WorldAudioVector, up: WorldAudioVector = [0, 1, 0]): void {
    if (!finiteVector(position) || (forward !== undefined && !finiteVector(forward)) || !finiteVector(up)) {
      throw new TypeError("Audio listener vectors must be finite.");
    }
    if (this.disposed) return;
    this.listener = { position: [...position], forward: forward ? [...forward] : null, up: [...up] };
    this.applyListener();
  }

  play(key: string, owner: string, offsetSeconds = 0): WorldAudioPlaybackReceipt | null {
    if (this.disposed) return this.drop("disposed");
    if (!identifier(key) || !identifier(owner) || !Number.isFinite(offsetSeconds) || offsetSeconds < 0) {
      return this.drop("invalid-call");
    }
    if (this.paused) return this.drop("paused");
    if (this.muted) return this.drop("muted");
    const context = this.context, master = this.master;
    if (!context || !master || context.state !== "running") return this.drop("context-not-running");
    const sound = this.sounds.get(key);
    if (!sound) return this.drop("unregistered");
    const buffer = sound.buffer;
    if (!buffer) return this.drop(sound.error ? "decode-failed" : "not-decoded");
    if (offsetSeconds > this.maxCatchupOffsetSeconds || offsetSeconds >= buffer.duration) return this.drop("stale-offset");
    if (this.count("effects") >= this.busLimits.effects) return this.drop("voice-limit");
    let source: AudioBufferSourceNode | undefined;
    const id = this.nextId++;
    try {
      source = context.createBufferSource();
      source.buffer = buffer;
      source.loop = false;
      source.connect(this.buses.get("effects")?.gain ?? master);
      const contextTime = context.currentTime;
      const voice: Voice = { owner, key, bus: "effects", loop: false, source, startedAt: contextTime, stopping: false };
      this.voices.set(id, voice);
      source.onended = () => this.release(id, voice, false);
      source.start(contextTime, offsetSeconds);
      this.played++;
      return { id, key, owner, contextTime, offsetSeconds, durationSeconds: buffer.duration };
    } catch (reason) {
      this.error = message(reason);
      const voice = this.voices.get(id);
      if (voice) this.release(id, voice, true);
      else if (source) { try { source.disconnect(); } catch { /* Already disconnected. */ } }
      return this.drop("start-failed");
    }
  }

  /** Long-lived or spatial voice on a named bus (ambient loops/one-shots).
   * Graph: source → fade gain → level gain → [pan-only panner] → bus. */
  startVoice(key: string, options: WorldAudioVoiceOptions): WorldAudioVoice | null {
    if (this.disposed) return this.drop("disposed");
    const { bus, owner } = options;
    const gain = options.gain ?? 1, rate = Math.min(4, Math.max(.25, options.playbackRate ?? 1)), fade = options.fadeInSeconds ?? 0;
    if (!identifier(key) || !identifier(owner) || !worldAudioBuses.includes(bus) || !Number.isFinite(gain) || gain < 0 || gain > 4 ||
        !Number.isFinite(rate) || !Number.isFinite(fade) || fade < 0 || (options.position !== undefined && !finiteVector(options.position)) ||
        !Number.isFinite(options.offsetSeconds ?? 0) || (options.offsetSeconds ?? 0) < 0) return this.drop("invalid-call");
    if (this.paused) return this.drop("paused");
    const context = this.context;
    if (!context || !this.master || context.state !== "running") return this.drop("context-not-running");
    const sound = this.sounds.get(key);
    if (!sound) return this.drop("unregistered");
    const buffer = sound.buffer;
    if (!buffer) return this.drop(sound.error ? "decode-failed" : "not-decoded");
    if (this.count(bus) >= this.busLimits[bus]) return this.drop("voice-limit");
    const loop = options.loop === true;
    let offset = options.offsetSeconds ?? 0;
    if (loop) offset %= buffer.duration;
    else if (offset >= buffer.duration) return this.drop("stale-offset");
    const id = this.nextId++;
    let source: AudioBufferSourceNode | undefined, fadeGain: GainNode | undefined, levelGain: GainNode | undefined, panner: PannerNode | undefined;
    try {
      const destination = this.ensureBus(bus).gain;
      source = context.createBufferSource();
      source.buffer = buffer; source.loop = loop;
      if (source.playbackRate) source.playbackRate.value = rate;
      fadeGain = context.createGain();
      levelGain = context.createGain();
      const now = context.currentTime;
      if (fade > 0) rampFade(fadeGain.gain, context, 0, 1, fade);
      else fadeGain.gain.value = 1;
      levelGain.gain.value = gain;
      source.connect(fadeGain); fadeGain.connect(levelGain);
      if (options.position && typeof context.createPanner === "function") {
        panner = context.createPanner();
        panner.panningModel = "equalpower"; panner.distanceModel = "linear";
        panner.rolloffFactor = 0; panner.refDistance = 1; panner.maxDistance = 10000;
        setVector(panner, options.position);
        levelGain.connect(panner); panner.connect(destination);
      } else levelGain.connect(destination);
      const voice: Voice = { owner, key, bus, loop, source, fade: fadeGain, gain: levelGain, panner, startedAt: now, stopping: false, onEnded: options.onEnded };
      this.voices.set(id, voice);
      source.onended = () => this.release(id, voice, false);
      source.start(now, offset);
      this.played++;
      if (bus === "music") this.nowPlaying = { key, owner, startedAt: now, id };
      const mixer = this;
      return {
        id, key, owner, bus, loop, durationSeconds: buffer.duration, startedAt: now,
        active: () => this.voices.get(id) === voice,
        setGain(value: number, rampSeconds = .05) {
          if (mixer.voices.get(id) !== voice || voice.stopping || !Number.isFinite(value) || value < 0 || value > 4) return;
          // Level node only: an in-progress fade-in on the fade node is untouched.
          setParam(voice.gain!.gain, value, mixer.context, rampSeconds);
        },
        setPosition(position: WorldAudioVector) {
          if (mixer.voices.get(id) === voice && voice.panner && finiteVector(position)) setVector(voice.panner, position);
        },
        stop(fadeSeconds = 0) { mixer.stopVoice(id, voice, fadeSeconds); },
      };
    } catch (reason) {
      this.error = message(reason);
      const voice = this.voices.get(id);
      if (voice) this.release(id, voice, true);
      else for (const node of [source, fadeGain, levelGain, panner]) { try { node?.disconnect(); } catch { /* Partial graph. */ } }
      return this.drop("start-failed");
    }
  }

  /** Routes a media element through the graph (MediaElementAudioSourceNode →
   * fade gain → level gain → bus). One source node per element, ever; call
   * after the context exists (e.g. from an unlock hook). */
  connectMedia(element: HTMLMediaElement, options: { bus: WorldAudioBus; owner: string; gain?: number }): WorldAudioMediaVoice | null {
    if (this.disposed) return this.drop("disposed");
    const context = this.context, gain = options.gain ?? 1;
    if (!identifier(options.owner) || !worldAudioBuses.includes(options.bus) || !Number.isFinite(gain) || gain < 0 || gain > 4) return this.drop("invalid-call");
    if (!context || !this.master || context.state === "closed" || typeof context.createMediaElementSource !== "function") return this.drop("context-not-open");
    let source: AudioNode | undefined, fade: GainNode | undefined, level: GainNode | undefined;
    try {
      source = context.createMediaElementSource(element);
      fade = context.createGain(); level = context.createGain();
      fade.gain.value = 1; level.gain.value = gain;
      source.connect(fade); fade.connect(level); level.connect(this.ensureBus(options.bus).gain);
    } catch (reason) {
      this.error = message(reason);
      for (const node of [source, fade, level]) { try { node?.disconnect(); } catch { /* Partial graph. */ } }
      return this.drop("start-failed");
    }
    const entry: MediaVoice = { owner: options.owner, bus: options.bus, key: null, source, fade, gain: level, startedAt: context.currentTime };
    this.media.add(entry);
    const mixer = this;
    return {
      owner: entry.owner, bus: entry.bus,
      setGain(value: number, rampSeconds = .05) {
        if (!mixer.media.has(entry) || !Number.isFinite(value) || value < 0 || value > 4) return;
        setParam(entry.gain.gain, value, mixer.context, rampSeconds);
      },
      fadeOut(seconds: number) {
        if (!mixer.media.has(entry) || !mixer.context) return;
        rampFade(entry.fade.gain, mixer.context, entry.fade.gain.value, 0, Math.max(0, seconds));
      },
      resetFade() {
        if (!mixer.media.has(entry) || !mixer.context) return;
        rampFade(entry.fade.gain, mixer.context, 1, 1, 0);
      },
      setKey(key: string | null) {
        if (!mixer.media.has(entry)) return;
        entry.key = key;
        if (key) entry.startedAt = mixer.context?.currentTime ?? 0;
      },
      disconnect() {
        if (!mixer.media.delete(entry)) return;
        for (const node of [entry.source, entry.fade, entry.gain]) { try { node.disconnect(); } catch { /* Already disconnected. */ } }
      },
    };
  }

  stopOwner(owner: string): void {
    for (const [id, voice] of this.voices) if (voice.owner === owner) this.release(id, voice, true);
  }

  /** Optional recording branch from the same post-mute/volume graph. Calling
   * this before unlock does not create a context or request any device access. */
  captureStream(): MediaStream | null {
    if (this.disposed || !this.context || !this.master || this.context.state === "closed") return null;
    if (this.capture) return this.capture.stream;
    if (typeof this.context.createMediaStreamDestination !== "function") return null;
    try {
      const destination = this.context.createMediaStreamDestination();
      this.capture = destination;
      this.outputNode()!.connect(destination);
      return destination.stream;
    } catch (reason) {
      this.error = message(reason);
      this.releaseCapture();
      return null;
    }
  }

  /** `levels: false` skips analyser reads (cheap UI refresh). */
  inspection(options: { levels?: boolean } = {}): WorldAudioInspection {
    const levels = options.levels !== false;
    const sounds = [...this.sounds.entries()];
    const decodeErrors = Object.fromEntries(sounds.flatMap(([key, value]) => value.error ? [[key, value.error]] : []));
    const error = this.error ?? Object.values(decodeErrors)[0] ?? null;
    const state = this.disposed ? "disposed" : this.unlocking ? "unlocking" :
      this.context?.state ?? (error ? "error" : "locked");
    const output = levels ? this.measureOutput() : { available: Boolean(this.analyser), rms: null, peak: null, sampledAtContextTime: null };
    const bus = (name: WorldAudioBus): WorldAudioBusInspection => {
      const node = this.buses.get(name), level = levels && node?.analyser ? this.measure(node.analyser) : null;
      const voices = [...this.voices.values()].filter(voice => voice.bus === name);
      const media = [...this.media].filter(entry => entry.bus === name && entry.key);
      return { ...this.busSettings[name], created: Boolean(node), active: voices.length + media.length, limit: this.busLimits[name],
        rms: level?.rms ?? null, peak: level?.peak ?? null,
        voices: [...voices.map(voice => ({ owner: voice.owner, key: voice.key, loop: voice.loop })),
          ...media.map(entry => ({ owner: entry.owner, key: entry.key!, loop: false }))] };
    };
    const playingMedia = [...this.media].find(entry => entry.bus === "music" && entry.key);
    const playing = this.nowPlaying && this.voices.has(this.nowPlaying.id) ? this.nowPlaying :
      playingMedia ? { key: playingMedia.key!, owner: playingMedia.owner, startedAt: playingMedia.startedAt } : null;
    const limiter = this.limiter ? { ...worldAudioLimiterDefaults, active: true,
      reductionDb: typeof this.limiter.reduction === "number" && Number.isFinite(this.limiter.reduction) ? this.limiter.reduction : null,
      policy: LIMITER_POLICY } : null;
    return { state, locked: this.locked, error, muted: this.muted, volume: this.volume, paused: this.paused,
      registered: sounds.length, decoded: sounds.filter(([, sound]) => sound.buffer).length,
      decoding: sounds.filter(([, sound]) => sound.pending).length, queuedDecodes: this.decodeQueue.length, active: this.voices.size,
      played: this.played, dropped: this.dropped, lastDropReason: this.lastDropReason, decodeErrors,
      limits: { maxActiveSources: this.maxActiveSources, maxCatchupOffsetSeconds: this.maxCatchupOffsetSeconds, policy: "source-cue-preview" },
      output, limiter,
      buses: { master: { volume: this.volume, muted: this.muted, rms: output.rms, peak: output.peak },
        music: bus("music"), ambience: bus("ambience"), effects: bus("effects") },
      listener: this.listener ? { position: this.listener.position, forward: this.listener.forward } : null,
      nowPlaying: playing ? { key: playing.key, owner: playing.owner, startedAt: playing.startedAt } : null,
      gestureUnlock: { attached: Boolean(this.detachGesture), attempts: this.gestureAttempts, lastEvent: this.lastGestureEvent } };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.detachGesture?.();
    this.stopAll();
    for (const entry of [...this.media]) {
      this.media.delete(entry);
      for (const node of [entry.source, entry.fade, entry.gain]) { try { node.disconnect(); } catch { /* Best-effort cleanup. */ } }
    }
    this.sounds.clear();
    this.decodeQueue.length = 0;
    this.unlockHooks.clear();
    this.releaseCapture();
    for (const bus of this.buses.values()) {
      try { bus.gain.disconnect(); } catch { /* Best-effort cleanup after closure. */ }
      try { bus.analyser?.disconnect(); } catch { /* Best-effort cleanup after closure. */ }
    }
    this.buses.clear();
    for (const node of [this.master, this.headroom, this.limiter, this.analyser]) {
      try { node?.disconnect(); } catch { /* Best-effort cleanup after closure. */ }
    }
    if (this.context) this.closeOnce(this.context);
    this.master = undefined;
    this.headroom = undefined;
    this.limiter = undefined;
    this.analyser = undefined;
    this.emitLock();
    this.lockListeners.clear();
  }

  private createContext(): AudioContext {
    const context = this.makeContext();
    let gain: GainNode | undefined, analyser: AnalyserNode | undefined, headroom: GainNode | undefined, limiter: DynamicsCompressorNode | undefined;
    try {
      gain = context.createGain();
      gain.gain.value = this.muted ? 0 : this.volume;
      if (this.useLimiter && typeof context.createDynamicsCompressor === "function") {
        try {
          const settings = worldAudioLimiterDefaults;
          headroom = context.createGain();
          headroom.gain.value = dbToGain(settings.headroomDb);
          limiter = context.createDynamicsCompressor();
          limiter.threshold.value = settings.thresholdDb; limiter.knee.value = settings.kneeDb; limiter.ratio.value = settings.ratio;
          limiter.attack.value = settings.attackSeconds; limiter.release.value = settings.releaseSeconds;
          gain.connect(headroom); headroom.connect(limiter);
        } catch {
          for (const node of [headroom, limiter]) { try { node?.disconnect(); } catch { /* Partial limiter. */ } }
          try { gain.disconnect(); } catch { /* Partial limiter. */ }
          headroom = undefined; limiter = undefined;
        }
      }
      const tail: AudioNode = limiter ?? gain;
      if (typeof context.createAnalyser === "function") {
        try { analyser = context.createAnalyser(); analyser.fftSize = 2048; }
        catch { if (analyser) analyser.disconnect(); analyser = undefined; }
      }
      if (analyser) { tail.connect(analyser); analyser.connect(context.destination); }
      else tail.connect(context.destination);
      this.context = context;
      this.master = gain;
      this.headroom = headroom;
      this.limiter = limiter;
      this.analyser = analyser;
      try { context.addEventListener?.("statechange", () => this.emitLock()); } catch { /* Optional event. */ }
      // Buses adjusted before unlock are realised now; untouched effects stays direct.
      for (const bus of worldAudioBuses) if (this.busSettings[bus].volume !== 1 || this.busSettings[bus].muted) this.ensureBus(bus);
      return context;
    } catch (reason) {
      for (const node of [gain, headroom, limiter, analyser]) { try { node?.disconnect(); } catch { /* Partially connected graph. */ } }
      this.buses.clear();
      this.closeOnce(context);
      throw reason;
    }
  }

  private outputNode(): AudioNode | undefined { return this.analyser ?? this.limiter ?? this.master; }

  private emitLock(): void {
    const locked = this.locked;
    if (locked === this.lastLocked) return;
    this.lastLocked = locked;
    for (const listener of [...this.lockListeners]) { try { listener(locked); } catch { /* Listener failures stay local. */ } }
  }

  private ensureBus(name: WorldAudioBus): Bus {
    const existing = this.buses.get(name);
    if (existing) return existing;
    const context = this.context, master = this.master;
    if (!context || !master) throw new Error("World audio context is not open.");
    const gain = context.createGain();
    let analyser: AnalyserNode | undefined;
    if (typeof context.createAnalyser === "function") {
      try { analyser = context.createAnalyser(); analyser.fftSize = 1024; gain.connect(analyser); }
      catch { analyser = undefined; }
    }
    gain.connect(master);
    const bus: Bus = { gain, analyser };
    this.buses.set(name, bus);
    this.updateBus(name);
    return bus;
  }

  private busGain(name: WorldAudioBus): number {
    const setting = this.busSettings[name];
    return setting.muted || (this.paused && name !== "effects") ? 0 : setting.volume;
  }

  private updateBus(name: WorldAudioBus, create = false): void {
    if (!this.context || !this.master) return;
    const bus = create ? this.ensureBus(name) : this.buses.get(name);
    if (bus) setParam(bus.gain.gain, this.busGain(name), this.context);
  }

  private applyListener(): void {
    const listener = this.context?.listener as (AudioListener & {
      forwardX?: AudioParam; forwardY?: AudioParam; forwardZ?: AudioParam; upX?: AudioParam; upY?: AudioParam; upZ?: AudioParam;
      setOrientation?: (x: number, y: number, z: number, ux: number, uy: number, uz: number) => void;
    }) | undefined;
    if (!listener || !this.listener) return;
    try {
      setVector(listener, this.listener.position);
      const forward = this.listener.forward, up = this.listener.up;
      if (!forward) return;
      if (listener.forwardX && listener.forwardY && listener.forwardZ && listener.upX && listener.upY && listener.upZ) {
        listener.forwardX.value = forward[0]; listener.forwardY.value = forward[1]; listener.forwardZ.value = forward[2];
        listener.upX.value = up[0]; listener.upY.value = up[1]; listener.upZ.value = up[2];
      } else listener.setOrientation?.(forward[0], forward[1], forward[2], up[0], up[1], up[2]);
    } catch { /* Listener positioning is best-effort presentation. */ }
  }

  /** Concurrency-limited decode slot; `priority` requests run before queued ones. */
  private acquireDecodeSlot(priority: boolean): Promise<void> {
    if (this.activeDecodes < this.maxConcurrentDecodes) { this.activeDecodes++; return Promise.resolve(); }
    return new Promise<void>(resolve => {
      const start = () => { this.activeDecodes++; resolve(); };
      if (priority) this.decodeQueue.unshift(start); else this.decodeQueue.push(start);
    });
  }

  private releaseDecodeSlot(): void {
    this.activeDecodes = Math.max(0, this.activeDecodes - 1);
    const next = this.decodeQueue.shift();
    if (next && !this.disposed) next();
  }

  private decode(sound: RegisteredSound, context: AudioContext, priority = false): Promise<void> {
    if (this.disposed || sound.buffer) return Promise.resolve();
    if (sound.pending) return sound.pending;
    delete sound.error;
    // decodeAudioData may detach its argument; retain an independent copy for
    // immutable identity comparisons and later retry after decode failure.
    let holding = false;
    const pending = this.acquireDecodeSlot(priority).then(() => {
      holding = true;
      if (this.disposed || sound.released) return undefined;
      return context.decodeAudioData(new Uint8Array(sound.bytes).buffer);
    }).then(buffer => {
      if (this.disposed || !buffer) return;
      if (!Number.isFinite(buffer.duration) || buffer.duration <= 0) throw new Error("Decoded audio has no finite positive duration.");
      sound.buffer = buffer;
    }).catch(reason => {
      if (!this.disposed) sound.error = message(reason);
    }).finally(() => {
      if (sound.pending === pending) delete sound.pending;
      if (holding) this.releaseDecodeSlot();
    });
    sound.pending = pending;
    return pending;
  }

  private updateGain(): void { if (this.master) this.master.gain.value = this.muted ? 0 : this.volume; }

  private count(bus: WorldAudioBus): number {
    let total = 0;
    for (const voice of this.voices.values()) if (voice.bus === bus) total++;
    return total;
  }

  private drop(reason: string): null { this.dropped++; this.lastDropReason = reason; return null; }

  private stopVoice(id: number, voice: Voice, fadeSeconds: number): void {
    if (this.voices.get(id) !== voice || voice.stopping) return;
    const context = this.context, fade = voice.fade ?? voice.gain;
    if (!context || !fade || !(fadeSeconds > 0) || typeof fade.gain.linearRampToValueAtTime !== "function") {
      this.release(id, voice, true);
      return;
    }
    voice.stopping = true;
    try {
      rampFade(fade.gain, context, fade.gain.value, 0, fadeSeconds);
      voice.source.stop(context.currentTime + fadeSeconds);
    } catch { this.release(id, voice, true); }
  }

  private release(id: number, voice: Voice, stop: boolean): void {
    if (this.voices.get(id) !== voice) return;
    this.voices.delete(id);
    voice.source.onended = null;
    if (stop) { try { voice.source.stop(); } catch { /* May already have ended. */ } }
    for (const node of [voice.source, voice.fade, voice.gain, voice.panner]) {
      try { node?.disconnect(); } catch { /* Safe against native ended/close races. */ }
    }
    if (voice.onEnded) {
      try { voice.onEnded(stop || voice.stopping ? "stopped" : "natural"); } catch { /* Listener failures stay local. */ }
    }
  }

  private stopAll(bus?: WorldAudioBus): void {
    for (const [id, voice] of this.voices) if (!bus || voice.bus === bus) this.release(id, voice, true);
  }

  private releaseCapture(): void {
    if (!this.capture) return;
    try { this.outputNode()?.disconnect(this.capture); } catch { /* Graph may already be disconnected. */ }
    for (const track of this.capture.stream.getTracks()) { try { track.stop(); } catch { /* Track may have ended. */ } }
    try { this.capture.disconnect(); } catch { /* Graph may already be disconnected. */ }
    this.capture = undefined;
  }

  private closeOnce(context: AudioContext): void {
    if (this.closed.has(context)) return;
    this.closed.add(context);
    try { if (context.state !== "closed") void context.close().catch(() => {}); } catch { /* Already closed. */ }
  }

  private measure(analyser: AnalyserNode): { rms: number; peak: number } | null {
    if (this.disposed || !this.context || typeof analyser.getFloatTimeDomainData !== "function") return null;
    try {
      let samples = this.sampleBuffers.get(analyser);
      if (!samples || samples.length !== analyser.fftSize) { samples = new Float32Array(analyser.fftSize); this.sampleBuffers.set(analyser, samples); }
      analyser.getFloatTimeDomainData(samples);
      let sum = 0, peak = 0;
      for (const sample of samples) {
        if (!Number.isFinite(sample)) throw new Error("Non-finite analyser output.");
        sum += sample * sample;
        peak = Math.max(peak, Math.abs(sample));
      }
      return { rms: Math.sqrt(sum / samples.length), peak };
    } catch { return null; }
  }

  private measureOutput(): WorldAudioInspection["output"] {
    if (!this.disposed && this.context && this.analyser) {
      const level = this.measure(this.analyser);
      // No synthesized amplitude when the analyser is unavailable.
      if (level) return { available: true, ...level, sampledAtContextTime: this.context.currentTime };
    }
    return { available: false, rms: null, peak: null, sampledAtContextTime: null };
  }
}
