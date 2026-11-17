const integerIndefinite = -0x80000000;
const int32Limit = 0x80000000;

export function truncateToInt32(value: number): number {
  const truncated = Math.trunc(value);
  return Number.isFinite(truncated) && truncated >= -int32Limit && truncated < int32Limit ? truncated : integerIndefinite;
}

export function floorToInt32(value: number): number {
  return truncateToInt32(Math.floor(value));
}

export function lowByte(value: number): number {
  return value & 0xff;
}
