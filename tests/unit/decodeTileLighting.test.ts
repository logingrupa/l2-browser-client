import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Material } from "@babylonjs/core/Materials/material";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, describe, expect, it } from "vitest";
import { FOG_DISABLED, type LoadedNativeMaterial } from "../../src/materials/ue2/babylon/material";
import { parseMaterialProgram } from "../../src/materials/ue2/model/materialProgram";
import { compileMaterialStagePlan } from "../../src/materials/ue2/model/stagePlan";
import type { NativeBspNodeRange, NativeBspSection } from "../../src/scene/world/nativeBspResources";
import { bindTileLighting, lightmapColourOperationOf, type TileLightingBspChunk } from "../../src/scene/world/lighting/bindTileLighting";
import { decodeTileLighting, type TileLightingModel } from "../../src/scene/world/lighting/decodeTileLighting";
import { decodeDxt1Texels, lightmapPageAtHour } from "../../src/scene/world/lighting/lightmapPages";
import {
  planLightmapSections, sectionSunAffectUnresolvedReason, type LightmapSectionChunk,
} from "../../src/scene/world/lighting/tileLightmapSections";
import type { WorldEnvironmentSample } from "../../src/scene/world/worldTimeOfDay";
import { swatchTexturePng, syntheticSwatchProgram, textureImageFor } from "../support/materialProgramFixture";
import { replaceArray, tileLightingArrays, tileLightingModel, tileLightingPayload, withoutArray } from "../support/tileLightingFixture";
import type { TypedPayloadFixtureArray } from "../support/typedPayloadFixture";

const sections: NativeBspSection[] = [
  { primitive: 0, material: "Synthetic.Lit", unlit: false, lightmap: 0, nativeRenderSection: 0, translucent: false },
  { primitive: 1, material: "Synthetic.Indoor", unlit: false, lightmap: 1, nativeRenderSection: 1, translucent: false },
  { primitive: 2, material: "Synthetic.Unlit", unlit: true, lightmap: null, nativeRenderSection: 2, translucent: false },
];
const nodeRanges: NativeBspNodeRange[] = [
  { node: 10, primitive: 0, firstIndex: 0, indexCount: 6 }, { node: 11, primitive: 1, firstIndex: 0, indexCount: 3 },
  { node: 12, primitive: 2, firstIndex: 0, indexCount: 3 },
];
const primitiveIndices = [[0, 1, 2, 0, 2, 3], [0, 1, 2], [0, 1, 2]];
const primitiveVertexCounts = [4, 3, 3];
const scenes: Scene[] = [];

function environmentAtHour(hour: number): WorldEnvironmentSample {
  return { hour, hourSource: "server-time", oldType: 0, targetType: 0, weight: 0 };
}

function decoded(arrays: readonly TypedPayloadFixtureArray[]) {
  const payload = tileLightingPayload(arrays);
  return decodeTileLighting(payload.assetRecord, payload.payloadBytes);
}

function plainChunk(ranges: readonly NativeBspNodeRange[] = nodeRanges): LightmapSectionChunk {
  return { chunkId: "chunk-0-0", chunkOrdinal: 0, sections, nodeRanges: ranges, primitiveVertexCount: primitive => primitiveVertexCounts[primitive]!,
    primitiveIndices: primitive => primitiveIndices[primitive]! };
}

afterEach(() => {
  for (const scene of scenes.splice(0)) {
    const engine = scene.getEngine();
    scene.dispose();
    engine.dispose();
  }
});

