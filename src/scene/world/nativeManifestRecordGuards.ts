export const nativeTileSha256Pattern = /^[a-f0-9]{64}$/;

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function hasExactKeys(value: unknown, fields: readonly string[]): value is Record<string, unknown> {
  if (!isPlainRecord(value)) return false;
  const keys = Object.keys(value);
  return keys.length === fields.length && fields.every(field => Object.hasOwn(value, field));
}
