import { readFileSync } from "node:fs";
import { nativeMaterialProgramPath } from "../../src/materials/ue2/babylon/loadNativeMaterial";
import { textureMipLevelStorePath, type TextureMipChainFormat, type TextureMipChainPin } from "../../src/materials/ue2/model/textureMipChain";
import {
  canonicalProgramBytes, encodeSolidRgbaPng, sha256Hex, swatchTextureRgba, syntheticSwatchProgram, textureImageFor, type FixtureProgram, type FixtureTextureImage,
} from "./materialProgramFixture";

export interface NativeMipChainFixtureLevel { readonly level: number; readonly width: number; readonly height: number; readonly bytes: number; readonly sha256: string; readonly base64: string }
export interface NativeMipChainFixture { readonly object: string; readonly format: TextureMipChainFormat; readonly mips: readonly NativeMipChainFixtureLevel[] }

export interface MipChainSwatch {
  readonly fixture: NativeMipChainFixture;
  readonly materialId: string;
  readonly image: FixtureTextureImage;
  readonly servedFiles: ReadonlyMap<string, Uint8Array<ArrayBuffer>>;
}

const nativeMipChainFixtures = new Map((JSON.parse(readFileSync(new URL("../fixtures/material-textures/native-mip-chains.json", import.meta.url), "utf8")) as {
  readonly textures: readonly NativeMipChainFixture[];
}).textures.map(texture => [texture.object, texture]));

export function nativeMipChainFixture(object: string): NativeMipChainFixture {
  const fixture = nativeMipChainFixtures.get(object);
  if (!fixture) throw new Error(`no native mip chain fixture ${object}`);
  return fixture;
}

export function nativeMipLevelBytes(level: NativeMipChainFixtureLevel): Uint8Array<ArrayBuffer> {
  return new Uint8Array(Buffer.from(level.base64, "base64"));
}

export function nativeMipChainPin(fixture: NativeMipChainFixture, firstMip = 0): TextureMipChainPin {
  return { format: fixture.format, firstMip, levels: fixture.mips.slice(firstMip).map(level => ({ width: level.width, height: level.height, bytes: level.bytes,
    sha256: level.sha256, path: textureMipLevelStorePath(level.sha256) })) };
}

export function swatchProgramWithTextureSize(image: FixtureTextureImage, width: number, height: number): FixtureProgram {
  const program = syntheticSwatchProgram(image);
  const sizeByField: Readonly<Record<string, number>> = { USize: width, VSize: height };
  return { ...program, nodes: program.nodes.map(node => node.class !== "Engine.Texture" ? node : { ...node, fields: node.fields.map(entry =>
    entry.field in sizeByField ? { ...entry, value: sizeByField[entry.field]! } : entry) }) };
}

export function mipChainSwatchWithPin(object: string, pin: TextureMipChainPin): MipChainSwatch {
  const fixture = nativeMipChainFixture(object);
  const { width, height } = fixture.mips[0]!;
  const png = new Uint8Array(encodeSolidRgbaPng(width, height, swatchTextureRgba));
  const image: FixtureTextureImage = { ...textureImageFor(png), mips: pin };
  const programBytes = new Uint8Array(canonicalProgramBytes(swatchProgramWithTextureSize(image, width, height)));
  const materialId = sha256Hex(programBytes);
  const servedFiles = new Map<string, Uint8Array<ArrayBuffer>>([[nativeMaterialProgramPath(materialId), programBytes], [image.path, png],
    ...fixture.mips.map(level => [textureMipLevelStorePath(level.sha256), nativeMipLevelBytes(level)] as const)]);
  return { fixture, materialId, image, servedFiles };
}

export function mipChainSwatch(object: string, firstMip = 0): MipChainSwatch {
  return mipChainSwatchWithPin(object, nativeMipChainPin(nativeMipChainFixture(object), firstMip));
}
