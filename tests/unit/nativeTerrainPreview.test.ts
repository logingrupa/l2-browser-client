import { afterEach, describe, expect, it, vi } from "vitest";
import { deflateSync } from "node:zlib";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { sha256 } from "../../src/assets/package/readAssetPackage";
import { applyNativeTerrainPreview, decodeNativePreviewPng, packNativePreviewMasks } from "../../src/scene/world/nativeTerrainPreview";

function crc(bytes: Uint8Array) {
  let value = 0xffffffff;
  for (const byte of bytes) { value ^= byte; for (let i = 0; i < 8; i++) value = value & 1 ? 0xedb88320 ^ value >>> 1 : value >>> 1; }
  return (value ^ 0xffffffff) >>> 0;
}
function png(width: number, height: number, channels: 3 | 4, pixels: Uint8Array, filters: number[] = [0]): Uint8Array<ArrayBuffer> {
  const stride = width * channels, rows = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const filter = filters[y % filters.length]!; rows[y * (stride + 1)] = filter;
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? pixels[y * stride + x - channels]! : 0, above = y ? pixels[(y - 1) * stride + x]! : 0;
      const diagonal = y && x >= channels ? pixels[(y - 1) * stride + x - channels]! : 0;
      let prediction = 0;
      if (filter === 1) prediction = left;
      if (filter === 2) prediction = above;
      if (filter === 3) prediction = (left + above) >>> 1;
      if (filter === 4) {
        const guess = left + above - diagonal, distances = [Math.abs(guess - left), Math.abs(guess - above), Math.abs(guess - diagonal)];
        prediction = [left, above, diagonal][distances.indexOf(Math.min(...distances))]!;
      }
      rows[y * (stride + 1) + x + 1] = pixels[y * stride + x]! - prediction;
    }
  }
  const header = new Uint8Array(13), hv = new DataView(header.buffer);
  hv.setUint32(0, width); hv.setUint32(4, height); header[8] = 8; header[9] = channels === 3 ? 2 : 6;
  const chunks = [["IHDR", header], ["IDAT", new Uint8Array(deflateSync(rows))], ["IEND", new Uint8Array()]] as const;
  const result = new Uint8Array(8 + chunks.reduce((sum, [, data]) => sum + data.length + 12, 0));
  result.set([137, 80, 78, 71, 13, 10, 26, 10]); const view = new DataView(result.buffer); let at = 8;
  for (const [type, data] of chunks) {
    view.setUint32(at, data.length); result.set(new TextEncoder().encode(type), at + 4); result.set(data, at + 8);
    view.setUint32(at + 8 + data.length, crc(result.subarray(at + 4, at + 8 + data.length))); at += 12 + data.length;
  }
  return result;
}
const signal = () => new AbortController().signal;
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("native terrain PNG and byte packing", () => {
  it("retains RGB beneath zero/partial alpha and independently reverses every PNG filter", async () => {
    const values = Uint8Array.from({ length: 4 * 3 * 5 }, (_, i) => (i * 71 + 13) % 256);
    values.set([191, 23, 54, 0, 9, 8, 7, 3]);
    const result = await decodeNativePreviewPng(png(3, 5, 4, values, [0, 1, 2, 3, 4]), signal());
    expect(result).toMatchObject({ width: 3, height: 5 }); expect(result.rgba).toEqual(values);
    const rgb = await decodeNativePreviewPng(png(1, 2, 3, new Uint8Array([7, 19, 31, 44, 55, 66]), [1, 4]), signal());
    expect([...rgb.rgba]).toEqual([7, 19, 31, 255, 44, 55, 66, 255]);
  });

  it("rejects unsupported layouts, decompressed length mismatches and cancellation", async () => {
    const bytes = png(2, 1, 4, new Uint8Array(8));
    for (const [offset, value] of [[24, 16], [25, 3], [28, 1]] as const) {
      const changed = bytes.slice(); changed[offset] = value;
      await expect(decodeNativePreviewPng(changed, signal())).rejects.toThrow("supports only");
    }
    const dimensions = bytes.slice(); new DataView(dimensions.buffer).setUint32(16, 1);
    await expect(decodeNativePreviewPng(dimensions, signal())).rejects.toThrow("exceeds dimensions");
    await expect(decodeNativePreviewPng(bytes.slice(0, -1), signal())).rejects.toThrow();
    const abort = new AbortController(); abort.abort();
    await expect(decodeNativePreviewPng(bytes, abort.signal)).rejects.toHaveProperty("name", "AbortError");
  });

  it("packs one equal scalar per source texel without interpolation or alpha premultiplication", () => {
    const mask = (a: number, b: number) => ({ width: 2, height: 1, rgba: new Uint8Array([a, a, a, a, b, b, b, b]) });
    const first = mask(3, 97), second = mask(215, 0), before = first.rgba.slice();
    expect([...packNativePreviewMasks([first, second]).rgba]).toEqual([3, 215, 0, 0, 97, 0, 0, 0]);
    expect(first.rgba).toEqual(before);
    const unequal = mask(1, 2); unequal.rgba[3] = 255;
    expect(() => packNativePreviewMasks([unequal])).toThrow("channels differ");
    expect(() => packNativePreviewMasks([first, { ...second, width: 1 }])).toThrow("matching dimensions");
  });

  const localAudit = resolve("artifacts/native-parity/research/terrain-materials/texture-channel-audit.json"), migration = resolve("artifacts/native-parity/migration");
  it.skipIf(!existsSync(localAudit) || !existsSync(resolve(migration, "coverage.json")))("matches all 18 retained PNG channel-audit RGBA hashes", async () => {
    const audit = JSON.parse(readFileSync(localAudit, "utf8")) as { pngAudit: { results: { id: string; pngSha256: string; rgbaSha256: string }[] } };
    const jobs = JSON.parse(readFileSync(resolve(migration, "coverage.json"), "utf8")) as { jobs: { path?: string }[] };
    const expected = new Map(audit.pngAudit.results.map(row => [row.id, row])); let checked = 0;
    for (const job of jobs.jobs) {
      if (!job.path?.endsWith("asset.l2asset")) continue;
      const directory = dirname(resolve(migration, job.path));
      const asset = JSON.parse(readFileSync(resolve(directory, "asset.json"), "utf8")) as { id: string; kind: string; image?: { file: string } };
      const record = expected.get(asset.id);
      if (asset.kind !== "texture" || !asset.image || !record) continue;
      const bytes = new Uint8Array(readFileSync(resolve(directory, asset.image.file)));
      expect(await sha256(bytes)).toBe(record.pngSha256);
      const result = await decodeNativePreviewPng(bytes, signal());
      expect(await sha256(result.rgba)).toBe(record.rgbaSha256); checked++;
    }
    expect(checked).toBe(18);
  });
});

