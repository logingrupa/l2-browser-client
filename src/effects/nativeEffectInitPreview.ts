import type { Scene } from "@babylonjs/core/scene";
import type { NativeActorClock } from "../assets/native/NativeActor";
import { dispatchStageActor, type EffectBundle } from "./nativeEffectComponents";
import type { EffectAnchorView } from "./nativeEffectComponentPreview";
import { drawEffectSessionSeed, loadEmitterActorPlayback, type EmitterActorPlayback } from "./particles/render/emitterActorPlayback";

export interface NativeInitEffectFrame {
  anchor: EffectAnchorView | null;
  clock: NativeActorClock | null;
  sequence: number;
  action: string | null;
  animation: string;
  alive: boolean;
}

type Status = "off" | "loading" | "armed" | "playing" | "completed" | "failed" | "disposed";

export function createNativeEffectInitPreview(scene: Scene, bundle: EffectBundle, sourceClip: string,
  frame: () => NativeInitEffectFrame, signal: AbortSignal, prepare: typeof loadEmitterActorPlayback = loadEmitterActorPlayback) {
  let disposed = false, enabled = false, request = 0, loading: AbortController | null = null;
  let playback: EmitterActorPlayback | null = null, attached: EffectAnchorView | null = null, actorObject: string | null = null;
  let status: Status = "off", error: string | null = null, interruption: string | null = null;
  let observedSequence = -1, generation: number | null = null, running = false, runs = 0, sourceSeconds = 0, sourceDuration = 0;
  const listeners = new Set<() => void>();
  const publish = () => { for (const listener of listeners) listener(); };
  const change = (next: Status) => { if (status !== next) { status = next; publish(); } };
  const clear = () => { playback?.dispose(); playback = null; attached = null; running = false; };
  const hide = () => { playback?.stop(); running = false; };
  const fail = (failure: unknown) => {
    clear(); enabled = false;
    error = failure instanceof Error ? failure.message : "Original init effects could not be prepared.";
    change("failed");
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true; enabled = false; request++; loading?.abort(); loading = null; clear();
    signal.removeEventListener("abort", dispose); scene.onDisposeObservable.remove(sceneObserver);
    change("disposed"); listeners.clear();
  };
  const sceneObserver = scene.onDisposeObservable.addOnce(dispose);
  signal.addEventListener("abort", dispose, { once: true });
  if (signal.aborted || scene.isDisposed) dispose();

  return {
    async setEnabled(value: boolean): Promise<void> {
      if (disposed || enabled === value && status !== "failed") return;
      const token = ++request; loading?.abort(); loading = null; clear();
      enabled = value; generation = null; sourceSeconds = 0; error = null; interruption = null;
      if (!value) { change("off"); return; }
      const controller = new AbortController(); loading = controller; change("loading");
      let candidate: EmitterActorPlayback | null = null;
      try {
        const origin = frame().anchor;
        if (!origin?.isValid()) throw new Error("The fighter's source hand is unavailable.");
        actorObject = dispatchStageActor(bundle, "init");
        candidate = await prepare(scene, bundle, { actorObject, emitterObjects: null, sessionSeed: drawEffectSessionSeed() }, controller.signal);
        if (disposed || request !== token || controller.signal.aborted) { candidate.dispose(); return; }
        const latest = frame();
        if (!origin.isValid() || !latest.anchor?.isValid() || latest.anchor.root !== origin.root) {
          throw new Error("The source hand changed while preparing init effects.");
        }
        playback = candidate; candidate = null; attached = latest.anchor;
        playback.root.parent = attached.root;
        observedSequence = latest.sequence; change("armed");
      } catch (failure) {
        candidate?.dispose();
        if (!disposed && request === token && !controller.signal.aborted) fail(failure);
      } finally {
        if (!disposed && request === token) { loading = null; publish(); }
      }
    },
    update() {
      if (disposed || !enabled || !playback || loading) return;
      try {
        const current = frame(), clock = current.clock;
        if (!attached?.isValid() || !current.anchor?.isValid() || current.anchor.root !== attached.root) {
          throw new Error("The source hand no longer belongs to this init preview.");
        }
        const special = current.alive && current.action === "special-attack" && current.animation === "attack" &&
          clock?.clip === sourceClip && clock.mode === "once";
        if (special && (!Number.isFinite(clock.elapsedSeconds) || clock.elapsedSeconds < 0 ||
          !Number.isFinite(clock.durationSeconds) || clock.durationSeconds <= 0 || clock.elapsedSeconds > clock.durationSeconds + 1e-8)) {
          throw new Error("The original action clock is invalid.");
        }
        if (current.sequence !== observedSequence) {
          observedSequence = current.sequence;
          if (special) {
            generation = current.sequence; running = true; runs++; interruption = null; sourceSeconds = 0; sourceDuration = clock.durationSeconds;
            playback.start(); change("playing");
          } else if (running) {
            interruption = "action-changed"; hide(); change("armed");
          }
        }
        if (!running) return;
        if (!special) {
          const completed = current.alive && current.sequence === generation && current.action === "special-attack" &&
            current.animation === "attack" && clock?.mode === "loop";
          if (!completed) interruption = !current.alive ? "fighter-dead" : "source-action-interrupted";
          hide(); change(completed ? "completed" : "armed"); return;
        }
        if (clock.elapsedSeconds + 1e-8 < sourceSeconds || clock.durationSeconds !== sourceDuration) {
          throw new Error("The original action clock changed within a generation.");
        }
        playback.advance(clock.elapsedSeconds - sourceSeconds);
        sourceSeconds = clock.elapsedSeconds;
        if (!playback.playing) { running = false; change("completed"); }
      } catch (failure) { fail(failure); }
    },
    bounds() { return status === "playing" ? playback?.bounds() ?? null : null; },
    subscribe(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener); },
    snapshot() {
      return { policy: "simulated-source-init-preview" as const, status, enabled, error, interruption, pending: loading !== null,
        sourceClip, sourceSeconds, generation, runs, manifestSha256: bundle.manifestSha256, actorObject,
        anchorId: attached?.root.id ?? null, anchorUniqueId: attached?.root.uniqueId ?? null,
        playback: playback?.inspect() ?? null, nativeSkillVerified: false, nativeTimingVerified: false };
    },
    dispose,
  };
}

export type NativeEffectInitPreview = ReturnType<typeof createNativeEffectInitPreview>;