describe("decodeTileLighting", () => {
  it("reads the lightmap pages, node ranges and zones of a lighting payload", () => {
    const model = tileLightingModel();
    expect(model).toMatchObject({ textureCount: 2, sourceSha256: "0123456789abcdef".repeat(4) });
    expect(model.pages).toHaveLength(9);
    expect(model.pages[3]).toMatchObject({ texture: 0, slot: 3, slotCount: 8, edge: 8 });
    expect(model.pages[3]!.texels).toHaveLength(32);
    expect(model.nodeRanges.map(range => [range.node, range.texture, range.lightmapCoordinates.length])).toEqual([[10, 0, 8], [11, 1, 6], [12, -1, 0]]);
    expect(model.records.zones).toEqual([
      { zoneIndex: 0, fog: null, unresolvedReason: "lighting-zone-fog-unresolved:0:bDistanceFog" },
      { zoneIndex: 1, unresolvedReason: null, fog: { distanceFog: true, terrainZone: false,
        fog: { colourBytes: [95, 112, 116], startSourceUnits: 100, endSourceUnits: 20000 } } },
      { zoneIndex: 2, unresolvedReason: null, fog: { distanceFog: false, terrainZone: false, fog: null } },
      { zoneIndex: 3, unresolvedReason: null, fog: { distanceFog: true, terrainZone: true, fog: null } },
    ]);
    expect(model.records.waterVolumeCount).toBe(1);
    expect(model.records.fogInfos.map(fogInfo => [fogInfo.exportIndex, fogInfo.unresolvedReason, fogInfo.record?.fogRanges.length])).toEqual([[9236, null, 5]]);
  });

  it("refuses page counts that disagree with the page arrays", () => {
    expect(() => decoded(replaceArray(tileLightingArrays(), "LMPG.slot", [0, 1, 2, 3, 4, 5, 6, 7]))).toThrow(/LMPG.slot holds 8 values; the counts need 9/);
    expect(() => decoded(replaceArray(tileLightingArrays(), "LMTX.pageStart", [0, 8, 10]))).toThrow(/LMTX.pageStart must run from 0 to 9/);
    expect(() => decoded(replaceArray(tileLightingArrays(), "LMPG.slotCount", [8, 8, 8, 8, 8, 8, 8, 4, 1]))).toThrow(/page 7 is slot 7 of 4/);
    const mipEdge = tileLightingArrays().find(array => array.name === "LMPG.mipEdge")!.values.map((edge, index) => index === 0 ? 16 : edge);
    expect(() => decoded(replaceArray(tileLightingArrays(), "LMPG.mipEdge", mipEdge))).toThrow(/page 0 mip 0 DXT1 bytes holds 32 values; the counts need 128/);
  });

  it("refuses lightmap coordinate counts that disagree with the node ranges", () => {
    expect(() => decoded(replaceArray(tileLightingArrays(), "LMNR.uvStart", [0, 4, 7, 8]))).toThrow(/LMNR.uvStart must run from 0 to 7/);
    expect(() => decoded(replaceArray(tileLightingArrays(), "LMNR.uvStart", [0, 4, 4, 7]))).toThrow(/node 11 has lightmap texture 1 and 0 lightmap coordinates/);
    expect(() => decoded(replaceArray(tileLightingArrays(), "LMNR.texture", [0, 2, -1]))).toThrow(/LMNR.texture\[1\] = 2 is not a lightmap texture of the 2/);
  });

  it("refuses units other than source", () => {
    const payload = tileLightingPayload();
    expect(() => decodeTileLighting({ ...payload.assetRecord, units: "metres" }, payload.payloadBytes)).toThrow(/units must be "source"/);
  });
});

describe("lightmap pages by hour", () => {
  it("offsets the texture's first page by the model slot of the hour", () => {
    const model = tileLightingModel();
    expect(lightmapPageAtHour(model, 0, 1, true)).not.toBe(lightmapPageAtHour(model, 0, 13, true));
    expect(lightmapPageAtHour(model, 1, 13, false)).toBe(8);
  });

  it("decodes DXT1 blocks with the four-colour and the transparent three-colour palette", () => {
    const fourColour = decodeDxt1Texels(new Uint8Array([0x00, 0xf8, 0x1f, 0x00, 0b11100100, 0, 0, 0]), 4);
    expect(Array.from(fourColour.subarray(0, 16))).toEqual([255, 0, 0, 255, 0, 0, 255, 255, 170, 0, 85, 255, 85, 0, 170, 255]);
    const threeColour = decodeDxt1Texels(new Uint8Array([0x1f, 0x00, 0x00, 0xf8, 0b11100100, 0, 0, 0]), 4);
    expect(Array.from(threeColour.subarray(8, 16))).toEqual([127, 0, 127, 255, 0, 0, 0, 0]);
    expect(() => decodeDxt1Texels(new Uint8Array(7), 4)).toThrow(/needs 8 bytes/);
  });
});

