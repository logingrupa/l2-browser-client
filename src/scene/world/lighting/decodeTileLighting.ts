import { readTypedPayload, type TypedPayload } from "../../../shared/typedPayload";
import { decodeHourlyLightingInputs, type HourlyLightingInputs } from "./decodeHourlyLightingInputs";
import { requireLightmapRebuildInputsMatchModel } from "./decodeLightmapRebuildInputs";
import { dxt1ByteCount, pageRangeHasRebuiltPage } from "./lightmapPages";
import { requireLightingInput, requireLightingPrefixStarts } from "./stagedLightingInput";
import { decodeTileLightingRecords, readTileLightingRecordsDocument, type TileLightingRecords } from "./tileLightingRecords";

export interface TileLightmapPage {
  readonly texture: number;
  readonly slot: number;
  readonly slotCount: number;
  readonly edge: number;
  readonly texels: Uint8Array;
}

export interface TileLightmapNodeRange {
  readonly chunk: number;
  readonly node: number;
  readonly primitive: number;
  readonly firstIndex: number;
  readonly indexCount: number;
  readonly texture: number;
  readonly lightmapCoordinates: Float32Array;
}

export interface TileLightingModel {
  readonly sourceSha256: string;
  readonly textureCount: number;
  readonly texturePageStart: Uint32Array;
  readonly pages: readonly TileLightmapPage[];
  readonly nodeRanges: readonly TileLightmapNodeRange[];
  readonly records: TileLightingRecords;
  readonly hourly: HourlyLightingInputs;
}

export const lightmapTextureNone = -1;
const mipsPerPage = 2;
const coordinateComponents = 2;

function requireCount(name: string, actual: number, expected: number): void {
  requireLightingInput(actual === expected, `${name} holds ${actual} values; the counts need ${expected}.`);
}

function requireTextureIndices(name: string, values: Int32Array, textureCount: number, allowNone: boolean): void {
  const outside = values.findIndex(value => !(value >= 0 && value < textureCount) && !(allowNone && value === lightmapTextureNone));
  requireLightingInput(outside === -1, `${name}[${outside}] = ${values[outside]} is not a lightmap texture of the ${textureCount}.`);
}

function decodePages(payload: TypedPayload, textureCount: number, texturePageStart: Uint32Array): TileLightmapPage[] {
  const texture = payload.int32("LMPG.texture"), slot = payload.int32("LMPG.slot"), slotCount = payload.int32("LMPG.slotCount");
  const mipEdge = payload.uint32("LMPG.mipEdge"), texelStart = payload.uint32("LMPG.texelStart"), texels = payload.uint8("LMPG.texels");
  const pageCount = texture.length;
  requireCount("LMPG.slot", slot.length, pageCount);
  requireCount("LMPG.slotCount", slotCount.length, pageCount);
  requireCount("LMPG.mipEdge", mipEdge.length, pageCount * mipsPerPage);
  requireLightingPrefixStarts("LMPG.texelStart", texelStart, pageCount * mipsPerPage, texels.length);
  requireLightingPrefixStarts("LMTX.pageStart", texturePageStart, textureCount, pageCount);
  const pagelessTexture = Array.from({ length: textureCount }, (_, index) => index).findIndex(index => texturePageStart[index] === texturePageStart[index + 1]);
  requireLightingInput(pagelessTexture === -1, `lightmap texture ${pagelessTexture} has no page.`);
  requireTextureIndices("LMPG.texture", texture, textureCount, false);
  return Array.from(texture, (pageTexture, page) => {
    const firstPage = texturePageStart[pageTexture]!, endPage = texturePageStart[pageTexture + 1]!;
    requireLightingInput(page >= firstPage && page < endPage, `page ${page} of texture ${pageTexture} lies outside its pages ${firstPage} to ${endPage}.`);
    requireLightingInput(slotCount[page] === endPage - firstPage && slot[page] === page - firstPage,
      `page ${page} is slot ${slot[page]} of ${slotCount[page]}, but texture ${pageTexture} lists it as slot ${page - firstPage} of ${endPage - firstPage}.`);
    const mip = page * mipsPerPage, edge = mipEdge[mip]!, start = texelStart[mip]!, end = texelStart[mip + 1]!;
    for (let level = 0; level < mipsPerPage; level++) {
      const levelEdge = mipEdge[mip + level]!;
      requireLightingInput(Number.isSafeInteger(levelEdge) && levelEdge >= 4 && levelEdge % 4 === 0, `page ${page} mip ${level} edge ${levelEdge} is not a DXT1 edge.`);
      requireCount(`page ${page} mip ${level} DXT1 bytes`, texelStart[mip + level + 1]! - texelStart[mip + level]!, dxt1ByteCount(levelEdge));
    }
    return { texture: pageTexture, slot: slot[page]!, slotCount: slotCount[page]!, edge, texels: texels.subarray(start, end) };
  });
}

