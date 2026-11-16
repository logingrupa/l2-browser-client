import { describe, expect, it } from "vitest";
import { createNativeTimeClock, type NativeTimeClockSetup } from "../../src/environment/model/nativeTimeClock";

const hoursPerMinute = 0.01666666753590107;
const hoursPerSecond = 0.00027777778450399637;
const shippedSetup: NativeTimeClockSetup = { isClock: true, timeRatio: 6, startTimeHours: 12 };

function manualRealTime(startSeconds = 100) {
  let seconds = startSeconds;
  return { read: () => seconds, set: (next: number) => { seconds = next; } };
}

function clockAfter(realElapsedSeconds: number, setup: NativeTimeClockSetup = shippedSetup) {
  const realTime = manualRealTime();
  const clock = createNativeTimeClock(setup, realTime.read);
  realTime.set(100 + realElapsedSeconds);
  clock.advance();
  return clock;
}

describe("native time clock (UpdateNTime 0x1051b330, SetTimeToLobbyTime 0x10514b30)", () => {
  it.each([[0, 12], [10, Math.fround(12 + 1 / 60)], [600, 13], [7200, 0], [14400, 12]])(
    "matches the REA native clock case of %s real seconds at ratio 6 from 12:00", (realElapsedSeconds, expectedHour) => {
      expect(clockAfter(realElapsedSeconds).hour()).toBe(expectedHour);
    });

  it("starts at StartTime with whole seconds before any advance", () => {
    const clock = createNativeTimeClock({ isClock: true, timeRatio: 6, startTimeHours: 6.5 }, manualRealTime().read);
    expect(clock.hour()).toBe(6.5);
    expect(clock.snapshot()).toMatchObject({ baselineHour: 6, baselineMinute: 30, baselineSecond: 0, baselineRealSeconds: 100, hourSource: "start-time" });
  });

  it("measures elapsed time from manager creation, not from the first advance", () => {
    const realTime = manualRealTime();
    const clock = createNativeTimeClock(shippedSetup, realTime.read);
    realTime.set(700);
    clock.advance();
    expect(clock.hour()).toBe(13);
  });

  it("keeps 60.0 seconds on the seconds carry instead of zeroing them", () => {
    const startTimeHours = 59.5 / 3600;
    const clock = clockAfter(0.1, { isClock: true, timeRatio: 6, startTimeHours });
    const { baselineSecond } = clock.snapshot();
    expect(baselineSecond).toBeGreaterThan(59);
    expect(clock.hour()).toBe(Math.fround(1 * hoursPerMinute + 0 + 60 * hoursPerSecond));
    expect(clock.hour()).not.toBe(Math.fround(1 * hoursPerMinute));
  });

  it("carries minutes into the hour only once", () => {
    const realTime = manualRealTime();
    const clock = createNativeTimeClock(shippedSetup, realTime.read);
    clock.receiveServerTime(-30);
    expect(clock.snapshot()).toMatchObject({ baselineHour: 0, baselineMinute: 226 });
    clock.advance();
    expect(clock.hour()).toBe(Math.fround(166 * hoursPerMinute + 1));
  });

  it("wraps the elapsed whole hours to a byte, so 256 game hours return to the baseline hour", () => {
    expect(clockAfter(256 * 3600 / 6).hour()).toBe(12);
    expect(clockAfter(255 * 3600 / 6).hour()).toBe(Math.fround((12 + 255) % 24));
  });

  it("truncates whole hours and minutes and rounds the elapsed game seconds to float32", () => {
    const clock = clockAfter(1234.5678);
    const elapsedGameSeconds = Math.fround(1234.5678 * 6);
    const wholeHours = Math.trunc(elapsedGameSeconds / 3600);
    const remainder = Math.fround(elapsedGameSeconds - wholeHours * 3600);
    const wholeMinutes = Math.trunc(Math.trunc(remainder) / 60);
    const seconds = Math.fround(Math.fround(remainder - wholeMinutes * 60) + 0);
    expect(clock.hour()).toBe(Math.fround(wholeMinutes * hoursPerMinute + 12 + wholeHours + seconds * hoursPerSecond));
  });
});

describe("native server time (OnReceiveServerTime 0x104893e0, SetNTime 0x10515620)", () => {
  it("sets a byte hour with no mod 24, then the next advance wraps it", () => {
    const realTime = manualRealTime();
    const clock = createNativeTimeClock(shippedSetup, realTime.read);
    realTime.set(500);
    clock.receiveServerTime(25 * 60 + 30);
    expect(clock.hour()).toBe(25.5);
    expect(clock.snapshot()).toMatchObject({ baselineHour: 25, baselineMinute: 30, baselineSecond: 0, baselineRealSeconds: 500, hourSource: "server-time" });
    clock.advance();
    expect(clock.hour()).toBe(1.5);
  });

  it("refreshes the real-time baseline so elapsed time restarts at the server time", () => {
    const realTime = manualRealTime();
    const clock = createNativeTimeClock(shippedSetup, realTime.read);
    realTime.set(10_000);
    clock.receiveServerTime(360);
    realTime.set(10_600);
    clock.advance();
    expect(clock.hour()).toBe(7);
  });

  it("wraps the hour byte above 255 hours", () => {
    const clock = createNativeTimeClock(shippedSetup, manualRealTime().read);
    clock.receiveServerTime(256 * 60 + 5);
    expect(clock.snapshot()).toMatchObject({ baselineHour: 0, baselineMinute: 5 });
  });

  it.each([1.5, Number.NaN, 2 ** 31])("rejects %s game minutes at the callback boundary", gameMinutes => {
    const clock = createNativeTimeClock(shippedSetup, manualRealTime().read);
    expect(() => clock.receiveServerTime(gameMinutes)).toThrow(RangeError);
  });

  it("rejects a TimeRatio that is not an integer", () => {
    expect(() => createNativeTimeClock({ isClock: true, timeRatio: 6.5, startTimeHours: 12 }, manualRealTime().read)).toThrow(RangeError);
  });
});
