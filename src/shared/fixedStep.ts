export interface FixedStepSettings {
  readonly stepSeconds: number;
  readonly maximumStepsPerFrame: number;
}

export interface FixedStepAccumulator {
  readonly backlogSeconds: number;
  advance(frameDeltaSeconds: number): number;
}

export function createFixedStepAccumulator(settings: FixedStepSettings): FixedStepAccumulator {
  const { stepSeconds, maximumStepsPerFrame } = settings;
  if (!Number.isFinite(stepSeconds) || stepSeconds <= 0) throw new RangeError(`The fixed step must be a positive number of seconds, not ${stepSeconds}.`);
  if (!Number.isSafeInteger(maximumStepsPerFrame) || maximumStepsPerFrame < 1) {
    throw new RangeError(`The fixed-step cap must be a positive integer, not ${maximumStepsPerFrame}.`);
  }
  let backlogSeconds = 0;
  return {
    get backlogSeconds() { return backlogSeconds; },
    advance(frameDeltaSeconds) {
      if (!Number.isFinite(frameDeltaSeconds) || frameDeltaSeconds < 0) {
        throw new RangeError(`A fixed-step frame delta must be a finite, non-negative number of seconds, not ${frameDeltaSeconds}.`);
      }
      backlogSeconds += frameDeltaSeconds;
      const dueSteps = Math.floor(backlogSeconds / stepSeconds);
      if (dueSteps > maximumStepsPerFrame) {
        backlogSeconds = 0;
        return maximumStepsPerFrame;
      }
      backlogSeconds -= dueSteps * stepSeconds;
      return dueSteps;
    },
  };
}
