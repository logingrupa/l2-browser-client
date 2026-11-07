import { describe, expect, it } from "vitest";
import { prepareTerrainReferenceTexture, validateTerrainLegacyFixture,
  type TerrainLegacyFixture, type TerrainLegacyTexture } from "../browser/terrainLegacyReferenceRenderer";

function texture(rgba: readonly number[], precision: TerrainLegacyTexture["precision"] = "rgba8"): TerrainLegacyTexture {
  return { width: rgba.length / 4, height: 1, rgba, precision, filter: "nearest", address: "clamp", uvRows: [[0, 0, .5], [0, 0, .5]] };
}
function fixture(): TerrainLegacyFixture {
  return { id: "retained-layer-fixture", width: 1, height: 1, clearRgba: [9, 8, 7, 6], alphaAssumption: "shared-factors",
    passes: [{ id: "authored-layer-7", isTransparent: false, diffuse: texture([255, 0, 0, 255]), mask: texture([0, 19, 31, 0]) }] };
}

describe("explicit terrain reference upload and input boundaries", () => {
  it("packs high nibbles into actual WebGL RGBA4444 channel order without changing retained bytes", () => {
    const source = [0, 15, 16, 255, 255, 128, 127, 31, 16, 32, 48, 64, 255, 255, 255, 255];
    const before = [...source];
    const data = prepareTerrainReferenceTexture(texture(source, "rgba4-high-nibble"));
    expect(data).toBeInstanceOf(Uint16Array);
    expect([...data]).toEqual([0x001f, 0xf871, 0x1234, 0xffff]);
    expect(source).toEqual(before);
  });

  it("keeps the RGBA8 control and RGB beneath alpha zero exactly, with an independent upload copy", () => {
    const source = [255, 127, 19, 0, 3, 15, 16, 17];
    const data = prepareTerrainReferenceTexture(texture(source));
    expect(data).toBeInstanceOf(Uint8Array);
    expect([...data]).toEqual(source);
    data[0] = 0;
    expect(source[0]).toBe(255);
  });

  it("keeps threshold alpha 15 below the first RGBA4 step while alpha 16 reaches it", () => {
    const data = prepareTerrainReferenceTexture(texture([255, 255, 255, 15, 255, 255, 255, 16], "rgba4-high-nibble"));
    expect([...data]).toEqual([0xfff0, 0xfff1]);
  });

  it("accepts an explicitly retained nonzero layer and unequal mask channels without inventing pruning", () => {
    const input = fixture(), before = structuredClone(input);
    expect(() => validateTerrainLegacyFixture(input)).not.toThrow();
    expect(input).toEqual(before);
  });

  it("requires an alpha model, predicate, sampler and UV transform instead of silent defaults", () => {
    const missingAlpha = fixture();
    Reflect.deleteProperty(missingAlpha, "alphaAssumption");
    expect(() => validateTerrainLegacyFixture(missingAlpha)).toThrow("alpha assumption");
    const missingPredicate = fixture();
    Reflect.deleteProperty(missingPredicate.passes[0]!, "isTransparent");
    expect(() => validateTerrainLegacyFixture(missingPredicate)).toThrow("IsTransparent");
    for (const field of ["uvRows", "filter", "address", "precision"] as const) {
      const input = fixture(); Reflect.deleteProperty(input.passes[0]!.mask, field);
      expect(() => validateTerrainLegacyFixture(input)).toThrow("sampler, precision and UV");
    }
  });

  it("rejects duplicate pass identities, malformed channels and nonfinite or unbounded input", () => {
    const duplicate = fixture(); duplicate.passes = [duplicate.passes[0]!, duplicate.passes[0]!];
    expect(() => validateTerrainLegacyFixture(duplicate)).toThrow("unique retained identity");
    for (const values of [[256, 0, 0, 255], [-1, 0, 0, 255], [.5, 0, 0, 255]]) {
      expect(() => prepareTerrainReferenceTexture(texture(values))).toThrow("RGBA byte data");
    }
    expect(() => prepareTerrainReferenceTexture({ ...texture([0, 0, 0, 0]), width: 1025 })).toThrow("bounded dimensions");
    expect(() => prepareTerrainReferenceTexture({ ...texture([0, 0, 0, 0]), uvRows: [[NaN, 0, 0], [0, 1, 0]] })).toThrow("UV rows");
    expect(() => validateTerrainLegacyFixture({ ...fixture(), width: 257 })).toThrow("bounded target");
    expect(() => validateTerrainLegacyFixture({ ...fixture(), passes: [] })).toThrow("retained passes");
  });
});
