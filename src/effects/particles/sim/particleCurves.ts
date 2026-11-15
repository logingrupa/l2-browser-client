import type { CurveKey } from "./emitterRecords";

export interface CurveSample {
  readonly values: readonly number[];
  readonly pastLastKey: boolean;
}

export function curvePhase(relativeAge: number, repeats: number): number {
  const repeatedAge = relativeAge * (repeats + 1);
  return repeatedAge - Math.floor(repeatedAge);
}

export function relativeParticleAge(timeSeconds: number, maxLifetimeSeconds: number): number {
  if (maxLifetimeSeconds === 0) return 0;
  return Math.min(1, Math.max(0, timeSeconds / maxLifetimeSeconds));
}

export function sampleCurve(keys: readonly CurveKey[], phase: number, identityValues: readonly number[]): CurveSample {
  const keyIndex = keys.findIndex(key => key.relativeTime >= phase);
  if (keyIndex < 0) return { values: keys.at(-1)?.values ?? identityValues, pastLastKey: true };
  const nextKey = keys[keyIndex]!;
  const previousTime = keyIndex === 0 ? 0 : keys[keyIndex - 1]!.relativeTime;
  const previousValues = keyIndex === 0 ? identityValues : keys[keyIndex - 1]!.values;
  const span = nextKey.relativeTime - previousTime;
  const weight = span > 0 ? (phase - previousTime) / span : 1;
  return { values: nextKey.values.map((value, index) => previousValues[index]! + (value - previousValues[index]!) * weight), pastLastKey: false };
}
