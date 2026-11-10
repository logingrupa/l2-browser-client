export interface ZoneSet {
  readonly low: number;
  readonly high: number;
}

export const zoneSetWordBits = 32;
export const zoneSetWordCount = 2;
export const maximumZoneCount = zoneSetWordBits * zoneSetWordCount;
export const emptyZoneSet: ZoneSet = { low: 0, high: 0 };
export const fullZoneSetWord = 0xffffffff;

export function zoneSetOf(zone: number): ZoneSet {
  return zone < zoneSetWordBits ? { low: (1 << zone) >>> 0, high: 0 } : { low: 0, high: (1 << (zone - zoneSetWordBits)) >>> 0 };
}

export function zoneSetHas(set: ZoneSet, zone: number): boolean {
  return zone < zoneSetWordBits ? (set.low & (1 << zone)) !== 0 : (set.high & (1 << (zone - zoneSetWordBits))) !== 0;
}

export function zoneSetUnion(left: ZoneSet, right: ZoneSet): ZoneSet {
  return { low: (left.low | right.low) >>> 0, high: (left.high | right.high) >>> 0 };
}

export function zoneSetIntersection(left: ZoneSet, right: ZoneSet): ZoneSet {
  return { low: (left.low & right.low) >>> 0, high: (left.high & right.high) >>> 0 };
}

export function isEmptyZoneSet(set: ZoneSet): boolean {
  return set.low === 0 && set.high === 0;
}

export function zoneSetAt(words: Uint32Array, index: number): ZoneSet {
  return { low: words[index * zoneSetWordCount]!, high: words[index * zoneSetWordCount + 1]! };
}

export function zoneSetWordsMeet(words: Uint32Array, index: number, set: ZoneSet): boolean {
  return (words[index * zoneSetWordCount]! & set.low) !== 0 || (words[index * zoneSetWordCount + 1]! & set.high) !== 0;
}

export function zoneSetWordsEmpty(words: Uint32Array, index: number): boolean {
  return words[index * zoneSetWordCount] === 0 && words[index * zoneSetWordCount + 1] === 0;
}

export function zoneSetOfAllZones(zoneCount: number): ZoneSet {
  let set = emptyZoneSet;
  for (let zone = 0; zone < zoneCount; zone++) set = zoneSetUnion(set, zoneSetOf(zone));
  return set;
}

export function zoneSetMembers(set: ZoneSet, zoneCount: number): number[] {
  const members: number[] = [];
  for (let zone = 0; zone < zoneCount; zone++) if (zoneSetHas(set, zone)) members.push(zone);
  return members;
}
