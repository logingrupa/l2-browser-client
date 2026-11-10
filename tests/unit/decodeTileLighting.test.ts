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
import { bindTileLighting, type TileLightingBspChunk } from "../../src/scene/world/lighting/bindTileLighting";
import { decodeTileLighting } from "../../src/scene/world/lighting/decodeTileLighting";
import { decodeDxt1Texels, lightmapPageAtHour, lightmapSlotAtHour } from "../../src/scene/world/lighting/lightmapPages";
import { planLightmapSections, type LightmapSectionChunk } from "../../src/scene/world/lighting/tileLightmapSections";
import type { WorldEnvironmentSample } from "../../src/scene/world/lighting/worldEnvironmentClock";
import { swatchTexturePng, syntheticSwatchProgram, textureImageFor } from "../support/materialProgramFixture";
import { replaceArray, tileLightingArrays, tileLightingModel, tileLightingPayload } from "../support/tileLightingFixture";
import type { TypedPayloadFixtureArray } from "../support/typedPayloadFixture";

const sections: NativeBspSection[] = [
  { primitive: 0, material: "Synthetic.Lit", unlit: false, lightmap: 0, outdoor: true, translucent: false },
  { primitive: 1, material: "Synthetic.Indoor", unlit: false, lightmap: 1, outdoor: false, translucent: false },
  { primitive: 2, material: "Synthetic.Unlit", unlit: true, lightmap: null, outdoor: true, translucent: false },
];
const nodeRanges: NativeBspNodeRange[] = [
  { node: 10, primitive: 0, firstIndex: 0, indexCount: 6 }, { node: 11, primitive: 1, firstIndex: 0, indexCount: 3 },
  { node: 12, primitive: 2, firstIndex: 0, indexCount: 3 },
];
const primitiveIndices = [[0, 1, 2, 0, 2, 3], [0, 1, 2], [0, 1, 2]];
const primitiveVertexCounts = [4, 3, 3];
const scenes: Scene[] = [];

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
  it("reads the lightmap pages, node ranges, zones and environment program of a lighting payload", () => {
    const model = tileLightingModel();
    expect(model).toMatchObject({ textureCount: 2, sourceSha256: "0123456789abcdef".repeat(4) });
    expect(model.pages).toHaveLength(9);
    expect(model.pages[3]).toMatchObject({ texture: 0, slot: 3, slotCount: 8, edge: 8 });
    expect(model.pages[3]!.texels).toHaveLength(32);
    expect(model.nodeRanges.map(range => [range.node, range.texture, range.lightmapCoordinates.length])).toEqual([[10, 0, 8], [11, 1, 6], [12, -1, 0]]);
    expect(model.records.environmentProgram).toEqual({ startTimeHours: 12, timeRatio: 6, environmentTypes: [0, 1, 2, 3], unresolved: [] });
    expect(model.records.zones).toEqual([
      { zoneIndex: 0, fog: null, unresolvedReason: "lighting-zone-fog-unresolved:0:bDistanceFog" },
      { zoneIndex: 1, unresolvedReason: null, fog: { distanceFog: true, sunAffected: true, fog: { colourBytes: [95, 112, 116], startSourceUnits: 100, endSourceUnits: 20000 } } },
      { zoneIndex: 2, unresolvedReason: null, fog: { distanceFog: false, sunAffected: true, fog: null } },
    ]);
    expect(model.records).toMatchObject({ fogInfoCount: 1, waterVolumeCount: 1 });
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
  it("takes truncate(h * n / 24) mod n outdoors and slot 0 indoors", () => {
    expect([0, 2.99, 3, 12, 23.9].map(hour => lightmapSlotAtHour(hour, 8, true))).toEqual([0, 0, 1, 4, 7]);
    expect(lightmapSlotAtHour(13, 8, false)).toBe(0);
    expect(lightmapSlotAtHour(13, 1, true)).toBe(0);
    expect(() => lightmapSlotAtHour(24, 8, true)).toThrow(RangeError);
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
    const [outdoor, indoor, unlit] = planLightmapSections(tileLightingModel(), [plainChunk()]);
    expect(outdoor).toMatchObject({ kind: "lightmapped", lightmapTexture: 0, outdoor: true });
    expect(Array.from(outdoor?.kind === "lightmapped" ? outdoor.lightmapCoordinates : [])).toEqual([0.25, 0.5, 0.75, 0.5, 0.75, 0.75, 0.25, 0.75]);
    expect(indoor).toMatchObject({ kind: "lightmapped", lightmapTexture: 1, outdoor: false });
    expect(unlit).toEqual({ kind: "unlit", chunkId: "chunk-0-0", primitive: 2, reason: "section-unlit" });
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
    let environment: WorldEnvironmentSample = { gameMinutes: 60, hour: 1, environmentType: 0, source: "environment-program-fallback" };
    const binding = await bindTileLighting({ scene, model: tileLightingModel(), bspChunks: [chunk], sessionSeed: 1, environment: () => environment,
      levelSeconds: () => 0, fog: () => FOG_DISABLED, loadProgram: async () => loaded }, new AbortController().signal);
    const pagesAtOne = binding.inspection().sections.map(section => section.page);
    expect(binding.inspection().sections.map(section => section.status)).toEqual(["library-compiled", "library-compiled", "program-unconverted"]);
    expect(meshes[0]!.material!.getClassName()).toBe("ShaderMaterial");
    expect(meshes[0]!.getVerticesData("uv2")).toEqual(new Float32Array([0.25, 0.5, 0.75, 0.5, 0.75, 0.75, 0.25, 0.75]));
    expect(meshes[2]!.material!.name).toBe("Synthetic.Unlit converted");
    environment = { gameMinutes: 780, hour: 13, environmentType: 0, source: "environment-program-fallback" };
    scene.onBeforeRenderObservable.notifyObservers(scene);
    const pagesAtThirteen = binding.inspection().sections.map(section => section.page);
    expect(pagesAtOne).toEqual([0, 8, null]);
    expect(pagesAtThirteen).toEqual([4, 8, null]);
    expect(binding.inspection().sections[0]!.hourPages).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    binding.dispose();
  });
});
