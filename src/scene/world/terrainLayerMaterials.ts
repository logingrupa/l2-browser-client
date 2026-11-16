import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { fetchVerifiedNativeResource } from "../../assets/native/fetchVerifiedNativeResource";
import { decodeNativeJsonResource } from "./loadNativeSection";
import { hasExactKeys, isPlainRecord } from "./nativeManifestRecordGuards";
import type { TerrainLayerUvRow } from "../../materials/ue2/babylon/terrainLayerMaterial";
import type { NativeTileManifest } from "./nativeTileManifest";
import { parseListedProgramPin } from "./staticMeshLibraryMaterials";

export interface TerrainLayerListingEntry {
  readonly index: number;
  readonly texture: string;
  readonly textureProgramId: string | null;
  readonly alphaMap: string;
  readonly alphaMapProgramId: string | null;
  readonly useAlpha: boolean;
  readonly rootsPorted: boolean;
  readonly gapReasons: readonly string[];
}

export interface TerrainMaterialsListing {
  readonly tileId: string;
  readonly layers: readonly TerrainLayerListingEntry[];
}

export type TerrainMaterialsLoad =
  | { readonly listing: TerrainMaterialsListing; readonly gap: null }
  | { readonly listing: null; readonly gap: string };

export interface TerrainLayerUvRows {
  readonly index: number;
  readonly texture: string;
  readonly alphaMap: string;
  readonly rowU: TerrainLayerUvRow;
  readonly rowV: TerrainLayerUvRow;
}

export const terrainMaterialsResourceKind = "terrain-materials";
export const terrainMaterialsResourceAbsentReason = "terrain-materials-resource-absent";
const listingInvalidReasonPrefix = "terrain-materials-invalid:";
const listingKind = "native-tile-terrain-materials";
const listingSchemaVersion = 1;
const listingFields = ["kind", "schemaVersion", "tileId", "layers", "files"];
const layerFields = ["index", "texture", "textureProgram", "alphaMap", "alphaMapProgram", "useAlpha", "rootsPorted", "gapReasons"];
const maximumTerrainLayers = 32;
const uvRowsMetadataField = "nativeTerrainLayerUvRows";
const matrixRowCount = 4;

function listingError(label: string, problem: string): never {
  throw new Error(`${label} ${problem}`);
}

const isLayerIndex = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0 && (value as number) < maximumTerrainLayers;
const isObjectName = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

function parseLayerEntry(value: unknown, label: string): TerrainLayerListingEntry {
  if (!hasExactKeys(value, layerFields) || !isLayerIndex(value.index) || !isObjectName(value.texture) || !isObjectName(value.alphaMap)) {
    listingError(label, `layers must hold exactly ${layerFields.join(", ")} with a layer index and two object names.`);
  }
  const entryLabel = `${label} layer ${value.index}`;
  if (typeof value.useAlpha !== "boolean" || typeof value.rootsPorted !== "boolean") listingError(entryLabel, "useAlpha and rootsPorted must be booleans.");
  if (!Array.isArray(value.gapReasons) || !value.gapReasons.every(reason => typeof reason === "string" && reason)) {
    listingError(entryLabel, "gapReasons must be a list of reasons.");
  }
  const textureProgramId = parseListedProgramPin(value.textureProgram, entryLabel);
  const alphaMapProgramId = parseListedProgramPin(value.alphaMapProgram, entryLabel);
  if (value.rootsPorted && (textureProgramId === null || alphaMapProgramId === null)) listingError(entryLabel, "names ported roots without both programs.");
  if (!value.rootsPorted && value.gapReasons.length === 0) listingError(entryLabel, "names unported roots without a gap reason.");
  return { index: value.index, texture: value.texture, textureProgramId, alphaMap: value.alphaMap, alphaMapProgramId, useAlpha: value.useAlpha,
    rootsPorted: value.rootsPorted, gapReasons: [...value.gapReasons as string[]] };
}

