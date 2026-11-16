import { readFontCatalogRecord } from "../../assets/native/nativeCatalogRecords";
import type { NativeCatalog } from "../../assets/native/readNativeCatalog";
import { fetchVerifiedNativeResource } from "../../assets/native/fetchVerifiedNativeResource";

export const nativeUiFontManifestKind = "native-ui-font";

export interface NativeWindowGlyph { readonly x: number; readonly y: number; readonly width: number; readonly height: number }

export interface NativeWindowDigitCells { readonly cellWidth: number; readonly cellHeight: number; readonly slotCharacters: string }

interface NativeWindowFontAtlas {
  readonly width: number; readonly height: number; readonly image: string; readonly imageSha256: string; readonly imageBytes: number;
}

export interface NativeWindowFontManifest {
  readonly fontType: number;
  readonly route: "bitmap-glyph-table" | "digit-atlas";
  readonly atlas: NativeWindowFontAtlas;
  readonly glyphsByCodeUnit: ReadonlyMap<number, NativeWindowGlyph>;
  readonly digitCells: NativeWindowDigitCells | null;
}

export interface NativeWindowFont {
  readonly manifest: NativeWindowFontManifest;
  readonly imageUrl: string;
}

export interface NativeWindowPlacedGlyph { readonly left: number; readonly glyph: NativeWindowGlyph }

export interface NativeWindowTextLayout { readonly glyphs: readonly NativeWindowPlacedGlyph[]; readonly width: number; readonly height: number }

const maximumAtlasSide = 4096;
const maximumAtlasBytes = 32 * 1024 * 1024;
const maximumCodeUnit = 0xffff;
const sha256Pattern = /^[a-f0-9]{64}$/;
const atlasImagePattern = /^\/l2\/[a-f0-9]{64}\/[A-Za-z0-9._-]+\.png$/;
const pngMimeType = "image/png";

function refuse(problem: string): never {
  throw new Error(`Native UI font manifest ${problem}.`);
}

function readRecord(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) refuse(`${label} must be an object`);
  return value as Readonly<Record<string, unknown>>;
}

function readInteger(value: unknown, label: string, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) refuse(`${label} must be an integer from ${minimum} to ${maximum}`);
  return value;
}

function readAtlas(value: unknown): NativeWindowFontAtlas {
  const atlas = readRecord(value, "atlas");
  const { image, imageSha256 } = atlas;
  if (typeof image !== "string" || !atlasImagePattern.test(image)) refuse("atlas image must be a /l2 PNG path");
  if (typeof imageSha256 !== "string" || !sha256Pattern.test(imageSha256)) refuse("atlas imageSha256 must be 64 lowercase hex digits");
  return { width: readInteger(atlas.width, "atlas width", 1, maximumAtlasSide), height: readInteger(atlas.height, "atlas height", 1, maximumAtlasSide),
    image, imageSha256, imageBytes: readInteger(atlas.imageBytes, "atlas imageBytes", 1, maximumAtlasBytes) };
}

function readGlyphs(value: unknown, atlas: NativeWindowFontAtlas): ReadonlyMap<number, NativeWindowGlyph> {
  if (!Array.isArray(value)) refuse("glyphs must be a list");
  const glyphs = new Map<number, NativeWindowGlyph>();
  for (const [index, entry] of value.entries()) {
    const glyph = readRecord(entry, `glyph ${index}`);
    const codeUnit = readInteger(glyph.codeUnit, `glyph ${index} codeUnit`, 0, maximumCodeUnit);
    const x = readInteger(glyph.x, `glyph ${index} x`, 0, atlas.width - 1);
    const y = readInteger(glyph.y, `glyph ${index} y`, 0, atlas.height - 1);
    const width = readInteger(glyph.width, `glyph ${index} width`, 1, atlas.width - x);
    const height = readInteger(glyph.height, `glyph ${index} height`, 1, atlas.height - y);
    if (glyphs.has(codeUnit)) refuse(`glyph code unit ${codeUnit} is listed twice`);
    glyphs.set(codeUnit, { x, y, width, height });
  }
  return glyphs;
}

