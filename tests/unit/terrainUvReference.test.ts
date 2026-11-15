import { describe, expect, it } from "vitest";
import { nativeTerrainReferenceUv, terrainUvCoordinateOracles, terrainUvReferenceCases } from "../browser/terrainUvReferenceCases";
import { validateTerrainLegacyFixture } from "../browser/terrainLegacyReferenceRenderer";

describe("conditional native terrain UV reference", () => {
  it("matches the independently retained binary-fraction coordinates for both branches", () => {
    for (const entry of terrainUvCoordinateOracles) {
      const coordinate = nativeTerrainReferenceUv(entry.grid, 256, entry.branch);
      expect(coordinate).toBe(entry.uv);
      expect(Math.fround(coordinate)).toBe(coordinate);
      expect(coordinate * 512 - .5).toBe(entry.mask512.texelCenter);
      expect(coordinate * 1024 - .5).toBe(entry.mask1024.texelCenter);
    }
  });

  it("keeps the selected X range and threshold equal, with the documented correction beyond 240", () => {
    for (const grid of [0, 64, 112, 208, 239, 240]) {
      expect(nativeTerrainReferenceUv(grid, 256, "corrected")).toBe(nativeTerrainReferenceUv(grid, 256, "ordinary"));
    }
    expect(nativeTerrainReferenceUv(241, 256, "ordinary") - nativeTerrainReferenceUv(241, 256, "corrected")).toBe(1 / 4096);
    expect(nativeTerrainReferenceUv(255, 256, "ordinary") - nativeTerrainReferenceUv(255, 256, "corrected")).toBe(15 / 4096);
  });

  it("requires explicit source scope and never substitutes the mask size as denominator", () => {
    for (const grid of [-1, 256, 240.5, NaN, Infinity]) expect(() => nativeTerrainReferenceUv(grid, 256, "ordinary")).toThrow("integer grid");
    for (const height of [0, 255, 512, 1024, NaN]) expect(() => nativeTerrainReferenceUv(240, height, "ordinary")).toThrow("dimension 256");
    expect(() => nativeTerrainReferenceUv(240, 256, undefined as never)).toThrow("explicit ordinary or corrected branch");
    expect(() => nativeTerrainReferenceUv(240, 256, "automatic" as never)).toThrow("explicit ordinary or corrected branch");
  });

  it("has 24 bounded, uniquely identified explicit cases without changing the reference byte tolerance", () => {
    expect(terrainUvReferenceCases).toHaveLength(24);
    expect(new Set(terrainUvReferenceCases.map(item => item.fixture.id)).size).toBe(24);
    for (const item of terrainUvReferenceCases) {
      expect(() => validateTerrainLegacyFixture(item.fixture)).not.toThrow();
      expect(item.uvCase.nativeApplicability).toBe("unverified");
      expect(item.fixture.passes[1]!.mask.uvRows[1]).toEqual([0, 0, item.uvCase.expectedCoordinate]);
      expect(item.fixture.passes[1]!.mask.rgba.length).toBe(item.uvCase.maskHeight * 4);
    }
  });

  it("independently samples the actual row bytes and agrees with the fixed nearest/bilinear expectations", () => {
    for (const item of terrainUvReferenceCases) {
      const mask = item.fixture.passes[1]!.mask;
      const texel = item.uvCase.expectedTexelCenter;
      const lowerRow = Math.floor(texel), fraction = texel - lowerRow;
      const actualAlpha = mask.filter === "nearest" ? mask.rgba[Math.floor(texel + .5) * 4 + 3]!
        : mask.rgba[lowerRow * 4 + 3]! * (1 - fraction) + mask.rgba[(lowerRow + 1) * 4 + 3]! * fraction;
      expect(actualAlpha).toBe(item.uvCase.expectedAlphaByte);
      expect(item.expectedRgba).toEqual([255 - actualAlpha, actualAlpha, 0, 255]);
    }
  });

  it("makes both post-threshold branches distinguishable beyond the existing one-byte rounding allowance", () => {
    for (const grid of [240, 241, 255]) for (const size of [512, 1024]) for (const filter of ["nearest", "bilinear"]) {
      const matching = terrainUvReferenceCases.filter(item => item.uvCase.gridY === grid && item.uvCase.maskHeight === size && item.uvCase.filter === filter);
      expect(matching).toHaveLength(2);
      const difference = Math.abs(matching[0]!.expectedRgba[1] - matching[1]!.expectedRgba[1]);
      if (grid === 240) expect(difference).toBe(0);
      else expect(difference).toBeGreaterThan(2);
    }
  });
});