describe("planLightmapSections", () => {
  it("places each node range's lightmap coordinates on its own vertices and leaves unlit sections unlit", () => {
    const [sunAffected, sheltered, unlit] = planLightmapSections(tileLightingModel(), [plainChunk()]);
    expect(sunAffected).toMatchObject({ kind: "lightmapped", lightmapTexture: 0, nativeRenderSection: 0, sunAffectedNodes: [10] });
    expect(Array.from(sunAffected?.kind === "lightmapped" ? sunAffected.lightmapCoordinates : [])).toEqual([0.25, 0.5, 0.75, 0.5, 0.75, 0.75, 0.25, 0.75]);
    expect(sheltered).toMatchObject({ kind: "lightmapped", lightmapTexture: 1, nativeRenderSection: 1, sunAffectedNodes: [] });
    expect(unlit).toEqual({ kind: "unlit", chunkId: "chunk-0-0", primitive: 2, reason: "section-unlit" });
  });

  it("lists the sun-affected nodes of each section from the LMNR row of each node range", () => {
    const swapped = decoded(replaceArray(tileLightingArrays(), "LMNR.sunAffect", [0, 1, 0]));
    const [first, second] = planLightmapSections(swapped, [plainChunk()]);
    expect([first, second].map(plan => plan?.kind === "lightmapped" ? plan.sunAffectedNodes : null)).toEqual([[], [11]]);
  });

  it.each<[string, () => TileLightingModel, LightmapSectionChunk, string]>([
    ["a section with a node range whose sun affect is unresolved",
      () => decoded(replaceArray(tileLightingArrays(), "LMNR.sunAffect", [-1, 0, 0])), plainChunk(), sectionSunAffectUnresolvedReason],
    ["a payload converted before LMNR.sunAffect", () => decoded(withoutArray(tileLightingArrays(), "LMNR.sunAffect")), plainChunk(),
      "hourly-lighting-input-unstaged:LMNR.sunAffect"],
    ["a payload converted before the page footer", () => decoded(withoutArray(tileLightingArrays(), "LMPG.compressedRevision")), plainChunk(),
      "hourly-lighting-input-unstaged:LMPG.compressedRevision"],
    ["a page whose revision differs from its compressed revision",
      () => decoded(replaceArray(tileLightingArrays(), "LMPG.compressedRevision", [3, 3, 4, 3, 3, 3, 3, 3, 3])), plainChunk(), "bsp-live-cache-state"],
  ])("turns %s into a named gap instead of a lightmap", (_, model, chunk, reason) => {
    expect(planLightmapSections(model(), [chunk])[0]).toMatchObject({ kind: "gap", reason });
  });

  it("names a node range the lighting resource holds differently from the chunk BSP", () => {
    const shifted = nodeRanges.map(range => range.node === 10 ? { ...range, indexCount: 3 } : range);
    expect(planLightmapSections(tileLightingModel(), [plainChunk(shifted)])[0]).toMatchObject({ kind: "gap", reason: "lighting-node-range-unmapped:10" });
  });
});

