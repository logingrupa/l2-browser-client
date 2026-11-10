import { readTileCatalogRecord, tileIdPattern } from "../../assets/native/nativeCatalogRecords";
import { readNativeCatalogUnlessNotStaged } from "../../assets/native/readNativeCatalog";
import { decodeNativeJsonResource, fetchVerifiedNativeResource } from "./loadNativeSection";
import {
  hasExactKeys, isFiniteVector, isQualifiedObjectName, nativeTileChunkGridPosition, nativeTileSha256Pattern, parseNativeTileGapRows,
  type NativeTileGapRow, type NativeTileVector,
} from "./nativeTileChunkManifest";

export interface NativeTileChunkRecord {
  readonly chunkId: string;
  readonly manifest: string;
  readonly manifestSha256: string;
  readonly manifestBytes: number;
}

const tileResourcePathTemplates = {
  "native-tile-collision": "/l2/maps/<sha256>/native-tile-collision/asset.json",
  movers: "/l2/movers/<sha256>/tile-movers.json",
  "bsp-visibility": "/l2/maps/<sha256>/native-tile-bsp-visibility/asset.json",
  "map-emitters": "/l2/map-emitters/<sha256>/tile-emitters.json",
  sky: "/l2/skies/<sha256>/manifest.json",
  "world-audio": "/l2/world-audio/<sha256>/manifest.json",
  lighting: "/l2/maps/<sha256>/native-tile-lighting/asset.json",
  minimap: "/l2/maps/<sha256>/native-tile-minimap/manifest.json",
} as const;

export type NativeTileResourceKind = keyof typeof tileResourcePathTemplates;

export const nativeTileResourceKinds = Object.keys(tileResourcePathTemplates) as readonly NativeTileResourceKind[];

export interface NativeTileResource {
  readonly kind: NativeTileResourceKind;
  readonly manifest: string;
  readonly manifestSha256: string;
  readonly manifestBytes: number;
}

export interface NativeTileManifest {
  readonly kind: "native-tile-runtime";
  readonly schemaVersion: 1;
  readonly tileId: string;
  readonly sourceMap: string;
  readonly sourceSha256: string;
  readonly frame: { readonly terrainInfo: string; readonly location: NativeTileVector; readonly terrainScale: NativeTileVector };
  readonly anchor: { readonly playerStart: string; readonly location: NativeTileVector };
  readonly chunks: readonly NativeTileChunkRecord[];
  readonly resources: readonly NativeTileResource[];
  readonly gaps: readonly NativeTileGapRow[];
}

const tileManifestFields = ["kind", "schemaVersion", "tileId", "sourceMap", "sourceSha256", "frame", "anchor", "chunks", "resources", "gaps"];
const frameFields = ["terrainInfo", "location", "terrainScale"];
const anchorFields = ["playerStart", "location"];
const chunkRecordFields = ["chunkId", "manifest", "manifestSha256", "manifestBytes"];
const chunkManifestPathPattern = /^\/l2\/maps\/([a-f0-9]{64})\/native-tile-chunk-runtime\/manifest\.json$/;
const tileResourceFields = ["kind", "manifest", "manifestSha256", "manifestBytes"];
const repeatableTileResourceKinds: ReadonlySet<NativeTileResourceKind> = new Set(["world-audio"]);
const isTileResourceKind = (value: unknown): value is NativeTileResourceKind => typeof value === "string" && Object.hasOwn(tileResourcePathTemplates, value);
const maximumTileResourceBytes = 128 * 1024 * 1024;
const maximumTileChunks = 256;
const maximumChunkManifestBytes = 8_000_000;

function parseChunkRecords(value: unknown, label: string): readonly NativeTileChunkRecord[] {
  if (!Array.isArray(value) || !value.length || value.length > maximumTileChunks) {
    throw new Error(`${label} must list 1 to ${maximumTileChunks} chunks.`);
  }
  const positions: (readonly [number, number])[] = [];
  return value.map(record => {
    const invalidRecord = new Error(`${label} has an invalid chunk record; chunk manifests live at /l2/maps/<sha256>/native-tile-chunk-runtime/manifest.json.`);
    if (!hasExactKeys(record, chunkRecordFields)) throw invalidRecord;
    const position = nativeTileChunkGridPosition(record.chunkId), manifestBytes = record.manifestBytes;
    if (!position || typeof record.manifestSha256 !== "string" || !nativeTileSha256Pattern.test(record.manifestSha256) ||
      typeof record.manifest !== "string" || chunkManifestPathPattern.exec(record.manifest)?.[1] !== record.manifestSha256 ||
      typeof manifestBytes !== "number" || !Number.isSafeInteger(manifestBytes) || manifestBytes < 1 || manifestBytes > maximumChunkManifestBytes) {
      throw invalidRecord;
    }
    if (positions.some(([column, row]) => column === position[0] && row === position[1])) throw new Error(`${label} lists chunk ${record.chunkId} twice.`);
    const previous = positions.at(-1);
    if (previous && (previous[0] > position[0] || previous[0] === position[0] && previous[1] > position[1])) {
      throw new Error(`${label} chunks must be sorted by (column, row).`);
    }
    positions.push(position);
    return { chunkId: record.chunkId as string, manifest: record.manifest, manifestSha256: record.manifestSha256, manifestBytes };
  });
}

