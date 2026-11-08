import { describe, expect, it } from "vitest";
import { sourceLayerDiffuseFragmentSource } from "../../src/scene/world/terrainSurfaces";

const twoMaskRuntime = {
  method: "source-layers-v2",
  maskPacking: "opaque-rgb",
  layers: [0, 1, 2, 3].map(layer => ({ layer, file: `layer${layer}.png`, width: 512, height: 512, repeat: [8, 8], offset: [0, 0] })),
  masks: [
    { file: "mask0.png", width: 256, height: 256, channels: [1, 2, null] },
    { file: "mask1.png", width: 128, height: 64, channels: [3, null, null] },
  ],
  samplers: 6,
  samples: [],
};

describe("source layer terrain fragment shader", () => {
  const source = sourceLayerDiffuseFragmentSource(twoMaskRuntime);

  it("never passes a sampler as a function argument, which WebGPU GLSL compilation rejects", () => {
    expect(source).not.toMatch(/\(\s*sampler2D\b/);
    expect(source).not.toMatch(/,\s*sampler2D\b/);
    expect(source).not.toMatch(/sourceMask\w*\(\s*masks\d/);
  });

  it("samples each mask through its own decode-before-interpolation function", () => {
    for (const [maskIndex, size] of [[0, "256.000000000000,256.000000000000"], [1, "128.000000000000,64.000000000000"]] as const) {
      expect(source).toContain(`vec4 sourceMask${maskIndex}(vec2 sourceUV, vec2 size) {`);
      expect(source.match(new RegExp(`texture2D\\(masks${maskIndex}, base`, "g"))).toHaveLength(4);
      expect(source).toContain(`vec4 weights${maskIndex} = sourceMask${maskIndex}(sourceUV, vec2(${size}));`);
    }
  });

  it("blends every later layer with the weight channel its mask assigns", () => {
    expect(source).toContain("weights0.r);");
    expect(source).toContain("weights0.g);");
    expect(source).toContain("weights1.r);");
  });
});
