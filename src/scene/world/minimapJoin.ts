import { nativeResourceUrl } from "../../assets/native/nativeResourceUrl";
import { worldPositionToSource, type WorldPosition } from "../../world/sourceFrame";
import { fetchVerifiedNativeResource } from "../../assets/native/fetchVerifiedNativeResource";
import { decodeNativeJsonResource } from "./loadNativeSection";
import { hasExactKeys, isPlainRecord, nativeTileSha256Pattern } from "./nativeManifestRecordGuards";
import type { NativeTileManifest } from "./nativeTileManifest";

export class NativeTileMinimapError extends Error {
  override readonly name = "NativeTileMinimapError";
}

export interface NativeTileMinimapSourceInput {
  readonly path: string;
  readonly sha256: string;
}

export interface NativeTileMinimapRadarTexture {
  readonly archive: string;
  readonly archiveSha256: string;
  readonly archiveBytes: number;
  readonly sourceObject: string;
  readonly rule: string;
}

export interface NativeTileMinimapTexture {
  readonly object: string;
  readonly rule: string;
  readonly source: { readonly path: string; readonly sha256: string; readonly exportIndex: number };
  readonly citation: string | null;
}

export interface NativeTileMinimapRowSource {
  readonly table: string;
  readonly path: string;
  readonly sha256: string;
  readonly rowIndex: number;
  readonly field: string;
}

export interface NativeTileMinimapZone {
  readonly id: number;
  readonly name: string;
  readonly map: string;
  readonly rule: string;
  readonly source: NativeTileMinimapRowSource;
}

export interface NativeTileMinimapHuntingZone {
  readonly id: number;
  readonly name: string;
  readonly rule: string;
  readonly startLocation: readonly [number, number, number];
  readonly source: NativeTileMinimapRowSource;
}

export interface NativeTileMinimapProjection {
  readonly rule: "tile-frame-extent";
  readonly status: "unverified";
  readonly frameMinimumNative: readonly [number, number];
  readonly frameMaximumNative: readonly [number, number];
  readonly textureWidth: number;
  readonly textureHeight: number;
}

export interface NativeTileMinimapGap {
  readonly reason: string;
  readonly evidence: string;
}

export interface NativeTileMinimap {
  readonly kind: "native-tile-minimap";
  readonly schemaVersion: 1;
  readonly tileId: string;
  readonly sourceInputs: readonly NativeTileMinimapSourceInput[];
  readonly radarTexture: NativeTileMinimapRadarTexture | null;
  readonly townMapTextures: readonly NativeTileMinimapTexture[];
  readonly zoneNameTextures: readonly NativeTileMinimapTexture[];
  readonly zones: readonly NativeTileMinimapZone[];
  readonly huntingZones: readonly NativeTileMinimapHuntingZone[];
  readonly projection: NativeTileMinimapProjection | null;
  readonly gaps: readonly NativeTileMinimapGap[];
  readonly labels: { readonly schemaFieldMeaning: string };
}

export type NativeTileMinimapTexturePosition =
  | { readonly position: { readonly u: number; readonly v: number; readonly status: "unverified" }; readonly reason: null }
  | { readonly position: null; readonly reason: string };

const manifestFields = ["kind", "schemaVersion", "tileId", "sourceInputs", "radarTexture", "townMapTextures", "zoneNameTextures", "zones",
  "huntingZones", "projection", "gaps", "labels"];
const radarTextureFields = ["archive", "archiveSha256", "archiveBytes", "sourceObject", "rule"];
const textureSourceFields = ["path", "sha256", "exportIndex"];
const rowSourceFields = ["table", "path", "sha256", "rowIndex", "field"];
const zoneFields = ["id", "name", "map", "rule", "source"];
const huntingZoneFields = ["id", "name", "rule", "startLocation", "source"];
const projectionFields = ["rule", "status", "frameMinimumNative", "frameMaximumNative", "textureWidth", "textureHeight"];
const textureRules = ["tile-id", "tile-id-map", "zonename-map", "zonename-name", "huntingzone-name"];
const radarTextureRules = ["tile-id", "tile-id-map", "zonename-map"];
const clientRelativePathPattern = /^(?:[A-Za-z0-9_-][A-Za-z0-9._-]*\/)*[A-Za-z0-9_-][A-Za-z0-9._-]*$/;
const qualifiedObjectPattern = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+$/;
const tileIdPattern = /^\d{2}_\d{2}$/;
const maximumArchiveBytes = 64 * 1024 * 1024;
const maximumTextureDimension = 16384;
const maximumListedItems = 4096;
const outsideTileFrameReason = "outside-tile-frame";
const projectionGapReason = "minimap-join-unresolved:projection";

function fail(label: string, message: string): never {
  throw new NativeTileMinimapError(`${label} ${message}`);
}

