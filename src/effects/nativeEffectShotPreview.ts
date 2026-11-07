import type { Scene } from "@babylonjs/core/scene";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { NativeActorClock } from "../assets/native/NativeActor";
import type { EntityPivotView } from "../entities/EntityRegistry";
import type { EffectBundle } from "./nativeEffectComponents";
import type { NativePowerStrikeShotSource } from "./nativePowerStrikeSource";
import { nativeEffectShotPlacement } from "./nativeEffectShotPlacement";
import { createNativeEffectShotTimeline } from "./nativeEffectShotTimeline";
import { createNativeEffectParticlePool } from "./nativeEffectParticlePool";

export interface NativeShotTargetView {
  readonly pivot: EntityPivotView;
  readonly collisionRadius: number;
  readonly profileId: string;
  readonly alive: boolean;
}
export interface NativeShotEffectFrame {
  readonly caster: EntityPivotView | null;
  readonly target: NativeShotTargetView | null;
  readonly targetId: string | null;
  readonly clock: NativeActorClock | null;
  readonly sequence: number;
  readonly action: string | null;
  readonly animation: string;
  readonly alive: boolean;
}
type Pool = Awaited<ReturnType<typeof createNativeEffectParticlePool>>;
type Timeline = ReturnType<typeof createNativeEffectShotTimeline>;
type Sample = ReturnType<Timeline["evaluate"]>;
type Status = "off" | "loading" | "armed" | "waiting" | "playing" | "completed" | "failed" | "disposed";

/** Source-event visual stage. The semantic adapter owns the bound target ID;
 * this manager owns only a world-space effect root and never damage or audio. */
