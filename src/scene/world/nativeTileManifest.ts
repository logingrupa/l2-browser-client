import { tileIdPattern } from "../../assets/native/nativeCatalogRecords";
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

export interface NativeTileManifest {
  readonly kind: "native-tile-runtime";
  readonly schemaVersion: 1;
  readonly tileId: string;
  readonly sourceMap: string;
  readonly sourceSha256: string;
  readonly frame: { readonly terrainInfo: string; readonly location: NativeTileVector; readonly terrainScale: NativeTileVector };
  readonly anchor: { readonly playerStart: string; readonly location: NativeTileVector };
  readonly chunks: readonly NativeTileChunkRecord[];
  readonly resources: readonly [];
  readonly gaps: readonly NativeTileGapRow[];
}

const tileManifestFields = ["kind", "schemaVersion", "tileId", "sourceMap", "sourceSha256", "frame", "anchor", "chunks", "resources", "gaps"];
const frameFields = ["terrainInfo", "location", "terrainScale"];
const anchorFields = ["playerStart", "location"];
const chunkRecordFields = ["chunkId", "manifest", "manifestSha256", "manifestBytes"];
const chunkManifestPathPattern = /^\/l2\/maps\/([a-f0-9]{64})\/native-tile-chunk-runtime\/manifest\.json$/;
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
  if (!Array.isArray(input.resources) || input.resources.length) throw new Error(`${label} resources are not supported.`);
  return { kind: "native-tile-runtime", schemaVersion: 1, tileId, sourceMap: input.sourceMap, sourceSha256: input.sourceSha256,
    frame: { terrainInfo: frame.terrainInfo, location: frame.location, terrainScale: frame.terrainScale },
    anchor: { playerStart: anchor.playerStart, location: anchor.location },
    chunks: parseChunkRecords(input.chunks, label), resources: [], gaps: parseNativeTileGapRows(input.gaps, tileId, label) };
}
