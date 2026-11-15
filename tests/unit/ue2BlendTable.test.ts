import { describe, expect, it } from "vitest";
import { blendFactorsForMaterial, blendFactorsForParticleDrawStyle } from "../../src/materials/ue2/model/blendTable";
import { MATERIAL_CONSTANT_TABLES } from "../../src/materials/ue2/model/constants/materialConstants";
import { parseMaterialProgram } from "../../src/materials/ue2/model/materialProgram";
import type { ReferenceConstantStatus } from "../../src/shared/referenceConstant";
import {
  enumValue, field, nodeReference, programOf, reviewedNode, swatchTextureNode, swatchTexturePng, textureImageFor, type FixtureProgramField,
} from "../support/materialProgramFixture";

const image = textureImageFor(swatchTexturePng());
const sharedStatuses: readonly ReferenceConstantStatus[] = ["ue2-data", "unconfirmed", "confirmed-interlude", "corrected-interlude", "unknown"];

function finalBlend(ordinal: number, extra: FixtureProgramField[] = []) {
  return parseMaterialProgram(JSON.parse(JSON.stringify(programOf("Synthetic.FinalBlend", [
    reviewedNode("Synthetic.FinalBlend", "Engine.FinalBlend", [field("Material", nodeReference("Synthetic.Texture")), field("FrameBufferBlending", enumValue(ordinal, `FB_${ordinal}`)), ...extra]),
    swatchTextureNode("Synthetic.Texture", image),
  ]))));
}

function shader(ordinal: number, withOpacity = false) {
  return parseMaterialProgram(JSON.parse(JSON.stringify(programOf("Synthetic.Shader", [
    reviewedNode("Synthetic.Shader", "Engine.Shader", [field("Diffuse", nodeReference("Synthetic.Texture")),
      field("Opacity", withOpacity ? nodeReference("Synthetic.Texture") : null), field("OutputBlending", enumValue(ordinal, `OB_${ordinal}`))]),
    swatchTextureNode("Synthetic.Texture", image),
  ]))));
}

describe("FinalBlend rows", () => {
  it.each([
    [0, "one", "zero", "fog-colour", true],
    [1, "destination-colour", "source-colour", "neutral-grey", false],
    [2, "source-alpha", "inverse-source-alpha", "fog-colour", false],
    [3, "one", "inverse-source-alpha", "black", false],
    [4, "one", "inverse-source-colour", "black", false],
    [5, "zero", "inverse-source-colour", "black", false],
    [6, "source-alpha", "one", "black", false],
    [7, "zero", "one", "black", false],
  ])("FrameBufferBlending %i maps to %s, %s with fog family %s", (ordinal, source, destination, fogFamily, depthWrite) => {
    expect(blendFactorsForMaterial(finalBlend(ordinal))).toMatchObject({ status: "resolved", pair: { source, destination }, fogFamily, depthWrite, colourWrite: ordinal !== 7 });
  });

  it("keeps FB_Add a named diagnostic until its factors are confirmed", () => {
    expect(blendFactorsForMaterial(finalBlend(8))).toEqual({ status: "diagnostic", sourceNode: "Synthetic.FinalBlend", reason: "material-feature-unported:FrameBufferBlending" });
    expect(blendFactorsForMaterial(finalBlend(9))).toMatchObject({ status: "diagnostic", reason: "material-blend-ordinal-unknown:FrameBufferBlending=9" });
  });

  it("lets an authored ZWrite override the depth rule and ZTest false disable depth testing", () => {
    expect(blendFactorsForMaterial(finalBlend(4, [field("ZWrite", true), field("ZTest", false)]))).toMatchObject({ depthWrite: true, depthTest: false });
  });
});

describe("Shader OutputBlending rows", () => {
  it.each([
    [0, "one", "zero", true, "blend.ob-pairs"],
    [1, "one", "zero", true, "blend.ob-pairs"],
    [2, "destination-colour", "source-colour", false, "blend.ob-pairs"],
    [3, "one", "one", false, "blend.ob-brighten-translucent"],
    [4, "zero", "one", false, "blend.ob-pairs"],
    [5, "one", "inverse-source-colour", false, "blend.ob-brighten-translucent"],
    [6, "zero", "inverse-source-colour", false, "blend.ob-pairs"],
  ])("OutputBlending %i maps to %s, %s", (ordinal, source, destination, depthWrite, constantId) => {
    const blend = blendFactorsForMaterial(shader(ordinal));
    expect(blend).toMatchObject({ status: "resolved", pair: { source, destination }, depthWrite });
    expect(blend.status === "resolved" && blend.constantIds).toContain(constantId);
  });

  it("blends OB_Normal with an Opacity input by source alpha and alpha-tests OB_Masked at 127", () => {
    expect(blendFactorsForMaterial(shader(0, true))).toMatchObject({ pair: { source: "source-alpha", destination: "inverse-source-alpha" }, depthWrite: false });
    expect(blendFactorsForMaterial(shader(1))).toMatchObject({ alphaTest: true, alphaReference: 127, depthWrite: true });
  });
});

describe("particle draw style rows", () => {
  it.each([
    [0, "one", "zero"],
    [1, "source-alpha", "inverse-source-alpha"],
    [2, "destination-colour", "source-colour"],
    [4, "one", "inverse-source-alpha"],
    [5, "zero", "inverse-source-colour"],
  ])("draw style %i maps to %s, %s and keeps destination alpha", (drawStyle, source, destination) => {
    expect(blendFactorsForParticleDrawStyle(drawStyle)).toMatchObject({ pair: { source, destination }, alphaPair: { source: "zero", destination: "one" } });
  });

  it("keeps the shipped PTDS 3 and 6 pairs until a swatch comparison is recorded", () => {
    expect(blendFactorsForParticleDrawStyle(3)).toMatchObject({ pair: { source: "one", destination: "inverse-source-colour" }, referencePair: { source: "one", destination: "one" } });
    expect(blendFactorsForParticleDrawStyle(6)).toMatchObject({ pair: { source: "one", destination: "one" }, referencePair: { source: "one", destination: "inverse-source-colour" } });
    expect(MATERIAL_CONSTANT_TABLES.blend.particleDrawStylePairs.status).toBe("unconfirmed");
    expect(() => blendFactorsForParticleDrawStyle(7)).toThrow(RangeError);
  });
});

describe("material constants rows", () => {
  const rows = Object.values(MATERIAL_CONSTANT_TABLES).flatMap(table => Object.values(table));

  it("give every row an id, a provenance and a status from the shared vocabulary", () => {
    expect(rows.length).toBeGreaterThan(30);
    for (const row of rows) {
      expect(row.id).toMatch(/^[a-z]+(?:\.[a-z0-9-]+)+$/);
      expect(row.provenance.length).toBeGreaterThan(20);
      expect(sharedStatuses).toContain(row.status);
      expect(row).toHaveProperty("runtimeDefault");
    }
    expect(new Set(rows.map(row => row.id)).size).toBe(rows.length);
  });

  it("keep every reference factor unconfirmed and cite NATIVE_FLAMES for the Interlude OB_Brighten and OB_Translucent pairs", () => {
    const blendRows = Object.values(MATERIAL_CONSTANT_TABLES.blend);
    for (const row of blendRows.filter(row => row.id !== "blend.ob-brighten-translucent" && row.id !== "blend.enum-ordinals" && row.id !== "blend.non-blending-root")) {
      expect(row.status).toBe("unconfirmed");
    }
    expect(MATERIAL_CONSTANT_TABLES.blend.outputBlendingInterludePairs.provenance).toContain("docs/NATIVE_FLAMES.md:9");
  });
});
