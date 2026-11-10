import type { Scene } from "@babylonjs/core/scene";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { NativeActorClock } from "../assets/native/NativeActor";
import type { EntityPivotView } from "../entities/EntityRegistry";
import { dispatchStageActor, type EffectBundle } from "./nativeEffectComponents";
import type { NativePowerStrikeShotSource } from "./nativePowerStrikeSource";
import { nativeEffectShotPlacement } from "./nativeEffectShotPlacement";
import { drawNativeSessionSeed } from "../assets/native/nativeSessionSeed";
import { loadEmitterActorPlayback, type EmitterActorPlayback } from "./particles/render/emitterActorPlayback";

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
type Status = "off" | "loading" | "armed" | "waiting" | "playing" | "completed" | "failed" | "disposed";

export function createNativeEffectShotPreview(scene: Scene, bundle: EffectBundle, inputSource: NativePowerStrikeShotSource,
  frame: () => NativeShotEffectFrame, signal: AbortSignal, prepare: typeof loadEmitterActorPlayback = loadEmitterActorPlayback) {
  const source = Object.freeze(structuredClone(inputSource));
  let disposed = false, enabled = false, request = 0, loading: AbortController | null = null;
  let playback: EmitterActorPlayback | null = null, caster: EntityPivotView | null = null, actorObject: string | null = null;
  let target: NativeShotTargetView | null = null, observedSequence = -1, generation: number | null = null;
  let status: Status = "off", error: string | null = null, interruption: string | null = null;
  let running = false, fired = false, runs = 0, shots = 0, sourceSeconds = 0;
  let placement: ReturnType<typeof nativeEffectShotPlacement> | null = null, emittedAtSourceSeconds: number | null = null;
  const casterPosition = new Vector3(), targetPosition = new Vector3(), listeners = new Set<() => void>();
  const publish = () => { for (const listener of listeners) listener(); };
  const change = (next: Status) => { if (status !== next) { status = next; publish(); } };
  const clear = () => { playback?.dispose(); playback = null; caster = null; target = null; running = false; };
  const hide = () => { playback?.stop(); running = false; };
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
      enabled = value; generation = null; sourceSeconds = 0; fired = false; placement = null;
      emittedAtSourceSeconds = null; error = null; interruption = null;
      if (!value) { change("off"); return; }
      const controller = new AbortController(); loading = controller; change("loading");
      let candidate: EmitterActorPlayback | null = null;
      try {
        const origin = frame().caster;
        if (!origin?.isValid()) throw new Error("The source fighter's actor pivot is unavailable.");
        if (!Number.isFinite(source.eventSeconds) || !Number.isFinite(source.durationSeconds) || source.eventSeconds <= 0 || source.eventSeconds > source.durationSeconds) {
          throw new Error("The qualified source clip does not contain its AttackShot event.");
        }
        actorObject = dispatchStageActor(bundle, "shot");
        candidate = await prepare(scene, bundle, { actorObject, emitterObjects: null, sessionSeed: drawNativeSessionSeed() }, controller.signal);
        if (disposed || request !== token || controller.signal.aborted) { candidate.dispose(); return; }
        const latest = frame();
        if (!origin.isValid() || !latest.caster?.isValid() || latest.caster.root !== origin.root) {
          throw new Error("The source fighter changed while preparing shot effects.");
        }
        playback = candidate; candidate = null; caster = latest.caster;
        playback.root.parent = null; playback.root.rotationQuaternion = Quaternion.Identity();
        observedSequence = latest.sequence; change("armed");
      } catch (failure) {
        candidate?.dispose();
        if (!disposed && request === token && !controller.signal.aborted) fail(failure);
      } finally { if (!disposed && request === token) { loading = null; publish(); } }
    },
    update() {
      if (disposed || !enabled || !playback || loading) return;
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
            hide(); placement = null; emittedAtSourceSeconds = null; fired = false; sourceSeconds = 0;
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
          if (completed) { sourceSeconds = source.durationSeconds; hide(); change("completed"); }
          else cancel(!current.alive ? "fighter-dead" : "source-action-interrupted");
          return;
        }
        if (clock.elapsedSeconds + 1e-8 < sourceSeconds) throw new Error("The original source clock rewound without a new action.");
        const previousSeconds = sourceSeconds;
        sourceSeconds = clock.elapsedSeconds;
        if (sourceSeconds < source.eventSeconds) return;
        if (!fired) {
          if (!caster.getWorldPositionToRef(casterPosition) || !target.pivot.getWorldPositionToRef(targetPosition)) {
            cancel("actor-pivot-unavailable"); return;
          }
          placement = nativeEffectShotPlacement([casterPosition.x, casterPosition.y, casterPosition.z],
            [targetPosition.x, targetPosition.y, targetPosition.z], target.collisionRadius);
          playback.root.position.set(...placement.position); playback.root.rotationQuaternion!.set(...placement.quaternion);
          playback.start();
          fired = true; shots++; emittedAtSourceSeconds = sourceSeconds;
          playback.advance(sourceSeconds - source.eventSeconds);
        } else playback.advance(sourceSeconds - previousSeconds);
        if (!playback.playing) { running = false; change("completed"); } else change("playing");
      } catch (failure) { fail(failure); }
    },
    bounds() { return status === "playing" ? playback?.bounds() ?? null : null; },
    subscribe(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener); },
    snapshot() {
      return { policy: "simulated-source-event-target-shot-preview" as const, status, enabled, error, interruption,
        pending: loading !== null, source: structuredClone(source), sourceSeconds, generation, runs, shots, actorObject,
        targetId: target?.pivot.entityId ?? null, targetRootUniqueId: target?.pivot.root.uniqueId ?? null,
        targetProfileId: target?.profileId ?? null, emittedAtSourceSeconds,
        eventOffsetSeconds: emittedAtSourceSeconds === null ? null : emittedAtSourceSeconds - source.eventSeconds,
        placement: placement && structuredClone(placement), playback: playback?.inspect() ?? null,
        nativePendingNotifyObserved: false, nativeSkillVerified: false, nativeAudioPolicyVerified: false };
    },
    dispose,
  };
}
export type NativeEffectShotPreview = ReturnType<typeof createNativeEffectShotPreview>;
