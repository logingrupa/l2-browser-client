import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, describe, expect, it } from "vitest";
import { createNativeMaterial, type NativeMaterial } from "../../src/materials/ue2/babylon/material";
import type { LoadedNativeMaterial } from "../../src/materials/ue2/babylon/loadNativeMaterial";
import { visibleDiagnosticMaterials } from "../../src/materials/ue2/babylon/visibleDiagnosticMaterials";
import { parseMaterialProgram } from "../../src/materials/ue2/model/materialProgram";
import { compileMaterialStagePlan } from "../../src/materials/ue2/model/stagePlan";
import {
  programOf, swatchTexturePng, syntheticSwatchProgram, syntheticUnportedProgram, textureImageFor, unportedNode, type FixtureProgram,
} from "../support/materialProgramFixture";

const swatchImage = textureImageFor(swatchTexturePng());
const testMaterialOptions = { sessionSeed: 1, lighting: "unlit" } as const;
const scenes: Scene[] = [];

function loadedMaterial(program: FixtureProgram): LoadedNativeMaterial {
  const parsedProgram = parseMaterialProgram(JSON.parse(JSON.stringify(program)));
  const pixels = { width: 4, height: 4, rgba: new Uint8Array(64).fill(255) };
  return { materialId: "ab".repeat(32), program: parsedProgram, plan: compileMaterialStagePlan(parsedProgram), texturePixels: new Map([[swatchImage.sha256, pixels]]) };
}

function nullScene(): Scene {
  const scene = new Scene(new NullEngine());
  scenes.push(scene);
  return scene;
}

function meshWith(scene: Scene, name: string, nativeMaterial: NativeMaterial): Mesh {
  const mesh = new Mesh(name, scene);
  mesh.material = nativeMaterial.material;
  return mesh;
}

function inspectedDiagnosticRecord(nativeMaterial: NativeMaterial) {
  const { root, unportedClass, reasons } = nativeMaterial.inspect();
  return { root, unportedClass, reasons };
}

const secondUnportedProgram = () => programOf("SyntheticSwatch.AnotherTriggeredOscillator",
  [unportedNode("SyntheticSwatch.AnotherTriggeredOscillator", "Engine.TexOscillatorTriggered")]);

afterEach(() => {
  for (const scene of scenes.splice(0)) {
    const engine = scene.getEngine();
    scene.dispose();
    engine.dispose();
  }
});

describe("visibleDiagnosticMaterials", () => {
  it("lists a diagnostic material on an enabled visible mesh once, equal to its inspect() values", () => {
    const scene = nullScene();
    const diagnostic = createNativeMaterial(scene, loadedMaterial(syntheticUnportedProgram()), testMaterialOptions);
    expect(diagnostic.inspect().status).toBe("diagnostic");
    meshWith(scene, "visible diagnostic", diagnostic);
    expect(visibleDiagnosticMaterials(scene)).toEqual([inspectedDiagnosticRecord(diagnostic)]);
    expect(visibleDiagnosticMaterials(scene)).toEqual([{ root: "SyntheticSwatch.TriggeredOscillator", unportedClass: "Engine.TexOscillatorTriggered",
      reasons: expect.arrayContaining(["material-class-unported:Engine.TexOscillatorTriggered"]) }]);
  });

  it("leaves out a disabled mesh, an invisible mesh and a mesh with a compiled material", () => {
    const scene = nullScene();
    const diagnostic = createNativeMaterial(scene, loadedMaterial(syntheticUnportedProgram()), testMaterialOptions);
    const compiled = createNativeMaterial(scene, loadedMaterial(syntheticSwatchProgram(swatchImage)), testMaterialOptions);
    expect(compiled.inspect().status).toBe("compiled");
    meshWith(scene, "disabled diagnostic", diagnostic).setEnabled(false);
    meshWith(scene, "invisible diagnostic", diagnostic).isVisible = false;
    meshWith(scene, "visible compiled", compiled);
    expect(visibleDiagnosticMaterials(scene)).toEqual([]);
  });

  it("lists a diagnostic root shared by two meshes once and sorts two roots by root", () => {
    const scene = nullScene();
    const triggered = createNativeMaterial(scene, loadedMaterial(syntheticUnportedProgram()), testMaterialOptions);
    const anotherTriggered = createNativeMaterial(scene, loadedMaterial(secondUnportedProgram()), testMaterialOptions);
    meshWith(scene, "triggered first", triggered);
    meshWith(scene, "triggered second", triggered);
    meshWith(scene, "another triggered", anotherTriggered);
    expect(visibleDiagnosticMaterials(scene).map(record => record.root)).toEqual(["SyntheticSwatch.AnotherTriggeredOscillator", "SyntheticSwatch.TriggeredOscillator"]);
    expect(visibleDiagnosticMaterials(scene)).toEqual([inspectedDiagnosticRecord(anotherTriggered), inspectedDiagnosticRecord(triggered)]);
  });

  it("gives an empty list for a scene with no diagnostic material", () => {
    const scene = nullScene();
    meshWith(scene, "visible compiled", createNativeMaterial(scene, loadedMaterial(syntheticSwatchProgram(swatchImage)), testMaterialOptions));
    new Mesh("no material", scene);
    expect(visibleDiagnosticMaterials(scene)).toEqual([]);
  });
});
