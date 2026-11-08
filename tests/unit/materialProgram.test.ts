import { readFileSync } from "node:fs";
import { Constants } from "@babylonjs/core/Engines/constants";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, describe, expect, it } from "vitest";
import { createNativeMaterial } from "../../src/materials/ue2/babylon/material";
import { nativeMaterialProgramPath, type LoadedNativeMaterial } from "../../src/materials/ue2/babylon/loadNativeMaterial";
import { blendFactorsForMaterial } from "../../src/materials/ue2/model/blendTable";
import { readRotatorField } from "../../src/materials/ue2/model/materialFieldValues";
import { MaterialProgramError, parseMaterialProgram, programNode } from "../../src/materials/ue2/model/materialProgram";
import { compileMaterialStagePlan } from "../../src/materials/ue2/model/stagePlan";
import {
  enumValue, field, materialSwatchFixtureFiles, nodeReference, programOf, rawStruct, reviewedNode, sha256Hex, swatchTextureNode,
  syntheticSwatchProgram, syntheticUnportedProgram, textureImageFor, swatchTexturePng, type FixtureProgram,
} from "../support/materialProgramFixture";

const fixtureStoreRoot = new URL("../fixtures/lane-store/", import.meta.url);
const swatchImage = textureImageFor(swatchTexturePng());
const scenes: Scene[] = [];

function parsed(program: FixtureProgram) {
  return parseMaterialProgram(JSON.parse(JSON.stringify(program)));
}

function loadedMaterial(program: FixtureProgram): LoadedNativeMaterial {
  const parsedProgram = parsed(program);
  const pixels = { width: 4, height: 4, rgba: new Uint8Array(64).fill(255) };
  return { materialId: "ab".repeat(32), program: parsedProgram, plan: compileMaterialStagePlan(parsedProgram), texturePixels: new Map([[swatchImage.sha256, pixels]]) };
}

function nullScene(): Scene {
  const scene = new Scene(new NullEngine());
  scenes.push(scene);
  return scene;
}

afterEach(() => {
  for (const scene of scenes.splice(0)) {
    const engine = scene.getEngine();
    scene.dispose();
    engine.dispose();
  }
});

describe("parseMaterialProgram", () => {
  it("reads a synthetic FinalBlend over a Shader with a Diffuse texture and keeps each field's provenance", () => {
    const program = parsed(syntheticSwatchProgram(swatchImage));
    expect(program.root).toBe("SyntheticSwatch.SwatchFinalBlend");
    expect(program.nodes.map(node => node.class)).toEqual(["Engine.FinalBlend", "Engine.Shader", "Engine.Texture"]);
    const shader = programNode(program, "SyntheticSwatch.SwatchShader");
    expect(shader.fields.map(programField => [programField.field, programField.provenance])).toEqual([
      ["Diffuse", "authored"], ["Opacity", "ue-zero"], ["OutputBlending", "ue-zero"], ["TwoSided", "ue-zero"], ["DetailScale", "class-default"],
    ]);
    expect(programNode(program, "SyntheticSwatch.SwatchTexture").image).toEqual(swatchImage);
  });

  it("rejects a reviewed node of an unknown class", () => {
    const program = syntheticSwatchProgram(swatchImage);
    program.nodes[1]!.class = "Engine.UnknownMaterial";
    expect(() => parsed(program)).toThrow(MaterialProgramError);
    expect(() => parsed(program)).toThrow(/reviewed but its class Engine\.UnknownMaterial is unknown/);
  });

  it("rejects a field without provenance", () => {
    const program = syntheticSwatchProgram(swatchImage) as unknown as { nodes: { fields: Record<string, unknown>[] }[] };
    delete program.nodes[0]!.fields[0]!.provenance;
    expect(() => parseMaterialProgram(program)).toThrow(/\(Material\) has no provenance/);
  });

  it("rejects a texture reference that is not a SHA-256", () => {
    const program = syntheticSwatchProgram({ ...swatchImage, sha256: "texture.png" });
    expect(() => parsed(program)).toThrow(/is not a SHA-256 texture reference/);
  });

  it("rejects a reference to a node the program does not hold and an unported node without its reason", () => {
    const dangling = syntheticSwatchProgram(swatchImage);
    dangling.nodes[1]!.fields[0] = field("Diffuse", nodeReference("SyntheticSwatch.Missing"));
    expect(() => parsed(dangling)).toThrow(/references SyntheticSwatch\.Missing/);
    const unported = syntheticUnportedProgram();
    unported.nodes[0]!.gapReasons = [];
    expect(() => parsed(unported)).toThrow(/unported without material-class-unported:Engine\.TexOscillatorTriggered/);
  });

  it("decodes a raw Rotator struct as the converter writes it", () => {
    const program = parsed(programOf("Synthetic.Panner", [
      reviewedNode("Synthetic.Panner", "Engine.TexPanner", [
        field("Material", nodeReference("Synthetic.Texture")), field("PanRate", 0.25),
        field("PanDirection", rawStruct("Rotator", "000000000040000000000000"), "authored", "raw"),
      ]),
      swatchTextureNode("Synthetic.Texture", swatchImage),
    ]));
    expect(readRotatorField(programNode(program, "Synthetic.Panner"), "PanDirection")).toEqual({ pitch: 0, yaw: 16384, roll: 0 });
  });
});

