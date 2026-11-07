import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Animation } from "@babylonjs/core/Animations/animation";
import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";

/** UEViewer SkeletalMesh.cpp GetKeyParams/GetBonePosition: source keys remain
 * untouched. A repeating clip interpolates its final key back to key zero
 * across NumFrames - finalKeyTime, independently for each native track.
 */
export function sampleNativeLoop(animation: Animation, timeSeconds: number, durationSeconds: number): unknown {
  const keys = animation.getKeys(), first = keys[0], last = keys.at(-1);
  if (!first || !last || !Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new Error("Invalid native animation duration or keys.");
  const frame = ((timeSeconds % durationSeconds) + durationSeconds) % durationSeconds * animation.framePerSecond;
  if (keys.length === 1 || frame <= first.frame) return first.value;
  if (frame <= last.frame) return animation.evaluate(frame);
  const end = durationSeconds * animation.framePerSecond;
  if (end <= last.frame) return last.value;
  const fraction = (frame - last.frame) / (end - last.frame);
  if (last.value instanceof Quaternion && first.value instanceof Quaternion) return Quaternion.Slerp(last.value, first.value, fraction);
  if (last.value instanceof Vector3 && first.value instanceof Vector3) return Vector3.Lerp(last.value, first.value, fraction);
  if (typeof last.value === "number" && typeof first.value === "number") return last.value + (first.value - last.value) * fraction;
  throw new Error(`Unsupported native loop channel: ${animation.targetProperty}`);
}

/** One-shot sequences hold the final authored key through the remaining source
 * duration. They never interpolate back to the first pose as loops do. */
export function sampleNativeOnce(animation: Animation, timeSeconds: number, durationSeconds: number): unknown {
  const keys = animation.getKeys(), first = keys[0], last = keys.at(-1);
  if (!first || !last || !Number.isFinite(durationSeconds) || durationSeconds <= 0 || !Number.isFinite(timeSeconds)) {
    throw new Error("Invalid native animation duration, time or keys.");
  }
  const frame = Math.max(0, Math.min(timeSeconds, durationSeconds)) * animation.framePerSecond;
  if (keys.length === 1 || frame <= first.frame) return first.value;
  return frame >= last.frame ? last.value : animation.evaluate(frame);
}

export interface NativeClipPlayback {
  readonly durationSeconds: number;
  readonly timeSeconds: number;
  readonly loopCount: number;
  readonly elapsedSeconds: number;
  readonly looping: boolean;
  readonly completed: boolean;
  readonly playing: boolean;
  play(): void;
  restart(): void;
  pause(): void;
  seek(timeSeconds: number): void;
  advance(deltaSeconds: number): void;
}

export function validateNativeClipDuration(group: AnimationGroup, durationSeconds: number): void {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new Error("Invalid native clip duration.");
  if (!group.targetedAnimations.length) throw new Error("The native clip has no animated channels.");
  for (const { animation } of group.targetedAnimations) {
    const last = animation.getKeys().at(-1);
    if (!last || last.frame / animation.framePerSecond > durationSeconds + 1e-5) throw new Error(`Native duration ends before a key in ${group.name}.`);
  }
}

/** Babylon clamps AnimationGroup's end frame to each channel's final key.
 * This source-duration clock samples the original channels directly, retaining
 * sparse-key timing and the source wrap interpolation without inventing keys.
 */
export function createNativeClipPlayback(group: AnimationGroup, durationSeconds: number, mode: "loop" | "once" = "loop"): NativeClipPlayback {
  validateNativeClipDuration(group, durationSeconds);
  const channels = group.targetedAnimations.map(({ animation, target }) => {
    const path = animation.targetPropertyPath;
    let owner: Record<string, unknown> = target as Record<string, unknown>;
    for (const segment of path.slice(0, -1)) {
      const child = owner[segment];
      if (typeof child !== "object" || child === null) throw new Error(`Unsupported animation target: ${animation.targetProperty}`);
      owner = child as Record<string, unknown>;
    }
    const property = path.at(-1);
    if (!property) throw new Error("The native animation has an empty target property.");
    return { animation, owner, property };
  });
  let elapsed = 0, playing = false;
  const looping = mode === "loop";
  const completed = () => !looping && elapsed >= durationSeconds;
  const apply = () => {
    for (const { animation, owner, property } of channels) {
      const value = looping ? sampleNativeLoop(animation, elapsed, durationSeconds) : sampleNativeOnce(animation, elapsed, durationSeconds);
      // A held key must not alias a mutable transform property: attachment or
      // Editor manipulation would otherwise modify the original clip itself.
      owner[property] = value instanceof Vector3 || value instanceof Quaternion ? value.clone() : value;
    }
  };
  group.stop(); apply();
  return {
    durationSeconds,
    get timeSeconds() { return looping ? elapsed % durationSeconds : elapsed; },
    get loopCount() { return looping ? Math.floor(elapsed / durationSeconds) : 0; },
    get elapsedSeconds() { return elapsed; },
    get looping() { return looping; },
    get completed() { return completed(); },
    get playing() { return playing; },
    play: () => { if (!completed()) playing = true; },
    restart: () => { elapsed = 0; playing = true; apply(); },
    pause: () => { playing = false; },
    seek(timeSeconds) {
      if (!Number.isFinite(timeSeconds) || timeSeconds < 0) throw new Error("Native playback time must be finite and non-negative.");
      elapsed = looping ? timeSeconds : Math.min(timeSeconds, durationSeconds);
      if (completed()) playing = false;
      apply();
    },
    advance(deltaSeconds) {
      if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) throw new Error("Native playback time must be finite and non-negative.");
      if (!playing) return;
      elapsed = looping ? elapsed + deltaSeconds : Math.min(elapsed + deltaSeconds, durationSeconds);
      if (completed()) playing = false;
      apply();
    },
  };
}
