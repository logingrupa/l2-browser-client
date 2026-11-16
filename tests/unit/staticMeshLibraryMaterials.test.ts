import { afterEach, describe, expect, it, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import type { Material } from "@babylonjs/core/Materials/material";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Scene } from "@babylonjs/core/scene";
import type { LoadedNativeMaterial } from "../../src/materials/ue2/babylon/loadNativeMaterial";
import { FOG_DISABLED } from "../../src/materials/ue2/babylon/material";
import { parseMaterialProgram } from "../../src/materials/ue2/model/materialProgram";
import { compileMaterialStagePlan } from "../../src/materials/ue2/model/stagePlan";
import { bindStaticMeshLibraryMaterials, staticMeshVertexLightingUnportedReason } from "../../src/scene/world/lighting/bindStaticMeshLibraryMaterials";
import { parseNativeTileManifest } from "../../src/scene/world/nativeTileManifest";
import { readNativeSourceReference } from "../../src/scene/world/nativeSourceReference";
import {
  joinStaticMeshSlot, parseStaticMeshMaterialsListing, staticMeshMaterialsResourceAbsentReason, staticMeshSlotMaterialNoneReason,
  staticMeshSlotMaterialUnlistedReason,
} from "../../src/scene/world/staticMeshLibraryMaterials";
import { swatchTexturePng, syntheticSwatchProgram, syntheticUnportedProgram, textureImageFor, type FixtureProgram } from "../support/materialProgramFixture";

const tileId = "20_21";
const portedProgramSha256 = "a".repeat(64);
const unportedProgramSha256 = "b".repeat(64);
const unportedReason = "material-class-unported:Engine.VertexColor";

function listing(materials: readonly unknown[], extra: Record<string, unknown> = {}) {
  return { kind: "native-tile-static-mesh-materials", schemaVersion: 1, tileId, materials,
    files: { [`${portedProgramSha256}/program.json`]: { sha256: portedProgramSha256, bytes: 10 } }, ...extra };
}

const portedEntry = { sourceObject: "cruma_tr_t.Cm_o_wall010", program: { directory: `native-materials/${portedProgramSha256}`, programSha256: portedProgramSha256 },
  rootPorted: true, gapReasons: [] };
const unportedEntry = { sourceObject: "Dion_tree_T.swamp_t.a3", program: { directory: `native-materials/${unportedProgramSha256}`,
  programSha256: unportedProgramSha256 }, rootPorted: false, gapReasons: [unportedReason] };
const failedEntry = { sourceObject: "Missing.Material", program: null, rootPorted: false, gapReasons: ["decode-failed:FormatError:material package missing or ambiguous"] };

const slotMaterial = (extras: Record<string, unknown> | undefined) => ({ metadata: extras === undefined ? null : { gltf: { extras } } }) as unknown as Material;

describe("static mesh slot to library program join", () => {
  const parsed = parseStaticMeshMaterialsListing(listing([portedEntry, unportedEntry, failedEntry]), tileId);

  it("joins a slot material object to its program pin, case-insensitively like the native names", () => {
    expect(joinStaticMeshSlot(parsed, "CRUMA_TR_T.cm_o_wall010"))
      .toEqual({ kind: "program", sourceObject: portedEntry.sourceObject, programMaterialId: portedProgramSha256 });
  });

  it("returns the program gap reasons for an unported root or a failed program, and a named reason for a slot without a listed material", () => {
    expect(joinStaticMeshSlot(parsed, unportedEntry.sourceObject)).toEqual({ kind: "gap", sourceObject: unportedEntry.sourceObject, reasons: [unportedReason] });
    expect(joinStaticMeshSlot(parsed, failedEntry.sourceObject)).toEqual({ kind: "gap", sourceObject: failedEntry.sourceObject, reasons: failedEntry.gapReasons });
    expect(joinStaticMeshSlot(parsed, null)).toEqual({ kind: "gap", sourceObject: null, reasons: [staticMeshSlotMaterialNoneReason] });
    expect(joinStaticMeshSlot(parsed, "Other.Material")).toEqual({ kind: "gap", sourceObject: "Other.Material", reasons: [staticMeshSlotMaterialUnlistedReason] });
  });

  it("reads the slot material object from the glTF material extras the static mesh converter writes", () => {
    expect(readNativeSourceReference(slotMaterial({ nativeSourceReference: portedEntry.sourceObject, nativeSectionIndex: 0 }))).toBe(portedEntry.sourceObject);
    expect(readNativeSourceReference(slotMaterial({ nativeSourceReference: null, unboundSourceMaterial: "None" }))).toBeNull();
    expect(readNativeSourceReference(slotMaterial(undefined))).toBeNull();
    expect(readNativeSourceReference(null)).toBeNull();
  });
});