describe("bindTileLighting", () => {
  it("gives every BSP section a native material whose lightmap page follows its section lightmap texture and the hour", async () => {
    const scene = new Scene(new NullEngine());
    scenes.push(scene);
    const swatchImage = textureImageFor(swatchTexturePng());
    const program = parseMaterialProgram(JSON.parse(JSON.stringify(syntheticSwatchProgram(swatchImage))));
    const loaded: LoadedNativeMaterial = { materialId: "ef".repeat(32), program, plan: compileMaterialStagePlan(program),
      texturePixels: new Map([[swatchImage.sha256, { width: 4, height: 4, rgba: new Uint8Array(64).fill(255) }]]) };
    const meshes = sections.map((section, primitive) => {
      const mesh = new Mesh(section.material, scene);
      const positions = Array.from({ length: primitiveVertexCounts[primitive]! * 3 }, (_, index) => index);
      Object.assign(new VertexData(), { positions, indices: primitiveIndices[primitive], uvs: new Array(primitiveVertexCounts[primitive]! * 2).fill(0) }).applyToMesh(mesh);
      mesh.material = new Material(`${section.material} converted`, scene);
      mesh.material.metadata = primitive === 2 ? null : { gltf: { extras: { nativeMaterialProgram: { directory: `native-materials/${loaded.materialId}`, programSha256: loaded.materialId } } } };
      return mesh;
    });
    const chunk: TileLightingBspChunk = { chunkId: "chunk-0-0", chunkOrdinal: 0, sections, nodeRanges, meshes };
    let environment = environmentAtHour(1);
    const binding = bindTileLighting({ scene, model: tileLightingModel(), sessionSeed: 1, environment: () => environment,
      levelSeconds: () => 0, fog: () => FOG_DISABLED, visibility: null, loadProgram: async () => loaded });
    await binding.addChunk(chunk);
    const pagesAtOne = binding.inspection().sections.map(section => section.page);
    expect(binding.inspection().sections.map(section => section.status)).toEqual(["library-compiled", "library-compiled", "program-unconverted"]);
    expect(meshes[0]!.material!.getClassName()).toBe("ShaderMaterial");
    expect(meshes[0]!.getVerticesData("uv2")).toEqual(new Float32Array([0.25, 0.5, 0.75, 0.5, 0.75, 0.75, 0.25, 0.75]));
    expect(meshes[2]!.material!.name).toBe("Synthetic.Unlit converted");
    environment = environmentAtHour(13);
    scene.onBeforeRenderObservable.notifyObservers(scene);
    const pagesAtThirteen = binding.inspection().sections.map(section => section.page);
    expect(pagesAtOne).toEqual([0, 8, null]);
    expect(pagesAtThirteen).toEqual([4, 8, null]);
    expect(binding.inspection().textureSlots).toEqual([{ texture: 0, childCount: 8, sunAffectedSlot: 4 }, { texture: 1, childCount: 1, sunAffectedSlot: 0 }]);
    expect(binding.inspection()).toMatchObject({ sunAffectedSectionCount: 1, lightmapUpload: { reason: "lightmap-bc1-cpu-decode" } });
    expect(binding.inspection().sections.map(section => [section.sunAffect, section.colourOperation?.operation ?? null, section.reasons])).toEqual([
      [true, "global-modulation", ["d3d-device-live-state"]], [false, "global-modulation", ["d3d-device-live-state"]], [null, null, ["section-unlit"]]]);
    expect(binding.inspection().lightmapHourGap).toBeNull();
    const boundLightmapPages = () => meshes[0]!.material!.getActiveTextures().map(texture => texture.name).filter(name => name.startsWith("Tile lightmap page"));
    expect(boundLightmapPages()).toEqual(["Tile lightmap page 4"]);
    environment = environmentAtHour(25);
    expect(() => scene.onBeforeRenderObservable.notifyObservers(scene)).not.toThrow();
    expect(binding.inspection()).toMatchObject({ lightmapHourGap: "lightmap-hour-outside-day:25" });
    expect(binding.inspection().sections.map(section => section.page)).toEqual([null, null, null]);
    expect(boundLightmapPages()).toEqual(["Tile lightmap page 4"]);
    expect(binding.inspection().sections[0]!.hourPages).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    const boundMaterial = meshes[0]!.material!;
    binding.removeChunk("chunk-0-0");
    expect(binding.inspection()).toMatchObject({ sectionCount: 0, lightmappedSectionCount: 0, sections: [] });
    expect(scene.materials.includes(boundMaterial)).toBe(false);
    for (const [primitive, mesh] of meshes.entries()) {
      if (primitive === 2) continue;
      mesh.material = new Material(`${sections[primitive]!.material} converted again`, scene);
      mesh.material.metadata = { gltf: { extras: { nativeMaterialProgram: { directory: `native-materials/${loaded.materialId}`, programSha256: loaded.materialId } } } };
    }
    await binding.addChunk(chunk);
    expect(binding.inspection()).toMatchObject({ sectionCount: 3, lightmappedSectionCount: 2 });
    expect(meshes[0]!.material!.getClassName()).toBe("ShaderMaterial");
    binding.dispose();
  });

  it("takes D3DTOP_MODULATE for a ColorModifier root and the MODULATE2X image default with the live device gap otherwise", () => {
    const swatchImage = textureImageFor(swatchTexturePng());
    const program = parseMaterialProgram(JSON.parse(JSON.stringify(syntheticSwatchProgram(swatchImage))));
    const loaded: LoadedNativeMaterial = { materialId: "ef".repeat(32), program, plan: compileMaterialStagePlan(program), texturePixels: new Map() };
    const colourModifierRoot: LoadedNativeMaterial = { ...loaded, program: { ...program,
      nodes: program.nodes.map(node => node.id === program.root ? { ...node, class: "Engine.ColorModifier" } : node) } };
    expect(lightmapColourOperationOf(colourModifierRoot)).toEqual({ operation: "modulate", opcode: 4 });
    expect(lightmapColourOperationOf(loaded)).toEqual({ operation: "global-modulation", imageDefaultOpcode: 5, status: "unresolved", reason: "d3d-device-live-state" });
  });

  it("binds no material for a chunk removed while its program loads and keeps no sections for it", async () => {
    const scene = new Scene(new NullEngine());
    scenes.push(scene);
    const meshes = sections.map((section, primitive) => {
      const mesh = new Mesh(section.material, scene);
      Object.assign(new VertexData(), { positions: Array.from({ length: primitiveVertexCounts[primitive]! * 3 }, (_, index) => index), indices: primitiveIndices[primitive] })
        .applyToMesh(mesh);
      mesh.material = new Material(`${section.material} converted`, scene);
      mesh.material.metadata = { gltf: { extras: { nativeMaterialProgram: { directory: `native-materials/${"ab".repeat(32)}`, programSha256: "ab".repeat(32) } } } };
      return mesh;
    });
    const originalMaterials = meshes.map(mesh => mesh.material);
    let releaseProgram: (() => void) | null = null;
    const binding = bindTileLighting({ scene, model: tileLightingModel(), sessionSeed: 1,
      environment: () => environmentAtHour(1), levelSeconds: () => 0, fog: () => FOG_DISABLED, visibility: null,
      loadProgram: (_materialId, signal) => new Promise((_resolve, reject) => { releaseProgram = () => reject(signal.reason); }) });
    const adding = binding.addChunk({ chunkId: "chunk-0-0", chunkOrdinal: 0, sections, nodeRanges, meshes });
    await Promise.resolve();
    binding.removeChunk("chunk-0-0");
    releaseProgram!();
    await expect(adding).rejects.toThrow();
    expect(meshes.map(mesh => mesh.material)).toEqual(originalMaterials);
    expect(binding.inspection().sections).toEqual([]);
    binding.dispose();
  });
});
