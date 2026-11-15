import { describe, expect, it } from "vitest";
import { MaterialSwatchParameterError, readMaterialSwatchParameters } from "../browser/harness/materialSwatchParameters";

const materialId = "ab".repeat(32);

describe("readMaterialSwatchParameters", () => {
  it("reads the material id, level seconds, hour and environment type", () => {
    expect(readMaterialSwatchParameters(`?material=${materialId}&levelSeconds=10.5&hour=23.75&environment=3`))
      .toEqual({ materialId, levelSeconds: 10.5, hour: 23.75, environmentType: 3 });
  });

  it.each([
    ["a missing material", "?levelSeconds=0&hour=12&environment=0", /exactly one \?material=/],
    ["a path as material", "?material=..%2Fcatalog&levelSeconds=0&hour=12&environment=0", /not a material program SHA-256/],
    ["a repeated hour", `?material=${materialId}&levelSeconds=0&hour=1&hour=2&environment=0`, /exactly one \?hour=/],
    ["an hour of 24", `?material=${materialId}&levelSeconds=0&hour=24&environment=0`, /outside 0 to 24/],
    ["a negative level time", `?material=${materialId}&levelSeconds=-1&hour=12&environment=0`, /not a non-negative decimal/],
    ["an exponent", `?material=${materialId}&levelSeconds=1e3&hour=12&environment=0`, /not a non-negative decimal/],
    ["a fractional environment", `?material=${materialId}&levelSeconds=0&hour=12&environment=1.5`, /not an environment type index/],
  ])("refuses %s", (_case, search, message) => {
    expect(() => readMaterialSwatchParameters(search)).toThrow(MaterialSwatchParameterError);
    expect(() => readMaterialSwatchParameters(search)).toThrow(message);
  });
});
