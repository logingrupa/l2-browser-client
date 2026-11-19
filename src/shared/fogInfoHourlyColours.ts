export type FogColourBytes = readonly [number, number, number];

export interface FogRangeBounds {
  readonly min: number;
  readonly max: number;
}

export interface FogInfoColourKey {
  readonly time: number;
  readonly fogColourBytes: FogColourBytes;
  readonly skyColourBytes: FogColourBytes;
  readonly cloudColourBytes: readonly FogColourBytes[];
  readonly hazeRingColourBytes: readonly FogColourBytes[];
}

type FogInfoColourMember = (key: FogInfoColourKey) => FogColourBytes | undefined;

export interface FogSourcePosition {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface L2FogInfoRecord {
  readonly exportIndex: number;
  readonly sourceLocation: FogSourcePosition;
  readonly affectRange: FogRangeBounds;
  readonly textureDistance: number;
  readonly fogRanges: readonly FogRangeBounds[];
  readonly colours: readonly FogInfoColourKey[];
}

export interface WeightedFogInfo {
  readonly fogInfo: L2FogInfoRecord;
  readonly weight: number;
}

const hoursPerDay = 24;
const unmatchedHourColour: FogColourBytes = [0, 0, 0];

export function interpolateFogColourBytes(from: FogColourBytes, to: FogColourBytes, weight: number): FogColourBytes {
  return [Math.trunc(from[0] + weight * (to[0] - from[0])), Math.trunc(from[1] + weight * (to[1] - from[1])), Math.trunc(from[2] + weight * (to[2] - from[2]))];
}

interface FogInfoHourPair {
  readonly first: FogInfoColourKey;
  readonly second: FogInfoColourKey;
  readonly weight: number;
}

export function fogInfoHourPair(colours: readonly FogInfoColourKey[], hour: number): FogInfoHourPair | null {
  const nativeHour = Math.fround(hour);
  const normalisedHour = ((nativeHour % hoursPerDay) + hoursPerDay) % hoursPerDay;
  for (let index = 0; index < colours.length; index++) {
    const first = colours[index]!, second = colours[(index + 1) % colours.length]!;
    const secondTime = index + 1 === colours.length ? second.time + hoursPerDay : second.time;
    if (first.time <= normalisedHour && normalisedHour <= secondTime) {
      return { first, second, weight: Math.fround((nativeHour - first.time) / (secondTime - first.time)) };
    }
  }
  return null;
}

export function fogInfoMemberAtHour(colours: readonly FogInfoColourKey[], hour: number, member: FogInfoColourMember): FogColourBytes | null {
  const pair = fogInfoHourPair(colours, hour);
  if (pair === null) return null;
  const from = member(pair.first), to = member(pair.second);
  return from === undefined || to === undefined ? null : interpolateFogColourBytes(from, to, pair.weight);
}

export function fogInfoScalarMemberAtHour(colours: readonly FogInfoColourKey[], hour: number, member: (key: FogInfoColourKey) => FogColourBytes): FogColourBytes {
  return fogInfoMemberAtHour(colours, hour, member) ?? unmatchedHourColour;
}

export function fogInfoColourAtHour(colours: readonly FogInfoColourKey[], hour: number): FogColourBytes {
  return fogInfoScalarMemberAtHour(colours, hour, key => key.fogColourBytes);
}