function isBoundedInteger(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function isNonEmptyText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && nativeTileSha256Pattern.test(value);
}

function isFiniteNumbers(value: unknown, count: number): value is readonly number[] {
  return Array.isArray(value) && value.length === count && value.every(entry => typeof entry === "number" && Number.isFinite(entry));
}

function boundedList(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value) || value.length > maximumListedItems) fail(label, `must be a list of at most ${maximumListedItems} entries.`);
  return value;
}

function parseSourceInput(value: unknown, label: string): NativeTileMinimapSourceInput {
  if (!hasExactKeys(value, ["path", "sha256"]) || typeof value.path !== "string" || !clientRelativePathPattern.test(value.path) || !isSha256(value.sha256)) {
    fail(label, "source input must hold a client-relative path and its SHA-256.");
  }
  return { path: value.path, sha256: value.sha256 };
}

function parseRadarTexture(value: unknown, label: string): NativeTileMinimapRadarTexture | null {
  if (value === null) return null;
  if (!hasExactKeys(value, radarTextureFields) || !isSha256(value.archiveSha256) || !isBoundedInteger(value.archiveBytes, 1, maximumArchiveBytes) ||
    typeof value.sourceObject !== "string" || !qualifiedObjectPattern.test(value.sourceObject) || !radarTextureRules.includes(value.rule as string)) {
    fail(label, "radar texture must pin its archive, byte size, source object and join rule.");
  }
  if (typeof value.archive !== "string" || value.archive !== `/l2/${value.archiveSha256}/asset.l2asset`) {
    fail(label, "radar texture archive must be /l2/<archiveSha256>/asset.l2asset.");
  }
  nativeResourceUrl(value.archive);
  return { archive: value.archive, archiveSha256: value.archiveSha256, archiveBytes: value.archiveBytes, sourceObject: value.sourceObject,
    rule: value.rule as string };
}

function parseTexture(value: unknown, label: string): NativeTileMinimapTexture {
  const fields = isPlainRecord(value) && "citation" in value ? ["object", "rule", "source", "citation"] : ["object", "rule", "source"];
  if (!hasExactKeys(value, fields) || typeof value.object !== "string" || !qualifiedObjectPattern.test(value.object) ||
    !textureRules.includes(value.rule as string) || ("citation" in value && !isNonEmptyText(value.citation))) {
    fail(label, "texture must name its object, an exact join rule and its source.");
  }
  const source = value.source;
  if (!hasExactKeys(source, textureSourceFields) || typeof source.path !== "string" || !clientRelativePathPattern.test(source.path) ||
    !isSha256(source.sha256) || !isBoundedInteger(source.exportIndex, 1, Number.MAX_SAFE_INTEGER)) {
    fail(label, "texture source must hold a package path, its SHA-256 and an export index.");
  }
  return { object: value.object, rule: value.rule as string, citation: (value.citation as string | undefined) ?? null,
    source: { path: source.path, sha256: source.sha256, exportIndex: source.exportIndex } };
}

function parseRowSource(value: unknown, label: string): NativeTileMinimapRowSource {
  if (!hasExactKeys(value, rowSourceFields) || !isNonEmptyText(value.table) || typeof value.path !== "string" || !clientRelativePathPattern.test(value.path) ||
    !isSha256(value.sha256) || !isBoundedInteger(value.rowIndex, 0, Number.MAX_SAFE_INTEGER) || !isNonEmptyText(value.field)) {
    fail(label, "row source must hold a table, its path and SHA-256, a row index and a field.");
  }
  return { table: value.table, path: value.path, sha256: value.sha256, rowIndex: value.rowIndex, field: value.field };
}

function parseZone(value: unknown, label: string): NativeTileMinimapZone {
  if (!hasExactKeys(value, zoneFields) || !isBoundedInteger(value.id, 0, Number.MAX_SAFE_INTEGER) || typeof value.name !== "string" ||
    typeof value.map !== "string" || value.rule !== "zonename-grid") {
    fail(label, "zone must hold an id, name, map and the zonename-grid rule.");
  }
  return { id: value.id, name: value.name, map: value.map, rule: value.rule, source: parseRowSource(value.source, label) };
}

function parseHuntingZone(value: unknown, label: string): NativeTileMinimapHuntingZone {
  if (!hasExactKeys(value, huntingZoneFields) || !isBoundedInteger(value.id, 0, Number.MAX_SAFE_INTEGER) || typeof value.name !== "string" ||
    value.rule !== "huntingzone-start-in-frame" || !isFiniteNumbers(value.startLocation, 3)) {
    fail(label, "hunting zone must hold an id, name, the start-in-frame rule and a finite start location.");
  }
  const [x, y, z] = value.startLocation;
  return { id: value.id, name: value.name, rule: value.rule, startLocation: [x!, y!, z!], source: parseRowSource(value.source, label) };
}

