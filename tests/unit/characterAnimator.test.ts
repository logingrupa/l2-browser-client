import { describe, expect, it } from "vitest";
import { CharacterAnimator, type CharacterAnimationDriver } from "../../src/animation/CharacterAnimator";
import type { AnimationState } from "../../src/world/worldTypes";

function recordingDriver() {
  const calls: { setState: [AnimationState, boolean | undefined][]; update: number[]; disposed: number } = { setState: [], update: [], disposed: 0 };
  const driver: CharacterAnimationDriver = {
    setState(state, retrigger) { calls.setState.push([state, retrigger]); },
    update(seconds) { calls.update.push(seconds); },
    dispose() { calls.disposed += 1; },
  };
  return { driver, calls };
}

describe("character animator", () => {
  it("forwards only state changes unless the caller retriggers the same state", () => {
    const { driver, calls } = recordingDriver(), animator = new CharacterAnimator(driver);
    animator.setState("idle");
    animator.setState("run"); animator.setState("run");
    animator.setState("run", true);
    expect(calls.setState).toEqual([["run", false], ["run", true]]);
    expect(animator.state).toBe("run");
  });

  it("rejects elapsed times that are not finite and non-negative", () => {
    const { driver, calls } = recordingDriver(), animator = new CharacterAnimator(driver);
    expect(() => animator.update(Number.NaN)).toThrow(RangeError);
    expect(() => animator.update(-1)).toThrow(RangeError);
    animator.update(.25);
    expect(calls.update).toEqual([.25]);
  });

  it("disposes the replaced driver and replays the current state on its replacement", () => {
    const first = recordingDriver(), second = recordingDriver(), animator = new CharacterAnimator(first.driver);
    animator.setState("attack");
    animator.replaceDriver(second.driver);
    expect(first.calls.disposed).toBe(1);
    expect(second.calls.setState).toEqual([["attack", undefined]]);
  });

  it("ignores state and time after disposal and disposes a late replacement driver", () => {
    const first = recordingDriver(), late = recordingDriver(), animator = new CharacterAnimator(first.driver);
    animator.dispose(); animator.dispose();
    animator.setState("run"); animator.update(1);
    animator.replaceDriver(late.driver);
    expect(first.calls).toEqual({ setState: [], update: [], disposed: 1 });
    expect(animator.state).toBe("idle");
    expect(late.calls).toEqual({ setState: [], update: [], disposed: 1 });
  });
});
