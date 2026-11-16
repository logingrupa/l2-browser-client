import { ENVIRONMENT_ENGINE_CONSTANTS } from "./nativeEnvironmentEngineConstants";

export interface NativeTimeClockSetup {
  readonly isClock: boolean;
  readonly timeRatio: number;
  readonly startTimeHours: number;
}

export type NativeHourSource = "start-time" | "server-time";

export interface NativeTimeClockSnapshot {
  readonly isClock: boolean;
  readonly timeRatio: number;
  readonly baselineHour: number;
  readonly baselineMinute: number;
  readonly baselineSecond: number;
  readonly baselineRealSeconds: number;
  readonly hour: number;
  readonly hourSource: NativeHourSource;
}

export interface NativeTimeClock {
  readonly isClock: boolean;
  hour(): number;
  advance(): void;
  receiveServerTime(gameMinutes: number): void;
  snapshot(): NativeTimeClockSnapshot;
}

export type ReadRealSeconds = () => number;

const { hoursPerMinute, hoursPerSecond, secondsPerHour, secondsPerMinute, minutesPerHour, secondsCarryValue, lastHourOfDay, hoursPerDay } = ENVIRONMENT_ENGINE_CONSTANTS;
const byteMask = 0xff;
const int32Minimum = -0x80000000;
const int32Maximum = 0x7fffffff;

function wholeQuotient(dividend: number, divisor: number): number {
  return Math.trunc(Math.trunc(dividend) / divisor);
}

function unsignedWholeSeconds(seconds: number): number {
  return Math.trunc(seconds) >>> 0;
}

function composeNativeHour(hour: number, minute: number, wholeOrFractionalSeconds: number): number {
  return Math.fround(minute * hoursPerMinute.value + hour + wholeOrFractionalSeconds * hoursPerSecond.value);
}

function requireSetup(setup: NativeTimeClockSetup): void {
  if (!Number.isSafeInteger(setup.timeRatio)) throw new RangeError(`TimeRatio ${setup.timeRatio} must be an integer.`);
  if (!Number.isFinite(setup.startTimeHours)) throw new RangeError(`StartTime ${setup.startTimeHours} must be a finite number of hours.`);
}

export function createNativeTimeClock(setup: NativeTimeClockSetup, readRealSeconds: ReadRealSeconds): NativeTimeClock {
  requireSetup(setup);
  const { isClock, timeRatio } = setup;
  let baselineRealSeconds = readRealSeconds();
  let lobbySeconds = Math.fround(Math.fround(setup.startTimeHours) * secondsPerHour.value);
  let baselineHour = wholeQuotient(lobbySeconds, secondsPerHour.value);
  lobbySeconds = Math.fround(lobbySeconds - baselineHour * secondsPerHour.value);
  let baselineMinute = wholeQuotient(lobbySeconds, secondsPerMinute.value);
  let baselineSecond = Math.fround(lobbySeconds - baselineMinute * secondsPerMinute.value);
  let hour = composeNativeHour(baselineHour, baselineMinute, unsignedWholeSeconds(baselineSecond));
  let hourSource: NativeHourSource = "start-time";

  function setNativeTime(nextHour: number, nextMinute: number, nextSecond: number): void {
    baselineHour = nextHour;
    baselineMinute = nextMinute;
    baselineSecond = Math.fround(nextSecond);
    hour = composeNativeHour(baselineHour, baselineMinute, unsignedWholeSeconds(baselineSecond));
    baselineRealSeconds = readRealSeconds();
  }

  return {
    isClock,
    hour: () => hour,
    advance() {
      const elapsedGameSeconds = Math.fround((readRealSeconds() - baselineRealSeconds) * timeRatio);
      const wholeHours = wholeQuotient(elapsedGameSeconds, secondsPerHour.value);
      const remainderSeconds = Math.fround(elapsedGameSeconds - wholeHours * secondsPerHour.value);
      const wholeMinutes = wholeQuotient(remainderSeconds, secondsPerMinute.value);
      let currentHour = baselineHour + (wholeHours & byteMask);
      let currentMinute = baselineMinute + (wholeMinutes & byteMask);
      let currentSecond = Math.fround(Math.fround(remainderSeconds - wholeMinutes * secondsPerMinute.value) + baselineSecond);
      if (currentSecond >= secondsPerMinute.value) {
        currentMinute += 1;
        currentSecond = Math.fround(secondsCarryValue.value);
      }
      if (currentMinute >= minutesPerHour.value) {
        currentHour += 1;
        currentMinute -= minutesPerHour.value;
      }
      if (currentHour > lastHourOfDay.value) currentHour %= hoursPerDay.value;
      hour = composeNativeHour(currentHour, currentMinute, currentSecond);
    },
    receiveServerTime(gameMinutes) {
      if (!Number.isInteger(gameMinutes) || gameMinutes < int32Minimum || gameMinutes > int32Maximum) {
        throw new RangeError(`Server time ${gameMinutes} must be a signed 32-bit integer of game minutes.`);
      }
      const wholeHours = Math.trunc(gameMinutes / minutesPerHour.value);
      setNativeTime(wholeHours & byteMask, (gameMinutes - wholeHours * minutesPerHour.value) & byteMask, 0);
      hourSource = "server-time";
    },
    snapshot: () => ({ isClock, timeRatio, baselineHour, baselineMinute, baselineSecond, baselineRealSeconds, hour, hourSource }),
  };
}
