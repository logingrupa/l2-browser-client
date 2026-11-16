import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { sha256 } from "../../src/assets/package/readAssetPackage";
import { applyNativeTerrainPreview, packNativePreviewMasks } from "../../src/scene/world/nativeTerrainPreview";
import { syntheticPngBytes } from "../support/syntheticPngBytes";

const signal = () => new AbortController().signal;
const ownedTextureIdPrefix = "map-20-20-textures:";
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("native terrain mask byte packing", () => {
  it("packs one equal scalar per source texel without interpolation or alpha premultiplication", () => {
    const mask = (a: number, b: number) => ({ width: 2, height: 1, rgba: new Uint8Array([a, a, a, a, b, b, b, b]) });
    const first = mask(3, 97), second = mask(215, 0), before = first.rgba.slice();
    expect([...packNativePreviewMasks([first, second]).rgba]).toEqual([3, 215, 0, 0, 97, 0, 0, 0]);
    expect(first.rgba).toEqual(before);
    const unequal = mask(1, 2); unequal.rgba[3] = 255;
    expect(() => packNativePreviewMasks([unequal])).toThrow("channels differ");
    expect(() => packNativePreviewMasks([first, { ...second, width: 1 }])).toThrow("matching dimensions");
  });
});

describe("optional native terrain material ownership", () => {
  const layers = Array.from({ length: 9 }, (_, index) => ({ index, texture: `Texture.Diffuse${index}`, alphaMap: `Texture.Mask${index}`,
    worldToTextureRowMajor: [[1 / 128, 0, 0, 0], [0, 1 / 128, 0, 0], [0, 0, 1, 0], [0, -.03125, 0, 1]] }));
  const encodedLayerImages: { bytes: Uint8Array<ArrayBuffer>; texture: { id: string; assetId: string; image: string; imageBytes: number; imageSha256: string; archiveSha256: string } }[] = [];
  beforeAll(async () => {
    for (const layer of layers) for (const kind of ["texture", "alphaMap"] as const) {
      const size = kind === "texture" || layer.index === 0 ? 256 : layer.index === 6 ? 512 : 1024;
      const pixels = new Uint8Array(size * size * 4).fill(kind === "texture" ? 141 : layer.index === 0 ? 255 : layer.index * 13);
      const bytes = syntheticPngBytes(size, size, 4, pixels), hash = await sha256(bytes), archive = `${kind === "texture" ? "a" : "b"}${layer.index}`.padEnd(64, "0");
      encodedLayerImages.push({ bytes, texture: { id: `${ownedTextureIdPrefix}${encodedLayerImages.length}`, assetId: `interlude:${layer[kind]}`, image: `/l2/${archive}/image.png`, imageBytes: bytes.length, imageSha256: hash, archiveSha256: archive } });
    }
  });
  async function fixture() {
    const engine = new NullEngine(), scene = new Scene(engine); scene.useRightHandedSystem = true;
    const mesh = MeshBuilder.CreateGround("native terrain", { width: 10, height: 10 }, scene), neutral = new StandardMaterial("neutral", scene);
    mesh.material = neutral;
    mesh.metadata = { gltf: { extras: { nativeLayers: structuredClone(layers) } } };
    const responses = new Map(encodedLayerImages.map(({ bytes, texture }) => [texture.image, bytes]));
    const textures = encodedLayerImages.map(({ texture }) => ({ ...texture }));
    vi.stubGlobal("fetch", vi.fn(async (url: string) => { const bytes = responses.get(url); return new Response(bytes?.slice().buffer, { status: bytes ? 200 : 404 }); }));
    vi.spyOn(ShaderMaterial.prototype, "forceCompilationAsync").mockResolvedValue(undefined);
    return { engine, scene, mesh, neutral, responses, catalog: { schemaVersion: 1, textures }, dispose: () => { scene.dispose(); engine.dispose(); } };
  }

  it("commits only after readiness and toggles/restores the original neutral material without geometry edits", async () => {
    const value = await fixture();
    try {
      const positions = value.mesh.getVerticesData("position")!.slice(), originalTextures = value.scene.textures.length;
      const preview = await applyNativeTerrainPreview(value.scene, [value.mesh], value.catalog, ownedTextureIdPrefix, signal());
      expect(preview.samplerCount).toBe(12); expect(preview.status).toBe("candidate-source-textures");
      expect(value.mesh.material).toBeInstanceOf(ShaderMaterial); expect(value.scene.textures.length - originalTextures).toBe(12);
      expect(value.mesh.getVerticesData("position")).toEqual(positions);
      preview.setEnabled(false); expect(value.mesh.material).toBe(value.neutral);
      preview.setEnabled(true); expect(value.mesh.material).not.toBe(value.neutral);
      preview.dispose(); preview.dispose(); expect(value.mesh.material).toBe(value.neutral); expect(value.scene.textures.length).toBe(originalTextures);
    } finally { value.dispose(); }
  });

  it("leaves neutral intact and releases GPU allocations when compilation fails", async () => {
    const value = await fixture();
    try {
      vi.mocked(ShaderMaterial.prototype.forceCompilationAsync).mockRejectedValueOnce(new Error("shader failure"));
      const before = [value.scene.materials.length, value.scene.textures.length];
      await expect(applyNativeTerrainPreview(value.scene, [value.mesh], value.catalog, ownedTextureIdPrefix, signal())).rejects.toThrow("shader failure");
      expect(value.mesh.material).toBe(value.neutral); expect([value.scene.materials.length, value.scene.textures.length]).toEqual(before);
    } finally { value.dispose(); }
  });

  it("rejects corrupt image bytes before decoding or replacing materials", async () => {
    const value = await fixture();
    try {
      value.responses.set(value.catalog.textures[0]!.image, new Uint8Array([1, 2, 3]));
      await expect(applyNativeTerrainPreview(value.scene, [value.mesh], value.catalog, ownedTextureIdPrefix, signal())).rejects.toThrow("hash/length differs");
      expect(value.mesh.material).toBe(value.neutral); expect(value.scene.textures).toHaveLength(0);
      expect(ShaderMaterial.prototype.forceCompilationAsync).not.toHaveBeenCalled();
    } finally { value.dispose(); }
  });

  it("cancels a pending shader compile and restores neutral without waiting for its completion", async () => {
    const value = await fixture(), controller = new AbortController();
    try {
      let started!: () => void, finish!: () => void;
      const ready = new Promise<void>(resolve => { started = resolve; });
      vi.mocked(ShaderMaterial.prototype.forceCompilationAsync).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; started(); }));
      const pending = applyNativeTerrainPreview(value.scene, [value.mesh], value.catalog, ownedTextureIdPrefix, controller.signal);
      await ready; controller.abort();
      await expect(pending).rejects.toHaveProperty("name", "AbortError");
      expect(value.mesh.material).toBe(value.neutral); expect(value.scene.textures).toHaveLength(0);
      finish();
    } finally { value.dispose(); }
  });

  it("ignores UI texture records that share one assetId under several interface spellings", async () => {
    const value = await fixture();
    try {
      const owned = value.catalog.textures[0]!;
      for (const id of ["ui-texture:L2UI_CH3.BUTTON.BTN1_normal", "ui-texture:L2UI_CH3.Button.Btn1_normal"]) {
        value.catalog.textures.push({ ...owned, id, assetId: "interlude:L2UI_CH3.Button.Btn1_normal" });
      }
      const preview = await applyNativeTerrainPreview(value.scene, [value.mesh], value.catalog, ownedTextureIdPrefix, signal());
      expect(preview.samplerCount).toBe(12); expect(value.mesh.material).toBeInstanceOf(ShaderMaterial);
      preview.dispose();
    } finally { value.dispose(); }
  });

  it("still refuses a duplicate assetId inside the section's own records", async () => {
    const value = await fixture();
    try {
      value.catalog.textures.push({ ...value.catalog.textures[0]!, id: `${ownedTextureIdPrefix}99` });
      await expect(applyNativeTerrainPreview(value.scene, [value.mesh], value.catalog, ownedTextureIdPrefix, signal()))
        .rejects.toThrow("Native preview texture catalog identity/hash/path is invalid.");
      expect(value.mesh.material).toBe(value.neutral);
    } finally { value.dispose(); }
  });

  it("reports a section with no owned texture records as unstaged instead of reading other owners", async () => {
    const value = await fixture();
    try {
      for (const texture of value.catalog.textures) texture.id = `ui-texture:${texture.assetId}`;
      await expect(applyNativeTerrainPreview(value.scene, [value.mesh], value.catalog, ownedTextureIdPrefix, signal()))
        .rejects.toThrow("Native preview texture is unstaged");
      expect(value.mesh.material).toBe(value.neutral);
    } finally { value.dispose(); }
  });

  it("refuses a texture record without a string id", async () => {
    const value = await fixture();
    try {
      const withoutId: Record<string, unknown> = { ...value.catalog.textures[0]! };
      delete withoutId.id;
      const catalog = { ...value.catalog, textures: [...value.catalog.textures, withoutId] };
      await expect(applyNativeTerrainPreview(value.scene, [value.mesh], catalog, ownedTextureIdPrefix, signal()))
        .rejects.toThrow("Native preview texture catalog identity/hash/path is invalid.");
    } finally { value.dispose(); }
  });
});
