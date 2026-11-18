import { Constants } from "@babylonjs/core/Engines/constants";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createNativeMaterial } from "../../src/materials/ue2/babylon/material";
import { loadNativeMaterial, type LoadedNativeMaterial } from "../../src/materials/ue2/babylon/loadNativeMaterial";
import { parseMaterialProgram } from "../../src/materials/ue2/model/materialProgram";
import {
  TEXTURE_COMPRESSION_BC_UNALIGNED_SIZE_REASON, TEXTURE_COMPRESSION_BC_UNAVAILABLE_REASON, textureMipLevelStorePath, type TextureMipChainPin,
} from "../../src/materials/ue2/model/textureMipChain";
import { canonicalProgramBytes, encodeSolidRgbaPng, sha256Hex, swatchTextureRgba, textureImageFor } from "../support/materialProgramFixture";
import { mipChainSwatch, mipChainSwatchWithPin, type MipChainSwatch, nativeMipChainFixture, nativeMipChainPin, swatchProgramWithTextureSize } from "../support/nativeMipChainFixture";

function serveSwatch(swatch: MipChainSwatch): MipChainSwatch {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const bytes = swatch.servedFiles.get(url);
    return new Response(bytes === undefined ? null : bytes.slice(), { status: bytes === undefined ? 404 : 200 });
  }));
  return swatch;
}

function serveProgramWithMipChain(object: string, firstMip = 0): MipChainSwatch {
  return serveSwatch(mipChainSwatch(object, firstMip));
}

function parsedTextureImageMips(object: string, pin: TextureMipChainPin): unknown {
  const fixture = nativeMipChainFixture(object);
  const { width, height } = fixture.mips[0]!;
  const image = { ...textureImageFor(encodeSolidRgbaPng(width, height, swatchTextureRgba)), mips: pin };
  const program = parseMaterialProgram(JSON.parse(new TextDecoder().decode(canonicalProgramBytes(swatchProgramWithTextureSize(image, width, height)))));
  return program.nodes.find(node => node.class === "Engine.Texture")?.image?.mips;
}

const scenes: Scene[] = [];

function nullScene(blockCompressionAvailable: boolean): Scene {
  const engine = new NullEngine();
  const capabilities = engine.getCaps() as { s3tc?: unknown };
  if (blockCompressionAvailable) capabilities.s3tc = {};
  else delete capabilities.s3tc;
  const scene = new Scene(engine);
  scenes.push(scene);
  return scene;
}

interface RecordedLevelUpload { readonly babylonFormat: number; readonly width: number; readonly height: number; readonly bytes: number; readonly level: number }

function recordLevelUploads(scene: Scene): RecordedLevelUpload[] {
  const uploads: RecordedLevelUpload[] = [];
  vi.spyOn(scene.getEngine(), "_uploadCompressedDataToTextureDirectly").mockImplementation((_texture, babylonFormat, width, height, data, _face, level) => {
    uploads.push({ babylonFormat, width, height, bytes: data.byteLength, level: level ?? 0 });
  });
  return uploads;
}

async function loadedMaterialOf(object: string): Promise<LoadedNativeMaterial> {
  const served = serveProgramWithMipChain(object);
  return loadNativeMaterial(served.materialId, new AbortController().signal);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const scene of scenes.splice(0)) {
    const engine = scene.getEngine();
    scene.dispose();
    engine.dispose();
  }
});

