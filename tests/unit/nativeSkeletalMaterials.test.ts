import { afterEach, describe, expect, it, vi } from "vitest";
import { AssetContainer } from "@babylonjs/core/assetContainer";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import type { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { Bone } from "@babylonjs/core/Bones/bone";
import { Skeleton } from "@babylonjs/core/Bones/skeleton";
import { Matrix } from "@babylonjs/core/Maths/math.vector";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Scene } from "@babylonjs/core/scene";
import type { LoadedNativeMaterial } from "../../src/materials/ue2/babylon/loadNativeMaterial";
import { parseMaterialProgram } from "../../src/materials/ue2/model/materialProgram";
import { compileMaterialStagePlan } from "../../src/materials/ue2/model/stagePlan";
import { bindSkeletalSlotMaterials } from "../../src/assets/native/nativeSkeletalMaterials";
import type { ActorMaterialPrograms, ActorModelSlotSourceObjects, ActorSlotProgramJoin } from "../../src/assets/native/actorMaterialPrograms";
import { swatchTexturePng, syntheticSwatchProgram, syntheticUnportedProgram, textureImageFor, type FixtureProgram } from "../support/materialProgramFixture";

const compiledProgramId = "ab".repeat(32), unportedProgramId = "cd".repeat(32);
const compiledObject = "Npc.Body.Compiled", unportedObject = "Npc.Body.Unported", gapObject = "Npc.Body.Gap";
const swatchImage = textureImageFor(swatchTexturePng());
const releases: (() => void)[] = [];
afterEach(() => { releases.splice(0).reverse().forEach(release => release()); });

function loadedProgram(materialId: string, program: FixtureProgram): LoadedNativeMaterial {
  const parsedProgram = parseMaterialProgram(JSON.parse(JSON.stringify(program)));
  return { materialId, program: parsedProgram, plan: compileMaterialStagePlan(parsedProgram), texturePixels: new Map([[swatchImage.sha256, { width: 4, height: 4, rgba: new Uint8Array(64).fill(255) }]]) };
}

const joins: Readonly<Record<string, ActorSlotProgramJoin>> = {
  [compiledObject]: { kind: "program", sourceObject: compiledObject, programMaterialId: compiledProgramId },
  [unportedObject]: { kind: "program", sourceObject: unportedObject, programMaterialId: unportedProgramId },
  [gapObject]: { kind: "gap", sourceObject: gapObject, reasons: ["material-class-unported:Engine.TexOscillatorTriggered"] },
};

const materialPrograms: ActorMaterialPrograms = {
  async joinSlot(sourceObject) {
    return sourceObject === null ? { kind: "gap", sourceObject, reasons: ["actor-slot-material-none"] } : joins[sourceObject]!;
  },
};

function skinnedBox(name: string, scene: Scene) {
  const mesh = MeshBuilder.CreateBox(name, { size: 1 }, scene);
  const skeleton = new Skeleton(`${name} skeleton`, `${name} skeleton`, scene);
  new Bone("root", skeleton, null, Matrix.Identity());
  const vertices = mesh.getTotalVertices();
  mesh.setVerticesData(VertexBuffer.MatricesIndicesKind, new Array<number>(vertices * 4).fill(0), false, 4);
  mesh.setVerticesData(VertexBuffer.MatricesWeightsKind, Array.from({ length: vertices * 4 }, (_, index) => index % 4 === 0 ? 1 : 0), false, 4);
  mesh.numBoneInfluencers = 4;
  mesh.skeleton = skeleton;
  return mesh;
}

function slotContainer(slots: readonly { name: string; skinned?: boolean; pointer?: string | null }[]) {
  const engine = new NullEngine(), scene = new Scene(engine), container = new AssetContainer(scene);
  releases.push(() => { scene.dispose(); engine.dispose(); });
  const meshes = slots.map((slot, index) => {
    const material = new PBRMaterial(slot.name, scene);
    if (slot.pointer !== null) material._internalMetadata = { gltf: { pointers: [slot.pointer ?? `/materials/${index}`] } };
    const mesh = slot.skinned ? skinnedBox(`${slot.name} mesh`, scene) : MeshBuilder.CreateBox(`${slot.name} mesh`, { size: 1 }, scene);
    mesh.material = material;
    container.materials.push(material); container.meshes.push(mesh);
    return mesh;
  });
  const loadProgram = vi.fn(async (materialId: string) => loadedProgram(materialId, materialId === compiledProgramId ? syntheticSwatchProgram(swatchImage) : syntheticUnportedProgram()));
  const bind = (slotSourceObjects: ActorModelSlotSourceObjects) =>
    bindSkeletalSlotMaterials(scene, container, { sessionSeed: 5, loadProgram, slotSourceObjects, materialPrograms }, new AbortController().signal);
  return { scene, meshes, loadProgram, bind };
}

