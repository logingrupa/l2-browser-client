import type { Material } from "@babylonjs/core/Materials/material";
import { describe, expect, it } from "vitest";
import { parseNativeTileManifest } from "../../src/scene/world/nativeTileManifest";
import {
  joinStaticMeshSlot, parseStaticMeshMaterialsListing, readStaticMeshSlotSourceObject, staticMeshSlotMaterialNoneReason, staticMeshSlotMaterialUnlistedReason,
} from "../../src/scene/world/staticMeshLibraryMaterials";

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
    expect(readStaticMeshSlotSourceObject(slotMaterial({ nativeSourceReference: portedEntry.sourceObject, nativeSectionIndex: 0 }))).toBe(portedEntry.sourceObject);
    expect(readStaticMeshSlotSourceObject(slotMaterial({ nativeSourceReference: null, unboundSourceMaterial: "None" }))).toBeNull();
    expect(readStaticMeshSlotSourceObject(slotMaterial(undefined))).toBeNull();
    expect(readStaticMeshSlotSourceObject(null)).toBeNull();
  });
});

describe("static mesh materials listing parser", () => {
  it("refuses an unknown field, another tile, a repeated material and a program that is no pin", () => {
    expect(() => parseStaticMeshMaterialsListing(listing([portedEntry], { extraField: true }), tileId)).toThrow(/holding exactly kind, schemaVersion/);
    expect(() => parseStaticMeshMaterialsListing(listing([portedEntry]), "20_20")).toThrow(/names tile "20_21"/);
    expect(() => parseStaticMeshMaterialsListing(listing([portedEntry, { ...portedEntry, sourceObject: portedEntry.sourceObject.toUpperCase() }]), tileId))
      .toThrow(/twice/);
    expect(() => parseStaticMeshMaterialsListing(listing([{ ...portedEntry, program: { directory: "elsewhere", programSha256: portedProgramSha256 } }]), tileId))
      .toThrow(/no native-materials program pin/);
    expect(() => parseStaticMeshMaterialsListing(listing([{ ...portedEntry, extraField: 1 }]), tileId)).toThrow(/materials must hold exactly/);
    expect(() => parseStaticMeshMaterialsListing(listing([{ ...failedEntry, rootPorted: true }]), tileId)).toThrow(/ported root without a program/);
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
