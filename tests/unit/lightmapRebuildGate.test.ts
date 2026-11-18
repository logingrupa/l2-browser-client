import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Material } from "@babylonjs/core/Materials/material";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FOG_DISABLED, type LoadedNativeMaterial } from "../../src/materials/ue2/babylon/material";
import { parseMaterialProgram } from "../../src/materials/ue2/model/materialProgram";
import { compileMaterialStagePlan } from "../../src/materials/ue2/model/stagePlan";
import { bindTileLighting, type TileLightingBspChunk, type TileLightingSettings } from "../../src/scene/world/lighting/bindTileLighting";
import { rebuiltLightmapNotes } from "../../src/scene/world/lighting/composeRebuiltLightmap";
import { decodeTileLighting } from "../../src/scene/world/lighting/decodeTileLighting";
import { shadowLightUnlistedReason } from "../../src/scene/world/lighting/rebuiltLightmapRequest";
import { rebuildCompositionFailedReasonPrefix } from "../../src/scene/world/lighting/rebuiltLightmapStore";
import { planLightmapSections, type LightmapSectionChunk } from "../../src/scene/world/lighting/tileLightmapSections";
import type { NativeBspNodeRange, NativeBspSection } from "../../src/scene/world/nativeBspResources";
import { inThreadLightmapRebuild, planSectionsWithoutComposition, pointLightFields, rebuiltTileLightingArrays } from "../support/lightmapRebuildFixture";
import { swatchTexturePng, syntheticSwatchProgram, textureImageFor } from "../support/materialProgramFixture";
import { replaceArray, tileLightingArrays, tileLightingPayload } from "../support/tileLightingFixture";
import type { TypedPayloadFixtureArray } from "../support/typedPayloadFixture";

const sections: NativeBspSection[] = [
  { primitive: 0, material: "Synthetic.Lit", unlit: false, lightmap: 0, nativeRenderSection: 0, translucent: false },
  { primitive: 1, material: "Synthetic.Indoor", unlit: false, lightmap: 1, nativeRenderSection: 1, translucent: false },
];
const nodeRanges: NativeBspNodeRange[] = [{ node: 10, primitive: 0, firstIndex: 0, indexCount: 6 }, { node: 11, primitive: 1, firstIndex: 0, indexCount: 3 }];
const primitiveIndices = [[0, 1, 2, 0, 2, 3], [0, 1, 2]];
const primitiveVertexCounts = [4, 3];
const unportedEffectReason = "bsp-rebuild-light-effect-unported:4";
const scenes: Scene[] = [];

afterEach(() => {
  for (const scene of scenes.splice(0)) {
    const engine = scene.getEngine();
    scene.dispose();
    engine.dispose();
  }
});

function decoded(arrays: readonly TypedPayloadFixtureArray[]) {
  const payload = tileLightingPayload(arrays);
  return decodeTileLighting(payload.assetRecord, payload.payloadBytes);
}

const planningChunk: LightmapSectionChunk = { chunkId: "chunk-0-0", chunkOrdinal: 0, sections, nodeRanges,
  primitiveVertexCount: primitive => primitiveVertexCounts[primitive]!, primitiveIndices: primitive => primitiveIndices[primitive]! };

function swatchMaterial(): LoadedNativeMaterial {
  const swatchImage = textureImageFor(swatchTexturePng());
  const program = parseMaterialProgram(JSON.parse(JSON.stringify(syntheticSwatchProgram(swatchImage))));
  return { materialId: "ef".repeat(32), program, plan: compileMaterialStagePlan(program),
    texturePixels: new Map([[swatchImage.sha256, { width: 4, height: 4, rgba: new Uint8Array(64).fill(255) }]]), textureMipChains: new Map() };
}

function boundChunk(scene: Scene, materialId: string): TileLightingBspChunk {
  const meshes = sections.map((section, primitive) => {
    const mesh = new Mesh(section.material, scene);
    Object.assign(new VertexData(), { positions: Array.from({ length: primitiveVertexCounts[primitive]! * 3 }, (_, index) => index),
      indices: primitiveIndices[primitive], uvs: new Array(primitiveVertexCounts[primitive]! * 2).fill(0) }).applyToMesh(mesh);
    mesh.material = new Material(`${section.material} converted`, scene);
    mesh.material.metadata = { gltf: { extras: { nativeMaterialProgram: { directory: `native-materials/${materialId}`, programSha256: materialId } } } };
    return mesh;
  });
  return { chunkId: "chunk-0-0", chunkOrdinal: 0, sections, nodeRanges, meshes };
}

