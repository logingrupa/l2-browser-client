import { describe, expect, it } from "vitest";
import { createNativeFlameReplayClock } from "../../src/scene/world/nativeFlameReplayClock";

describe("explicit browser flame replay clocks", () => {
  it("keeps separate origins and rates through long frames without the actor simulation clamp", () => {
    const clock = createNativeFlameReplayClock({ textureSeconds: .2, fadeSeconds: .4, textureRate: 2, fadeRate: .5 });
    expect(clock.advance(1.5, false)).toEqual({ textureSeconds: 3.2, fadeSeconds: 1.15 });
    expect(clock.inspect().nativeSynchronization).toBe("unverified");
  });
  it("does not accumulate paused time, supports independent seek and a zero rate", () => {
    const clock = createNativeFlameReplayClock({ fadeRate: 0 });
    clock.advance(5, true);
    expect(clock.advance(.25, false)).toEqual({ textureSeconds: .25, fadeSeconds: 0 });
    clock.seek({ textureSeconds: 3, fadeSeconds: 7 });
    expect(clock.advance(2, true)).toEqual({ textureSeconds: 3, fadeSeconds: 7 });
    expect(clock.advance(1, false)).toEqual({ textureSeconds: 4, fadeSeconds: 7 });
  });
  it("rejects invalid initialization and preserves prior state when a seek or delta fails", () => {
    expect(() => createNativeFlameReplayClock({ fadeRate: -1 })).toThrow("fadeRate");
    expect(() => createNativeFlameReplayClock({ textureSeconds: Infinity })).toThrow("textureSeconds");
    const clock = createNativeFlameReplayClock({ textureSeconds: 2, fadeSeconds: 3 });
    for (const invalid of [NaN, Infinity, -1]) {
      expect(() => clock.seek({ textureSeconds: 9, fadeSeconds: invalid })).toThrow("fadeSeconds");
      expect(() => clock.advance(invalid, false)).toThrow("frameSeconds");
      expect(clock.advance(0, false)).toEqual({ textureSeconds: 2, fadeSeconds: 3 });
    }
  });
  it("rejects overflow atomically and does not expose mutable internal state", () => {
    const clock = createNativeFlameReplayClock({ textureRate: 2 });
    expect(() => clock.advance(Number.MAX_VALUE, false)).toThrow("textureSeconds");
    const current = clock.advance(0, false); current.textureSeconds = 90;
    clock.inspect().fadeSeconds = 20;
    expect(clock.advance(0, false)).toEqual({ textureSeconds: 0, fadeSeconds: 0 });
  });
});