describe("native texture mip chain pins", () => {
  it("parses the original DXT3 levels of l2_skies.FlareSet.Sun01 in source order", () => {
    const fixture = nativeMipChainFixture("l2_skies.FlareSet.Sun01");
    const image = { ...textureImageFor(encodeSolidRgbaPng(128, 128, swatchTextureRgba)), mips: nativeMipChainPin(fixture) };
    const program = parseMaterialProgram(JSON.parse(new TextDecoder().decode(canonicalProgramBytes(swatchProgramWithTextureSize(image, 128, 128)))));
    const texture = program.nodes.find(node => node.class === "Engine.Texture");
    expect(texture?.image?.mips).toEqual(nativeMipChainPin(fixture));
  });

  it.each([
    ["a level whose bytes differ from its format", (pin: TextureMipChainPin) => ({ ...pin, levels: pin.levels.map((level, index) => index === 1 ? { ...level, bytes: level.bytes + 1 } : level) }), /bytes/],
    ["a level that does not halve the previous one", (pin: TextureMipChainPin) => ({ ...pin, levels: [pin.levels[0]!, pin.levels[2]!] }), /does not halve/],
    ["an unpublished format", (pin: TextureMipChainPin) => ({ ...pin, format: "P8" }), /format/],
    ["a level path that is not its SHA-256 store path", (pin: TextureMipChainPin) => ({ ...pin, levels: [{ ...pin.levels[0]!, path: "/l2/native-materials/elsewhere.bin" }, ...pin.levels.slice(1)] }), /store path/],
    ["an empty chain", (pin: TextureMipChainPin) => ({ ...pin, levels: [] }), /1 to 16 levels/],
    ["a firstMip that is not a level index", (pin: TextureMipChainPin) => ({ ...pin, firstMip: -1 }), /firstMip/],
  ])("refuses %s at the trust boundary", (_case, corrupt, message) => {
    const fixture = nativeMipChainFixture("l2_skies.FlareSet.Sun01");
    const image = { ...textureImageFor(encodeSolidRgbaPng(128, 128, swatchTextureRgba)), mips: corrupt(nativeMipChainPin(fixture)) as TextureMipChainPin };
    expect(() => parseMaterialProgram(JSON.parse(new TextDecoder().decode(canonicalProgramBytes(swatchProgramWithTextureSize(image, 128, 128)))))).toThrow(message);
  });
});

describe("native texture mip chain retention", () => {
  it("parses the nine RM-25 Cm_o_wall008 levels down to its 2x1 tail", () => {
    const pin = nativeMipChainPin(nativeMipChainFixture("cruma_tr_t.Cm_o_wall008"));
    expect(parsedTextureImageMips("cruma_tr_t.Cm_o_wall008", pin)).toEqual(pin);
    expect(pin.levels.at(-1)).toMatchObject({ width: 2, height: 1 });
  });

  it("refuses a level past the smaller dimension of the chain", () => {
    const pin = nativeMipChainPin(nativeMipChainFixture("cruma_tr_t.Cm_o_wall008"));
    const pastSha256 = "a".repeat(64);
    const pastTheCap = { ...pin, levels: [...pin.levels, { width: 1, height: 1, bytes: 8, sha256: pastSha256, path: textureMipLevelStorePath(pastSha256) }] };
    expect(() => parsedTextureImageMips("cruma_tr_t.Cm_o_wall008", pastTheCap)).toThrow(/does not halve/);
  });

  it("loads a chain whose first level is USize and VSize shifted by its firstMip", async () => {
    const served = serveProgramWithMipChain("l2_skies.FlareSet.Sun01", 1);
    const loaded = await loadNativeMaterial(served.materialId, new AbortController().signal);
    const [chain] = [...loaded.textureMipChains.values()];
    expect(chain?.levels.map(level => [level.width, level.height])).toEqual(served.fixture.mips.slice(1).map(level => [level.width, level.height]));
  });

  it("refuses a chain whose first level is not USize and VSize shifted by its firstMip", async () => {
    const fixture = nativeMipChainFixture("l2_skies.FlareSet.Sun01");
    const served = serveSwatch(mipChainSwatchWithPin(fixture.object, { ...nativeMipChainPin(fixture, 1), firstMip: 2 }));
    await expect(loadNativeMaterial(served.materialId, new AbortController().signal)).rejects.toThrow(/USize x VSize 128 x 128 shifted by firstMip 2/);
  });
});

describe("native texture mip chain loading", () => {
  it("loads every pinned level byte for byte next to the mip-0 PNG", async () => {
    const loaded = await loadedMaterialOf("l2_skies.FlareSet.Flare01");
    const fixture = nativeMipChainFixture("l2_skies.FlareSet.Flare01");
    const [chain] = [...loaded.textureMipChains.values()];
    expect(chain?.format).toBe("DXT5");
    expect(chain?.levels.map(level => sha256Hex(level.data))).toEqual(fixture.mips.map(level => level.sha256));
    expect(loaded.texturePixels.size).toBe(1);
  });

  it("refuses a level whose served bytes differ from its pinned SHA-256", async () => {
    const served = serveProgramWithMipChain("l2_skies.FlareSet.Sun01");
    const tamperedPath = textureMipLevelStorePath(served.fixture.mips[3]!.sha256);
    const originalFetch = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => url === tamperedPath ? new Response(new Uint8Array(served.fixture.mips[3]!.bytes)) : originalFetch(url)));
    await expect(loadNativeMaterial(served.materialId, new AbortController().signal)).rejects.toThrow(/differs from its SHA-256/);
  });
});