function bindRebuilt(arrays: readonly TypedPayloadFixtureArray[], compose?: TileLightingSettings["composeRebuiltLightmap"]) {
  const scene = new Scene(new NullEngine());
  scenes.push(scene);
  const loaded = swatchMaterial(), rebuild = inThreadLightmapRebuild(), composeRebuiltLightmap = vi.fn(compose ?? rebuild.composeRebuiltLightmap);
  const binding = bindTileLighting({ scene, model: decoded(arrays), sessionSeed: 1, environment: () => ({ hour: 13, hourSource: "server-time", oldType: 0, targetType: 0, weight: 0 }),
    levelSeconds: () => 0, fog: () => FOG_DISABLED, visibility: null, loadProgram: async () => loaded, rebuildEnvironment: rebuild.rebuildEnvironment, composeRebuiltLightmap });
  return { binding, chunk: boundChunk(scene, loaded.materialId), composeRebuiltLightmap };
}

describe("lightmap rebuild inputs in the lighting payload", () => {
  it("decodes the records and packed shadow masks of each texture with a differing page", () => {
    const inputs = decoded(rebuiltTileLightingArrays()).hourly.lightmapRebuild;
    if (inputs.status !== "staged") throw new Error(`Rebuild inputs not staged: ${inputs.reason}.`);
    expect(inputs.value.textureHasInputs).toEqual([true, false]);
    expect(inputs.value.textureRecords[1]).toEqual([]);
    expect(inputs.value.textureRecords[0]).toEqual([{ zone: 2, atlasX: 0, atlasY: 0, surface: { normal: [0, 0, -1], polyFlags: 0 },
      projection: { width: 4, height: 2, origin: [0, 0, 0], uStep: [1, 0, 0], vStep: [0, 1, 0] },
      shadows: [{ light: 0, height: 1, rowBytes: 1, minimumX: 0, minimumY: 0, maximumX: 0, maximumY: 0, bits: Uint8Array.of(1) }] }]);
  });

  it("stages nothing for a payload converted before the rebuild inputs", () => {
    expect(decoded(tileLightingArrays()).hourly.lightmapRebuild).toEqual({ status: "unstaged", reason: "hourly-lighting-input-unstaged:LMTX.rebuildInputs" });
  });

  it.each<[string, TypedPayloadFixtureArray[], RegExp]>([
    ["rebuild inputs on a texture whose pages all match", replaceArray(rebuiltTileLightingArrays(), "LMTX.rebuildInputs", [1, 1]), /rebuild inputs are listed, but no page/],
    ["a shadow light outside the RECS lights", replaceArray(rebuiltTileLightingArrays(), "LMSH.light", [1]), /names light 1 of 1 RECS lights/],
    ["a negative shadow light other than the unlisted marker", replaceArray(rebuiltTileLightingArrays(), "LMSH.light", [-2]), /is not a packed mask of its rectangle/],
    ["a shadow whose row bytes do not pack its width", replaceArray(rebuiltTileLightingArrays(), "LMSH.rowBytes", [2]), /is not a packed mask of its rectangle/],
    ["a record that leaves its page", replaceArray(rebuiltTileLightingArrays(), "LMRC.rectangle", [6, 0, 4, 2, 4, 4, 2, 2]), /leaves the 8 x 8 page/],
  ])("refuses %s", (_, arrays, message) => {
    expect(() => decoded(arrays)).toThrow(message);
  });
});