describe("optional native terrain material ownership", () => {
  async function fixture() {
    const engine = new NullEngine(), scene = new Scene(engine); scene.useRightHandedSystem = true;
    const mesh = MeshBuilder.CreateGround("native terrain", { width: 10, height: 10 }, scene), neutral = new StandardMaterial("neutral", scene);
    mesh.material = neutral;
    const layers = Array.from({ length: 9 }, (_, index) => ({ index, texture: `Texture.Diffuse${index}`, alphaMap: `Texture.Mask${index}`,
      worldToTextureRowMajor: [[1 / 128, 0, 0, 0], [0, 1 / 128, 0, 0], [0, 0, 1, 0], [0, -.03125, 0, 1]] }));
    mesh.metadata = { gltf: { extras: { nativeLayers: layers } } };
    const responses = new Map<string, Uint8Array<ArrayBuffer>>(), textures = [];
    for (const layer of layers) for (const kind of ["texture", "alphaMap"] as const) {
      const size = kind === "texture" || layer.index === 0 ? 256 : layer.index === 6 ? 512 : 1024;
      const pixels = new Uint8Array(size * size * 4).fill(kind === "texture" ? 141 : layer.index === 0 ? 255 : layer.index * 13);
      const bytes = png(size, size, 4, pixels), hash = await sha256(bytes), archive = `${kind === "texture" ? "a" : "b"}${layer.index}`.padEnd(64, "0");
      const image = `/l2/${archive}/image.png`; responses.set(image, bytes);
      textures.push({ assetId: `interlude:${layer[kind]}`, image, imageBytes: bytes.length, imageSha256: hash, archiveSha256: archive });
    }
    vi.stubGlobal("fetch", vi.fn(async (url: string) => { const bytes = responses.get(url); return new Response(bytes?.slice().buffer, { status: bytes ? 200 : 404 }); }));
    vi.spyOn(ShaderMaterial.prototype, "forceCompilationAsync").mockResolvedValue(undefined);
    return { engine, scene, mesh, neutral, responses, catalog: { schemaVersion: 1, textures }, dispose: () => { scene.dispose(); engine.dispose(); } };
  }

  it("commits only after readiness and toggles/restores the original neutral material without geometry edits", async () => {
    const value = await fixture();
    try {
      const positions = value.mesh.getVerticesData("position")!.slice(), originalTextures = value.scene.textures.length;
      const preview = await applyNativeTerrainPreview(value.scene, [value.mesh], value.catalog, signal());
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
      await expect(applyNativeTerrainPreview(value.scene, [value.mesh], value.catalog, signal())).rejects.toThrow("shader failure");
      expect(value.mesh.material).toBe(value.neutral); expect([value.scene.materials.length, value.scene.textures.length]).toEqual(before);
    } finally { value.dispose(); }
  });

  it("rejects corrupt image bytes before decoding or replacing materials", async () => {
    const value = await fixture();
    try {
      value.responses.set(value.catalog.textures[0]!.image, new Uint8Array([1, 2, 3]));
      await expect(applyNativeTerrainPreview(value.scene, [value.mesh], value.catalog, signal())).rejects.toThrow("hash/length differs");
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
      const pending = applyNativeTerrainPreview(value.scene, [value.mesh], value.catalog, controller.signal);
      await ready; controller.abort();
      await expect(pending).rejects.toHaveProperty("name", "AbortError");
      expect(value.mesh.material).toBe(value.neutral); expect(value.scene.textures).toHaveLength(0);
      finish();
    } finally { value.dispose(); }
  });
});
