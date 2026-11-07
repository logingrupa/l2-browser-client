import type { AssetPackage } from "./readAssetPackage";

export interface NativeSoundEvent { clip: string; timeSeconds: number; sound: string; resolvedFile: string }
export interface SoundOccurrence { event: NativeSoundEvent; elapsedSeconds: number }

/** Authored notifications crossed by a source-duration clock. A boundary event
 * belongs to the ending loop; a zero-time event belongs to the next loop. */
export function nativeSoundEventsBetween(events: readonly NativeSoundEvent[], clip: string, previous: number, elapsed: number, duration: number, includeStart = false): SoundOccurrence[] {
  if (![previous, elapsed, duration].every(Number.isFinite) || previous < 0 || elapsed < previous || duration <= 0) throw new Error("Invalid native notification clock.");
  const result: SoundOccurrence[] = [];
  for (const event of events) {
    if (event.clip !== clip || event.timeSeconds < 0 || event.timeSeconds > duration) continue;
    const first = Math.max(0, Math.ceil((previous - event.timeSeconds) / duration));
    const last = Math.floor((elapsed - event.timeSeconds) / duration);
    // A background tab must not produce an unbounded sound burst on return.
    for (let loop = Math.max(first, last - 1); loop <= last; loop++) {
      const time = loop * duration + event.timeSeconds;
      if (time > previous || (includeStart && time === previous)) result.push({ event, elapsedSeconds: time });
    }
  }
  return result.sort((a, b) => a.elapsedSeconds - b.elapsedSeconds);
}

export interface NativeEventAudio {
  setEnabled(enabled: boolean): Promise<void>;
  reset(): void;
  advance(clip: string, previousElapsed: number, elapsed: number, durationSeconds: number): void;
  inspection(): { available: number; enabled: boolean; decoded: number; played: number; skipped: number; error: string | null };
  dispose(): void;
}

/** Optional diagnostic playback of exact linked files. This deliberately does
 * not interpret UE2 volume, radius, random, surface, or conditional dispatch.
 * AudioContext is created only from the user's enable gesture. */
export function createNativeEventAudio(asset: AssetPackage, makeContext: () => AudioContext = () => new AudioContext()): NativeEventAudio {
  const events: NativeSoundEvent[] = [];
  for (const value of asset.manifest.animationEvents ?? []) {
    if (typeof value !== "object" || !value) continue;
    const event = value as Partial<NativeSoundEvent>;
    const file = asset.manifest.files.find(file => file.path === event.resolvedFile);
    if (typeof event.clip === "string" && typeof event.timeSeconds === "number" && Number.isFinite(event.timeSeconds) && event.timeSeconds >= 0 &&
      typeof event.sound === "string" && typeof event.resolvedFile === "string" && file && ["audio/wav", "audio/ogg"].includes(file.mime) && asset.files.has(file.path)) events.push(event as NativeSoundEvent);
  }
  let context: AudioContext | undefined, enabled = false, disposed = false, includeStart = true;
  let played = 0, skipped = 0, error: string | null = null;
  let decoding: Promise<void> | undefined;
  const buffers = new Map<string, AudioBuffer>(), active = new Set<AudioBufferSourceNode>();
  const stop = () => { for (const source of active) { source.onended = null; source.stop(); source.disconnect(); } active.clear(); };
  return {
    async setEnabled(value) {
      if (disposed) return;
      enabled = value;
      if (!value) { stop(); return; }
      try {
        context ??= makeContext();
        const ownedContext = context;
        // Call resume synchronously within the trusted click before awaiting.
        const resume = ownedContext.resume();
        decoding ??= (async () => {
          for (const file of new Set(events.map(event => event.resolvedFile))) {
            if (disposed) return;
            const decoded = await ownedContext.decodeAudioData(asset.files.get(file)!.slice().buffer);
            if (!disposed) buffers.set(file, decoded);
          }
        })();
        await Promise.all([resume, decoding]);
      } catch (reason) {
        if (!disposed) { enabled = false; error = reason instanceof Error ? reason.message : "Linked audio could not be decoded."; stop(); }
      }
    },
    reset() { includeStart = true; stop(); },
    advance(clip, previous, elapsed, duration) {
      const start = includeStart;
      includeStart = false;
      if (!enabled || disposed || !context || context.state !== "running") return;
      for (const occurrence of nativeSoundEventsBetween(events, clip, previous, elapsed, duration, start && previous === 0)) {
        const buffer = buffers.get(occurrence.event.resolvedFile), offset = elapsed - occurrence.elapsedSeconds;
        // Seek past a missed onset, keeping the preview aligned after a slow
        // frame. Do not replay stale sounds after a long background-tab gap.
        if (!buffer || offset >= buffer.duration || offset > .25 || active.size >= 16) { skipped++; continue; }
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.connect(context.destination);
        active.add(source);
        source.onended = () => { active.delete(source); source.disconnect(); };
        source.start(context.currentTime, Math.max(0, offset));
        played++;
      }
    },
    inspection: () => ({ available: events.length, enabled, decoded: buffers.size, played, skipped, error }),
    dispose() {
      if (disposed) return;
      disposed = true; enabled = false; stop(); buffers.clear();
      if (context) void context.close().catch(() => {});
    },
  };
}
