import { describe, expect, it } from "vitest";
import {
  RANDOM_REFERENCE_RULES,
  RANDOM_STREAM_DOMAINS,
  createRandomStream,
  deriveStreamSeed,
  randomRange,
  randomUnitVector,
  type RandomStream,
} from "../../src/shared/random";

function firstDraws(stream: RandomStream, count: number) {
  return Array.from({ length: count }, () => stream.nextUint32());
}

function countingStream(stream: RandomStream) {
  let draws = 0;
  return {
    stream: { nextUint32: () => { draws += 1; return stream.nextUint32(); }, nextUnit: () => { draws += 1; return stream.nextUnit(); } },
    draws: () => draws,
  };
}

describe("seeded random streams", () => {
  it("names the four stream domains", () => {
    expect(RANDOM_STREAM_DOMAINS).toEqual(["emitter", "light-flicker", "tex-jitter", "test"]);
  });

  it("pins the test-domain seed and the first sfc32 draws", () => {
    const seed = deriveStreamSeed(1, "test", [0]);
    expect(seed).toBe(1667376744);
    expect(firstDraws(createRandomStream(seed), 5)).toEqual([2351794619, 3187611969, 1379483339, 871736596, 4146715276]);
    expect(deriveStreamSeed(1, "emitter", [7, "20_20.Emitter3"])).toBe(3416019879);
  });

  it("repeats the same sequence for the same session seed, domain and ids", () => {
    const seed = deriveStreamSeed(20261108, "emitter", [12, 3]);
    expect(firstDraws(createRandomStream(seed), 64)).toEqual(firstDraws(createRandomStream(deriveStreamSeed(20261108, "emitter", [12, 3])), 64));
  });

  it("never gives two domains the same first draw for the same ids", () => {
    for (let id = 0; id < 500; id += 1) {
      const firstDrawByDomain = RANDOM_STREAM_DOMAINS.map(domain => createRandomStream(deriveStreamSeed(7, domain, [id])).nextUint32());
      expect(new Set(firstDrawByDomain).size).toBe(RANDOM_STREAM_DOMAINS.length);
    }
  });

  it("separates id order, id count and numeric from string ids", () => {
    const seeds = [
      deriveStreamSeed(7, "emitter", [1, 2]), deriveStreamSeed(7, "emitter", [2, 1]), deriveStreamSeed(7, "emitter", [1, 2, 0]),
      deriveStreamSeed(7, "emitter", [12]), deriveStreamSeed(7, "emitter", ["12"]), deriveStreamSeed(8, "emitter", [1, 2]),
    ];
    expect(new Set(seeds).size).toBe(seeds.length);
  });

  it("refuses a session seed or numeric id outside unsigned 32 bits", () => {
    expect(() => deriveStreamSeed(-1, "test", [])).toThrow(RangeError);
    expect(() => deriveStreamSeed(1, "test", [1.5])).toThrow(RangeError);
    expect(() => createRandomStream(2 ** 32)).toThrow(RangeError);
  });

  it("draws units in [0, 1) with a mean near one half", () => {
    const stream = createRandomStream(deriveStreamSeed(3, "test", [0]));
    const draws = Array.from({ length: 20000 }, () => stream.nextUnit());
    expect(draws.every(draw => draw >= 0 && draw < 1)).toBe(true);
    expect(Math.abs(draws.reduce((sum, draw) => sum + draw, 0) / draws.length - 0.5)).toBeLessThan(0.01);
  });
});

describe("reference draws", () => {
  it("draws a range as Max + (Min - Max) * u", () => {
    expect(randomRange(2, 10, 0)).toBe(10);
    expect(randomRange(2, 10, 0.25)).toBe(8);
    expect(randomRange(2, 10, 1)).toBe(2);
    expect(randomRange(-5, -5, 0.7)).toBe(-5);
  });

  it("draws a unit vector with exactly two draws, z first and then the azimuth", () => {
    const counted = countingStream(createRandomStream(deriveStreamSeed(9, "test", [1])));
    const reference = createRandomStream(deriveStreamSeed(9, "test", [1]));
    for (let spawn = 1; spawn <= 200; spawn += 1) {
      const vector = randomUnitVector(counted.stream);
      expect(counted.draws()).toBe(spawn * 2);
      const expectedZ = randomRange(-1, 1, reference.nextUnit());
      const expectedAzimuth = 2 * Math.PI * reference.nextUnit();
      expect(vector.z).toBe(expectedZ);
      expect(Math.atan2(vector.y, vector.x)).toBeCloseTo(expectedAzimuth > Math.PI ? expectedAzimuth - 2 * Math.PI : expectedAzimuth, 9);
      expect(Math.hypot(vector.x, vector.y, vector.z)).toBeCloseTo(1, 12);
    }
  });

  it("keeps every reference rule an unconfirmed constants row with provenance", () => {
    expect(RANDOM_REFERENCE_RULES.unitVectorDraws.runtimeDefault).toBe(2);
    for (const row of Object.values(RANDOM_REFERENCE_RULES)) {
      expect(row.status).toBe("unconfirmed");
      expect(row.provenance.length).toBeGreaterThan(0);
      expect(row.interludeEvidence).toBeNull();
      expect(row.runtimeDefault).toBe(row.value);
    }
  });
});
