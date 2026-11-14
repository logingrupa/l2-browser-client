import { afterEach, describe, expect, it, vi } from "vitest";
import { loadNativeMaterial, nativeMaterialProgramPath } from "../../src/materials/ue2/babylon/loadNativeMaterial";
import {
  canonicalProgramBytes, encodeSolidRgbaPng, sha256Hex, swatchTextureRgba, syntheticSwatchProgram, textureImageFor, type FixtureProgram, type FixtureTextureImage,
} from "../support/materialProgramFixture";

afterEach(() => { vi.unstubAllGlobals(); });

function swatchProgramWithTextureSize(image: FixtureTextureImage, width: number, height: number): FixtureProgram {
  const program = syntheticSwatchProgram(image);
  return { ...program, nodes: program.nodes.map(node => node.class !== "Engine.Texture" ? node : { ...node, fields: node.fields.map(entry =>
    entry.field === "USize" ? { ...entry, value: width } : entry.field === "VSize" ? { ...entry, value: height } : entry) }) };
}

function serveSwatchProgramWithTexture(width: number, height: number, programSize: readonly [number, number] = [width, height]) {
  const png = encodeSolidRgbaPng(width, height, swatchTextureRgba), image = textureImageFor(png);
  const programBytes = canonicalProgramBytes(swatchProgramWithTextureSize(image, ...programSize)), materialId = sha256Hex(programBytes);
  const servedFiles = new Map<string, Uint8Array>([[nativeMaterialProgramPath(materialId), programBytes], [image.path, png]]);
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const bytes = servedFiles.get(url);
    return new Response(bytes === undefined ? null : bytes.slice(), { status: bytes === undefined ? 404 : 200 });
  }));
  return { materialId, image };
}

describe("UE2 material library texture loading", () => {
  it.each([[2048, 512], [512, 2048], [1024, 2048]])("decodes a pinned %i x %i texture, the long edge of Interlude static mesh textures", async (width, height) => {
    const served = serveSwatchProgramWithTexture(width, height);
    const loaded = await loadNativeMaterial(served.materialId, new AbortController().signal);
    expect(loaded.plan.status).toBe("compiled");
    const pixels = loaded.texturePixels.get(served.image.sha256);
    expect(pixels).toMatchObject({ width, height });
    expect([...pixels!.rgba.subarray(0, 4)]).toEqual([...swatchTextureRgba]);
    expect([...pixels!.rgba.subarray(pixels!.rgba.length - 4)]).toEqual([...swatchTextureRgba]);
  });

  it("refuses a texture whose decoded size differs from its program's Engine.Texture USize and VSize", async () => {
    const served = serveSwatchProgramWithTexture(512, 256, [256, 512]);
    await expect(loadNativeMaterial(served.materialId, new AbortController().signal))
      .rejects.toThrow(/decodes to 512 x 256, not its Engine.Texture USize x VSize 256 x 512/);
  });
});
