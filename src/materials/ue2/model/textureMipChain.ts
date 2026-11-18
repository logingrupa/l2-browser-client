export const TEXTURE_MIP_CHAIN_FORMATS = ["DXT1", "DXT3", "DXT5", "RGBA8"] as const;

export type TextureMipChainFormat = (typeof TEXTURE_MIP_CHAIN_FORMATS)[number];

export const TEXTURE_COMPRESSION_BC_UNAVAILABLE_REASON = "texture-compression-bc-unavailable";
export const TEXTURE_COMPRESSION_BC_UNALIGNED_SIZE_REASON = "texture-compression-bc-unaligned-size";

export interface TextureMipLevelPin {
  readonly width: number;
  readonly height: number;
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
}

export interface TextureMipChainPin {
  readonly format: TextureMipChainFormat;
  readonly levels: readonly TextureMipLevelPin[];
}

export class TextureMipChainError extends Error {
  override readonly name = "TextureMipChainError";
}

const maximumMipLevels = 16;
const maximumMipDimension = 4096;
const sha256Pattern = /^[a-f0-9]{64}$/;
const levelMembers = ["bytes", "height", "path", "sha256", "width"];
const chainMembers = ["format", "levels"];
const blockEdge = 4;
const blockBytesByFormat: Readonly<Record<Exclude<TextureMipChainFormat, "RGBA8">, number>> = { DXT1: 8, DXT3: 16, DXT5: 16 };
const rgba8BytesPerPixel = 4;

function requireMipChain(condition: unknown, message: string): asserts condition {
  if (!condition) throw new TextureMipChainError(`Texture mip chain: ${message}`);
}

function isRecordWithExactMembers(value: unknown, members: readonly string[]): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).sort().join(",") === members.join(",");
}

function isBoundedDimension(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 1 && (value as number) <= maximumMipDimension;
}

export function textureMipLevelBytes(format: TextureMipChainFormat, width: number, height: number): number {
  if (format === "RGBA8") return width * height * rgba8BytesPerPixel;
  return Math.ceil(width / blockEdge) * Math.ceil(height / blockEdge) * blockBytesByFormat[format];
}

export function textureMipLevelStorePath(sha256: string): string {
  return `/l2/native-materials/texture-mips/${sha256}/level.bin`;
}

function readTextureMipLevel(value: unknown, label: string, format: TextureMipChainFormat, previous: TextureMipLevelPin | null): TextureMipLevelPin {
  requireMipChain(isRecordWithExactMembers(value, levelMembers), `${label} must hold exactly ${levelMembers.join(", ")}.`);
  const { width, height, path, sha256, bytes } = value;
  requireMipChain(isBoundedDimension(width) && isBoundedDimension(height), `${label} width and height must be 1 to ${maximumMipDimension}.`);
  if (previous !== null) {
    const halvesThePreviousLevel = (previous.width !== 1 || previous.height !== 1)
      && width === Math.max(1, Math.floor(previous.width / 2)) && height === Math.max(1, Math.floor(previous.height / 2));
    requireMipChain(halvesThePreviousLevel, `${label} ${width}x${height} does not halve the previous level ${previous.width}x${previous.height}.`);
  }
  const expectedBytes = textureMipLevelBytes(format, width, height);
  requireMipChain(bytes === expectedBytes, `${label} holds ${String(bytes)} bytes, not the ${expectedBytes} bytes of a ${width}x${height} ${format} level.`);
  requireMipChain(typeof sha256 === "string" && sha256Pattern.test(sha256), `${label}.sha256 is not a SHA-256.`);
  requireMipChain(path === textureMipLevelStorePath(sha256), `${label}.path ${String(path)} is not the store path of its SHA-256.`);
  return { width, height, path, sha256, bytes: expectedBytes };
}

export function readTextureMipChainPin(value: unknown, label: string): TextureMipChainPin {
  requireMipChain(isRecordWithExactMembers(value, chainMembers), `${label} must hold exactly ${chainMembers.join(", ")}.`);
  const format = value.format;
  requireMipChain(typeof format === "string" && (TEXTURE_MIP_CHAIN_FORMATS as readonly string[]).includes(format),
    `${label}.format ${JSON.stringify(format)} is not one of ${TEXTURE_MIP_CHAIN_FORMATS.join(", ")}.`);
  const chainFormat = format as TextureMipChainFormat;
  requireMipChain(Array.isArray(value.levels) && value.levels.length >= 1 && value.levels.length <= maximumMipLevels,
    `${label}.levels must hold 1 to ${maximumMipLevels} levels.`);
  const levels: TextureMipLevelPin[] = [];
  value.levels.forEach((level: unknown, index: number) => {
    levels.push(readTextureMipLevel(level, `${label}.levels[${index}]`, chainFormat, levels.at(-1) ?? null));
  });
  return { format: chainFormat, levels };
}
