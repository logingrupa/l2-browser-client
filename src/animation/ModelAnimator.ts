import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import type { AnimationState } from "../world/worldTypes";
import type { CharacterAnimationDriver } from "./CharacterAnimator";

export type CharacterClips = Readonly<Record<AnimationState, AnimationGroup>>;

/** Exact, case-insensitive aliases; game-specific clip names need an explicit map. */
export function findCharacterClips(groups: readonly AnimationGroup[]): CharacterClips | undefined {
  const find = (...aliases: string[]): AnimationGroup | undefined =>
    groups.find(group => group.targetedAnimations.length > 0 && aliases.includes(group.name.trim().toLowerCase()));
  const idle = find("idle", "stand", "standing");
  const run = find("run", "running", "walk", "walking");
  const attack = find("attack", "attacking", "melee");
  return idle && run && attack ? { idle, run, attack } : undefined;
}

export class ModelAnimator implements CharacterAnimationDriver {
  private active: AnimationGroup | undefined;
  private outgoing: AnimationGroup | undefined;
  private transitionSeconds = 0;
  private isDisposed = false;

  constructor(private readonly clips: CharacterClips) {
    for (const group of Object.values(clips)) group.stop();
    this.setState("idle");
  }

  setState(state: AnimationState): void {
    const next = this.clips[state];
    if (this.isDisposed || next === this.active) return;
    this.outgoing?.stop();
    this.outgoing = this.active;
    this.active = next;
    this.transitionSeconds = 0;
    next.weight = this.outgoing ? 0 : 1;
    // The adapter controls the state duration, including repeated demo attacks.
    next.start(true);
  }

  update(deltaTimeSeconds: number): void {
    if (this.isDisposed || !this.active || !this.outgoing) return;
    this.transitionSeconds += deltaTimeSeconds;
    const progress = Math.min(1, this.transitionSeconds / 0.16);
    this.active.weight = progress;
    this.outgoing.weight = 1 - progress;
    if (progress === 1) {
      this.outgoing.stop();
      this.outgoing = undefined;
    }
  }

  dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    for (const group of Object.values(this.clips)) group.stop();
    this.active = undefined;
    this.outgoing = undefined;
  }
}