describe("static mesh materials listing parser", () => {
  it("refuses an unknown field, another tile, a repeated material, a program that is no pin and an unported root without a reason", () => {
    expect(() => parseStaticMeshMaterialsListing(listing([portedEntry], { extraField: true }), tileId)).toThrow(/holding exactly kind, schemaVersion/);
    expect(() => parseStaticMeshMaterialsListing(listing([portedEntry]), "20_20")).toThrow(/names tile "20_21"/);
    expect(() => parseStaticMeshMaterialsListing(listing([portedEntry, { ...portedEntry, sourceObject: portedEntry.sourceObject.toUpperCase() }]), tileId))
      .toThrow(/twice/);
    expect(() => parseStaticMeshMaterialsListing(listing([{ ...portedEntry, program: { directory: "elsewhere", programSha256: portedProgramSha256 } }]), tileId))
      .toThrow(/no native-materials program pin/);
    expect(() => parseStaticMeshMaterialsListing(listing([{ ...portedEntry, extraField: 1 }]), tileId)).toThrow(/materials must hold exactly/);
    expect(() => parseStaticMeshMaterialsListing(listing([{ ...failedEntry, rootPorted: true }]), tileId)).toThrow(/ported root without a program/);
    expect(() => parseStaticMeshMaterialsListing(listing([{ ...failedEntry, gapReasons: [] }]), tileId)).toThrow(/unported root without a gap reason/);
  });

  it("is a tile manifest resource kind at its hash-addressed native-materials path", () => {
    const listingSha256 = "e".repeat(64);
    const resource = { kind: "static-mesh-materials", manifest: `/l2/native-materials/static-mesh-materials-${listingSha256}.json`, manifestSha256: listingSha256,
      manifestBytes: 4096 };
    const manifest = (resources: readonly unknown[]) => ({ kind: "native-tile-runtime", schemaVersion: 1, tileId, sourceMap: `maps/${tileId}.unr`,
      sourceSha256: "c".repeat(64), frame: { terrainInfo: `${tileId}.TerrainInfo0`, location: [0, 0, 0], terrainScale: [1, 1, 1] },
      anchor: { playerStart: `${tileId}.PlayerStart0`, location: [0, 0, 0] },
      chunks: [{ chunkId: "chunk-0-0", manifest: `/l2/maps/${"1".repeat(64)}/native-tile-chunk-runtime/manifest.json`, manifestSha256: "1".repeat(64),
        manifestBytes: 100 }], resources, gaps: [] });
    expect(parseNativeTileManifest(manifest([resource])).resources.map(entry => entry.kind)).toEqual(["static-mesh-materials"]);
    expect(() => parseNativeTileManifest(manifest([{ ...resource, manifest: `/l2/native-materials/${listingSha256}/listing.json` }])))
      .toThrow(/static-mesh-materials resource must be \/l2\/native-materials\/static-mesh-materials-<sha256>\.json/);
    expect(() => parseNativeTileManifest(manifest([resource, resource]))).toThrow(/lists more than one static-mesh-materials resource/);
  });
});

const swatchImage = textureImageFor(swatchTexturePng());
const diagnosticProgramSha256 = "c".repeat(64);
const diagnosticEntry = { sourceObject: "Giran_T.Deep.Oscillator", program: { directory: `native-materials/${diagnosticProgramSha256}`,
  programSha256: diagnosticProgramSha256 }, rootPorted: true, gapReasons: [] };
const releases: (() => void)[] = [];
afterEach(() => { releases.splice(0).reverse().forEach(release => release()); });

function loadedProgram(materialId: string, program: FixtureProgram): LoadedNativeMaterial {
  const parsedProgram = parseMaterialProgram(JSON.parse(JSON.stringify(program)));
  return { materialId, program: parsedProgram, plan: compileMaterialStagePlan(parsedProgram),
    texturePixels: new Map([[swatchImage.sha256, { width: 4, height: 4, rgba: new Uint8Array(64).fill(255) }]]) };
}

function slotMeshes(sourceObjects: readonly (string | null)[]) {
  const engine = new NullEngine(), scene = new Scene(engine);
  releases.push(() => { scene.dispose(); engine.dispose(); });
  const meshes = sourceObjects.map((sourceObject, index) => {
    const material = new PBRMaterial(`slot ${index}`, scene);
    material.metadata = { gltf: { extras: { nativeSectionIndex: 0, nativeSourceReference: sourceObject } } };
    const mesh = new Mesh(`static mesh ${index}`, scene);
    mesh.material = material;
    return mesh;
  });
  const loadProgram = vi.fn(async (materialId: string) =>
    loadedProgram(materialId, materialId === portedProgramSha256 ? syntheticSwatchProgram(swatchImage) : syntheticUnportedProgram()));
  return { scene, meshes, loadProgram };
}

const materialUniforms = () => ({ levelSeconds: 0, hour: 12, environmentType: 0, fog: FOG_DISABLED });

