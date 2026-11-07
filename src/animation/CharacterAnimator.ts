import type { AnimationState } from "../world/worldTypes";

export interface CharacterAnimationDriver {
  readonly playback?: CharacterPlayback;
  setState(state: AnimationState, retrigger?: boolean): void;
  update(deltaTimeSeconds: number): void;
  dispose(): void;
}

export interface CharacterPlayback {
  readonly activeClip: string;
  readonly frame: number;
  readonly looping: boolean;
  readonly playing: boolean;
  readonly weights: readonly { readonly name: string; readonly weight: number }[];
}

/** Presentation follows the requested state; it never changes world state. */
export class CharacterAnimator {
  private currentState: AnimationState = "idle";
  private isDisposed = false;

  constructor(private driver: CharacterAnimationDriver) {}

  get state(): AnimationState {
    return this.currentState;
  }

  get playback(): CharacterPlayback | undefined { return this.driver.playback; }

  setState(state: AnimationState, retrigger = false): void {
    if (this.isDisposed || (this.currentState === state && !retrigger)) return;
    this.currentState = state;
    this.driver.setState(state, retrigger);
  }

  update(deltaTimeSeconds: number): void {
    if (this.isDisposed) return;
    if (!Number.isFinite(deltaTimeSeconds) || deltaTimeSeconds < 0) {
      throw new RangeError("Animation elapsed time must be finite and non-negative.");
    }
    this.driver.update(deltaTimeSeconds);
  }

  replaceDriver(driver: CharacterAnimationDriver): void {
    if (this.isDisposed) {
      driver.dispose();
      return;
    }
    this.driver.dispose();
    this.driver = driver;
    this.driver.setState(this.currentState);
  }

  dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    this.driver.dispose();
  }
}
