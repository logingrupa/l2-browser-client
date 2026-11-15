export interface PresentationClock {
  readonly levelSeconds: number;
  readonly frameDeltaSeconds: number;
  readonly paused: boolean;
  advance(frameDeltaSeconds: number): void;
  pause(): void;
  resume(): void;
  seek(levelSeconds: number): void;
}

function requireNonNegativeSeconds(seconds: number, label: string): void {
  if (!Number.isFinite(seconds) || seconds < 0) throw new RangeError(`${label} must be a finite, non-negative number of seconds, not ${seconds}.`);
}

export function createPresentationClock(): PresentationClock {
  let levelSeconds = 0, frameDeltaSeconds = 0, paused = false;
  return {
    get levelSeconds() { return levelSeconds; },
    get frameDeltaSeconds() { return frameDeltaSeconds; },
    get paused() { return paused; },
    advance(elapsedSeconds) {
      requireNonNegativeSeconds(elapsedSeconds, "A presentation frame delta");
      frameDeltaSeconds = paused ? 0 : elapsedSeconds;
      levelSeconds += frameDeltaSeconds;
    },
    pause() { paused = true; frameDeltaSeconds = 0; },
    resume() { paused = false; },
    seek(targetLevelSeconds) {
      requireNonNegativeSeconds(targetLevelSeconds, "A presentation seek target");
      levelSeconds = targetLevelSeconds;
      frameDeltaSeconds = 0;
    },
  };
}
