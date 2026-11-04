import type { AnimationState } from "../world/worldTypes";

export interface CharacterAnimationDriver {
  setState(state: AnimationState): void;
  update(deltaTimeSeconds: number): void;
  dispose(): void;
}

/** Presentation follows the requested state; it never changes world state. */
export class CharacterAnimator {
  private currentState: AnimationState = "idle";
  private isDisposed = false;

  constructor(private driver: CharacterAnimationDriver) {}

  get state(): AnimationState {
    return this.currentState;
  }

  setState(state: AnimationState): void {
    if (this.isDisposed || this.currentState === state) return;
    this.currentState = state;
    this.driver.setState(state);
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
