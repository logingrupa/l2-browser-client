import type { PresentationClock } from "../../../shared/presentationClock";
import type { WorldEvent } from "../../../world/worldTypes";
import { hoursPerDay } from "./lightmapPages";
import type { WorldEnvironmentProgram } from "./tileLightingRecords";

export type WorldEnvironmentEvent = Extract<WorldEvent, { type: "environment" }>;
export type WorldEnvironmentSource = "environment-event" | "environment-program-fallback";

export interface WorldEnvironmentSample {
  readonly gameMinutes: number;
  readonly hour: number;
  readonly environmentType: number;
  readonly source: WorldEnvironmentSource;
}

export interface WorldEnvironmentClock {
  applyEnvironmentEvent(event: WorldEnvironmentEvent): void;
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
    applyEnvironmentEvent(event) {
      if (!Number.isFinite(event.gameMinutes) || event.gameMinutes < 0) throw new RangeError(`Environment event game minutes ${event.gameMinutes} must be finite and not negative.`);
      if (!Number.isSafeInteger(event.environmentType) || !knownEnvironmentTypes.has(event.environmentType)) {
        throw new RangeError(`Environment event type ${event.environmentType} is not one of the program types ${[...knownEnvironmentTypes].join(", ")}.`);
      }
      anchor = { gameMinutes: event.gameMinutes, levelSeconds: presentationClock.levelSeconds, environmentType: event.environmentType, source: "environment-event" };
    },
    sample() {
      const elapsedGameMinutes = (presentationClock.levelSeconds - anchor.levelSeconds) * program.timeRatio / secondsPerMinute;
      const gameMinutes = wrappedMinutes(anchor.gameMinutes + elapsedGameMinutes);
      return { gameMinutes, hour: gameMinutes / minutesPerHour, environmentType: anchor.environmentType, source: anchor.source };
    },
  };
}
