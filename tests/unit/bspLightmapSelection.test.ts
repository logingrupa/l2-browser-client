import { describe, expect, it } from "vitest";
import { bspLightmapPageSource, bspLightmapSlot } from "../../src/environment/model/bspLightmapSelection";

describe("BSP lightmap slot (draw sections 0x10668ac0 and 0x10669de0)", () => {
  it("selects trunc(float32(hour) * N / 24) % N for a sun-affected section, 0/2/4/6 at 0/6/12/18 for an 8-child atlas", () => {
    expect([0, 6, 12, 18].map(hour => bspLightmapSlot(hour, 8, true))).toEqual([0, 2, 4, 6]);
    expect([2.99, 3, 23.9].map(hour => bspLightmapSlot(hour, 8, true))).toEqual([0, 1, 7]);
  });

  it("keeps slot 0 for a section whose node zones lack bSunAffect and for a one-child group", () => {
    expect(bspLightmapSlot(13, 8, false)).toBe(0);
    expect(bspLightmapSlot(13, 1, true)).toBe(0);
  });

  it("divides by 24 in double precision as _ftol2 does, not after a float32 rounding", () => {
    const hourJustBelowThreeFifths = 14.399999618530273;
    expect(Math.trunc(Math.fround(Math.fround(Math.fround(hourJustBelowThreeFifths) * 5) / 24))).toBe(3);
    expect(bspLightmapSlot(hourJustBelowThreeFifths, 5, true)).toBe(2);
  });

  it("refuses an hour outside the day and a child count below 1", () => {
    expect(() => bspLightmapSlot(24, 8, true)).toThrow(RangeError);
    expect(() => bspLightmapSlot(Number.NaN, 8, true)).toThrow(RangeError);
    expect(() => bspLightmapSlot(1, 0, true)).toThrow(RangeError);
  });
});

describe("lightmap child source (DB-16 REV-SAME-MISMATCH-PATH, UseCompressedLightmaps=True)", () => {
  it("takes the compressed child on equal revisions and the rebuilt composite on any difference", () => {
    expect(bspLightmapPageSource(6641, 6641)).toBe("compressed-child");
    expect([[211740, 6986], [211395, 6641], [5428, 5410], [18, 36]].map(([revision, compressed]) => bspLightmapPageSource(revision!, compressed!)))
      .toEqual(["rebuilt-composite", "rebuilt-composite", "rebuilt-composite", "rebuilt-composite"]);
  });
});
