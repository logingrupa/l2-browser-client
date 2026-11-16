import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Scene } from "@babylonjs/core/scene";
import type { LoadedNativeMaterial } from "../../src/materials/ue2/babylon/loadNativeMaterial";
import { parseMaterialProgram } from "../../src/materials/ue2/model/materialProgram";
import { compileMaterialStagePlan } from "../../src/materials/ue2/model/stagePlan";
import {
  bindNativeSkyLibraryMaterials, joinNativeSkySurface, parseNativeSkyMaterialsListing, skyMaterialsListingAbsentReason, skySurfaceMaterialUnlistedReason,
  skySurfaceProgramAbsentReason, skySurfaceSourceReferenceNoneReason,
} from "../../src/scene/world/nativeSkyLibraryMaterials";
import { swatchTexturePng, syntheticSkyColourModifierProgram, syntheticUnportedProgram, textureImageFor } from "../support/materialProgramFixture";

const tileId = "15_22";
const backgroundRoot = "l2_skies.Shaders.SkybackgroundColor";
const backgroundProgramSha256 = "a".repeat(64);
const unportedProgramSha256 = "b".repeat(64);
const unportedRoot = "l2_skies.Shaders.Unported";
const failedRoot = "l2_skies.Shaders.Failed";
const failedReason = "decode-failed:FormatError:texture missing";
const pin = (programSha256: string) => ({ directory: `native-materials/${programSha256}`, programSha256 });
const listedMaterial = (root: string, program: unknown, gapReasons: string[] = []) => ({ mapReference: root.replace("l2_skies", "L2_Skies"), root, program, gapReasons });
const snapshot = (materials: readonly unknown[], extra: Record<string, unknown> = {}) =>
  ({ schemaVersion: 1, kind: "native-sky-source-snapshot", tileId, parts: [], materials, ...extra });
const whiteChipImage = textureImageFor(swatchTexturePng());

describe("sky surface to library program join", () => {
  const listing = parseNativeSkyMaterialsListing(snapshot([listedMaterial(backgroundRoot, pin(backgroundProgramSha256)),
    listedMaterial(failedRoot, null, [failedReason]), listedMaterial("l2_skies.Shaders.Bare", null)]), tileId);

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

  it("refuses another snapshot kind or tile, a repeated root, a field outside the sky material record and a program that is no pin", () => {
    expect(() => parseNativeSkyMaterialsListing(snapshot([], { kind: "native-sky-source-bundle" }), tileId)).toThrow(/native-sky-source-snapshot schema 1 record of tile 15_22/);
    expect(() => parseNativeSkyMaterialsListing(snapshot([]), "20_21")).toThrow(/record of tile 20_21/);
    expect(() => parseNativeSkyMaterialsListing(snapshot([listedMaterial(backgroundRoot, pin(backgroundProgramSha256)),
      listedMaterial(backgroundRoot.toUpperCase(), pin(backgroundProgramSha256))]), tileId)).toThrow(/twice/);
    expect(() => parseNativeSkyMaterialsListing(snapshot([{ ...listedMaterial(backgroundRoot, null), colour: 1 }]), tileId)).toThrow(/must hold exactly mapReference, root, program, gapReasons/);
    expect(() => parseNativeSkyMaterialsListing(snapshot([listedMaterial(backgroundRoot, { directory: "elsewhere", programSha256: backgroundProgramSha256 })]), tileId))
      .toThrow(/no native-materials program pin/);
  });
});

describe("sky surfaces bound through the UE2 library", () => {
  let engine: NullEngine, scene: Scene;
  beforeEach(() => { engine = new NullEngine(); scene = new Scene(engine); });
  afterEach(() => { scene.dispose(); engine.dispose(); });

  function skyMesh(sourceReference: string) {
    const mesh = MeshBuilder.CreateBox(sourceReference, {}, scene), material = new PBRMaterial(sourceReference, scene);
    material.metadata = { gltf: { extras: { nativeSourceReference: sourceReference, sourceSnapshot: true } } };
    mesh.material = material;
    return mesh;
  }
  const loadProgram = vi.fn(async (materialId: string): Promise<LoadedNativeMaterial> => {
    const program = parseMaterialProgram(JSON.parse(JSON.stringify(materialId === backgroundProgramSha256
      ? syntheticSkyColourModifierProgram(backgroundRoot, whiteChipImage, "ce9600ff") : syntheticUnportedProgram())));
    return { materialId, program, plan: compileMaterialStagePlan(program),
      texturePixels: new Map([[whiteChipImage.sha256, { width: 4, height: 4, rgba: new Uint8Array(64).fill(255) }]]) };
  });

  it("keeps every glTF material and names the absent listing when the sky source pins no snapshot programs", async () => {
    const meshes = [skyMesh(backgroundRoot)], materials = meshes.map(mesh => mesh.material);
    const surfaces = await bindNativeSkyLibraryMaterials({ scene, meshes, listing: null, sessionSeed: 1, loadProgram, signal: new AbortController().signal });
    expect(surfaces.map(({ status, reasons, library }) => ({ status, reasons, library }))).toEqual([{ status: "program-unconverted", reasons: [skyMaterialsListingAbsentReason], library: null }]);
    expect(meshes.map(mesh => mesh.material)).toEqual(materials);
  });

  it("draws a compiled program through the library and keeps the glTF material of a diagnostic program with its reasons", async () => {
    const listing = parseNativeSkyMaterialsListing(snapshot([listedMaterial(backgroundRoot, pin(backgroundProgramSha256)),
      listedMaterial(unportedRoot, pin(unportedProgramSha256))]), tileId);
    const meshes = [skyMesh(backgroundRoot), skyMesh(unportedRoot)], unportedMaterial = meshes[1]!.material;
    const surfaces = await bindNativeSkyLibraryMaterials({ scene, meshes, listing, sessionSeed: 1, loadProgram, signal: new AbortController().signal });
    expect(surfaces.map(({ status, programMaterialId }) => ({ status, programMaterialId }))).toEqual([
      { status: "library-compiled", programMaterialId: backgroundProgramSha256 }, { status: "library-diagnostic", programMaterialId: unportedProgramSha256 }]);
    expect(meshes[0]!.material).toBe(surfaces[0]!.library!.material);
    expect(meshes[1]!.material).toBe(unportedMaterial);
    expect(surfaces[1]!.reasons).toEqual(["material-class-unported:Engine.TexOscillatorTriggered"]);
    expect(scene.materials.some(material => material.name === "UE2 diagnostic: SyntheticSwatch.TriggeredOscillator")).toBe(false);
  });

  it("assigns no library material and releases the ones it built when the lifetime ends while binding", async () => {
    const listing = parseNativeSkyMaterialsListing(snapshot([listedMaterial(backgroundRoot, pin(backgroundProgramSha256))]), tileId);
    const lifetime = new AbortController(), meshes = [skyMesh(backgroundRoot), skyMesh(backgroundRoot)], materials = meshes.map(mesh => mesh.material);
    const abortingLoad = vi.fn(async (materialId: string, signal: AbortSignal) => {
      const loaded = await loadProgram(materialId);
      if (abortingLoad.mock.calls.length === 2) lifetime.abort();
      signal.throwIfAborted();
      return loaded;
    });
    await expect(bindNativeSkyLibraryMaterials({ scene, meshes, listing, sessionSeed: 1, loadProgram: abortingLoad, signal: lifetime.signal })).rejects.toThrow();
    expect(meshes.map(mesh => mesh.material)).toEqual(materials);
    expect(scene.materials.some(material => material.name.startsWith("UE2 material:"))).toBe(false);
  });
});
