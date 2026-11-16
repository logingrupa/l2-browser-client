import { afterEach, describe, expect, it, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Scene } from "@babylonjs/core/scene";
import type { LoadedNativeMaterial } from "../../src/materials/ue2/babylon/loadNativeMaterial";
import { FOG_DISABLED, type NativeMaterialUniforms } from "../../src/materials/ue2/babylon/material";
import { parseMaterialProgram } from "../../src/materials/ue2/model/materialProgram";
import { compileMaterialStagePlan } from "../../src/materials/ue2/model/stagePlan";
import { bindSkyMaterialPrograms } from "../../src/scene/world/nativeSkyMaterialPrograms";
import type { SkyEnvironmentColour } from "../../src/scene/world/worldTimeOfDay";
import { swatchTexturePng, syntheticColorModifierProgram, syntheticSwatchProgram, syntheticUnportedProgram, textureImageFor,
  type FixtureProgram } from "../support/materialProgramFixture";
import { shippedSkyBindings } from "../support/worldTimeOfDayFixture";

const compiledProgramSha256 = "a".repeat(64);
const unportedProgramSha256 = "b".repeat(64);
const skyColourProgramSha256 = "c".repeat(64);
const otherSkyColourProgramSha256 = "e".repeat(64);
const programsBySha256 = new Map<string, () => FixtureProgram>([
  [skyColourProgramSha256, () => syntheticColorModifierProgram(swatchImage, "L2_Skies.Shaders.SkybackgroundColor")],
  [otherSkyColourProgramSha256, () => syntheticColorModifierProgram(swatchImage, "L2_SkiesNight.Shaders.SkybackgroundColor")],
  [unportedProgramSha256, syntheticUnportedProgram],
]);
const swatchImage = textureImageFor(swatchTexturePng());
const releases: (() => void)[] = [];
afterEach(() => { releases.splice(0).reverse().forEach(release => release()); });

function loadedProgram(materialId: string, program: FixtureProgram): LoadedNativeMaterial {
  const parsedProgram = parseMaterialProgram(JSON.parse(JSON.stringify(program)));
  return { materialId, program: parsedProgram, plan: compileMaterialStagePlan(parsedProgram),
    texturePixels: new Map([[swatchImage.sha256, { width: 4, height: 4, rgba: new Uint8Array(64).fill(255) }]]) };
}

function programPin(programSha256: string) {
  return { directory: `native-materials/${programSha256}`, programSha256 };
}

function skyMeshes(pins: readonly (string | null)[]) {
  const engine = new NullEngine(), scene = new Scene(engine);
  releases.push(() => { scene.dispose(); engine.dispose(); });
  const meshes = pins.map((programSha256, index) => {
    const material = new PBRMaterial(`sky snapshot ${index}`, scene);
    material.metadata = { gltf: { extras: { nativeSourceReference: `l2_skies.Shaders.Root${index}`,
      ...(programSha256 === null ? {} : { nativeMaterialProgram: programPin(programSha256) }) } } };
    const mesh = new Mesh(`sky part ${index}`, scene);
    mesh.material = material;
    return mesh;
  });
  const loadProgram = vi.fn(async (materialId: string) =>
    loadedProgram(materialId, programsBySha256.get(materialId)?.() ?? syntheticSwatchProgram(swatchImage)));
  return { scene, meshes, loadProgram };
}