function parseProjection(value: unknown, label: string): NativeTileMinimapProjection | null {
  if (value === null) return null;
  if (!hasExactKeys(value, projectionFields) || value.rule !== "tile-frame-extent" || value.status !== "unverified" ||
    !isFiniteNumbers(value.frameMinimumNative, 2) || !isFiniteNumbers(value.frameMaximumNative, 2) ||
    !isBoundedInteger(value.textureWidth, 1, maximumTextureDimension) || value.textureHeight !== value.textureWidth) {
    fail(label, "projection must be the unverified tile-frame-extent rule with a frame and a square texture.");
  }
  const [minimumX, minimumY] = value.frameMinimumNative, [maximumX, maximumY] = value.frameMaximumNative;
  if (!(minimumX! < maximumX! && minimumY! < maximumY!)) fail(label, "projection frame minimum must lie below its maximum.");
  return { rule: "tile-frame-extent", status: "unverified", frameMinimumNative: [minimumX!, minimumY!], frameMaximumNative: [maximumX!, maximumY!],
    textureWidth: value.textureWidth, textureHeight: value.textureWidth };
}

function parseGap(value: unknown, label: string): NativeTileMinimapGap {
  if (!hasExactKeys(value, ["reason", "evidence"]) || !isNonEmptyText(value.reason) || !isNonEmptyText(value.evidence)) {
    fail(label, "gap must hold a reason and its evidence.");
  }
  return { reason: value.reason, evidence: value.evidence };
}

export function parseNativeTileMinimapManifest(input: unknown, expectedTileId: string): NativeTileMinimap {
  const label = `Native tile ${expectedTileId} minimap manifest`;
  if (!hasExactKeys(input, manifestFields) || input.kind !== "native-tile-minimap" || input.schemaVersion !== 1) {
    fail(label, "kind or schema version is invalid.");
  }
  if (typeof input.tileId !== "string" || !tileIdPattern.test(input.tileId) || input.tileId !== expectedTileId) fail(label, "names another tile.");
  const labels = input.labels;
  if (!hasExactKeys(labels, ["schemaFieldMeaning"]) || !isNonEmptyText(labels.schemaFieldMeaning)) fail(label, "must label the schema field meanings.");
  const gaps = boundedList(input.gaps, `${label} gaps`).map(gap => parseGap(gap, label));
  const projection = parseProjection(input.projection, label);
  if (projection === null && gaps.length === 0) fail(label, "without a projection must list the gap that explains it.");
  return { kind: "native-tile-minimap", schemaVersion: 1, tileId: input.tileId,
    sourceInputs: boundedList(input.sourceInputs, `${label} sourceInputs`).map(entry => parseSourceInput(entry, label)),
    radarTexture: parseRadarTexture(input.radarTexture, label),
    townMapTextures: boundedList(input.townMapTextures, `${label} townMapTextures`).map(entry => parseTexture(entry, label)),
    zoneNameTextures: boundedList(input.zoneNameTextures, `${label} zoneNameTextures`).map(entry => parseTexture(entry, label)),
    zones: boundedList(input.zones, `${label} zones`).map(entry => parseZone(entry, label)),
    huntingZones: boundedList(input.huntingZones, `${label} huntingZones`).map(entry => parseHuntingZone(entry, label)),
    projection, gaps, labels: { schemaFieldMeaning: labels.schemaFieldMeaning } };
}

export async function loadNativeTileMinimap(tileManifest: NativeTileManifest, signal: AbortSignal): Promise<NativeTileMinimap | null> {
  const resource = tileManifest.resources.find(entry => entry.kind === "minimap");
  if (!resource) return null;
  const bytes = await fetchVerifiedNativeResource(resource.manifest, resource.manifestSha256, signal, resource.manifestBytes);
  return parseNativeTileMinimapManifest(decodeNativeJsonResource(bytes, `Native tile ${tileManifest.tileId} minimap manifest`), tileManifest.tileId);
}

export function minimapTexturePosition(minimap: NativeTileMinimap, scenePosition: WorldPosition): NativeTileMinimapTexturePosition {
  const projection = minimap.projection;
  if (projection === null) {
    return { position: null, reason: (minimap.gaps.find(gap => gap.reason === projectionGapReason) ?? minimap.gaps[0]!).reason };
  }
  const { x: nativeX, y: nativeY } = worldPositionToSource(scenePosition);
  const [minimumX, minimumY] = projection.frameMinimumNative, [maximumX, maximumY] = projection.frameMaximumNative;
  if (nativeX < minimumX || nativeX > maximumX || nativeY < minimumY || nativeY > maximumY) return { position: null, reason: outsideTileFrameReason };
  return { position: { u: (nativeX - minimumX) / (maximumX - minimumX), v: (nativeY - minimumY) / (maximumY - minimumY), status: "unverified" },
    reason: null };
}
