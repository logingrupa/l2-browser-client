import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Scene } from "@babylonjs/core/scene";
import type { LoadedNativeMaterial } from "../../src/materials/ue2/babylon/loadNativeMaterial";
import { FOG_DISABLED, type NativeMaterialUniforms } from "../../src/materials/ue2/babylon/material";
import { parseMaterialProgram } from "../../src/materials/ue2/model/materialProgram";
import { compileMaterialStagePlan } from "../../src/materials/ue2/model/stagePlan";
import {
  bindNativeSkyLibraryMaterials, joinNativeSkySurface, parseNativeSkyMaterialsListing, skySurfaceMaterialUnlistedReason,
  skySurfaceProgramAbsentReason, skySurfaceSourceReferenceNoneReason, type NativeSkyLibrarySettings, type NativeSkyMaterialsListing,
} from "../../src/scene/world/nativeSkyLibraryMaterials";
import type { SkyEnvironmentColour } from "../../src/scene/world/worldTimeOfDay";
import { swatchTexturePng, syntheticSkyColourModifierProgram, syntheticUnportedProgram, textureImageFor } from "../support/materialProgramFixture";
import { shippedSkyBindings } from "../support/worldTimeOfDayFixture";

const backgroundRoot = "l2_skies.Shaders.SkybackgroundColor";
const backgroundProgramSha256 = "a".repeat(64);
const unportedProgramSha256 = "b".repeat(64);
const nightBackgroundRoot = "l2_skiesnight.Shaders.SkybackgroundColor";
const nightBackgroundProgramSha256 = "c".repeat(64);
const unportedRoot = "l2_skies.Shaders.Unported";
const failedRoot = "l2_skies.Shaders.Failed";
const failedReason = "decode-failed:FormatError:texture missing";
const pin = (programSha256: string) => ({ directory: `native-materials/${programSha256}`, programSha256 });
const listedMaterial = (root: string, program: unknown, gapReasons: string[] = []) => ({ mapReference: root.replace("l2_skies", "L2_Skies"), root, program, gapReasons });
const snapshot = (materials: readonly unknown[], extra: Record<string, unknown> = {}) =>
  ({ schemaVersion: 1, kind: "native-shared-sky-snapshot", map: "skylevel", parts: [], materials, ...extra });
const whiteChipImage = textureImageFor(swatchTexturePng());

describe("sky surface to library program join", () => {
  const listing = parseNativeSkyMaterialsListing(snapshot([listedMaterial(backgroundRoot, pin(backgroundProgramSha256)),
    listedMaterial(failedRoot, null, [failedReason]), listedMaterial("l2_skies.Shaders.Bare", null)]));

  it("joins a sky surface's glTF source reference to the program its sky snapshot lists, case-insensitively like the native names", () => {
    expect(joinNativeSkySurface(listing, backgroundRoot)).toEqual({ kind: "program", programMaterialId: backgroundProgramSha256 });
    expect(joinNativeSkySurface(listing, backgroundRoot.toUpperCase())).toEqual({ kind: "program", programMaterialId: backgroundProgramSha256 });
  });

  it("names why a surface has no program: no source reference, an unlisted root, a listed root without a program", () => {
    expect(joinNativeSkySurface(listing, null)).toEqual({ kind: "gap", reasons: [skySurfaceSourceReferenceNoneReason] });
    expect(joinNativeSkySurface(listing, "l2_skies.Shaders.Other")).toEqual({ kind: "gap", reasons: [skySurfaceMaterialUnlistedReason] });
    expect(joinNativeSkySurface(listing, failedRoot)).toEqual({ kind: "gap", reasons: [failedReason] });
    expect(joinNativeSkySurface(listing, "l2_skies.Shaders.Bare")).toEqual({ kind: "gap", reasons: [skySurfaceProgramAbsentReason] });
  });

  it("refuses another snapshot kind or map, a repeated root, a field outside the sky material record and a program that is no pin", () => {
    expect(() => parseNativeSkyMaterialsListing(snapshot([], { kind: "native-shared-sky-bundle" }))).toThrow(/native-shared-sky-snapshot schema 1 record of map skylevel/);
    expect(() => parseNativeSkyMaterialsListing(snapshot([], { map: "20_21" }))).toThrow(/record of map skylevel/);
    expect(() => parseNativeSkyMaterialsListing(snapshot([listedMaterial(backgroundRoot, pin(backgroundProgramSha256)),
      listedMaterial(backgroundRoot.toUpperCase(), pin(backgroundProgramSha256))]))).toThrow(/twice/);
    expect(() => parseNativeSkyMaterialsListing(snapshot([{ ...listedMaterial(backgroundRoot, null), colour: 1 }]))).toThrow(/must hold exactly mapReference, root, program, gapReasons/);
    expect(() => parseNativeSkyMaterialsListing(snapshot([listedMaterial(backgroundRoot, { directory: "elsewhere", programSha256: backgroundProgramSha256 })])))
      .toThrow(/no native-materials program pin/);
  });
});