describe("static mesh slots through the UE2 material library", () => {
  const parsed = parseStaticMeshMaterialsListing(listing([portedEntry, unportedEntry, diagnosticEntry]), tileId);

  it("draws a ported slot through one shared library material and keeps the texture material of every other slot with its reasons", async () => {
    const f = slotMeshes([portedEntry.sourceObject, portedEntry.sourceObject.toUpperCase(), unportedEntry.sourceObject, diagnosticEntry.sourceObject, null]);
    const textureMaterials = f.meshes.map(mesh => mesh.material);
    const binding = bindStaticMeshLibraryMaterials({ scene: f.scene, load: { listing: parsed, gap: null }, sessionSeed: 3, uniforms: materialUniforms,
      loadProgram: f.loadProgram });
    await binding.addChunk("chunk-0-0", f.meshes);
    expect(f.meshes[0]!.material).toBe(f.meshes[1]!.material);
    expect(f.meshes[0]!.material?.name).toBe("UE2 material: SyntheticSwatch.SwatchFinalBlend");
    expect(f.meshes.slice(2).map(mesh => mesh.material)).toEqual(textureMaterials.slice(2));
    expect(f.loadProgram.mock.calls.map(([materialId]) => materialId).sort()).toEqual([portedProgramSha256, diagnosticProgramSha256]);
    const inspection = binding.inspection();
    expect(inspection).toMatchObject({ gap: null, lighting: "unlit", lightingReasons: [staticMeshVertexLightingUnportedReason], meshCount: 5,
      statusCounts: { "library-compiled": 2, "library-diagnostic": 1, "program-gap": 2 } });
    expect(inspection.slots).toEqual([
      { sourceObject: null, status: "program-gap", programMaterialId: null, reasons: [staticMeshSlotMaterialNoneReason], meshes: 1 },
      { sourceObject: portedEntry.sourceObject, status: "library-compiled", programMaterialId: portedProgramSha256, reasons: [], meshes: 2 },
      { sourceObject: unportedEntry.sourceObject, status: "program-gap", programMaterialId: null, reasons: [unportedReason], meshes: 1 },
      { sourceObject: diagnosticEntry.sourceObject, status: "library-diagnostic", programMaterialId: diagnosticProgramSha256,
        reasons: ["material-class-unported:Engine.GlowModifier"], meshes: 1 },
    ]);
    binding.dispose();
  });

  it("joins a returning chunk from the remembered slot material and loads no program twice", async () => {
    const f = slotMeshes([portedEntry.sourceObject]);
    const binding = bindStaticMeshLibraryMaterials({ scene: f.scene, load: { listing: parsed, gap: null }, sessionSeed: 3, uniforms: materialUniforms,
      loadProgram: f.loadProgram });
    await binding.addChunk("chunk-0-0", f.meshes);
    binding.removeChunk("chunk-0-0");
    expect(binding.inspection().meshCount).toBe(0);
    await binding.addChunk("chunk-0-0", f.meshes);
    expect(binding.inspection().statusCounts["library-compiled"]).toBe(1);
    expect(f.loadProgram).toHaveBeenCalledTimes(1);
    binding.dispose();
  });

  it("keeps every texture material and names the listing gap when the tile pins no static mesh materials", async () => {
    const f = slotMeshes([portedEntry.sourceObject, null]);
    const textureMaterials = f.meshes.map(mesh => mesh.material);
    const binding = bindStaticMeshLibraryMaterials({ scene: f.scene, load: { listing: null, gap: staticMeshMaterialsResourceAbsentReason }, sessionSeed: 3,
      uniforms: materialUniforms, loadProgram: f.loadProgram });
    await binding.addChunk("chunk-0-0", f.meshes);
    expect(f.meshes.map(mesh => mesh.material)).toEqual(textureMaterials);
    expect(binding.inspection()).toMatchObject({ gap: staticMeshMaterialsResourceAbsentReason, meshCount: 2,
      statusCounts: { "library-compiled": 0, "library-diagnostic": 0, "program-gap": 2 } });
    expect(f.loadProgram).not.toHaveBeenCalled();
    binding.dispose();
  });

  it("updates the bound library materials every frame and leaves no observer after dispose", async () => {
    const f = slotMeshes([portedEntry.sourceObject]);
    const observersBefore = f.scene.onBeforeRenderObservable.observers.length;
    const uniforms = vi.fn(materialUniforms);
    const binding = bindStaticMeshLibraryMaterials({ scene: f.scene, load: { listing: parsed, gap: null }, sessionSeed: 3, uniforms, loadProgram: f.loadProgram });
    await binding.addChunk("chunk-0-0", f.meshes);
    f.scene.onBeforeRenderObservable.notifyObservers(f.scene);
    expect(uniforms).toHaveBeenCalled();
    binding.dispose();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(f.scene.onBeforeRenderObservable.observers.length).toBe(observersBefore);
  });
});