describe("page source gate", () => {
  it("draws a differing page from the rebuilt image when it resolves and names the composer reason when it does not", () => {
    const model = decoded(rebuiltTileLightingArrays());
    const resolved = planLightmapSections(model, [planningChunk], texture =>
      texture === 0 ? { texture, source: "rebuilt", builtAtHour: 6, uncoveredTexels: 0, notes: [] } : { texture, source: "compressed" });
    expect(resolved.map(plan => plan.kind)).toEqual(["lightmapped", "lightmapped"]);
    const unresolved = planLightmapSections(model, [planningChunk], texture =>
      texture === 0 ? { texture, source: "gap", reason: unportedEffectReason } : { texture, source: "compressed" });
    expect(unresolved[0]).toMatchObject({ kind: "gap", reason: unportedEffectReason });
    expect(unresolved[1]).toMatchObject({ kind: "lightmapped" });
  });

  it("keeps bsp-live-cache-state for a differing page of a payload without rebuild inputs", () => {
    const older = decoded(replaceArray(tileLightingArrays(), "LMPG.compressedRevision", [2, 2, 2, 2, 2, 2, 2, 2, 3]));
    expect(planSectionsWithoutComposition(older, [planningChunk])[0]).toMatchObject({ kind: "gap", reason: "bsp-live-cache-state" });
  });

  it("refuses to plan a differing texture whose rebuild was never requested", () => {
    expect(() => planSectionsWithoutComposition(decoded(rebuiltTileLightingArrays()), [planningChunk])).toThrow(/planned while its rebuild is rebuild-not-requested/);
  });
});

describe("bindTileLighting with a rebuilt lightmap texture", () => {
  it("binds the rebuilt composite to the differing pages, keeps the DXT child elsewhere and composes once per session", async () => {
    const { binding, chunk, composeRebuiltLightmap } = bindRebuilt(rebuiltTileLightingArrays());
    expect(binding.inspection().textureSources).toEqual([{ texture: 0, source: "rebuild-not-requested" }, { texture: 1, source: "compressed" }]);
    await binding.addChunk(chunk);
    const inspection = binding.inspection();
    expect(inspection.sections.map(section => [section.lighting, section.page, section.pageSource])).toEqual([["lightmapped", 4, "rebuilt-composite"],
      ["lightmapped", 8, "compressed-child"]]);
    expect(chunk.meshes[0]!.material!.getActiveTextures().map(texture => texture.name)).toContain("Tile rebuilt lightmap 0");
    expect(chunk.meshes[1]!.material!.getActiveTextures().map(texture => texture.name)).toContain("Tile lightmap page 8");
    expect(inspection.textureSources).toEqual([{ texture: 0, source: "rebuilt", builtAtHour: 6, uncoveredTexels: 56,
      notes: [rebuiltLightmapNotes.tableControlWord, rebuiltLightmapNotes.uncoveredTexels] }, { texture: 1, source: "compressed" }]);
    binding.removeChunk(chunk.chunkId);
    await binding.addChunk(chunk);
    expect(composeRebuiltLightmap).toHaveBeenCalledTimes(1);
    binding.dispose();
  });

  it("leaves the sections of a texture whose rebuild is unresolved as a gap with the composer reason", async () => {
    const { binding, chunk } = bindRebuilt(rebuiltTileLightingArrays({ ...pointLightFields, LightEffect: 4 }));
    await binding.addChunk(chunk);
    const inspection = binding.inspection();
    expect(inspection.sections[0]).toMatchObject({ lighting: "gap", status: "lighting-gap", reasons: [unportedEffectReason], pageSource: null });
    expect(inspection.textureSources[0]).toEqual({ texture: 0, source: "gap", reason: unportedEffectReason });
    binding.dispose();
  });

  it("leaves a texture as a gap when the converter could not list one of its shadow lights", async () => {
    const { binding, chunk } = bindRebuilt(replaceArray(rebuiltTileLightingArrays(), "LMSH.light", [-1]));
    await binding.addChunk(chunk);
    expect(binding.inspection().textureSources[0]).toEqual({ texture: 0, source: "gap", reason: shadowLightUnlistedReason });
    binding.dispose();
  });

  it("names a failed composition as a gap and rethrows its error to the chunk", async () => {
    const { binding, chunk } = bindRebuilt(rebuiltTileLightingArrays(), () => Promise.reject(new Error("rebuilt lightmap worker failed: out of memory")));
    await expect(binding.addChunk(chunk)).rejects.toThrow(/out of memory/);
    expect(binding.inspection().textureSources[0]).toEqual({ texture: 0, source: "gap",
      reason: `${rebuildCompositionFailedReasonPrefix}rebuilt lightmap worker failed: out of memory` });
    binding.dispose();
  });
});
