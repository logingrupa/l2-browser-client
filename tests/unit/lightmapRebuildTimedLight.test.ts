import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyTimeLightRule, type TimedLightState } from "../../src/environment/model/lightmapRebuild/timedLightSwitch";

interface NativeTimedLightState {
  readonly LightType: number;
  readonly flags5c: string;
  readonly LightLifeTime: number;
  readonly LightPrevTime: number;
}

interface TimedLightFixture {
  readonly scenario: string;
  readonly inputHour: number;
  readonly on: number;
  readonly off: number;
  readonly before: NativeTimedLightState;
  readonly after: NativeTimedLightState;
}

const fixtures = (JSON.parse(readFileSync(new URL("../fixtures/db16/time-light-native.json", import.meta.url), "utf8")) as { readonly fixtures: readonly TimedLightFixture[] }).fixtures;

const portState = (state: NativeTimedLightState): TimedLightState =>
  ({ lightType: state.LightType, switchFlags: Number.parseInt(state.flags5c, 16), lightLifeTime: state.LightLifeTime, lightPreviousTime: state.LightPrevTime });

describe("timed light switch 0x105d0c70 behind the bTimeLight gate of AActor::Tick", () => {
  it("covers twelve boundary hours from both starting types and nine sequential ticks", () => {
    expect(fixtures.filter(fixture => fixture.scenario === "independent boundary")).toHaveLength(12);
    expect(fixtures.filter(fixture => fixture.scenario === "sequential ticks")).toHaveLength(9);
  });

  it.each(fixtures.map((fixture, index) => [index, fixture.scenario, fixture.inputHour, fixture.before.LightType, fixture] as const))(
    "fixture %s (%s) at hour %s from LightType %s matches the native state", (_index, _scenario, _hour, _type, fixture) => {
      const schedule = { timeLight: true, lightOnTime: fixture.on, lightOffTime: fixture.off };
      expect(applyTimeLightRule(schedule, portState(fixture.before), fixture.inputHour)).toEqual(portState(fixture.after));
    });

  it("leaves a light with bTimeLight false untouched, as the On19/Off8 lights of 20_20 stay on", () => {
    const steady: TimedLightState = { lightType: 1, switchFlags: 0, lightLifeTime: 0, lightPreviousTime: 0 };
    expect(applyTimeLightRule({ timeLight: false, lightOnTime: 19, lightOffTime: 8 }, steady, 12)).toBe(steady);
  });
});