describe("native texture mip chain upload", () => {
  it.each([
    ["l2_skies.FlareSet.Sun01", Constants.TEXTUREFORMAT_COMPRESSED_RGBA_S3TC_DXT3],
    ["l2_skies.FlareSet.Flare01", Constants.TEXTUREFORMAT_COMPRESSED_RGBA_S3TC_DXT5],
    ["l2_skies.Textures.WhiteChip", Constants.TEXTUREFORMAT_COMPRESSED_RGBA_S3TC_DXT1],
  ])("uploads every original %s level as a BC texture when the device has texture-compression-bc", async (object, babylonFormat) => {
    const loaded = await loadedMaterialOf(object);
    const scene = nullScene(true);
    const uploads = recordLevelUploads(scene);
    const material = createNativeMaterial(scene, loaded, { sessionSeed: 1, lighting: "unlit" });
    const fixture = nativeMipChainFixture(object);
    expect(uploads).toEqual(fixture.mips.map(level => ({ babylonFormat, width: level.width, height: level.height, bytes: level.bytes, level: level.level })));
    expect(material.inspect().reasons).toEqual([]);
    const texture = material.material.getActiveTextures()[0]!;
    expect(texture.getInternalTexture()?.generateMipMaps).toBe(fixture.mips.length > 1);
    expect(texture.getInternalTexture()?._maxLodLevel).toBe(fixture.mips.length);
    expect(texture.getInternalTexture()?.samplingMode).toBe(Constants.TEXTURE_TRILINEAR_SAMPLINGMODE);
    expect(texture.anisotropicFilteringLevel).toBe(1);
  });

  it("keeps the mip-0 PNG and names texture-compression-bc-unavailable when the device lacks BC", async () => {
    const loaded = await loadedMaterialOf("l2_skies.FlareSet.Sun01");
    const scene = nullScene(false);
    const uploads = recordLevelUploads(scene);
    const material = createNativeMaterial(scene, loaded, { sessionSeed: 1, lighting: "unlit" });
    expect(uploads).toEqual([]);
    expect(material.inspect().reasons).toEqual([TEXTURE_COMPRESSION_BC_UNAVAILABLE_REASON]);
    expect(material.material.getActiveTextures()[0]!.getInternalTexture()?.generateMipMaps).toBe(false);
  });

  it("uploads the native RGBA8 levels as BGRA without needing BC", async () => {
    const loaded = await loadedMaterialOf("l2_skies.Textures.mongebg");
    const scene = nullScene(false);
    const uploads = recordLevelUploads(scene);
    const material = createNativeMaterial(scene, loaded, { sessionSeed: 1, lighting: "unlit" });
    const fixture = nativeMipChainFixture("l2_skies.Textures.mongebg");
    expect(uploads).toEqual(fixture.mips.map(level => ({ babylonFormat: Constants.TEXTUREFORMAT_BGRA, width: level.width, height: level.height, bytes: level.bytes, level: level.level })));
    expect(material.inspect().reasons).toEqual([]);
  });

  it("keeps the mip-0 PNG and names texture-compression-bc-unaligned-size for a BC chain whose first level is not a whole block", async () => {
    const loaded = await loadedMaterialOf("l2_skies.FlareSet.Sun01");
    const [chain] = [...loaded.textureMipChains.values()];
    const unaligned: LoadedNativeMaterial = { ...loaded, textureMipChains: new Map([[[...loaded.textureMipChains.keys()][0]!, { ...chain!, levels: chain!.levels.slice(6) }]]) };
    const scene = nullScene(true);
    const uploads = recordLevelUploads(scene);
    const material = createNativeMaterial(scene, unaligned, { sessionSeed: 1, lighting: "unlit" });
    expect(uploads).toEqual([]);
    expect(material.inspect().reasons).toEqual([TEXTURE_COMPRESSION_BC_UNALIGNED_SIZE_REASON]);
  });
});
