import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MaterialProgramError, maximumTextureImageBytes, parseMaterialProgram } from "../../src/materials/ue2/model/materialProgram";
import { compileMaterialStagePlan } from "../../src/materials/ue2/model/stagePlan";

const texturedProgramFixturePath = "tests/fixtures/material-programs/textured-program.json";
const materialProgramPythonPath = "scripts/native_assets_lib/material_program.py";
const textureNodeId = "SyntheticMaterials.SkyTexture";
const pannerNodeId = "SyntheticMaterials.SkyPanner";

type JsonObject = Record<string, unknown>;

function texturedProgramDocument(): JsonObject {
  return JSON.parse(readFileSync(texturedProgramFixturePath, "utf-8")) as JsonObject;
}

function withTextureNode(document: JsonObject, replaceTextureNode: (node: JsonObject) => JsonObject): JsonObject {
  const nodes = document.nodes as JsonObject[];
  return { ...document, nodes: nodes.map(node => node.id === textureNodeId ? replaceTextureNode(node) : node) };
}

function pythonIntegerConstant(source: string, name: string): number {
  const match = new RegExp(`^${name} = (\\d+)$`, "m").exec(source);
  if (!match) throw new Error(`${materialProgramPythonPath} has no ${name} integer constant.`);
  return Number(match[1]);
}

describe("texture image pins the pipeline writes into program.json", () => {
  it("parses the pipeline fixture with the image on the Texture node only", () => {
    const program = parseMaterialProgram(texturedProgramDocument());
    const imagesByNode = Object.fromEntries(program.nodes.map(node => [node.id, node.image]));
    expect(imagesByNode[pannerNodeId]).toBeNull();
    expect(imagesByNode[textureNodeId]).toMatchObject({ path: expect.stringMatching(/^\/l2\//), bytes: expect.any(Number) });
  });

  it("compiles the pinned Texture node to one sampler whose frame image is the pin", () => {
    const document = texturedProgramDocument();
    const pinnedImage = (document.nodes as JsonObject[]).find(node => node.id === textureNodeId)!.image;
    const plan = compileMaterialStagePlan(parseMaterialProgram(document));
    expect(plan.status).toBe("compiled");
    if (plan.status !== "compiled") return;
    expect(plan.samplers).toHaveLength(1);
    expect(plan.samplers[0]).toMatchObject({ textureNode: textureNodeId, frameNodes: [textureNodeId], frameImages: [pinnedImage],
      textureCoordinateModifiers: [pannerNodeId] });
  });

  it("names the Texture node texture-image-absent when the same program carries no pin", () => {
    const unpinned = withTextureNode(texturedProgramDocument(), node => ({ ...node, image: null }));
    expect(compileMaterialStagePlan(parseMaterialProgram(unpinned))).toMatchObject({ status: "diagnostic", reasons: [`texture-image-absent:${textureNodeId}`] });
  });

  it("uses the same texture image byte limit as the Python pin guard", () => {
    const pythonSource = readFileSync(materialProgramPythonPath, "utf-8");
    expect(maximumTextureImageBytes).toBe(pythonIntegerConstant(pythonSource, "MAXIMUM_TEXTURE_IMAGE_BYTES"));
    const withImageBytes = (bytes: number) => withTextureNode(texturedProgramDocument(), node => ({ ...node, image: { ...(node.image as JsonObject), bytes } }));
    const atLimit = parseMaterialProgram(withImageBytes(maximumTextureImageBytes));
    expect(atLimit.nodes.find(node => node.id === textureNodeId)?.image?.bytes).toBe(maximumTextureImageBytes);
    expect(() => parseMaterialProgram(withImageBytes(maximumTextureImageBytes + 1))).toThrow(MaterialProgramError);
  });
});
