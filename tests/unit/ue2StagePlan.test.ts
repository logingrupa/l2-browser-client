import { describe, expect, it } from "vitest";
import { COMBINER_CONSTANTS } from "../../src/materials/ue2/model/constants/combinerConstants";
import { parseMaterialProgram } from "../../src/materials/ue2/model/materialProgram";
import { compileMaterialStagePlan } from "../../src/materials/ue2/model/stagePlan";
import {
  enumValue, field, nodeReference, programOf, reviewedNode, swatchTextureNode, swatchTexturePng, textureImageFor,
  type FixtureProgramField, type FixtureProgramNode,
} from "../support/materialProgramFixture";

const image = textureImageFor(swatchTexturePng());
const textureId = "Synthetic.Texture";

function stagePlanOf(root: string, nodes: FixtureProgramNode[]) {
  return compileMaterialStagePlan(parseMaterialProgram(JSON.parse(JSON.stringify(programOf(root, nodes)))));
}

function referenceField(name: string, nodeId: string | undefined): FixtureProgramField {
  return nodeId === undefined ? field(name, null, "ue-zero") : field(name, nodeReference(nodeId));
}

function combinerNode(id: string, colourOperation: number, inputs: { material1?: string; material2?: string; mask?: string }) {
  return reviewedNode(id, "Engine.Combiner", [
    field("CombineOperation", enumValue(colourOperation, `CO_${colourOperation}`)), field("AlphaOperation", enumValue(3, "AO_Use_Alpha_From_Material1")),
    referenceField("Material1", inputs.material1), referenceField("Material2", inputs.material2), referenceField("Mask", inputs.mask),
  ]);
}

function withField(node: FixtureProgramNode, replacement: FixtureProgramField): FixtureProgramNode {
  return { ...node, fields: node.fields.map(nodeField => nodeField.field === replacement.field ? replacement : nodeField) };
}

describe("compileMaterialStagePlan graph walk", () => {
  it("names a Combiner that reaches itself through one input as a graph cycle", () => {
    const plan = stagePlanOf("Synthetic.Loop", [combinerNode("Synthetic.Loop", 0, { material1: "Synthetic.Loop", material2: textureId }), swatchTextureNode(textureId, image)]);
    expect(plan).toMatchObject({ status: "diagnostic", reasons: ["material-graph-cycle:Synthetic.Loop"] });
  });

  it("names a Combiner that reaches itself through both inputs as a graph cycle", () => {
    const plan = stagePlanOf("Synthetic.Loop", [combinerNode("Synthetic.Loop", 0, { material1: "Synthetic.Loop", material2: "Synthetic.Loop" })]);
    expect(plan).toMatchObject({ status: "diagnostic", reasons: ["material-graph-cycle:Synthetic.Loop"] });
  });

  it("compiles a chain of Combiners that each read the next one twice into one sampler", () => {
    const chainLength = 48;
    const nodeIdAt = (index: number) => index === chainLength ? textureId : `Synthetic.Combiner${index}`;
    const combiners = Array.from({ length: chainLength }, (_, index) => combinerNode(nodeIdAt(index), 2, { material1: nodeIdAt(index + 1), material2: nodeIdAt(index + 1) }));
    const plan = stagePlanOf(nodeIdAt(0), [...combiners, swatchTextureNode(textureId, image)]);
    expect(plan.status).toBe("compiled");
    expect(plan.status === "compiled" && plan.samplers.map(sampler => sampler.textureNode)).toEqual([textureId]);
  });
});

describe("compileMaterialStagePlan colour sources", () => {
  const fadeNode = (fadePeriod: number, colorFadeType: FixtureProgramField) => reviewedNode("Synthetic.Fade", "Engine.FadeColor", [
    field("FadePeriod", fadePeriod), field("FadePhase", 0, "ue-zero"), colorFadeType]);

  it("compiles a FadeColor with a positive FadePeriod and a reviewed ColorFadeType", () => {
    expect(stagePlanOf("Synthetic.Fade", [fadeNode(0.4, field("ColorFadeType", enumValue(1, "FC_Sinusoidal")))]).status).toBe("compiled");
  });

  it("names a FadeColor whose FadePeriod is not positive instead of compiling it", () => {
    expect(stagePlanOf("Synthetic.Fade", [fadeNode(0, field("ColorFadeType", enumValue(1, "FC_Sinusoidal")))]))
      .toMatchObject({ status: "diagnostic", reasons: ["material-feature-unported:FadePeriod"] });
  });

  it("names a FadeColor whose ColorFadeType is unset instead of compiling it", () => {
    expect(stagePlanOf("Synthetic.Fade", [fadeNode(0.4, field("ColorFadeType", null, "ue-zero"))]))
      .toMatchObject({ status: "diagnostic", reasons: ["material-feature-unported:ColorFadeType"] });
  });
});