export function createNativeEffectShotPreview(scene: Scene, bundle: EffectBundle, inputSource: NativePowerStrikeShotSource,
  frame: () => NativeShotEffectFrame, signal: AbortSignal,
  prepare: typeof createNativeEffectParticlePool = createNativeEffectParticlePool) {
  const source = Object.freeze(structuredClone(inputSource));
  let disposed = false, enabled = false, request = 0, loading: AbortController | null = null;
  let pool: Pool | null = null, timeline: Timeline | null = null, caster: EntityPivotView | null = null;
  let target: NativeShotTargetView | null = null, observedSequence = -1, generation: number | null = null;
  let status: Status = "off", error: string | null = null, interruption: string | null = null;
  let running = false, fired = false, runs = 0, shots = 0, sourceSeconds = 0;
  let sample: Sample | null = null, placement: ReturnType<typeof nativeEffectShotPlacement> | null = null;
  let emittedAtSourceSeconds: number | null = null;
  const casterPosition = new Vector3(), targetPosition = new Vector3(), listeners = new Set<() => void>();
  const publish = () => { for (const listener of listeners) listener(); };
  const change = (next: Status) => { if (status !== next) { status = next; publish(); } };
  const clear = () => { pool?.dispose(); pool = null; caster = null; target = null; running = false; };
  const hide = () => { pool?.apply([]); pool?.root.setEnabled(false); running = false; };
  const cancel = (reason: string) => { interruption = reason; hide(); change("armed"); };
  const fail = (failure: unknown) => {
    clear(); enabled = false;
    error = failure instanceof Error ? failure.message : "The source shot preview could not be prepared.";
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
      enabled = value; generation = null; sourceSeconds = 0; fired = false; sample = null; placement = null;
      emittedAtSourceSeconds = null; error = null; interruption = null;
      if (!value) { change("off"); return; }
      const controller = new AbortController(); loading = controller; change("loading");
      let candidate: Pool | null = null;
      try {
        const origin = frame().caster;
        if (!origin?.isValid()) throw new Error("The source fighter's actor pivot is unavailable.");
        timeline ??= createNativeEffectShotTimeline(bundle);
        if (!Number.isFinite(source.eventSeconds) || !Number.isFinite(source.durationSeconds) ||
          source.eventSeconds <= 0 || source.eventSeconds + timeline.duration > source.durationSeconds + 1e-8) {
          throw new Error("The qualified source clip does not contain the complete shot timeline.");
        }
        candidate = await prepare(scene, bundle, timeline.components, controller.signal);
        if (disposed || request !== token || controller.signal.aborted) { candidate.dispose(); return; }
        const latest = frame();
        if (!origin.isValid() || !latest.caster?.isValid() || latest.caster.root !== origin.root) {
          throw new Error("The source fighter changed while preparing shot effects.");
        }
        pool = candidate; candidate = null; caster = latest.caster;
        pool.root.parent = null; pool.root.rotationQuaternion = Quaternion.Identity(); pool.root.setEnabled(false);
        observedSequence = latest.sequence; change("armed");
      } catch (failure) {
        candidate?.dispose();
        if (!disposed && request === token && !controller.signal.aborted) fail(failure);
      } finally { if (!disposed && request === token) { loading = null; publish(); } }
    },
    update() {
      if (disposed || !enabled || !pool || !timeline || loading) return;
      try {
        const current = frame(), clock = current.clock;
        if (!caster?.isValid() || !current.caster?.isValid() || caster.root !== current.caster.root) {
          throw new Error("The source fighter no longer belongs to this shot preview.");
        }
        const special = current.alive && current.action === "special-attack" && current.animation === "attack" &&
          clock?.clip === source.clip && clock.mode === "once";
        if (special && (!Number.isFinite(clock.elapsedSeconds) || clock.elapsedSeconds < 0 ||
          Math.abs(clock.durationSeconds - source.durationSeconds) > 1e-8 || !Number.isFinite(clock.durationSeconds) ||
          clock.elapsedSeconds > clock.durationSeconds + 1e-8)) throw new Error("The qualified source action clock is invalid.");
        if (current.sequence !== observedSequence) {
          observedSequence = current.sequence;
          if (special && current.targetId !== null) {
            hide(); sample = null; placement = null; emittedAtSourceSeconds = null; fired = false; sourceSeconds = 0;
            target = current.target; generation = current.sequence; interruption = null;
            if (!target?.alive || !target.pivot.isValid() || target.pivot.entityId !== current.targetId ||
              !Number.isFinite(target.collisionRadius) || target.collisionRadius <= 0) { cancel("target-unavailable"); return; }
            running = true; runs++; change("waiting");
          } else if (running) { cancel("action-changed"); }
        }
        if (!running) return;
        if (!target?.alive || !target.pivot.isValid() || !current.target?.alive ||
          !current.target.pivot.isValid() || target.pivot.root !== current.target.pivot.root ||
          current.targetId !== target.pivot.entityId || current.target.collisionRadius !== target.collisionRadius) {
          cancel("target-unavailable"); return;
        }
        if (!special) {
          const completed = fired && current.alive && current.sequence === generation && current.action === "special-attack" &&
            current.animation === "attack" && clock?.mode === "loop";
          if (completed) { sourceSeconds = source.durationSeconds; sample = timeline.evaluate(sourceSeconds - source.eventSeconds); hide(); change("completed"); }
          else cancel(!current.alive ? "fighter-dead" : "source-action-interrupted");
          return;
        }
        if (clock.elapsedSeconds + 1e-8 < sourceSeconds) throw new Error("The original source clock rewound without a new action.");
        sourceSeconds = clock.elapsedSeconds;
        if (sourceSeconds < source.eventSeconds) return;
        if (!fired) {
          if (!caster.getWorldPositionToRef(casterPosition) || !target.pivot.getWorldPositionToRef(targetPosition)) {
            cancel("actor-pivot-unavailable"); return;
          }
          placement = nativeEffectShotPlacement([casterPosition.x, casterPosition.y, casterPosition.z],
            [targetPosition.x, targetPosition.y, targetPosition.z], target.collisionRadius);
          pool.root.position.set(...placement.position); pool.root.rotationQuaternion!.set(...placement.quaternion);
          fired = true; shots++; emittedAtSourceSeconds = sourceSeconds;
        }
        // Freeze the impact transform when the event is observed. Its particles
        // keep world-space ownership even if the target subsequently moves.
        sample = timeline.evaluate(sourceSeconds - source.eventSeconds);
        pool.apply(sample.particles); pool.root.setEnabled(sample.particles.length > 0);
        if (sample.complete) { running = false; change("completed"); } else change("playing");
      } catch (failure) { fail(failure); }
    },
    bounds() { return status === "playing" ? pool?.bounds() ?? null : null; },
    subscribe(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener); },
    snapshot() {
      return { policy: "source-event-target-shot-preview" as const, status, enabled, error, interruption,
        pending: loading !== null, source: structuredClone(source), sourceSeconds, generation, runs, shots,
        targetId: target?.pivot.entityId ?? null, targetRootUniqueId: target?.pivot.root.uniqueId ?? null,
        targetProfileId: target?.profileId ?? null, emittedAtSourceSeconds,
        eventOffsetSeconds: emittedAtSourceSeconds === null ? null : emittedAtSourceSeconds - source.eventSeconds,
        placement: placement && structuredClone(placement), sampled: sample && structuredClone(sample),
        timeline: timeline ? { policy: timeline.policy, capacity: timeline.capacity, duration: timeline.duration,
          components: timeline.components.map(component => component.object), limitations: timeline.limitations } : null,
        pool: pool?.inspect() ?? null, nativePendingNotifyObserved: false, nativeSkillVerified: false, nativeAudioPolicyVerified: false,
        limits: ["The action target ID is fixed at explicit local preview dispatch; placement samples presented pivots at the source event's observing frame.",
          "Source CollisionRadius remains independent of DrawScale; world root freezes after placement. No native runtime Location/Rotation or override observation.",
          "Exact authored AttackShot clock with deliberate modern particle policies; no damage, target reaction, candidate table sound or native skill-state execution."] };
    },
    dispose,
  };
}
export type NativeEffectShotPreview = ReturnType<typeof createNativeEffectShotPreview>;
