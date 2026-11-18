import { describe, expect, it } from "vitest";
import { createNativeEnvironmentManager, type ChangeEnvironmentRequest, type NativeEnvironmentSetup } from "../../src/environment/model/nativeEnvironmentManager";

const shippedSetup: NativeEnvironmentSetup = { isClock: true, timeRatio: 6, startTimeHours: 12, shadowTickHours: 0.1, slopeSunAngleDegrees: 30 };
const redSkyDelayHours = 0.0020000000949949026;
const ssqDelayHours = 0.019999999552965164;

function managerWith(setup: NativeEnvironmentSetup = shippedSetup) {
  let seconds = 100;
  const manager = createNativeEnvironmentManager({ setup, loadedEnvironmentTypes: new Set([0, 1, 2, 3]), readRealSeconds: () => seconds });
  return { manager, advanceRealSeconds: (delta: number) => { seconds += delta; } };
}

const request = (overrides: Partial<ChangeEnvironmentRequest>): ChangeEnvironmentRequest => ({
  environmentType: 1, immediate: 0, endDelayHours: 0.5, peakDelayHours: 0.25, targetWeight: 0.5, timeoutSeconds: 0, persistent: false, ...overrides,
});

describe("native environment manager per-frame steps (UpdateNTime 0x1051b330)", () => {
  it.each([[359, 3], [360, 0], [479, 0], [480, 1], [1319, 1], [1320, 2], [1439, 2], [0, 3]])(
    "derives day part from server time %s minutes as %s", (gameMinutes, dayPart) => {
      const { manager } = managerWith();
      manager.receiveServerTime(gameMinutes);
      manager.tick(0);
      expect(manager.snapshot().dayPart).toBe(dayPart);
    });

  it("does nothing per frame when IsClock is 0", () => {
    const { manager, advanceRealSeconds } = managerWith({ ...shippedSetup, isClock: false });
    manager.receiveRedSky(0);
    advanceRealSeconds(3600);
    manager.tick(5);
    expect(manager.hour()).toBe(12);
    expect(manager.snapshot()).toMatchObject({ dayPart: 0, lightingDirty: false, targetType: 3, remainingRevertSeconds: 0, weight: 0 });
  });

  it("reports the freeze gate as false with its unresolved producer and still advances", () => {
    const { manager, advanceRealSeconds } = managerWith();
    advanceRealSeconds(600);
    manager.tick(0);
    expect(manager.hour()).toBe(13);
    expect(manager.snapshot().frozen).toEqual({ value: false, status: "unresolved", reason: "freeze-producer-unresolved" });
  });

  it("never marks lighting dirty from the hour when ShadowTick is the native default -1", () => {
    const { manager, advanceRealSeconds } = managerWith({ ...shippedSetup, shadowTickHours: -1 });
    for (let frame = 0; frame < 5; frame += 1) {
      advanceRealSeconds(600);
      manager.tick(600);
      expect(manager.snapshot().lightingDirty).toBe(false);
    }
  });

  it("marks lighting dirty only when the hour moved strictly more than ShadowTick", () => {
    const { manager, advanceRealSeconds } = managerWith();
    manager.tick(0);
    expect(manager.snapshot()).toMatchObject({ lightingDirty: true, lastLightingHour: 12 });
    manager.tick(0);
    expect(manager.snapshot().lightingDirty).toBe(false);
    advanceRealSeconds(30);
    manager.tick(30);
    expect(manager.snapshot()).toMatchObject({ lightingDirty: false, lastLightingHour: 12 });
    advanceRealSeconds(31);
    manager.tick(31);
    expect(manager.snapshot()).toMatchObject({ lightingDirty: true, lastLightingHour: manager.hour() });
  });

  it("keeps lighting dirty while a transition is active", () => {
    const { manager } = managerWith({ ...shippedSetup, shadowTickHours: -1 });
    manager.changeEnvironment(request({}));
    manager.tick(0);
    expect(manager.snapshot()).toMatchObject({ lightingDirty: true, oldType: 0, targetType: 1 });
  });

  it("settles when the hour equals the transition end, not only after it", () => {
    const { manager } = managerWith();
    manager.changeEnvironment(request({ endDelayHours: 0, peakDelayHours: 0, targetWeight: 0.25 }));
    expect(manager.snapshot()).toMatchObject({ transitionEnd: 12, oldType: 0, targetType: 1 });
    manager.tick(0);
    expect(manager.snapshot()).toMatchObject({ oldType: 1, targetType: 1, oldWeight: 0.25, weight: 1 });
  });

  it("fires the timeout revert only once the countdown drops below 0", () => {
    const { manager } = managerWith();
    manager.receiveRedSky(5);
    expect(manager.snapshot()).toMatchObject({ targetType: 3, persistentTargetType: 0, remainingRevertSeconds: 5 });
    manager.tick(5);
    expect(manager.snapshot()).toMatchObject({ targetType: 3, remainingRevertSeconds: 0 });
    manager.tick(0.25);
    expect(manager.snapshot()).toMatchObject({ targetType: 0, oldType: 3, targetWeight: 1, remainingRevertSeconds: 0 });
    expect(manager.snapshot().transitionPeak).toBe(manager.snapshot().transitionEnd);
  });

  it("reverts red sky to the persistent SSQ type, not to type 0", () => {
    const { manager } = managerWith();
    manager.receiveSsqInfo(2, 1);
    manager.receiveRedSky(0);
    manager.tick(0.1);
    expect(manager.snapshot()).toMatchObject({ targetType: 2, persistentTargetType: 2 });
  });
});