describe("compileMaterialStagePlan absent inputs", () => {
  it("names a Shader with no Diffuse instead of drawing it white", () => {
    const shader = reviewedNode("Synthetic.Shader", "Engine.Shader", [
      field("Diffuse", null, "ue-zero"), field("Opacity", null, "ue-zero"), field("OutputBlending", enumValue(0, "OB_Normal"), "ue-zero")]);
    expect(stagePlanOf("Synthetic.Shader", [shader])).toMatchObject({ status: "diagnostic", reasons: ["material-reference-absent:Synthetic.Shader.Diffuse"] });
  });

  it("reads an absent Combiner Material as the white of the unconfirmed combiner.absent-material row", () => {
    const plan = stagePlanOf("Synthetic.Combiner", [combinerNode("Synthetic.Combiner", 3, { material1: textureId }), swatchTextureNode(textureId, image)]);
    expect(COMBINER_CONSTANTS.absentMaterial).toMatchObject({ id: "combiner.absent-material", status: "unconfirmed", runtimeDefault: "white" });
    expect(plan.status === "compiled" && plan.expression).toMatchObject({
      kind: "combiner", material1: { kind: "texture", samplerIndex: 0 }, material2: { kind: COMBINER_CONSTANTS.absentMaterial.runtimeDefault } });
  });
});

describe("compileMaterialStagePlan diagnostics", () => {
  const animatedTexture = (id: string, animationNext: FixtureProgramField["value"]) => withField(swatchTextureNode(id, image), field("AnimNext", animationNext));

  it.each([
    ["an AnimNext chain that loops back to a middle frame", "Synthetic.Frame0", [
      animatedTexture("Synthetic.Frame0", nodeReference("Synthetic.Frame1")), animatedTexture("Synthetic.Frame1", nodeReference("Synthetic.Frame1"))],
    "texture-animation-chain-unclosed:Synthetic.Frame0"],
    ["an AnimNext that names an object outside the program", "Synthetic.Frame0", [animatedTexture("Synthetic.Frame0", { externalObject: "Engine.ExternalFrame" })],
      "material-reference-external:Engine.ExternalFrame"],
    ["an AnimNext frame that is not a reviewed Texture", "Synthetic.Frame0", [
      animatedTexture("Synthetic.Frame0", nodeReference("Synthetic.Constant")), reviewedNode("Synthetic.Constant", "Engine.ConstantColor", [])],
    "texture-animation-frame-unreviewed:Synthetic.Constant"],
    ["a Texture without an image", textureId, [reviewedNode(textureId, "Engine.Texture", [field("AnimNext", null, "ue-zero")])], `texture-image-absent:${textureId}`],
    ["a Combiner input that names an object outside the program", "Synthetic.Combiner", [
      withField(combinerNode("Synthetic.Combiner", 0, {}), field("Material1", { externalObject: "Engine.ExternalMaterial" }))],
    "material-reference-external:Engine.ExternalMaterial"],
    ["a MaterialSequence whose SequenceItems are not typed", "Synthetic.Sequence", [reviewedNode("Synthetic.Sequence", "Engine.MaterialSequence", [field("Loop", true, "class-default")])],
      "material-sequence-items-untyped:Synthetic.Sequence"],
    ["a Combiner CombineOperation past the last ordinal", "Synthetic.Combiner", [combinerNode("Synthetic.Combiner", 8, { material1: textureId }), swatchTextureNode(textureId, image)],
      "material-combiner-operation-unknown:CombineOperation=8"],
  ])("names %s", (_, root, nodes, reason) => {
    expect(stagePlanOf(root, nodes)).toMatchObject({ status: "diagnostic", reasons: [reason] });
  });

  it("names a Combiner AlphaOperation past the last ordinal", () => {
    const unknownAlpha = withField(combinerNode("Synthetic.Combiner", 0, { material1: textureId }), field("AlphaOperation", enumValue(5, "AO_5")));
    expect(stagePlanOf("Synthetic.Combiner", [unknownAlpha, swatchTextureNode(textureId, image)]))
      .toMatchObject({ status: "diagnostic", reasons: ["material-combiner-operation-unknown:AlphaOperation=5"] });
  });

  it.each([5, 6, 7])("names a Combiner whose CombineOperation %i reads a Mask it does not have", colourOperation => {
    const plan = stagePlanOf("Synthetic.Combiner", [combinerNode("Synthetic.Combiner", colourOperation, { material1: textureId, material2: textureId }), swatchTextureNode(textureId, image)]);
    expect(plan).toMatchObject({ status: "diagnostic", reasons: ["material-combiner-mask-absent:Synthetic.Combiner"] });
  });

  it("names a graph deeper than the compile depth limit", () => {
    const chainLength = 66;
    const nodeIdAt = (index: number) => index === chainLength ? textureId : `Synthetic.Combiner${index}`;
    const combiners = Array.from({ length: chainLength }, (_, index) => combinerNode(nodeIdAt(index), 0, { material1: nodeIdAt(index + 1) }));
    expect(stagePlanOf(nodeIdAt(0), [...combiners, swatchTextureNode(textureId, image)]))
      .toMatchObject({ status: "diagnostic", reasons: ["material-graph-depth-exceeds:64"] });
  });

  it("names a modifier chain that never reaches a blending node before the graph cycle", () => {
    const panner = reviewedNode("Synthetic.Panner", "Engine.TexPanner", [field("Material", nodeReference("Synthetic.Panner")), field("PanRate", 0.25)]);
    expect(stagePlanOf("Synthetic.Panner", [panner]))
      .toMatchObject({ status: "diagnostic", reasons: ["material-modifier-chain-exceeds:128", "material-graph-cycle:Synthetic.Panner"] });
  });
});
