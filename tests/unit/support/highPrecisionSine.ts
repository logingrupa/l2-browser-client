const fractionBits = 192n;
const piDecimalDigits = "31415926535897932384626433832795028841971693993751058209749445923078164062862089986280348253421170679";
const scaledPi = (BigInt(piDecimalDigits) << fractionBits) / 10n ** BigInt(piDecimalDigits.length - 1);
const scaledHalfPi = scaledPi >> 1n;
const roundingMarginShift = 50n;

function exactlyScaled(value: number): bigint {
  if (value === 0) return 0n;
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value);
  const bits = view.getBigUint64(0);
  const exponentField = Number((bits >> 52n) & 0x7ffn);
  const mantissa = (bits & ((1n << 52n) - 1n)) | (exponentField === 0 ? 0n : 1n << 52n);
  const shift = BigInt((exponentField === 0 ? 1 : exponentField) - 1075) + fractionBits;
  const magnitude = shift >= 0n ? mantissa << shift : mantissa >> -shift;
  return bits >> 63n === 1n ? -magnitude : magnitude;
}

function scaledSine(scaledAngle: bigint): bigint {
  let reduced = scaledAngle, sign = 1n;
  if (reduced > scaledPi) { reduced -= scaledPi; sign = -1n; }
  if (reduced > scaledHalfPi) reduced = scaledPi - reduced;
  const squared = (reduced * reduced) >> fractionBits;
  let term = reduced, sum = reduced;
  for (let order = 1n; term !== 0n; order += 1n) {
    term = -((term * squared) >> fractionBits) / (2n * order * (2n * order + 1n));
    sum += term;
  }
  return sign * sum;
}

function float32Step(value: number, steps: number): number {
  const floats = new Float32Array([value]), integers = new Int32Array(floats.buffer);
  integers[0] = integers[0]! + steps;
  return floats[0]!;
}

export function float32SineWithRoundingMargin(angleRadians: number): number {
  const scaledSineValue = scaledSine(exactlyScaled(angleRadians));
  if (scaledSineValue === 0n) return 0;
  const magnitude = scaledSineValue < 0n ? -scaledSineValue : scaledSineValue;
  const nearestFloat32 = Math.fround(Number(magnitude) / 2 ** Number(fractionBits));
  const lowerMidpoint = exactlyScaled((float32Step(nearestFloat32, -1) + nearestFloat32) / 2);
  const upperMidpoint = exactlyScaled((nearestFloat32 + float32Step(nearestFloat32, 1)) / 2);
  const margin = magnitude >> roundingMarginShift;
  if (!(magnitude - lowerMidpoint > margin && upperMidpoint - magnitude > margin)) {
    throw new RangeError(`sin(${angleRadians}) lies within 2^-50 of a float32 rounding midpoint; its float32 depends on the sine implementation.`);
  }
  return scaledSineValue < 0n ? -nearestFloat32 : nearestFloat32;
}