function decodeNodeRanges(payload: TypedPayload, textureCount: number): TileLightmapNodeRange[] {
  const chunk = payload.int32("LMNR.chunk"), node = payload.int32("LMNR.node"), primitive = payload.int32("LMNR.primitive");
  const firstIndex = payload.int32("LMNR.firstIndex"), indexCount = payload.int32("LMNR.indexCount"), texture = payload.int32("LMNR.texture");
  const uvStart = payload.uint32("LMNR.uvStart"), coordinates = payload.float32("LMUV.uv"), count = node.length;
  for (const [name, values] of [["LMNR.chunk", chunk], ["LMNR.primitive", primitive], ["LMNR.firstIndex", firstIndex], ["LMNR.indexCount", indexCount],
    ["LMNR.texture", texture]] as const) requireCount(name, values.length, count);
  requireLightingInput(coordinates.length % coordinateComponents === 0, `LMUV.uv holds ${coordinates.length} floats, not whole coordinate pairs.`);
  requireLightingPrefixStarts("LMNR.uvStart", uvStart, count, coordinates.length / coordinateComponents);
  requireTextureIndices("LMNR.texture", texture, textureCount, true);
  const nonFinite = coordinates.findIndex(value => !Number.isFinite(value));
  requireLightingInput(nonFinite === -1, `LMUV.uv[${nonFinite}] is not finite.`);
  return Array.from(node, (rangeNode, range) => {
    const coordinateCount = uvStart[range + 1]! - uvStart[range]!, lit = texture[range] !== lightmapTextureNone;
    requireLightingInput(lit === coordinateCount > 0, `node ${rangeNode} has lightmap texture ${texture[range]} and ${coordinateCount} lightmap coordinates.`);
    requireLightingInput(chunk[range]! >= 0 && primitive[range]! >= 0 && firstIndex[range]! >= 0 && indexCount[range]! > 0 && indexCount[range]! % 3 === 0,
      `node ${rangeNode} range is not a positive whole number of triangles in a chunk primitive.`);
    return { chunk: chunk[range]!, node: rangeNode, primitive: primitive[range]!, firstIndex: firstIndex[range]!, indexCount: indexCount[range]!,
      texture: texture[range]!, lightmapCoordinates: coordinates.subarray(uvStart[range]! * coordinateComponents, uvStart[range + 1]! * coordinateComponents) };
  });
}

function requireRebuildInputsMatchPages(hourly: HourlyLightingInputs, texturePageStart: Uint32Array, pages: readonly TileLightmapPage[]): void {
  const { lightmapRebuild, pageRevisions } = hourly;
  if (lightmapRebuild.status === "unstaged") return;
  requireLightingInput(pageRevisions.status === "staged", "the payload lists lightmap rebuild inputs without page revisions.");
  const textureFirstPages = Array.from(texturePageStart.subarray(0, -1));
  requireLightmapRebuildInputsMatchModel(lightmapRebuild.value, { textureEdges: textureFirstPages.map(page => pages[page]!.edge),
    textureHasMismatchedPage: textureFirstPages.map((firstPage, texture) => pageRangeHasRebuiltPage(pageRevisions.value, firstPage, texturePageStart[texture + 1]!)) });
}

export function decodeTileLighting(assetJson: unknown, payloadBytes: Uint8Array): TileLightingModel {
  const payload = readTypedPayload(assetJson, payloadBytes);
  requireLightingInput(payload.units === "source", `the payload units are ${String(payload.units)}, not source.`);
  const texturePageStart = payload.uint32("LMTX.pageStart");
  requireLightingInput(texturePageStart.length >= 1, "LMTX.pageStart is empty.");
  const textureCount = texturePageStart.length - 1;
  requireLightingInput(payload.uint32("LMTX.recordStart").length === textureCount + 1, "LMTX.recordStart and LMTX.pageStart disagree on the texture count.");
  requireTextureIndices("LMSC.lightmapTexture", payload.int32("LMSC.lightmapTexture"), textureCount, true);
  const pages = decodePages(payload, textureCount, texturePageStart);
  const recordsDocument = readTileLightingRecordsDocument(payload.uint8("RECS.canonicalJson"));
  const records = decodeTileLightingRecords(recordsDocument), hourly = decodeHourlyLightingInputs(payload, recordsDocument);
  requireRebuildInputsMatchPages(hourly, texturePageStart, pages);
  return { sourceSha256: payload.sourceSha256, textureCount, texturePageStart, pages, nodeRanges: decodeNodeRanges(payload, textureCount), records, hourly };
}
