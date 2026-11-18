import { afterEach, describe, expect, it, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Scene } from "@babylonjs/core/scene";
import type { LoadedNativeMaterial } from "../../src/materials/ue2/babylon/loadNativeMaterial";
import { FOG_DISABLED } from "../../src/materials/ue2/babylon/material";
import { buildTerrainLayerFragmentChain } from "../../src/materials/ue2/babylon/fragmentChain";
import { TERRAIN_LAYER_CONSTANTS } from "../../src/materials/ue2/model/constants/terrainLayerConstants";
import { parseMaterialProgram } from "../../src/materials/ue2/model/materialProgram";
import { compileMaterialStagePlan } from "../../src/materials/ue2/model/stagePlan";
import {
  alphaMapChannelsAreEqual, packTerrainAlphaMaps, singleTextureSampler, terrainLayerAlphaChannelsDifferReason, terrainLayerProgramNotSingleTextureReason,
} from "../../src/materials/ue2/model/terrainLayers";
import {
  bindTerrainLayerMaterials, terrainLayerBaseUnconvertedReasonPrefix, terrainLayerSamplerBudgetReasonPrefix, terrainLayerUseAlphaUnverifiedReasonPrefix,
  terrainLayerUvRowsDifferReason, terrainLightingUnportedReason,
} from "../../src/scene/world/lighting/bindTerrainLayerMaterials";
import { parseNativeTileManifest } from "../../src/scene/world/nativeTileManifest";
import {
  attachTerrainLayerUvRows, parseTerrainLayerUvExtras, parseTerrainMaterialsListing, type TerrainLayerUvRows,
} from "../../src/scene/world/terrainLayerMaterials";
import { programOf, swatchTextureNode, swatchTexturePng, syntheticSwatchProgram, textureImageFor } from "../support/materialProgramFixture";

const tileId = "20_21";
const pin = (character: string) => ({ directory: `native-materials/${character.repeat(64)}`, programSha256: character.repeat(64) });
const layerEntry = (index: number, texture: string, alphaMap: string, extra: Record<string, unknown> = {}) => ({
  index, texture, textureProgram: pin("a"), alphaMap, alphaMapProgram: pin("b"), useAlpha: false, rootsPorted: true, gapReasons: [], ...extra,
});
const listing = (layers: readonly unknown[], extra: Record<string, unknown> = {}) =>
  ({ kind: "native-tile-terrain-materials", schemaVersion: 1, tileId, layers, files: {}, ...extra });
const releases: (() => void)[] = [];
afterEach(() => { releases.splice(0).reverse().forEach(release => release()); });

describe("terrain materials listing", () => {
  it("reads drawn layers in increasing order with their texture and alpha map program pins", () => {
    const parsed = parseTerrainMaterialsListing(listing([layerEntry(0, "T_texture.Texture.Base", "T_texture.Texture.layer0"),
      layerEntry(6, "T_Dion.DI_C3", "T_20_21.Height.20_21_C", { useAlpha: true })]), tileId);
    expect(parsed.layers.map(layer => [layer.index, layer.textureProgramId, layer.alphaMapProgramId, layer.useAlpha]))
      .toEqual([[0, "a".repeat(64), "b".repeat(64), false], [6, "a".repeat(64), "b".repeat(64), true]]);
  });

  it("refuses layers out of order, another tile, ported roots without programs and unported roots without reasons", () => {
    expect(() => parseTerrainMaterialsListing(listing([layerEntry(2, "A.B", "C.D"), layerEntry(1, "A.B", "C.D")]), tileId)).toThrow(/increasing layer order/);
    expect(() => parseTerrainMaterialsListing(listing([layerEntry(0, "A.B", "C.D")]), "20_20")).toThrow(/names tile "20_21"/);
    expect(() => parseTerrainMaterialsListing(listing([layerEntry(0, "A.B", "C.D", { alphaMapProgram: null })]), tileId)).toThrow(/without both programs/);
    expect(() => parseTerrainMaterialsListing(listing([layerEntry(0, "A.B", "C.D", { rootsPorted: false })]), tileId)).toThrow(/without a gap reason/);
    expect(() => parseTerrainMaterialsListing(listing([]), tileId)).toThrow(/1 to 32 drawn layers/);
  });

  it("is a tile manifest resource kind at its hash-addressed native-materials path", () => {
    const sha256 = "e".repeat(64);
    const manifest = parseNativeTileManifest({ kind: "native-tile-runtime", schemaVersion: 1, tileId, sourceMap: `maps/${tileId}.unr`, sourceSha256: "c".repeat(64),
      frame: { terrainInfo: `${tileId}.TerrainInfo0`, location: [0, 0, 0], terrainScale: [1, 1, 1] }, anchor: { playerStart: `${tileId}.PlayerStart0`, location: [0, 0, 0] },
      chunks: [{ chunkId: "chunk-0-0", manifest: `/l2/maps/${"1".repeat(64)}/native-tile-chunk-runtime/manifest.json`, manifestSha256: "1".repeat(64), manifestBytes: 100 }],
      resources: [{ kind: "terrain-materials", manifest: `/l2/native-materials/terrain-materials-${sha256}.json`, manifestSha256: sha256, manifestBytes: 10 }], gaps: [] });
    expect(manifest.resources.map(resource => resource.kind)).toEqual(["terrain-materials"]);
  });
});