export function parseTerrainMaterialsListing(input: unknown, expectedTileId: string): TerrainMaterialsListing {
  const label = `Native tile ${expectedTileId} terrain materials`;
  if (!hasExactKeys(input, listingFields) || input.kind !== listingKind || input.schemaVersion !== listingSchemaVersion) {
    listingError(label, `must be a ${listingKind} schema ${listingSchemaVersion} listing holding exactly ${listingFields.join(", ")}.`);
  }
  if (input.tileId !== expectedTileId) listingError(label, `names tile ${JSON.stringify(input.tileId)}.`);
  if (!isPlainRecord(input.files)) listingError(label, "files must be an object.");
  if (!Array.isArray(input.layers) || input.layers.length === 0 || input.layers.length > maximumTerrainLayers) {
    listingError(label, `layers must list 1 to ${maximumTerrainLayers} drawn layers.`);
  }
  const layers = input.layers.map(value => parseLayerEntry(value, label));
  if (layers.some((layer, position) => position > 0 && layer.index <= layers[position - 1]!.index)) listingError(label, "layers must be in increasing layer order.");
  return { tileId: expectedTileId, layers };
}

export async function loadTerrainMaterialsListing(manifest: NativeTileManifest, signal: AbortSignal): Promise<TerrainMaterialsLoad> {
  const resource = manifest.resources.find(entry => entry.kind === terrainMaterialsResourceKind);
  if (resource === undefined) return { listing: null, gap: terrainMaterialsResourceAbsentReason };
  try {
    const bytes = await fetchVerifiedNativeResource(resource.manifest, resource.manifestSha256, signal, resource.manifestBytes);
    const label = `Native tile ${manifest.tileId} terrain materials`;
    return { listing: parseTerrainMaterialsListing(decodeNativeJsonResource(bytes, label), manifest.tileId), gap: null };
  } catch (error) {
    signal.throwIfAborted();
    return { listing: null, gap: `${listingInvalidReasonPrefix}${error instanceof Error ? error.message : String(error)}` };
  }
}

function matrixColumn(rows: readonly (readonly number[])[], column: number): TerrainLayerUvRow {
  return [rows[0]![column]!, rows[1]![column]!, rows[2]![column]!, rows[3]![column]!];
}

function parseLayerUvRows(value: unknown, position: number): TerrainLayerUvRows {
  const label = `Native terrain GLB nativeLayers[${position}]`;
  if (!isPlainRecord(value) || !isLayerIndex(value.index) || !isObjectName(value.texture) || !isObjectName(value.alphaMap)) {
    throw new Error(`${label} needs a layer index, texture and alphaMap.`);
  }
  const rows = value.worldToTextureRowMajor;
  if (!Array.isArray(rows) || rows.length !== matrixRowCount ||
    !rows.every(row => Array.isArray(row) && row.length === matrixRowCount && row.every(entry => typeof entry === "number" && Number.isFinite(entry)))) {
    throw new Error(`${label} worldToTextureRowMajor must be four rows of four finite numbers.`);
  }
  const matrix = rows as number[][];
  return { index: value.index, texture: value.texture, alphaMap: value.alphaMap, rowU: matrixColumn(matrix, 0), rowV: matrixColumn(matrix, 1) };
}

export function parseTerrainLayerUvExtras(glbDocument: Record<string, unknown>): TerrainLayerUvRows[] {
  const meshes = glbDocument.meshes;
  const extras = Array.isArray(meshes) && meshes.length === 1 && isPlainRecord(meshes[0]) ? meshes[0].extras : undefined;
  if (!isPlainRecord(extras) || !Array.isArray(extras.nativeLayers) || extras.nativeLayers.length > maximumTerrainLayers) {
    throw new Error("Native terrain GLB must hold one mesh whose extras list nativeLayers.");
  }
  return extras.nativeLayers.map(parseLayerUvRows);
}

export function attachTerrainLayerUvRows(mesh: AbstractMesh, rows: readonly TerrainLayerUvRows[]): void {
  mesh.metadata = { ...mesh.metadata, [uvRowsMetadataField]: rows };
}

export function readTerrainLayerUvRows(mesh: AbstractMesh): readonly TerrainLayerUvRows[] | null {
  const metadata: unknown = mesh.metadata;
  const rows = isPlainRecord(metadata) ? metadata[uvRowsMetadataField] : undefined;
  return Array.isArray(rows) ? rows as TerrainLayerUvRows[] : null;
}
