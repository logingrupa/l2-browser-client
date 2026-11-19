const integerIndefinite = -0x80000000;
const int32Limit = 0x80000000;
const int64Limit = 2 ** 63;
const uint32Range = 2 ** 32;

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

export function truncateToInt64LowDword(value: number): number {
  const truncated = Math.trunc(value);
  if (!Number.isFinite(truncated) || truncated < -int64Limit || truncated >= int64Limit) return 0;
  return ((truncated % uint32Range) + uint32Range) % uint32Range;
}
