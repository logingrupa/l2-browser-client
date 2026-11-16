import { describe, expect, it } from "vitest";
import { nativeEffectSelfTargetViewerPlacement, nativeEffectShotPlacement } from "../../src/effects/nativeEffectShotPlacement";

describe("Power Strike shot placement", () => {
  it("keeps the gameplay refusal of coincident caster and target pivots", () => {
    expect(() => nativeEffectShotPlacement([1, 2, 3], [1, 2, 3], 0.18)).toThrow("Coincident actor pivots cannot define a shot direction.");
  });

  it("places the gameplay shot half the target radius before the target on the caster-to-target line", () => {
    const placement = nativeEffectShotPlacement([0, 0, 0], [2, 0, 0], 0.18);
    expect(placement.policy).toBe("presented-pivot-half-source-radius-v1");
    expect(placement.position[0]).toBeCloseTo(1.91, 12);
    expect(placement.distance).toBe(2);
  });

  it("reproduces the PawnViewer self entry: rotation 0, source +X and the caster minus half its collision radius along X", () => {
    const placement = nativeEffectSelfTargetViewerPlacement([10532.1865, 40, -7], 9);
    expect(placement).toMatchObject({ policy: "pawnviewer-self-target-v1", position: [10527.6865, 40, -7], direction: [1, 0, 0],
      quaternion: [0, 0, 0, 1], caster: [10532.1865, 40, -7], target: [10532.1865, 40, -7], collisionRadius: 9, halfRadius: 4.5, distance: 0,
      nativeRuntimeLocationVerified: false });
  });

  it("refuses a viewer placement without a finite caster pivot or a positive caster radius", () => {
    expect(() => nativeEffectSelfTargetViewerPlacement([Number.NaN, 0, 0], 9)).toThrow("finite pivots and a positive source collision radius");
    expect(() => nativeEffectSelfTargetViewerPlacement([0, 0, 0], 0)).toThrow("finite pivots and a positive source collision radius");
  });
});