function parseTileResource(resource: unknown, listedKinds: Set<NativeTileResourceKind>, label: string): NativeTileResource {
  if (!hasExactKeys(resource, tileResourceFields)) {
    throw new Error(`${label} resource must hold exactly ${tileResourceFields.join(", ")}.`);
  }
  const kind = resource.kind;
  if (!isTileResourceKind(kind)) {
    throw new Error(`${label} resource kind ${JSON.stringify(kind)} is not in the tile manifest vocabulary (${nativeTileResourceKinds.join(", ")}).`);
  }
  if (listedKinds.has(kind) && !repeatableTileResourceKinds.has(kind)) throw new Error(`${label} lists more than one ${kind} resource.`);
  const pathTemplate = tileResourcePathTemplates[kind], manifest = resource.manifest, manifestSha256 = resource.manifestSha256;
  if (typeof manifestSha256 !== "string" || !nativeTileSha256Pattern.test(manifestSha256) || typeof manifest !== "string" ||
    manifest !== pathTemplate.replace("<sha256>", manifestSha256)) {
    throw new Error(`${label} ${kind} resource must be ${pathTemplate} with its SHA-256.`);
  }
  const manifestBytes = resource.manifestBytes;
  if (typeof manifestBytes !== "number" || !Number.isSafeInteger(manifestBytes) || manifestBytes < 1 || manifestBytes > maximumTileResourceBytes) {
    throw new Error(`${label} ${kind} resource manifestBytes must be a whole number from 1 to ${maximumTileResourceBytes}.`);
  }
  listedKinds.add(kind);
  return { kind, manifest, manifestSha256, manifestBytes };
}

function parseTileResources(value: unknown, label: string): readonly NativeTileResource[] {
  if (!Array.isArray(value)) throw new Error(`${label} resources must be a list.`);
  const listedKinds = new Set<NativeTileResourceKind>(), listedManifests = new Set<string>();
  return value.map(resource => {
    const parsed = parseTileResource(resource, listedKinds, label);
    if (listedManifests.has(parsed.manifest)) throw new Error(`${label} lists the resource ${parsed.manifest} twice.`);
    listedManifests.add(parsed.manifest);
    return parsed;
  });
}

export function parseNativeTileManifest(input: unknown): NativeTileManifest {
  if (!hasExactKeys(input, tileManifestFields) || input.kind !== "native-tile-runtime" || input.schemaVersion !== 1 ||
    typeof input.tileId !== "string" || !tileIdPattern.test(input.tileId)) {
    throw new Error("Native tile manifest kind, schema version or tile id is invalid.");
  }
  const tileId = input.tileId, label = `Native tile manifest ${tileId}`;
  if (input.sourceMap !== `maps/${tileId}.unr` || typeof input.sourceSha256 !== "string" || !nativeTileSha256Pattern.test(input.sourceSha256)) {
    throw new Error(`${label} source identity is invalid.`);
  }
  const frame = input.frame, anchor = input.anchor;
  if (!hasExactKeys(frame, frameFields) || !isQualifiedObjectName(frame.terrainInfo) || !isFiniteVector(frame.location) ||
    !isFiniteVector(frame.terrainScale)) {
    throw new Error(`${label} frame must hold exactly terrainInfo, location and terrainScale.`);
  }
  if (!hasExactKeys(anchor, anchorFields) || !isQualifiedObjectName(anchor.playerStart) || !isFiniteVector(anchor.location)) {
    throw new Error(`${label} needs an anchor with a PlayerStart name and a finite location.`);
  }
  return { kind: "native-tile-runtime", schemaVersion: 1, tileId, sourceMap: input.sourceMap, sourceSha256: input.sourceSha256,
    frame: { terrainInfo: frame.terrainInfo, location: frame.location, terrainScale: frame.terrainScale },
    anchor: { playerStart: anchor.playerStart, location: anchor.location },
    chunks: parseChunkRecords(input.chunks, label), resources: parseTileResources(input.resources, label),
    gaps: parseNativeTileGapRows(input.gaps, tileId, label) };
}

export interface PinnedNativeTileManifest {
  readonly manifest: NativeTileManifest;
  readonly manifestSha256: string;
}

export async function readNativeTileManifest(tileId: string, signal: AbortSignal): Promise<PinnedNativeTileManifest | null> {
  const catalog = await readNativeCatalogUnlessNotStaged(signal);
  if (!catalog) return null;
  const records = catalog.tiles.map(readTileCatalogRecord).filter(record => record.tile === tileId);
  if (records.length > 1) throw new Error(`Native catalog lists tile ${tileId} twice.`);
  const record = records[0];
  if (!record) return null;
  const manifest = parseNativeTileManifest(decodeNativeJsonResource(
    await fetchVerifiedNativeResource(record.manifest, record.manifestSha256, signal, record.manifestBytes), "Native tile manifest"));
  if (manifest.tileId !== tileId) throw new Error(`Native tile manifest names tile ${manifest.tileId}, not ${tileId}.`);
  return { manifest, manifestSha256: record.manifestSha256 };
}