describe("terrain layer UV rows from the terrain GLB", () => {
  it("takes the serialized TerrainMatrix columns 0 and 1 as the U and V rows of each retained layer", () => {
    const matrix = [[0.25, 0, 0, 0], [0, 0.5, 0, 0], [0, 0, 1, 0], [3, 4, 0, 1]];
    const rows = parseTerrainLayerUvExtras({ meshes: [{ extras: { nativeLayers: [{ index: 0, texture: "A.B", alphaMap: "C.D", worldToTextureRowMajor: matrix }] } }] });
    expect(rows).toEqual([{ index: 0, texture: "A.B", alphaMap: "C.D", rowU: [0.25, 0, 0, 3], rowV: [0, 0.5, 0, 4] }]);
    expect(() => parseTerrainLayerUvExtras({ meshes: [{ extras: {} }] })).toThrow(/extras list nativeLayers/);
    expect(() => parseTerrainLayerUvExtras({ meshes: [{ extras: { nativeLayers: [{ index: 0, texture: "A.B", alphaMap: "C.D", worldToTextureRowMajor: [[1]] }] } }] }))
      .toThrow(/four rows of four finite numbers/);
  });
});

const grey = (width: number, value: number) => ({ width, height: width, rgba: new Uint8Array(width * width * 4).fill(value) });

describe("terrain alpha maps", () => {
  it("packs equal-channel alpha maps four to an RGBA texture per size and clamp mode and names each layer's channel", () => {
    const alphaMaps = [grey(4, 10), grey(4, 20), grey(2, 30), grey(4, 40), grey(4, 50), grey(4, 60)].map(pixels => ({ pixels, clampU: false, clampV: false }));
    const packing = packTerrainAlphaMaps(alphaMaps);
    expect(packing.layerWeights).toEqual([{ maskTexture: 0, channel: "red" }, { maskTexture: 0, channel: "green" }, { maskTexture: 1, channel: "red" },
      { maskTexture: 0, channel: "blue" }, { maskTexture: 0, channel: "alpha" }, { maskTexture: 2, channel: "red" }]);
    expect(Array.from(packing.maskTextures[0]!.pixels.rgba.subarray(0, 4))).toEqual([10, 20, 40, 50]);
    expect(packing.maskTextures.map(mask => mask.pixels.width)).toEqual([4, 2, 4]);
  });

  it("accepts an alpha map only when its red, green, blue and alpha bytes agree", () => {
    expect(alphaMapChannelsAreEqual(grey(2, 7))).toBe(true);
    const mixed = grey(2, 7);
    mixed.rgba[1] = 8;
    expect(alphaMapChannelsAreEqual(mixed)).toBe(false);
  });
});

