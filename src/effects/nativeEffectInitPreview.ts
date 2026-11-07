import type { Scene } from "@babylonjs/core/scene";
import type { NativeActorClock } from "../assets/native/NativeActor";
import type { EffectBundle } from "./nativeEffectComponents";
import type { EffectAnchorView } from "./nativeEffectComponentPreview";
import { createNativeEffectInitTimeline } from "./nativeEffectInitTimeline";
import { createNativeEffectParticlePool } from "./nativeEffectParticlePool";

export interface NativeInitEffectFrame {
  anchor: EffectAnchorView | null;
  clock: NativeActorClock | null;
  sequence: number;
  action: string | null;
  animation: string;
  alive: boolean;
}

type Pool = Awaited<ReturnType<typeof createNativeEffectParticlePool>>;
type Timeline = ReturnType<typeof createNativeEffectInitTimeline>;
type Sample = ReturnType<Timeline["evaluate"]>;
type Status = "off" | "loading" | "armed" | "playing" | "completed" | "failed" | "disposed";

/** Opt-in source-informed init preview. It observes the original source clock;
 * it never dispatches gameplay, advances animation or chooses any sound. */
export function createNativeEffectInitPreview(scene: Scene, bundle: EffectBundle, sourceClip: string,
  frame: () => NativeInitEffectFrame, signal: AbortSignal,
  prepare: typeof createNativeEffectParticlePool = createNativeEffectParticlePool) {
  let disposed = false, enabled = false, request = 0, loading: AbortController | null = null;
  let pool: Pool | null = null, timeline: Timeline | null = null, attached: EffectAnchorView | null = null;
  let status: Status = "off", error: string | null = null, interruption: string | null = null;
  let observedSequence = -1, generation: number | null = null, running = false, runs = 0, sourceSeconds = 0;
  let sourceDuration = 0, sample: Sample | null = null;
  const listeners = new Set<() => void>();
  const publish = () => { for (const listener of listeners) listener(); };
  const change = (next: Status) => { if (status !== next) { status = next; publish(); } };
  const clear = () => { pool?.dispose(); pool = null; attached = null; running = false; };
  const hide = () => { pool?.apply([]); pool?.root.setEnabled(false); running = false; };
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
      enabled = value; generation = null; sourceSeconds = 0; sample = null; error = null; interruption = null;
      if (!value) { change("off"); return; }
      const controller = new AbortController(); loading = controller; change("loading");
      let candidate: Pool | null = null;
      try {
        const origin = frame().anchor;
        if (!origin?.isValid()) throw new Error("The fighter's source hand is unavailable.");
        timeline ??= createNativeEffectInitTimeline(bundle);
        candidate = await prepare(scene, bundle, timeline.components, controller.signal);
        if (disposed || request !== token || controller.signal.aborted) { candidate.dispose(); return; }
        const latest = frame();
        if (!origin.isValid() || !latest.anchor?.isValid() || latest.anchor.root !== origin.root) {
          throw new Error("The source hand changed while preparing init effects.");
        }
        pool = candidate; candidate = null; attached = latest.anchor;
        pool.root.parent = attached.root; pool.root.setEnabled(false);
        // Enabling or completing a load midway through an action never joins
        // it late. Only a subsequent explicit animation generation may start.
        observedSequence = latest.sequence; change("armed");
      } catch (failure) {
        candidate?.dispose();
        if (!disposed && request === token && !controller.signal.aborted) fail(failure);
      } finally {
        if (!disposed && request === token) { loading = null; publish(); }
      }
    },
    update() {
      if (disposed || !enabled || !pool || !timeline || loading) return;
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
            if (clock.durationSeconds + 1e-8 < timeline.duration) {
              throw new Error("The original action is shorter than the prepared init timeline.");
            }
            generation = current.sequence; running = true; runs++; interruption = null;
            sourceDuration = clock.durationSeconds; sourceSeconds = 0; change("playing");
          } else if (running) {
            interruption = "action-changed"; hide(); change("armed");
          }
        }
        if (!running) return;
        if (!special) {
          // NativeActorDriver returns a completed one-shot to idle before this
          // scene observer. Persisting intent/generation distinguishes that
          // completion from movement/another action/death; it starts no replay.
          const completed = current.alive && current.sequence === generation && current.action === "special-attack" &&
            current.animation === "attack" && clock?.mode === "loop";
          if (completed) { sourceSeconds = sourceDuration; sample = timeline.evaluate(sourceSeconds); }
          else interruption = !current.alive ? "fighter-dead" : "source-action-interrupted";
          hide(); change(completed ? "completed" : "armed"); return;
        }
        if (clock.elapsedSeconds + 1e-8 < sourceSeconds || clock.durationSeconds !== sourceDuration) {
          throw new Error("The original action clock changed within a generation.");
        }
        sourceSeconds = clock.elapsedSeconds; sample = timeline.evaluate(sourceSeconds);
        pool.apply(sample.particles); pool.root.setEnabled(sample.particles.length > 0);
        if (sample.complete) { running = false; change("completed"); }
      } catch (failure) { fail(failure); }
    },
    bounds() { return status === "playing" ? pool?.bounds() ?? null : null; },
    subscribe(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener); },
    snapshot() {
      return { policy: "source-informed-init-preview" as const, status, enabled, error, interruption, pending: loading !== null,
        sourceClip, sourceSeconds, generation, runs, manifestSha256: bundle.manifestSha256,
        anchorId: attached?.root.id ?? null, anchorUniqueId: attached?.root.uniqueId ?? null,
        timeline: timeline ? { policy: timeline.policy, seed: timeline.seed, capacity: timeline.capacity, duration: timeline.duration,
          components: timeline.components.map(component => component.object), limitations: timeline.limitations } : null,
        sampled: sample ? structuredClone(sample) : null, pool: pool?.inspect() ?? null,
        nativeSkillVerified: false, nativeEmissionVerified: false, nativeTimingVerified: false,
        limits: ["Arms the next explicit source special-action generation; no late join, gameplay dispatch or sound selection.",
          "Authored init properties with explicit modern scheduling/sampling/interpolation; no native lifetime adjustment or actor DrawScale.",
          "Source clock owns progress and pause. Shot placement, complete native particle/skill/audio behavior remain unimplemented."] };
    },
    dispose,
  };
}

export type NativeEffectInitPreview = ReturnType<typeof createNativeEffectInitPreview>;
