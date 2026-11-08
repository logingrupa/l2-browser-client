import { readFileSync } from "node:fs";
import { Constants } from "@babylonjs/core/Engines/constants";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, describe, expect, it } from "vitest";
import { createNativeMaterial, particleFragmentChain, selectTextureFrame } from "../../src/materials/ue2/babylon/material";
import { nativeMaterialProgramPath, type LoadedNativeMaterial } from "../../src/materials/ue2/babylon/loadNativeMaterial";
import { blendFactorsForMaterial } from "../../src/materials/ue2/model/blendTable";
import { evaluateFogState, FOG_DISABLED } from "../../src/materials/ue2/model/fog";
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
const testMaterialOptions = { sessionSeed: 1 };

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
    const nativeMaterial = createNativeMaterial(nullScene(), loaded, testMaterialOptions);
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
    const nativeMaterial = createNativeMaterial(nullScene(), loadedMaterial(program), testMaterialOptions);
    expect(nativeMaterial.inspect().blend).toMatchObject({ pair: { source: "one", destination: "inverse-source-colour" }, babylonAlphaMode: "ALPHA_SCREENMODE", depthWrite: false });
    expect(nativeMaterial.material.alphaMode).toBe(Constants.ALPHA_SCREENMODE);
  });

  it("renders an unported class as the named magenta diagnostic", () => {
    const nativeMaterial = createNativeMaterial(nullScene(), loadedMaterial(syntheticUnportedProgram()), testMaterialOptions);
    expect(nativeMaterial.inspect()).toMatchObject({ status: "diagnostic", unportedClass: "Engine.TexOscillatorTriggered",
      reasons: expect.arrayContaining(["material-class-unported:Engine.TexOscillatorTriggered"]) });
  });

  it("renders a Modulate pair Babylon has no preset for as a named diagnostic", () => {
    const program = syntheticSwatchProgram(swatchImage);
    program.nodes[0]!.fields[1] = field("FrameBufferBlending", enumValue(1, "FB_Modulate"));
    expect(createNativeMaterial(nullScene(), loadedMaterial(program), testMaterialOptions).inspect()).toMatchObject({
      status: "diagnostic", reasons: ["babylon-blend-pair-unavailable:destination-colour,source-colour"] });
  });

  it("binds the frame and fog state the model evaluates on update", () => {
    const program = syntheticSwatchProgram(swatchImage);
    program.nodes[1]!.fields[0] = field("Diffuse", nodeReference("SyntheticSwatch.Panner"));
    program.nodes.push(reviewedNode("SyntheticSwatch.Panner", "Engine.TexPanner", [field("Material", nodeReference("SyntheticSwatch.SwatchTexture")),
      field("PanRate", 2), field("PanDirection", rawStruct("Rotator", "000000000000000000000000"), "authored", "raw")]));
    const nativeMaterial = createNativeMaterial(nullScene(), loadedMaterial(program), testMaterialOptions);
    const fog = evaluateFogState({ environmentPreset: null, cameraZone: null, waterVolume: null,
      fogInfo: { colourBytes: [10, 20, 30], startSourceUnits: 100, endSourceUnits: 900 } });
    nativeMaterial.update({ levelSeconds: 0.25, hour: 6.5, environmentType: 2, fog });
    const inspection = nativeMaterial.inspect();
    expect(inspection.uniforms).toEqual({ levelSeconds: 0.25, hour: 6.5, environmentType: 2, fog });
    expect(inspection.frame?.samplerMatrices).toEqual([[1, 0, 0.5, 0, 1, 0]]);
    expect(fog.fogEnd).toBe(900);
  });

  it("names the coordinate generators the binding cannot draw yet", () => {
    const program = syntheticSwatchProgram(swatchImage);
    program.nodes[1]!.fields[0] = field("Diffuse", nodeReference("SyntheticSwatch.EnvironmentMap"));
    program.nodes.push(reviewedNode("SyntheticSwatch.EnvironmentMap", "Engine.TexEnvMap", [field("Material", nodeReference("SyntheticSwatch.SwatchTexture"))]));
    expect(createNativeMaterial(nullScene(), loadedMaterial(program), testMaterialOptions).inspect())
      .toMatchObject({ status: "diagnostic", reasons: ["material-feature-unported:EnvMapType"] });
  });

  it("exports the particle fragment hook and texture frames for the actors render stage", () => {
    const translucent = particleFragmentChain(3);
    expect(translucent).toMatchObject({ fragmentFunctionName: "ue2ParticleFragment", babylonBlend: { alphaMode: Constants.ALPHA_SCREENMODE }, blend: { fogFamily: "black" } });
    expect(translucent.fragmentFunctionSource).toContain("vec4 ue2ParticleFragment(vec4 sourceColour, float viewDepth)");
    expect(particleFragmentChain(6).babylonBlend.alphaMode).toBe(Constants.ALPHA_ONEONE);
    expect(() => particleFragmentChain(2)).toThrow(/destination-colour,source-colour has no Babylon blend state/);
    expect(selectTextureFrame({ kind: "anim-next", frameCount: 4, maximumFrameRate: 10 }, 0.25).index).toBe(2);
    expect(FOG_DISABLED.fogEnd).toBeNull();
  });
});
