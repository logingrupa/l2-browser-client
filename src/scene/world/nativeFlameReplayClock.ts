import type { NativeFlameReplayTime } from "./nativeFlameMaterials";

export interface NativeFlameReplaySettings {
  textureSeconds?: number;
  fadeSeconds?: number;
  textureRate?: number;
  fadeRate?: number;
}

/** A browser inspection clock. Native texture/fade clock origins and pause
 * coupling are unresolved, so neither the actor's clamped simulation step nor
 * a claim of native synchronization is used here. */
export function createNativeFlameReplayClock(settings: NativeFlameReplaySettings = {}) {
  let current: NativeFlameReplayTime = {
    textureSeconds: settings.textureSeconds ?? 0, fadeSeconds: settings.fadeSeconds ?? 0,
  };
  const rates = { textureRate: settings.textureRate ?? 1, fadeRate: settings.fadeRate ?? 1 };
  const validate = (values: object) => {
    for (const [name, value] of Object.entries(values)) {
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
        throw new Error(`Native flame replay: ${name} must be finite and nonnegative.`);
      }
    }
  };
  validate(current); validate(rates);
  return {
    advance(frameSeconds: number, paused: boolean): NativeFlameReplayTime {
      validate({ frameSeconds });
      if (!paused) {
        const next = { textureSeconds: current.textureSeconds + frameSeconds * rates.textureRate,
          fadeSeconds: current.fadeSeconds + frameSeconds * rates.fadeRate };
        validate(next); current = next;
      }
      return { ...current };
    },
    seek(time: NativeFlameReplayTime): void {
      const next = { textureSeconds: time.textureSeconds, fadeSeconds: time.fadeSeconds };
      validate(next); current = next;
    },
    inspect: () => ({ ...current, ...rates,
      policy: "independent browser replay clocks; uncapped engine frame delta; pause follows local adapter" as const,
      nativeSynchronization: "unverified" as const }),
  };
}
