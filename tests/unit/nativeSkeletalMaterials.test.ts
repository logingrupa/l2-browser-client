import { afterEach, describe, expect, it, vi } from "vitest";
import { AssetContainer } from "@babylonjs/core/assetContainer";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Skeleton } from "@babylonjs/core/Bones/skeleton";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Scene } from "@babylonjs/core/scene";
import type { LoadedNativeMaterial } from "../../src/materials/ue2/babylon/loadNativeMaterial";
import { parseMaterialProgram } from "../../src/materials/ue2/model/materialProgram";
import { compileMaterialStagePlan } from "../../src/materials/ue2/model/stagePlan";
import { bindSkeletalSlotMaterials, SKELETAL_SLOT_PROGRAM_EXTRAS_FIELD } from "../../src/assets/native/nativeSkeletalMaterials";
import { swatchTexturePng, syntheticSwatchProgram, syntheticUnportedProgram, textureImageFor, type FixtureProgram } from "../support/materialProgramFixture";

const compiledProgramId = "ab".repeat(32), unportedProgramId = "cd".repeat(32);
const swatchImage = textureImageFor(swatchTexturePng());
const releases: (() => void)[] = [];
afterEach(() => { releases.splice(0).reverse().forEach(release => release()); });

function loadedProgram(materialId: string, program: FixtureProgram): LoadedNativeMaterial {
  const parsedProgram = parseMaterialProgram(JSON.parse(JSON.stringify(program)));
  return { materialId, program: parsedProgram, plan: compileMaterialStagePlan(parsedProgram), texturePixels: new Map([[swatchImage.sha256, { width: 4, height: 4, rgba: new Uint8Array(64).fill(255) }]]) };
}

function slotContainer(slots: readonly { name: string; programId?: unknown; skinned?: boolean }[]) {
  const engine = new NullEngine(), scene = new Scene(engine), container = new AssetContainer(scene);
  releases.push(() => { scene.dispose(); engine.dispose(); });
  const meshes = slots.map(slot => {
    const material = new PBRMaterial(slot.name, scene);
    if (slot.programId !== undefined) material.metadata = { gltf: { extras: { [SKELETAL_SLOT_PROGRAM_EXTRAS_FIELD]: slot.programId } } };
    const mesh = new Mesh(`${slot.name} mesh`, scene);
    mesh.material = material;
    if (slot.skinned) mesh.skeleton = new Skeleton(`${slot.name} skeleton`, `${slot.name} skeleton`, scene);
    container.materials.push(material); container.meshes.push(mesh);
    return mesh;
  });
  const loadProgram = vi.fn(async (materialId: string) => loadedProgram(materialId, materialId === compiledProgramId ? syntheticSwatchProgram(swatchImage) : syntheticUnportedProgram()));
  return { scene, container, meshes, loadProgram };
}

describe("skeletal slot materials through the UE2 material library", () => {
  it("renders a slot with a converted program through createNativeMaterial and an unported program as the magenta diagnostic", async () => {
    const f = slotContainer([{ name: "Body.Compiled", programId: compiledProgramId }, { name: "Body.Unported", programId: unportedProgramId }]);
    const binding = await bindSkeletalSlotMaterials(f.scene, f.container, { sessionSeed: 5, loadProgram: f.loadProgram }, new AbortController().signal);
    expect(binding.slots).toEqual([
      { slot: "Body.Compiled", status: "library-compiled", programMaterialId: compiledProgramId, meshes: 1 },
      { slot: "Body.Unported", status: "library-diagnostic", programMaterialId: unportedProgramId, meshes: 1 },
    ]);
    expect(f.meshes.map(mesh => mesh.material?.getClassName())).toEqual(["ShaderMaterial", "ShaderMaterial"]);
    expect(f.meshes[0]!.material!.name).toBe("UE2 material: SyntheticSwatch.SwatchFinalBlend");
    expect(f.meshes[1]!.material!.name).toMatch(/^UE2 diagnostic: /);
    binding.dispose(); binding.dispose();
    expect(f.scene.materials.filter(material => material.getClassName() === "ShaderMaterial")).toEqual([]);
  });

  it("keeps the converted texture material of a slot without a program and of a skinned slot the library vertex stage cannot skin", async () => {
    const f = slotContainer([{ name: "Body.NoProgram" }, { name: "Body.Skinned", programId: compiledProgramId, skinned: true }]);
    const before = f.meshes.map(mesh => mesh.material);
    const binding = await bindSkeletalSlotMaterials(f.scene, f.container, { sessionSeed: 5, loadProgram: f.loadProgram }, new AbortController().signal);
    expect(binding.slots.map(slot => slot.status)).toEqual(["program-unconverted", "library-vertex-stage-unskinned"]);
    expect(f.meshes.map(mesh => mesh.material)).toEqual(before);
    expect(f.loadProgram).not.toHaveBeenCalled();
  });

  it("refuses a slot program id that is not a SHA-256 and releases what it created", async () => {
    const f = slotContainer([{ name: "Body.Compiled", programId: compiledProgramId }, { name: "Body.Broken", programId: "not-a-sha" }]);
    await expect(bindSkeletalSlotMaterials(f.scene, f.container, { sessionSeed: 5, loadProgram: f.loadProgram }, new AbortController().signal))
      .rejects.toThrow("is not a material program SHA-256");
    expect(f.scene.materials.filter(material => material.getClassName() === "ShaderMaterial")).toEqual([]);
  });
});