describe("terrain layer fragment chain", () => {
  it("draws the base layer opaque and blends each later layer by its alpha map as Ci * Ai + Cold * (1 - Ai), then fogs once", () => {
    const chain = buildTerrainLayerFragmentChain([{ maskTexture: 0, channel: "red" }, { maskTexture: 0, channel: "green" }], 1);
    expect(chain.samplers).toEqual(["ue2TerrainLayer0", "ue2TerrainLayer1", "ue2TerrainLayer2", "ue2TerrainMask0"]);
    expect(chain.fragmentSource).toContain("vec3 ue2TerrainColour = texture2D(ue2TerrainLayer0, vec2(dot(vec4(ue2TerrainNativePosition, 1.0), ue2TerrainLayerRowU0)");
    expect(chain.fragmentSource).toContain("float ue2TerrainLayerAlpha2 = texture2D(ue2TerrainMask0, ue2TerrainMaskCoordinates).g;");
    expect(chain.fragmentSource).toMatch(/ue2TerrainColour = texture2D\(ue2TerrainLayer2, .+\)\.rgb \* ue2TerrainLayerAlpha2 \+ ue2TerrainColour \* \(1\.0 - ue2TerrainLayerAlpha2\);/);
    expect(chain.fragmentSource).toContain("gl_FragColor = vec4(mix(clamp(ue2TerrainColour, 0.0, 1.0), ue2FogColour.rgb, ue2FogFactor), clamp(1.0, 0.0, 1.0));");
  });

  it("names the verified pass blends and the one assumption about the inherited blend operation", () => {
    expect(TERRAIN_LAYER_CONSTANTS.basePassBlend.runtimeDefault).toEqual({ source: "one", destination: "zero" });
    expect(TERRAIN_LAYER_CONSTANTS.layerPassBlend.runtimeDefault).toEqual({ source: "source-alpha", destination: "inverse-source-alpha" });
    expect(TERRAIN_LAYER_CONSTANTS.blendOperation).toMatchObject({ status: "unconfirmed", runtimeDefault: "add" });
    expect(TERRAIN_LAYER_CONSTANTS.blendOperation.provenance).toMatch(/^assumption:/);
  });
});

const textureImage = textureImageFor(swatchTexturePng());
const textureRootProgram = (root: string) => programOf(root, [swatchTextureNode(root, textureImage)]);

function loaded(materialId: string, program: ReturnType<typeof programOf>, value: number): LoadedNativeMaterial {
  const parsedProgram = parseMaterialProgram(JSON.parse(JSON.stringify(program)));
  return { materialId, program: parsedProgram, plan: compileMaterialStagePlan(parsedProgram), texturePixels: new Map([[textureImage.sha256, grey(4, value)]]), textureMipChains: new Map() };
}

const uvRows = (index: number, texture: string, alphaMap: string, offset = 0): TerrainLayerUvRows =>
  ({ index, texture, alphaMap, rowU: [1 / 256, 0, 0, offset], rowV: [0, 1 / 256, 0, 0] });

function terrainScene(rows: readonly TerrainLayerUvRows[][]) {
  const engine = new NullEngine(), scene = new Scene(engine);
  releases.push(() => { scene.dispose(); engine.dispose(); });
  const meshes = rows.map((meshRows, index) => {
    const mesh = new Mesh(`terrain ${index}`, scene);
    attachTerrainLayerUvRows(mesh, meshRows);
    return mesh;
  });
  const programs = new Map<string, LoadedNativeMaterial>([
    ["a".repeat(64), loaded("a".repeat(64), textureRootProgram("T.Base"), 100)],
    ["b".repeat(64), loaded("b".repeat(64), textureRootProgram("T.Alpha"), 128)],
    ["c".repeat(64), loaded("c".repeat(64), syntheticSwatchProgram(textureImage), 50)],
  ]);
  return { scene, meshes, loadProgram: vi.fn(async (materialId: string) => programs.get(materialId)!) };
}

const base = layerEntry(0, "T.Base", "T.Alpha");
const blended = layerEntry(1, "T.Base", "T.Alpha", { useAlpha: true });
const unported = layerEntry(2, "T.Base", "T.Missing", { alphaMapProgram: null, rootsPorted: false, gapReasons: ["decode-failed:FormatError:missing"] });
const notSingleTexture = layerEntry(3, "T.Base", "T.Alpha", { textureProgram: pin("c") });
const meshRows = [uvRows(0, "T.Base", "T.Alpha"), uvRows(1, "T.Base", "T.Alpha", 0.5), uvRows(3, "T.Base", "T.Alpha")];