function readDigitCells(value: unknown, atlas: NativeWindowFontAtlas): NativeWindowDigitCells {
  const cells = readRecord(value, "digitCells");
  const cellWidth = readInteger(cells.cellWidth, "digitCells cellWidth", 1, atlas.width);
  const cellHeight = readInteger(cells.cellHeight, "digitCells cellHeight", 1, atlas.height);
  const { slotCharacters } = cells;
  if (typeof slotCharacters !== "string" || slotCharacters.length === 0 || new Set(slotCharacters).size !== slotCharacters.length
    || slotCharacters.length * cellWidth > atlas.width) refuse("digitCells slotCharacters must be distinct characters whose cells fit the atlas");
  return { cellWidth, cellHeight, slotCharacters };
}

export function parseNativeWindowFontManifest(input: unknown, expectedFontType: number): NativeWindowFontManifest {
  const manifest = readRecord(input, "document");
  if (manifest.kind !== nativeUiFontManifestKind || manifest.schemaVersion !== 1) refuse(`must be ${nativeUiFontManifestKind} schema 1`);
  const fontType = readInteger(manifest.fontType, "fontType", 0, 255);
  if (fontType !== expectedFontType) refuse(`holds fontType ${fontType}, not its catalog fontType ${expectedFontType}`);
  const atlas = readAtlas(manifest.atlas);
  if (manifest.route === "digit-atlas") {
    return { fontType, route: manifest.route, atlas, glyphsByCodeUnit: new Map(), digitCells: readDigitCells(manifest.digitCells, atlas) };
  }
  if (manifest.route !== "bitmap-glyph-table") refuse("route must be bitmap-glyph-table or digit-atlas");
  return { fontType, route: manifest.route, atlas, glyphsByCodeUnit: readGlyphs(manifest.glyphs, atlas), digitCells: null };
}

function digitGlyph(cells: NativeWindowDigitCells, character: string): NativeWindowGlyph | undefined {
  const slot = cells.slotCharacters.indexOf(character);
  return slot < 0 ? undefined : { x: slot * cells.cellWidth, y: 0, width: cells.cellWidth, height: cells.cellHeight };
}

export function layoutNativeWindowText(font: NativeWindowFontManifest, text: string): NativeWindowTextLayout {
  const glyphs: NativeWindowPlacedGlyph[] = [];
  let penLeft = 0;
  let height = font.digitCells?.cellHeight ?? 0;
  for (let index = 0; index < text.length; index += 1) {
    const glyph = font.digitCells === null ? font.glyphsByCodeUnit.get(text.charCodeAt(index)) : digitGlyph(font.digitCells, text[index]!);
    if (glyph === undefined) continue;
    glyphs.push({ left: penLeft, glyph });
    penLeft += glyph.width;
    height = Math.max(height, glyph.height);
  }
  return { glyphs, width: penLeft, height };
}

function decodeManifestText(bytes: Uint8Array): unknown {
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { return refuse("is not UTF-8 JSON"); }
}

export async function loadNativeWindowFonts(catalog: Pick<NativeCatalog, "fonts">, signal: AbortSignal): Promise<ReadonlyMap<number, NativeWindowFont>> {
  const fonts = new Map<number, NativeWindowFont>();
  try {
    for (const value of catalog.fonts) {
      const record = readFontCatalogRecord(value);
      if (fonts.has(record.fontType)) throw new Error(`Native catalog fonts lists ui-font:${record.fontType} twice.`);
      const manifestBytes = await fetchVerifiedNativeResource(record.manifest, record.manifestSha256, signal, record.manifestBytes);
      const manifest = parseNativeWindowFontManifest(decodeManifestText(manifestBytes), record.fontType);
      const imageBytes = await fetchVerifiedNativeResource(manifest.atlas.image, manifest.atlas.imageSha256, signal, manifest.atlas.imageBytes);
      fonts.set(record.fontType, { manifest, imageUrl: URL.createObjectURL(new Blob([imageBytes.slice()], { type: pngMimeType })) });
    }
  } catch (error) {
    revokeNativeWindowFonts(fonts);
    throw error;
  }
  return fonts;
}

export function revokeNativeWindowFonts(fonts: ReadonlyMap<number, NativeWindowFont>): void {
  for (const font of fonts.values()) URL.revokeObjectURL(font.imageUrl);
}