describe("tile sky surfaces through the UE2 material library", () => {
  it("binds each pinned sky program that compiles, draws it without depth or fog and keeps the others on their snapshot material", async () => {
    const sky = skyMeshes([compiledProgramSha256, unportedProgramSha256, null]);
    const snapshotMaterials = sky.meshes.map(mesh => mesh.material);
    let levelSeconds = 0;
    const materialUniforms = vi.fn((): NativeMaterialUniforms => ({ levelSeconds, hour: 12, environmentType: 0, fog: FOG_DISABLED }));
    const binding = await bindSkyMaterialPrograms({ scene: sky.scene, meshes: sky.meshes, sessionSeed: 7, materialUniforms, environmentColours: null,
      loadProgram: sky.loadProgram, signal: new AbortController().signal });
    expect(binding.surfaces).toEqual([
      { mesh: "sky part 0", programMaterialId: compiledProgramSha256, status: "library-compiled", reasons: [] },
      { mesh: "sky part 1", programMaterialId: unportedProgramSha256, status: "library-diagnostic", reasons: expect.arrayContaining(["material-class-unported:Engine.GlowModifier"]) },
      { mesh: "sky part 2", programMaterialId: null, status: "program-unconverted", reasons: [] },
    ]);
    const bound = sky.meshes[0]!.material;
    expect(bound).toBeInstanceOf(ShaderMaterial);
    expect([bound!.disableDepthWrite, (bound as ShaderMaterial).forceDepthWrite]).toEqual([true, false]);
    expect(sky.meshes.slice(1).map(mesh => mesh.material)).toEqual(snapshotMaterials.slice(1));
    const uniformReadsBeforeFrame = materialUniforms.mock.calls.length;
    levelSeconds = 3;
    sky.scene.onBeforeRenderObservable.notifyObservers(sky.scene);
    expect(materialUniforms.mock.calls.length).toBe(uniformReadsBeforeFrame + 1);
    expect(binding.environmentColours()).toEqual([]);
    binding.dispose();
    expect(sky.meshes.map(mesh => mesh.material)).toEqual(snapshotMaterials);
    expect(sky.scene.materials.includes(bound!)).toBe(false);
  });

  it("reports a pinned program without tile material uniforms as absent and loads nothing", async () => {
    const sky = skyMeshes([compiledProgramSha256]);
    const binding = await bindSkyMaterialPrograms({ scene: sky.scene, meshes: sky.meshes, sessionSeed: 7, materialUniforms: null, environmentColours: null,
      loadProgram: sky.loadProgram, signal: new AbortController().signal });
    expect(binding.surfaces).toEqual([{ mesh: "sky part 0", programMaterialId: compiledProgramSha256, status: "library-material-uniforms-absent", reasons: [] }]);
    expect(sky.loadProgram).not.toHaveBeenCalled();
    expect(sky.meshes[0]!.material).toBeInstanceOf(PBRMaterial);
  });

  it("writes the time-of-day sky colour into the SkybackgroundColor ColorModifier before the first frame and on every frame", async () => {
    const sky = skyMeshes([skyColourProgramSha256, compiledProgramSha256]);
    let skyBoxColour: SkyEnvironmentColour["colour"] = { status: "resolved", value: [66, 124, 176] };
    const environmentColours = vi.fn((): readonly SkyEnvironmentColour[] => shippedSkyBindings.map(binding =>
      ({ ...binding, colour: binding.setupKey === "SKYBOX" ? skyBoxColour : { status: "resolved", value: [1, 2, 3] } })));
    const binding = await bindSkyMaterialPrograms({ scene: sky.scene, meshes: sky.meshes, sessionSeed: 7,
      materialUniforms: () => ({ levelSeconds: 0, hour: 12, environmentType: 0, fog: FOG_DISABLED }), environmentColours,
      loadProgram: sky.loadProgram, signal: new AbortController().signal });
    expect(binding.environmentColours()[0]).toEqual({ ...shippedSkyBindings[0], materialNode: "L2_Skies.Shaders.SkybackgroundColor", writtenRgb: [66, 124, 176],
      materialColourSource: "environment-write", reason: null });
    expect(binding.environmentColours().slice(1).map(entry => entry.reason)).toEqual(Array(4).fill("sky-environment-material-absent"));
    const callsBeforeFrame = environmentColours.mock.calls.length;
    skyBoxColour = { status: "unresolved", reason: "env-color-transition-unresolved" };
    sky.scene.onBeforeRenderObservable.notifyObservers(sky.scene);
    expect(environmentColours.mock.calls.length).toBe(callsBeforeFrame + 1);
    expect(binding.environmentColours()[0]).toMatchObject({ writtenRgb: [66, 124, 176], materialColourSource: "held-environment-write", reason: "env-color-transition-unresolved" });
    binding.dispose();
  });

  it("refuses an Env.int sky object that two compiled sky surfaces name differently and disposes what it compiled", async () => {
    const sky = skyMeshes([skyColourProgramSha256, otherSkyColourProgramSha256]);
    const snapshotMaterials = sky.meshes.map(mesh => mesh.material);
    const materialsBefore = sky.scene.materials.length;
    await expect(bindSkyMaterialPrograms({ scene: sky.scene, meshes: sky.meshes, sessionSeed: 7,
      materialUniforms: () => ({ levelSeconds: 0, hour: 12, environmentType: 0, fog: FOG_DISABLED }),
      environmentColours: () => shippedSkyBindings.map(binding => ({ ...binding, colour: { status: "resolved", value: [0, 0, 0] } })),
      loadProgram: sky.loadProgram, signal: new AbortController().signal })).rejects.toThrow("Sky environment binding SKYBOX=SkybackgroundColor matches 2 ColorModifier objects");
    expect(sky.meshes.map(mesh => mesh.material)).toEqual(snapshotMaterials);
    expect(sky.scene.materials.length).toBe(materialsBefore);
  });
});