describe("the fixture lane store material programs", () => {
  it("equal the synthetic fixture writer and are named by their SHA-256", () => {
    const fixture = materialSwatchFixtureFiles();
    for (const file of fixture.files) {
      const committed = new Uint8Array(readFileSync(new URL(`.${file.storePath}`, fixtureStoreRoot)));
      expect(sha256Hex(committed)).toBe(sha256Hex(file.bytes));
    }
    expect(nativeMaterialProgramPath(fixture.swatchMaterialId)).toBe(`/l2/native-materials/${fixture.swatchMaterialId}/program.json`);
    expect(() => nativeMaterialProgramPath("../catalog")).toThrow(/is not a program SHA-256/);
  });
});

describe("createNativeMaterial", () => {
  it("builds a ShaderMaterial whose blend state equals blendFactorsForMaterial for the program", () => {
    const loaded = loadedMaterial(syntheticSwatchProgram(swatchImage));
    const blend = blendFactorsForMaterial(loaded.program);
    expect(blend).toMatchObject({ status: "resolved", source: "final-blend", pair: { source: "one", destination: "zero" }, depthWrite: true, fogFamily: "fog-colour" });
    const nativeMaterial = createNativeMaterial(nullScene(), loaded);
    const inspection = nativeMaterial.inspect();
    expect(inspection.status).toBe("compiled");
    expect(inspection.blend).toMatchObject({ pair: blend.status === "resolved" ? blend.pair : null, babylonAlphaMode: "ALPHA_DISABLE" });
    expect(nativeMaterial.material.getClassName()).toBe("ShaderMaterial");
    expect(nativeMaterial.material.alphaMode).toBe(Constants.ALPHA_DISABLE);
    expect(nativeMaterial.material.disableDepthWrite).toBe(false);
    nativeMaterial.dispose();
  });

  it("maps an OB_Brighten shader to the Interlude screen pair", () => {
    const program = syntheticSwatchProgram(swatchImage);
    program.root = "SyntheticSwatch.SwatchShader";
    program.nodes[1]!.fields[2] = field("OutputBlending", enumValue(5, "OB_Brighten"));
    const nativeMaterial = createNativeMaterial(nullScene(), loadedMaterial(program));
    expect(nativeMaterial.inspect().blend).toMatchObject({ pair: { source: "one", destination: "inverse-source-colour" }, babylonAlphaMode: "ALPHA_SCREENMODE", depthWrite: false });
    expect(nativeMaterial.material.alphaMode).toBe(Constants.ALPHA_SCREENMODE);
  });

  it("renders an unported class as the named magenta diagnostic", () => {
    const nativeMaterial = createNativeMaterial(nullScene(), loadedMaterial(syntheticUnportedProgram()));
    expect(nativeMaterial.inspect()).toMatchObject({ status: "diagnostic", unportedClass: "Engine.TexOscillatorTriggered",
      reasons: expect.arrayContaining(["material-class-unported:Engine.TexOscillatorTriggered"]) });
  });

  it("renders a Modulate pair Babylon has no preset for as a named diagnostic", () => {
    const program = syntheticSwatchProgram(swatchImage);
    program.nodes[0]!.fields[1] = field("FrameBufferBlending", enumValue(1, "FB_Modulate"));
    expect(createNativeMaterial(nullScene(), loadedMaterial(program)).inspect()).toMatchObject({
      status: "diagnostic", reasons: ["babylon-blend-pair-unavailable:destination-colour,source-colour"] });
  });
});