describe("native ChangeEnv 0x1051a420, OnSSQInfo 0x1048b890 and OnRedSky 0x1048d540", () => {
  it("switches everything at once with weight 1 when immediate is 1", () => {
    const { manager } = managerWith();
    manager.changeEnvironment(request({ immediate: 1, persistent: true, timeoutSeconds: 9 }));
    expect(manager.snapshot()).toMatchObject({ oldType: 1, targetType: 1, persistentOldType: 1, persistentTargetType: 1, targetWeight: 1, oldWeight: 1,
      transitionStart: 12, transitionEnd: 12, transitionPeak: 12, remainingRevertSeconds: 0 });
  });

  it("opens a window from the current hour with no wrap and keeps the old type until it settles", () => {
    const { manager } = managerWith();
    manager.receiveServerTime(23 * 60 + 59);
    manager.changeEnvironment(request({ endDelayHours: 0.5, peakDelayHours: 0.25, timeoutSeconds: 3, persistent: true }));
    const hour = manager.hour();
    expect(manager.snapshot()).toMatchObject({ transitionStart: hour, transitionEnd: Math.fround(0.5 + hour), transitionPeak: Math.fround(0.25 + hour),
      oldType: 0, targetType: 1, persistentOldType: 0, persistentTargetType: 1, targetWeight: 0.5, remainingRevertSeconds: 3 });
    expect(manager.snapshot().transitionEnd).toBeGreaterThan(24);
  });

  it("forces peak = end and weight 1 for type 0", () => {
    const { manager } = managerWith();
    manager.changeEnvironment(request({ environmentType: 0, targetWeight: 0.2 }));
    expect(manager.snapshot()).toMatchObject({ targetType: 0, targetWeight: 1, transitionPeak: Math.fround(12.5), transitionEnd: Math.fround(12.5) });
  });

  it.each([
    ["a type with no table", request({ environmentType: 7 }), "environment-type-unloaded"],
    ["a negative peak delay", request({ peakDelayHours: -0.1 }), "peak-delay-negative"],
    ["a peak delay above the absolute end", request({ endDelayHours: 0.1, peakDelayHours: 13 }), "end-before-peak-delay"],
    ["a weight below 0", request({ targetWeight: -0.1 }), "target-weight-out-of-range"],
    ["a weight above 1", request({ targetWeight: 1.1 }), "target-weight-out-of-range"],
  ] as const)("ignores %s and names why", (_, ignoredRequest, outcome) => {
    const { manager } = managerWith();
    const before = manager.snapshot();
    expect(manager.changeEnvironment(ignoredRequest)).toBe(outcome);
    expect(manager.snapshot()).toEqual(before);
  });

  it("reports a request that took effect as changed, immediate or windowed", () => {
    const { manager } = managerWith();
    expect(manager.changeEnvironment(request({}))).toBe("changed");
    expect(manager.receiveSsqInfo(2, 1)).toBe("changed");
    expect(manager.receiveRedSky(5)).toBe("changed");
    expect(manager.receiveSsqInfo(7, 0)).toBe("environment-type-unloaded");
  });

  it("looks the requested type up as a signed character", () => {
    const manager = createNativeEnvironmentManager({ setup: shippedSetup, loadedEnvironmentTypes: new Set([0, -1]), readRealSeconds: () => 0 });
    manager.changeEnvironment(request({ environmentType: 255 }));
    expect(manager.snapshot().targetType).toBe(255);
  });

  it("forwards SSQ info with 0.02 hour delays, weight 1 and persistence", () => {
    const { manager } = managerWith();
    manager.receiveSsqInfo(1, 0);
    expect(manager.snapshot()).toMatchObject({ targetType: 1, oldType: 0, persistentTargetType: 1, persistentOldType: 0, targetWeight: 1,
      transitionEnd: Math.fround(ssqDelayHours + 12), transitionPeak: Math.fround(ssqDelayHours + 12), remainingRevertSeconds: 0 });
  });

  it("requests type 3 for red sky with 0.002 hour delays, its timeout and no persistence", () => {
    const { manager } = managerWith();
    manager.receiveRedSky(30);
    expect(manager.snapshot()).toMatchObject({ targetType: 3, persistentTargetType: 0, remainingRevertSeconds: 30,
      transitionEnd: Math.fround(redSkyDelayHours + 12), transitionPeak: Math.fround(redSkyDelayHours + 12) });
  });

  it("keeps a window that ends past midnight unsettled at every later hour and weighs it with W", () => {
    const { manager, advanceRealSeconds } = managerWith({ ...shippedSetup, shadowTickHours: -1 });
    manager.receiveServerTime(23 * 60 + 59);
    manager.receiveSsqInfo(1, 0);
    manager.changeEnvironment(request({ environmentType: 2, endDelayHours: 0.03, peakDelayHours: 0.01, targetWeight: 0.5, persistent: true }));
    for (let gameHour = 0; gameHour < 30; gameHour += 1) {
      advanceRealSeconds(600);
      manager.tick(600);
      const snapshot = manager.snapshot();
      expect(snapshot.oldType).not.toBe(snapshot.targetType);
      if (manager.hour() < snapshot.transitionStart) expect(snapshot.weight).toBe(0.5);
    }
  });

  it.each([1.5, Number.NaN])("rejects a red sky timeout of %s", timeoutSeconds => {
    expect(() => managerWith().manager.receiveRedSky(timeoutSeconds)).toThrow(RangeError);
  });
});
