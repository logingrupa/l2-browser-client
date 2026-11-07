import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import type { AnimationState } from "../world/worldTypes";
import type { CharacterAnimationDriver, CharacterPlayback } from "./CharacterAnimator";

export type CharacterClips = Readonly<Record<AnimationState, AnimationGroup>>;
export type CharacterAnimationProfile = Readonly<Record<AnimationState, {
  readonly name: string;
  readonly loop: boolean;
  readonly transitionSeconds: number;
}>>;

/** Native profiles use exact identifiers. Generic aliases remain an opt-in URL fallback. */
export function findCharacterClips(
  groups: readonly AnimationGroup[], profile?: CharacterAnimationProfile,
): CharacterClips | undefined {
  const find = (state: AnimationState, ...aliases: string[]): AnimationGroup | undefined =>
    groups.find(group => group.targetedAnimations.length > 0 && (profile
      ? group.name === profile[state].name
      : aliases.includes(group.name.trim().toLowerCase())));
  const idle = find("idle", "idle", "stand", "standing");
  const run = find("run", "run", "running", "walk", "walking");
  const attack = find("attack", "attack", "attacking", "melee");
  return idle && run && attack ? { idle, run, attack } : undefined;
}

export class ModelAnimator implements CharacterAnimationDriver {
  private active: AnimationGroup;
  private displayedState: AnimationState = "idle";
  private requestedState: AnimationState = "idle";
  private readonly transitionWeights = new Map<AnimationGroup, number>();
  private transitionSeconds = 0;
  private transitionDuration = 0;
  private isDisposed = false;

  constructor(private readonly clips: CharacterClips, private readonly profile?: CharacterAnimationProfile) {
    for (const group of new Set(Object.values(clips))) group.stop(true);
    this.active = clips.idle;
    this.active.weight = 1;
    this.active.start(this.shouldLoop("idle"));
  }

  get playback(): CharacterPlayback {
    return {
      activeClip: this.active.name,
      frame: this.active.getCurrentFrame(),
      looping: this.active.loopAnimation,
      playing: this.active.isPlaying,
      weights: [...new Set(Object.values(this.clips))]
        .filter(group => group.isStarted)
        .map(group => ({ name: group.name, weight: group.weight })),
    };
  }

  private shouldLoop(state: AnimationState): boolean { return this.profile?.[state].loop ?? state !== "attack"; }
  private transitionFor(state: AnimationState): number { return this.profile?.[state].transitionSeconds ?? 0.16; }

  setState(state: AnimationState, retrigger = false): void {
    if (this.isDisposed || (state === this.requestedState && !retrigger)) return;
    this.requestedState = state;
    this.show(state, retrigger);
  }

  private show(state: AnimationState, retrigger = false, duration = this.transitionFor(state)): void {
    const next = this.clips[state];
    this.transitionWeights.clear();
    // Retain every contributing group's current weight when a transition is interrupted.
    for (const group of new Set(Object.values(this.clips))) {
      if (group.isStarted && group.weight > 0) this.transitionWeights.set(group, group.weight);
      else if (group !== next) group.stop(true);
    }
    const initialWeight = this.transitionWeights.get(next) ?? 0;
    if (retrigger || !next.isStarted) {
      next.stop(true);
      next.weight = initialWeight;
      next.start(this.shouldLoop(state));
    }
    this.active = next;
    this.displayedState = state;
    this.transitionSeconds = 0;
    this.transitionDuration = this.transitionWeights.size ? Math.max(0, duration) : 0;
    this.transitionWeights.set(next, initialWeight);
    this.blend(0);
  }

  private blend(deltaTimeSeconds: number): void {
    this.transitionSeconds += deltaTimeSeconds;
    const progress = this.transitionDuration > 0 ? Math.min(1, this.transitionSeconds / this.transitionDuration) : 1;
    for (const [group, initialWeight] of this.transitionWeights) {
      group.weight = initialWeight + ((group === this.active ? 1 : 0) - initialWeight) * progress;
      if (progress === 1 && group !== this.active) group.stop(true);
    }
    if (progress === 1) this.transitionWeights.clear();
  }

  update(deltaTimeSeconds: number): void {
    if (this.isDisposed) return;
    this.blend(deltaTimeSeconds);
    if (this.shouldLoop(this.displayedState) || this.displayedState === "idle") return;
    // Fade into rest during the last native frames. Keep the authoritative requested
    // state unchanged, so an ordinary world snapshot cannot replay a finished attack.
    const framesPerSecond = this.active.targetedAnimations[0]?.animation.framePerSecond ?? 60;
    const remainingSeconds = Math.max(0, (this.active.to - this.active.getCurrentFrame()) / framesPerSecond);
    const returnDuration = this.transitionFor("idle");
    if (!this.active.isStarted || remainingSeconds <= returnDuration) {
      // An ended group has no contributors; start idle at full weight after a stall.
      // Never reset the rig or restore its bind pose between the two clips.
      this.show("idle", false, this.active.isStarted ? remainingSeconds : 0);
    }
  }

  dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    for (const group of new Set(Object.values(this.clips))) group.stop(true);
    this.transitionWeights.clear();
  }
}
