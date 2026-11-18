import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { BgraBytes } from "../../src/environment/model/nativeColourBytes";
import {
  setFogTransitionColourTarget, setFogTransitionDuration, setFogTransitionRangeTarget, snapshotFogTransition, updateFogTransition, type FogTransitionState,
} from "../../src/environment/model/fogTransition";

interface FixtureState {
  readonly targetColorBGRA: BgraBytes;
  readonly targetStart: number;
  readonly targetEnd: number;
  readonly oldColorBGRA: BgraBytes;
  readonly oldStart: number;
  readonly oldEnd: number;
  readonly colorBGRA: BgraBytes;
  readonly start: number;
  readonly end: number;
  readonly duration: number;
  readonly remaining: number;
}

interface TransitionFixture {
  readonly index: number;
  readonly scenario: string;
  readonly deltaSeconds: number;
  readonly before: FixtureState;
  readonly output: FixtureState;
}

const { fixtures } = JSON.parse(readFileSync(new URL("../fixtures/environment/fog-transition-rm17-fixtures.json", import.meta.url), "utf8")) as
  { readonly fixtures: readonly TransitionFixture[] };

const stateOf = (fixture: FixtureState): FogTransitionState => ({ targetColourBgra: fixture.targetColorBGRA, targetStart: fixture.targetStart,
  targetEnd: fixture.targetEnd, oldColourBgra: fixture.oldColorBGRA, oldStart: fixture.oldStart, oldEnd: fixture.oldEnd, colourBgra: fixture.colorBGRA,
  start: fixture.start, end: fixture.end, duration: fixture.duration, remaining: fixture.remaining });

describe("RM-17 fog transition update (0x10443ad0)", () => {
  it.each(fixtures.map(fixture => [fixture.index, fixture.scenario, fixture] as const))("matches native fixture %i (%s)", (_, __, fixture) => {
    expect(updateFogTransition(stateOf(fixture.before), Math.fround(fixture.deltaSeconds))).toEqual(stateOf(fixture.output));
  });

  it("restarts from the current tuple only through SnapshotCurrent; setting a duration or a target never restarts", () => {
    const midway = stateOf(fixtures.find(fixture => fixture.scenario === "restart-mid-transition")!.before);
    const retargeted = setFogTransitionDuration(setFogTransitionRangeTarget(setFogTransitionColourTarget(midway, [200, 50, 30, 0]), 1000, 5000), 1);
    expect([retargeted.oldColourBgra, retargeted.remaining]).toEqual([midway.oldColourBgra, midway.remaining]);
    const restarted = snapshotFogTransition(retargeted);
    expect([restarted.oldColourBgra, restarted.oldStart, restarted.oldEnd, restarted.remaining]).toEqual([midway.colourBgra, midway.start, midway.end, 1]);
  });
});
