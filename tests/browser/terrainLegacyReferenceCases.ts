import type { TerrainLegacyFixture, TerrainLegacyPass, TerrainLegacyTexture } from "./terrainLegacyReferenceRenderer";

/** Synthetic discriminators. Expected bytes and one-byte UNORM rounding allowance
 * are fixed before the first browser run; native visual tolerances are separate. */
export const TERRAIN_REFERENCE_BYTE_TOLERANCE = 1;
const rgba = (values: readonly number[], options: Partial<TerrainLegacyTexture> = {}): TerrainLegacyTexture => ({
  width: 1, height: 1, rgba: values, filter: "nearest", address: "clamp", precision: "rgba8",
  uvRows: [[0, 0, .5], [0, 0, .5]], ...options,
});
const pass = (id: string, color: readonly number[], alpha: number, isTransparent = false): TerrainLegacyPass => ({
  id, isTransparent, diffuse: rgba(color), mask: rgba([alpha, alpha, alpha, alpha]),
});
const red = () => pass("retained-layer-4", [255, 0, 0, 255], 255);
const green = (alpha: number, transparent = false, diffuseAlpha = 255) => pass("retained-layer-6", [0, 255, 0, diffuseAlpha], alpha, transparent);
const blue = () => pass("retained-layer-8", [0, 0, 255, 255], 128);

export interface TerrainReferenceCase {
  description: string;
  fixture: TerrainLegacyFixture;
  expectedRgba: readonly [number, number, number, number];
}
const example = (id: string, description: string, passes: TerrainLegacyPass[], expectedRgba: TerrainReferenceCase["expectedRgba"],
  alphaAssumption: TerrainLegacyFixture["alphaAssumption"] = "shared-factors"): TerrainReferenceCase => ({
  description, expectedRgba, fixture: { id, width: 8, height: 8, clearRgba: [0, 255, 255, 255], alphaAssumption, passes },
});
const edge = (values: number[], precision: TerrainLegacyTexture["precision"], filter: TerrainLegacyTexture["filter"],
  u = .5, address: TerrainLegacyTexture["address"] = "clamp"): TerrainLegacyPass => ({
  ...green(255), mask: rgba(values.flatMap(value => [value, value, value, value]), {
    width: 2, precision, filter, address, uvRows: [[0, 0, u], [0, 0, .5]],
  }),
});

export const terrainReferenceCases: readonly TerrainReferenceCase[] = [
  example("first-retained-zero-alpha", "First retained layer replaces the clear color even at alpha zero", [
    pass("retained-layer-6", [255, 0, 0, 0], 0, true), { ...green(0), id: "retained-layer-8" },
  ], [255, 0, 0, 0]),
  example("ordered-shared-alpha", "Physical red / green / blue passes, shared alpha factors", [
    pass("retained-layer-4", [255, 0, 0, 255], 64), green(128), blue(),
  ], [63, 64, 128, 112]),
  example("ordered-separate-alpha", "Same RGB, explicitly separate source-over alpha", [
    pass("retained-layer-4", [255, 0, 0, 255], 64), green(128), blue(),
  ], [63, 64, 128, 208], "separate-source-over"),
  example("reversed-order", "Swapping overlays changes their contributions", [red(), blue(), green(128)], [63, 128, 64, 159]),
  example("unequal-mask-channels", "Mask alpha 64; red 255 must not become the weight", [red(), {
    ...green(64), mask: rgba([255, 0, 63, 64]),
  }], [191, 64, 0, 207]),
  example("diffuse-alpha-flagged", "Transparent predicate multiplies two sampled alpha values", [red(), green(128, true, 128)], [191, 64, 0, 207]),
  example("diffuse-alpha-unflagged", "Opaque predicate ignores diffuse alpha", [red(), green(128, false, 128)], [127, 128, 0, 191]),
  example("flagged-zero-diffuse", "Zero diffuse alpha discards a flagged overlay", [red(), green(255, true, 0)], [255, 0, 0, 255]),
  example("unflagged-zero-diffuse", "Zero diffuse alpha does not discard an unflagged overlay", [red(), green(255, false, 0)], [0, 255, 0, 255]),
  example("rgba8-alpha-15", "RGBA8 retains alpha byte 15", [red(), green(15)], [240, 15, 0, 241]),
  example("rgba4-alpha-15", "Conditional high-nibble upload maps 15 to zero", [red(), {
    ...green(15), mask: rgba([15, 15, 15, 15], { precision: "rgba4-high-nibble" }),
  }], [255, 0, 0, 255]),
  example("rgba4-alpha-16", "Conditional high-nibble upload maps 16 to normalized 1/15", [red(), {
    ...green(16), mask: rgba([16, 16, 16, 16], { precision: "rgba4-high-nibble" }),
  }], [238, 17, 0, 239]),
  example("rgba4-before-filter", "Quantize 15/16 before filtering: midpoint alpha about 8.5/255", [red(),
    edge([15, 16], "rgba4-high-nibble", "bilinear"),
  ], [247, 9, 0, 247]),
  example("rgba8-before-filter", "RGBA8 control keeps the 15/16 midpoint", [red(), edge([15, 16], "rgba8", "bilinear")], [240, 16, 0, 240]),
  example("nearest-edge", "Nearest selects the second texel at explicit u=0.5", [red(), edge([0, 255], "rgba8", "nearest")], [0, 255, 0, 255]),
  example("bilinear-edge", "Bilinear mixes the two texels at the same coordinate", [red(), edge([0, 255], "rgba8", "bilinear")], [128, 128, 0, 191]),
  example("clamped-negative-uv", "Explicit clamp at u=-0.25 selects the first texel", [red(), edge([0, 255], "rgba8", "nearest", -.25)], [255, 0, 0, 255]),
  example("repeated-negative-uv", "Explicit repeat at u=-0.25 selects the second texel", [red(), edge([0, 255], "rgba8", "nearest", -.25, "repeat")], [0, 255, 0, 255]),
  example("sample-before-product", "Two filtered masks give RGB 1/4,1/4,1/2; cached final weights differ", [red(),
    edge([0, 255], "rgba8", "bilinear"), { ...edge([0, 255], "rgba8", "bilinear"), id: "retained-layer-8", diffuse: rgba([0, 0, 255, 255]) },
  ], [64, 64, 128, 159]),
  example("opaque-white-is-255", "Ordinary opaque white remains 255, never the CPU classification scalar 249", [red(), green(255)], [0, 255, 0, 255]),
];