describe("skeletal slot materials through the UE2 material library", () => {
  it("draws a skinned slot with a ported program through a library material whose vertex stage takes the mesh's bone influences", async () => {
    const f = slotContainer([{ name: "Body.Compiled", skinned: true }, { name: "Body.Unported", skinned: true }]);
    const binding = await f.bind({ kind: "slots", sourceObjects: [compiledObject, unportedObject] });
    expect(binding.slots[0]).toEqual({ slot: "Body.Compiled", sourceObject: compiledObject, status: "library-compiled", programMaterialId: compiledProgramId, reasons: [], meshes: 1 });
    expect(binding.slots[1]).toMatchObject({ slot: "Body.Unported", sourceObject: unportedObject, status: "library-diagnostic", programMaterialId: unportedProgramId, meshes: 1 });
    expect(binding.slots[1]!.reasons.length).toBeGreaterThan(0);
    const libraryMaterial = f.meshes[0]!.material as ShaderMaterial;
    expect(libraryMaterial.name).toBe("UE2 material: SyntheticSwatch.SwatchFinalBlend");
    expect(f.meshes[1]!.material!.name).toMatch(/^UE2 diagnostic: /);
    for (const texture of f.scene.textures) {
      const uploadedOnTheNullEngine = texture.getInternalTexture();
      if (uploadedOnTheNullEngine) uploadedOnTheNullEngine.isReady = true;
    }
    let createdEffectDefines = "";
    libraryMaterial.onEffectCreatedObservable.add(created => { createdEffectDefines = created.effect.defines; });
    expect(libraryMaterial.isReady(f.meshes[0]!)).toBe(true);
    expect(createdEffectDefines).toContain("#define NUM_BONE_INFLUENCERS 4");
    expect((libraryMaterial.shaderPath as { vertexSource: string }).vertexSource).toMatch(/#include<bonesDeclaration>[\s\S]*mat4 finalWorld = world;\n#include<bonesVertex>/);
    binding.dispose(); binding.dispose();
    expect(f.scene.materials.filter(material => material.getClassName() === "ShaderMaterial")).toEqual([]);
  });

  it("keeps the converted texture material of a slot whose program is a gap, of a slot without an object and of a model without slot provenance, and names the reasons", async () => {
    const f = slotContainer([{ name: "Body.Gap", skinned: true }, { name: "Body.None" }]);
    const before = f.meshes.map(mesh => mesh.material);
    const binding = await f.bind({ kind: "slots", sourceObjects: [gapObject, null] });
    expect(binding.slots.map(slot => [slot.status, slot.sourceObject, slot.reasons])).toEqual([
      ["program-gap", gapObject, ["material-class-unported:Engine.TexOscillatorTriggered"]], ["program-gap", null, ["actor-slot-material-none"]]]);
    expect(f.meshes.map(mesh => mesh.material)).toEqual(before);
    const absent = await f.bind({ kind: "absent" });
    expect(absent.slots.map(slot => [slot.status, slot.reasons])).toEqual([["program-gap", ["actor-slot-provenance-absent"]], ["program-gap", ["actor-slot-provenance-absent"]]]);
    expect(f.loadProgram).not.toHaveBeenCalled();
  });

  it("joins each slot by its glTF material index, not by its order in the container", async () => {
    const f = slotContainer([{ name: "Second", pointer: "/materials/1" }, { name: "First", pointer: "/materials/0" }]);
    const binding = await f.bind({ kind: "slots", sourceObjects: [gapObject, compiledObject] });
    expect(binding.slots.map(slot => [slot.slot, slot.sourceObject])).toEqual([["Second", compiledObject], ["First", gapObject]]);
  });

  it.each([
    ["a slot without a glTF material pointer", null, "has no glTF material index"],
    ["a slot beyond the provenance slot list", "/materials/4", "beyond the 1 slots of its provenance"],
  ])("refuses %s and releases what it created", async (_description, pointer, message) => {
    const f = slotContainer([{ name: "Body.Compiled", pointer: "/materials/0" }, { name: "Body.Broken", pointer }]);
    await expect(f.bind({ kind: "slots", sourceObjects: [compiledObject] })).rejects.toThrow(message);
    expect(f.scene.materials.filter(material => material.getClassName() === "ShaderMaterial")).toEqual([]);
  });
});
