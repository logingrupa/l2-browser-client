import { describe, expect, it } from "vitest";
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

function combinerNode(id: string, colourOperation: number, inputs: { material1?: string; material2?: string; mask?: string }, extraFields: FixtureProgramField[] = []) {
  return reviewedNode(id, "Engine.Combiner", [
    field("CombineOperation", enumValue(colourOperation, `CO_${colourOperation}`)), field("AlphaOperation", enumValue(3, "AO_Use_Alpha_From_Material1")),
    field("Material1", inputs.material1 === undefined ? null : nodeReference(inputs.material1), inputs.material1 === undefined ? "ue-zero" : "authored"),
    field("Material2", inputs.material2 === undefined ? null : nodeReference(inputs.material2), inputs.material2 === undefined ? "ue-zero" : "authored"),
    field("Mask", inputs.mask === undefined ? null : nodeReference(inputs.mask), inputs.mask === undefined ? "ue-zero" : "authored"),
    ...extraFields,
  ]);
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