describe("sky surfaces bound through the UE2 library", () => {
  let engine: NullEngine, scene: Scene;
  beforeEach(() => { engine = new NullEngine(); scene = new Scene(engine); });
  afterEach(() => { scene.dispose(); engine.dispose(); });

  const skyUniforms = (levelSeconds = 0): NativeMaterialUniforms => ({ levelSeconds, hour: 12, environmentType: 0, fog: FOG_DISABLED });
  function skyMesh(sourceReference: string) {
    const mesh = MeshBuilder.CreateBox(sourceReference, {}, scene), material = new PBRMaterial(sourceReference, scene);
    material.metadata = { gltf: { extras: { nativeSourceReference: sourceReference, sourceSnapshot: true } } };
    mesh.material = material;
    return mesh;
  }
  const loadProgram = vi.fn(async (materialId: string): Promise<LoadedNativeMaterial> => {
    const colourModifierRoot = materialId === backgroundProgramSha256 ? backgroundRoot : materialId === nightBackgroundProgramSha256 ? nightBackgroundRoot : null;
    const program = parseMaterialProgram(JSON.parse(JSON.stringify(colourModifierRoot === null ? syntheticUnportedProgram()
      : syntheticSkyColourModifierProgram(colourModifierRoot, whiteChipImage, "ce9600ff"))));
    return { materialId, program, plan: compileMaterialStagePlan(program),
      texturePixels: new Map([[whiteChipImage.sha256, { width: 4, height: 4, rgba: new Uint8Array(64).fill(255) }]]), textureMipChains: new Map() };
  });
  const bind = (meshes: readonly Mesh[], listing: NativeSkyMaterialsListing, overrides: Partial<NativeSkyLibrarySettings> = {}) =>
    bindNativeSkyLibraryMaterials({ scene, meshes, listing, sessionSeed: 1, materialUniforms: null, environmentColours: null, loadProgram,
      signal: new AbortController().signal, ...overrides });
  const backgroundListing = () => parseNativeSkyMaterialsListing(snapshot([listedMaterial(backgroundRoot, pin(backgroundProgramSha256))]));

  it("draws a compiled program through the library without depth write and keeps the glTF material of a diagnostic program with its reasons", async () => {
    const listing = parseNativeSkyMaterialsListing(snapshot([listedMaterial(backgroundRoot, pin(backgroundProgramSha256)),
      listedMaterial(unportedRoot, pin(unportedProgramSha256))]));
    const meshes = [skyMesh(backgroundRoot), skyMesh(unportedRoot)], unportedMaterial = meshes[1]!.material;
    const binding = await bind(meshes, listing);
    expect(binding.surfaces.map(({ status, programMaterialId }) => ({ status, programMaterialId }))).toEqual([
      { status: "library-compiled", programMaterialId: backgroundProgramSha256 }, { status: "library-diagnostic", programMaterialId: unportedProgramSha256 }]);
    const drawn = meshes[0]!.material as ShaderMaterial;
    expect(drawn).toBeInstanceOf(ShaderMaterial);
    expect(drawn.name).toBe(`UE2 material: ${backgroundRoot}`);
    expect([drawn.disableDepthWrite, drawn.forceDepthWrite]).toEqual([true, false]);
    expect(meshes[1]!.material).toBe(unportedMaterial);
    expect(binding.surfaces[1]!.reasons).toEqual(["material-class-unported:Engine.GlowModifier"]);
    expect(scene.materials.some(material => material.name.startsWith("UE2 diagnostic:"))).toBe(false);
    expect(binding.environmentColours()).toEqual([]);
  });

  it("assigns no library material and releases the ones it built when the lifetime ends while binding", async () => {
    const lifetime = new AbortController(), meshes = [skyMesh(backgroundRoot), skyMesh(backgroundRoot)], materials = meshes.map(mesh => mesh.material);
    const abortingLoad = vi.fn(async (materialId: string, signal: AbortSignal) => {
      const loaded = await loadProgram(materialId);
      if (abortingLoad.mock.calls.length === 2) lifetime.abort();
      signal.throwIfAborted();
      return loaded;
    });
    await expect(bind(meshes, backgroundListing(), { loadProgram: abortingLoad, signal: lifetime.signal })).rejects.toThrow();
    expect(meshes.map(mesh => mesh.material)).toEqual(materials);
    expect(scene.materials.some(material => material.name.startsWith("UE2 material:"))).toBe(false);
  });

  it("updates the library sky on the tile clock and restores the snapshot material on dispose", async () => {
    const meshes = [skyMesh(backgroundRoot)], snapshotMaterials = meshes.map(mesh => mesh.material);
    let levelSeconds = 0;
    const materialUniforms = vi.fn(() => skyUniforms(levelSeconds));
    const binding = await bind(meshes, backgroundListing(), { materialUniforms });
    const drawn = meshes[0]!.material!;
    const readsBeforeFrame = materialUniforms.mock.calls.length;
    levelSeconds = 3;
    scene.onBeforeRenderObservable.notifyObservers(scene);
    expect(materialUniforms.mock.calls.length).toBe(readsBeforeFrame + 1);
    binding.dispose();
    expect(meshes.map(mesh => mesh.material)).toEqual(snapshotMaterials);
    expect(scene.materials.includes(drawn)).toBe(false);
  });

  it("writes the time-of-day sky colour into the listed SkybackgroundColor ColorModifier before the first frame and holds it through an unresolved frame", async () => {
    let skyBoxColour: SkyEnvironmentColour["colour"] = { status: "resolved", value: [66, 124, 176] };
    const environmentColours = vi.fn((): readonly SkyEnvironmentColour[] => shippedSkyBindings.map(binding =>
      ({ ...binding, colour: binding.setupKey === "SKYBOX" ? skyBoxColour : { status: "resolved", value: [1, 2, 3] } })));
    const binding = await bind([skyMesh(backgroundRoot)], backgroundListing(), { materialUniforms: () => skyUniforms(),
      environmentColours: { tableColours: environmentColours, retainedFogInfos: () => ({ status: "listed", hour: 12, fogInfos: [] }) } });
    expect(binding.environmentColours()[0]).toEqual({ ...shippedSkyBindings[0], materialNode: backgroundRoot, tableRgb: [66, 124, 176], localFogInfoCount: 0,
      writtenRgb: [66, 124, 176], materialColourSource: "environment-write", reason: null });
    expect(binding.environmentColours().slice(1).map(entry => entry.reason)).toEqual(Array(4).fill("sky-environment-material-absent"));
    const callsBeforeFrame = environmentColours.mock.calls.length;
    skyBoxColour = { status: "unresolved", reason: "env-color-transition-unresolved" };
    scene.onBeforeRenderObservable.notifyObservers(scene);
    expect(environmentColours.mock.calls.length).toBe(callsBeforeFrame + 1);
    expect(binding.environmentColours()[0]).toMatchObject({ writtenRgb: [66, 124, 176], materialColourSource: "held-environment-write", reason: "env-color-transition-unresolved" });
    binding.dispose();
  });

  it("writes no time-of-day colour without tile material uniforms and keeps the library sky", async () => {
    const environmentColours = vi.fn((): readonly SkyEnvironmentColour[] => []);
    const binding = await bind([skyMesh(backgroundRoot)], backgroundListing(), { environmentColours: { tableColours: environmentColours,
      retainedFogInfos: () => ({ status: "listed", hour: 12, fogInfos: [] }) } });
    expect(binding.surfaces[0]!.status).toBe("library-compiled");
    expect(binding.environmentColours()).toEqual([]);
    expect(environmentColours).not.toHaveBeenCalled();
    binding.dispose();
  });

  it("refuses an Env.int sky object that two listed sky surfaces name differently and disposes what it compiled", async () => {
    const listing = parseNativeSkyMaterialsListing(snapshot([listedMaterial(backgroundRoot, pin(backgroundProgramSha256)),
      listedMaterial(nightBackgroundRoot, pin(nightBackgroundProgramSha256))]));
    const meshes = [skyMesh(backgroundRoot), skyMesh(nightBackgroundRoot)], snapshotMaterials = meshes.map(mesh => mesh.material);
    await expect(bind(meshes, listing, { materialUniforms: () => skyUniforms(),
      environmentColours: { tableColours: () => shippedSkyBindings.map(binding => ({ ...binding, colour: { status: "resolved", value: [0, 0, 0] } })),
        retainedFogInfos: () => ({ status: "listed", hour: 12, fogInfos: [] }) } }))
      .rejects.toThrow("Sky environment binding SKYBOX=SkybackgroundColor matches 2 ColorModifier objects");
    expect(meshes.map(mesh => mesh.material)).toEqual(snapshotMaterials);
    expect(scene.materials.some(material => material.name.startsWith("UE2 material:"))).toBe(false);
  });
});