describe("terrain layers through the UE2 library", () => {
  it("draws every convertible layer of a chunk through one library material and lists each other layer with its reasons", async () => {
    const f = terrainScene([meshRows, meshRows]);
    const parsed = parseTerrainMaterialsListing(listing([base, blended, unported, notSingleTexture]), tileId);
    const binding = bindTerrainLayerMaterials({ scene: f.scene, load: { listing: parsed, gap: null }, fog: () => FOG_DISABLED, loadProgram: f.loadProgram });
    await binding.addChunk("chunk-0-0", f.meshes);
    expect(f.meshes[0]!.material).toBe(f.meshes[1]!.material);
    expect(f.meshes[0]!.material?.name).toBe(`UE2 terrain layers: ${tileId}`);
    expect(binding.inspection()).toMatchObject({ gap: null, lighting: "unlit", lightingReasons: [terrainLightingUnportedReason], drawnLayers: [0, 1],
      samplerCount: 3, meshCount: 2, statusCounts: { "library-terrain-layers": 2, "terrain-layer-gap": 0 },
      layerReasons: [{ index: 1, reasons: [`${terrainLayerUseAlphaUnverifiedReasonPrefix}1`] }, { index: 2, reasons: ["decode-failed:FormatError:missing"] },
        { index: 3, reasons: [terrainLayerProgramNotSingleTextureReason] }] });
    binding.dispose();
  });

  it("keeps the neutral material when the base layer does not convert, when mesh UV rows differ, or past the sampler budget", async () => {
    const baseless = terrainScene([meshRows]);
    const unportedBase = parseTerrainMaterialsListing(listing([{ ...unported, index: 0 }, blended]), tileId);
    const baselessBinding = bindTerrainLayerMaterials({ scene: baseless.scene, load: { listing: unportedBase, gap: null }, fog: () => FOG_DISABLED,
      loadProgram: baseless.loadProgram });
    await baselessBinding.addChunk("chunk-0-0", baseless.meshes);
    expect(baselessBinding.inspection()).toMatchObject({ gap: `${terrainLayerBaseUnconvertedReasonPrefix}0`, statusCounts: { "terrain-layer-gap": 1 } });
    expect(baseless.meshes[0]!.material).toBeNull();

    const differing = terrainScene([meshRows, [uvRows(0, "T.Base", "T.Alpha", 0.25), ...meshRows.slice(1)]]);
    const twoLayers = parseTerrainMaterialsListing(listing([base, blended]), tileId);
    const differingBinding = bindTerrainLayerMaterials({ scene: differing.scene, load: { listing: twoLayers, gap: null }, fog: () => FOG_DISABLED,
      loadProgram: differing.loadProgram });
    await differingBinding.addChunk("chunk-0-0", differing.meshes);
    expect(differingBinding.inspection()).toMatchObject({ gap: terrainLayerUvRowsDifferReason, statusCounts: { "terrain-layer-gap": 2 } });

    const budget = terrainScene([meshRows]);
    vi.spyOn(budget.scene.getEngine(), "getCaps").mockReturnValue({ ...budget.scene.getEngine().getCaps(), maxTexturesImageUnits: 2 });
    const budgetBinding = bindTerrainLayerMaterials({ scene: budget.scene, load: { listing: twoLayers, gap: null }, fog: () => FOG_DISABLED, loadProgram: budget.loadProgram });
    await budgetBinding.addChunk("chunk-0-0", budget.meshes);
    expect(budgetBinding.inspection().gap).toBe(`${terrainLayerSamplerBudgetReasonPrefix}3`);
  });

  it("refuses an alpha map whose channels differ and accepts a plain texture root as a single texture", () => {
    const plan = compileMaterialStagePlan(parseMaterialProgram(JSON.parse(JSON.stringify(textureRootProgram("T.Base")))));
    expect(singleTextureSampler(plan)?.textureNode).toBe("T.Base");
    expect(terrainLayerAlphaChannelsDifferReason).toBe("terrain-layer-alpha-channels-differ");
  });
});
