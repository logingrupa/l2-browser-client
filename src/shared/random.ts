import type { Vector3 } from "./math/vector3";
import type { ReferenceConstantRow } from "./referenceConstant";

export const RANDOM_STREAM_DOMAINS = ["emitter", "light-flicker", "tex-jitter", "test"] as const;
export type RandomStreamDomain = (typeof RANDOM_STREAM_DOMAINS)[number];
export type RandomStreamId = number | string;

export interface RandomStream {
  nextUint32(): number;
  nextUnit(): number;
}

export const RANDOM_REFERENCE_RULES = {
  rangeDraw: {
    id: "fx.frange-draw",
    value: "Max + (Min - Max) * u",
    provenance: ".planning/reference/lineage2js/04-particles.md fx.frange-draw: u in [0, 1); lineage2js/src/objects/emitters/base-emitter.ts:2088 (beam-emitter.ts:41 uses the opposite order and is not followed); re-derive at Core.dll 9462f87a FRange::GetRand 0x1010212B -> 0x1010E690 (POL-04)",
    status: "unconfirmed",
    interludeEvidence: null,
    runtimeDefault: "Max + (Min - Max) * u",
  },
  unitVectorDraws: {
    id: "fx.unit-vector-draws",
    value: 2,
    provenance: ".planning/reference/lineage2js/04-particles.md design: the unit vector takes two draws, z uniform in [-1, 1] and then the azimuth, so each spawn uses a fixed number of draws",
    status: "unconfirmed",
    interludeEvidence: null,
    runtimeDefault: 2,
  },
} as const satisfies Record<string, ReferenceConstantRow<string | number>>;

const goldenRatioIncrement = 0x9e3779b9;
const sfc32WarmupDraws = 12;
const uint32Range = 2 ** 32;
const numericIdTag = 0;
const stringIdTag = 1;

function requireUint32(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0 || value >= uint32Range) throw new RangeError(`${label} must be an unsigned 32-bit integer, not ${value}.`);
}

function finalizeHash32(hash: number): number {
  let mixed = hash;
  mixed = Math.imul(mixed ^ (mixed >>> 16), 0x85ebca6b);
  mixed = Math.imul(mixed ^ (mixed >>> 13), 0xc2b2ae35);
  return (mixed ^ (mixed >>> 16)) >>> 0;
}

function mixHashWord(hash: number, word: number): number {
  let scrambled = Math.imul(word, 0xcc9e2d51);
  scrambled = (scrambled << 15) | (scrambled >>> 17);
  scrambled = Math.imul(scrambled, 0x1b873593);
  const combined = hash ^ scrambled;
  return (Math.imul((combined << 13) | (combined >>> 19), 5) + 0xe6546b64) | 0;
}

function stringWords(text: string): number[] {
  return [text.length, ...Array.from({ length: text.length }, (_, index) => text.charCodeAt(index))];
}

function streamIdWords(id: RandomStreamId): number[] {
  if (typeof id === "string") return [stringIdTag, ...stringWords(id)];
  requireUint32(id, "A numeric random stream id");
  return [numericIdTag, id];
}

export function deriveStreamSeed(sessionSeed: number, domain: RandomStreamDomain, ids: readonly RandomStreamId[]): number {
  requireUint32(sessionSeed, "The session seed");
  const words = [sessionSeed, ...stringWords(domain), ids.length, ...ids.flatMap(streamIdWords)];
  return finalizeHash32(words.reduce(mixHashWord, 0) ^ words.length);
}

export function createRandomStream(seed: number): RandomStream {
  requireUint32(seed, "The random stream seed");
  let splitmixState = seed | 0;
  const nextSplitmix32 = () => {
    splitmixState = (splitmixState + goldenRatioIncrement) | 0;
    return finalizeHash32(splitmixState);
  };
  let first = nextSplitmix32() | 0, second = nextSplitmix32() | 0, third = nextSplitmix32() | 0, counter = nextSplitmix32() | 0;
  const nextUint32 = () => {
    const firstPlusSecond = (first + second) | 0;
    first = second ^ (second >>> 9);
    second = (third + (third << 3)) | 0;
    const rotatedThird = (third << 21) | (third >>> 11);
    counter = (counter + 1) | 0;
    const output = (firstPlusSecond + counter) | 0;
    third = (rotatedThird + output) | 0;
    return output >>> 0;
  };
  for (let warmupDraw = 0; warmupDraw < sfc32WarmupDraws; warmupDraw += 1) nextUint32();
  return { nextUint32, nextUnit: () => nextUint32() / uint32Range };
}

export function randomRange(minimum: number, maximum: number, unitDraw: number): number {
  return maximum + (minimum - maximum) * unitDraw;
}

export function randomUnitVector(stream: RandomStream): Vector3 {
  const z = randomRange(-1, 1, stream.nextUnit());
  const azimuth = 2 * Math.PI * stream.nextUnit();
  const radius = Math.sqrt(Math.max(0, 1 - z * z));
  return { x: radius * Math.cos(azimuth), y: radius * Math.sin(azimuth), z };
}
