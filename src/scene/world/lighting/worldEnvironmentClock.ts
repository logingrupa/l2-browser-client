import type { PresentationClock } from "../../../shared/presentationClock";
import { hoursPerDay } from "./lightmapPages";
import type { WorldEnvironmentProgram } from "./tileLightingRecords";

export type WorldEnvironmentSource = "server-time" | "environment-program-fallback";

export interface WorldEnvironmentSample {
  readonly gameMinutes: number;
  readonly hour: number;
  readonly environmentType: number;
  readonly source: WorldEnvironmentSource;
}

export interface WorldEnvironmentClock {
  applyServerTime(gameMinutes: number): void;
  sample(): WorldEnvironmentSample;
}

export interface WorldEnvironmentClockSettings {
  readonly program: WorldEnvironmentProgram;
  readonly presentationClock: Pick<PresentationClock, "levelSeconds">;
}

const minutesPerHour = 60;
const minutesPerDay = hoursPerDay * minutesPerHour;
const secondsPerMinute = 60;

interface ClockAnchor {
  readonly gameMinutes: number;
  readonly levelSeconds: number;
  readonly environmentType: number;
  readonly source: WorldEnvironmentSource;
}

function wrappedMinutes(minutes: number): number {
  const wrapped = minutes % minutesPerDay;
  return wrapped < 0 ? wrapped + minutesPerDay : wrapped;
}

export function createWorldEnvironmentClock(settings: WorldEnvironmentClockSettings): WorldEnvironmentClock {
  const { program, presentationClock } = settings;
  const knownEnvironmentTypes = new Set(program.environmentTypes);
  const fallbackEnvironmentType = 0;
  if (!knownEnvironmentTypes.has(fallbackEnvironmentType)) throw new RangeError("The environment program has no environment type 0 for the fallback clock.");
  let anchor: ClockAnchor = { gameMinutes: program.startTimeHours * minutesPerHour, levelSeconds: presentationClock.levelSeconds,
    environmentType: fallbackEnvironmentType, source: "environment-program-fallback" };
  return {
    applyServerTime(gameMinutes) {
      if (!Number.isFinite(gameMinutes) || gameMinutes < 0) throw new RangeError(`Server time game minutes ${gameMinutes} must be finite and not negative.`);
      anchor = { gameMinutes, levelSeconds: presentationClock.levelSeconds, environmentType: anchor.environmentType, source: "server-time" };
    },
    sample() {
      const elapsedGameMinutes = (presentationClock.levelSeconds - anchor.levelSeconds) * program.timeRatio / secondsPerMinute;
      const gameMinutes = wrappedMinutes(anchor.gameMinutes + elapsedGameMinutes);
      return { gameMinutes, hour: gameMinutes / minutesPerHour, environmentType: anchor.environmentType, source: anchor.source };
    },
  };
}
