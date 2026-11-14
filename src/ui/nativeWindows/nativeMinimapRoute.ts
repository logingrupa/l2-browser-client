import { nativeResourceUrl } from "../../assets/native/nativeResourceUrl";
import { isPlainRecord, nativeTileSha256Pattern } from "../../scene/world/nativeManifestRecordGuards";

export class NativeMinimapRouteError extends Error {
  override readonly name = "NativeMinimapRouteError";
}

export interface NativeTextureArchivePin {
  readonly archive: string;
  readonly archiveSha256: string;
  readonly archiveBytes: number;
}

export interface NativeMinimapRouteTexture extends NativeTextureArchivePin {
  readonly object: string;
  readonly rule: string;
}

export interface NativeMinimapRouteRadarCase {
  readonly zoneName: string;
  readonly texture: NativeMinimapRouteTexture | null;
  readonly mapX: number;
  readonly mapY: number;
}

export interface NativeMinimapRouteRadar {
  readonly cases: readonly NativeMinimapRouteRadarCase[];
  readonly default: { readonly texture: NativeMinimapRouteTexture | null; readonly mapX: number; readonly mapY: number };
}

export interface NativeMinimapRouteWorldMapPiece {
  readonly suffix: number;
  readonly originX: number;
  readonly originY: number;
  readonly width: number;
  readonly height: number;
  readonly texture: NativeMinimapRouteTexture | null;
}

export interface NativeMinimapRouteProjection {
  readonly offsetX: number;
  readonly offsetY: number;
  readonly scaleNumerator: number;
  readonly scaleDenominator: number;
}

export interface NativeMinimapRouteWorldMap {
  readonly pieces: readonly NativeMinimapRouteWorldMapPiece[];
  readonly projection: NativeMinimapRouteProjection;
}

export interface NativeMinimapRouteZoneSampler {
  readonly worldOffsetX: number;
  readonly worldOffsetY: number;
  readonly tileSize: number;
  readonly tileBias: number;
  readonly originTileX: number;
  readonly originTileY: number;
  readonly missingTextureKey: number;
}

export interface NativeMinimapRouteZoneKeyRow {
  readonly rowIndex: number;
  readonly name: string;
  readonly key: number;
  readonly bottom: number;
  readonly top: number;
}

export interface NativeMinimapRouteGap { readonly reason: string; readonly evidence: string }

export interface NativeMinimapRoute {
  readonly radar: NativeMinimapRouteRadar;
  readonly worldMap: NativeMinimapRouteWorldMap;
  readonly zoneSampler: NativeMinimapRouteZoneSampler;
  readonly zoneKeyRows: readonly NativeMinimapRouteZoneKeyRow[];
  readonly gaps: readonly NativeMinimapRouteGap[];
}

const routeLabel = "Native minimap route manifest";
const maximumArchiveBytes = 128 * 1024 * 1024;
const maximumListedItems = 4096;
const maximumPieceDimension = 16384;

function fail(message: string): never {
  throw new NativeMinimapRouteError(`${routeLabel} ${message}`);
}

function requireRecord(value: unknown, what: string): Record<string, unknown> {
  if (!isPlainRecord(value)) fail(`${what} must be an object.`);
  return value;
}

function requireList(value: unknown, what: string): readonly unknown[] {
  if (!Array.isArray(value) || value.length > maximumListedItems) fail(`${what} must be a list of at most ${maximumListedItems} entries.`);
  return value;
}

function requireInteger(value: unknown, what: string, minimum = Number.MIN_SAFE_INTEGER, maximum = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) fail(`${what} must be an integer in ${minimum}..${maximum}.`);
  return value;
}

function requireFinite(value: unknown, what: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(`${what} must be a finite number.`);
  return value;
}

function requireText(value: unknown, what: string): string {
  if (typeof value !== "string" || value.length === 0) fail(`${what} must be non-empty text.`);
  return value;
}

function parseRouteTexture(value: unknown, what: string): NativeMinimapRouteTexture | null {
  if (value === null) return null;
  const texture = requireRecord(value, what);
  const archiveSha256 = texture.archiveSha256;
  if (typeof archiveSha256 !== "string" || !nativeTileSha256Pattern.test(archiveSha256) || texture.archive !== `/l2/${archiveSha256}/asset.l2asset`) {
    fail(`${what} archive must be /l2/<archiveSha256>/asset.l2asset.`);
  }
  nativeResourceUrl(texture.archive);
  return { archive: texture.archive, archiveSha256, archiveBytes: requireInteger(texture.archiveBytes, `${what} archiveBytes`, 1, maximumArchiveBytes),
    object: requireText(texture.object, `${what} object`), rule: requireText(texture.rule, `${what} rule`) };
}

function parseRadar(value: unknown): NativeMinimapRouteRadar {
  const radar = requireRecord(value, "radar");
  const cases = requireList(radar.cases, "radar cases").map((entry, index) => {
    const radarCase = requireRecord(entry, `radar case ${index}`);
    return { zoneName: requireText(radarCase.zoneName, `radar case ${index} zoneName`), texture: parseRouteTexture(radarCase.texture, `radar case ${index} texture`),
      mapX: requireInteger(radarCase.mapX, `radar case ${index} mapX`), mapY: requireInteger(radarCase.mapY, `radar case ${index} mapY`) };
  });
  const defaultCase = requireRecord(radar.default, "radar default");
  return { cases, default: { texture: parseRouteTexture(defaultCase.texture, "radar default texture"),
    mapX: requireInteger(defaultCase.mapX, "radar default mapX"), mapY: requireInteger(defaultCase.mapY, "radar default mapY") } };
}

function parseWorldMapPiece(value: unknown, index: number): NativeMinimapRouteWorldMapPiece {
  const piece = requireRecord(value, `world map piece ${index}`);
  const width = requireInteger(piece.width, `world map piece ${index} width`, 1, maximumPieceDimension);
  const height = requireInteger(piece.height, `world map piece ${index} height`, 1, maximumPieceDimension);
  const column = requireInteger(piece.column, `world map piece ${index} column`, 0), row = requireInteger(piece.row, `world map piece ${index} row`, 0);
  if (piece.originX !== column * width || piece.originY !== row * height) fail(`world map piece ${index} must lie at map pixel (column x width, row x height).`);
  return { suffix: requireInteger(piece.suffix, `world map piece ${index} suffix`, 0), originX: column * width, originY: row * height, width, height,
    texture: parseRouteTexture(piece.texture, `world map piece ${index} texture`) };
}

function parseWorldMap(value: unknown): NativeMinimapRouteWorldMap {
  const worldMap = requireRecord(value, "worldMap");
  const projection = requireRecord(worldMap.projection, "world map projection");
  return {
    pieces: requireList(worldMap.pieces, "world map pieces").map(parseWorldMapPiece),
    projection: { offsetX: requireFinite(projection.offsetX, "projection offsetX"), offsetY: requireFinite(projection.offsetY, "projection offsetY"),
      scaleNumerator: requireFinite(projection.scaleNumerator, "projection scaleNumerator"),
      scaleDenominator: requireInteger(projection.scaleDenominator, "projection scaleDenominator", 1) },
  };
}

function parseZoneSampler(value: unknown): NativeMinimapRouteZoneSampler {
  const sampler = requireRecord(value, "zoneSampler");
  if (sampler.clamp !== false) fail("zoneSampler must state clamp false.");
  return { worldOffsetX: requireFinite(sampler.worldOffsetX, "zoneSampler worldOffsetX"), worldOffsetY: requireFinite(sampler.worldOffsetY, "zoneSampler worldOffsetY"),
    tileSize: requireInteger(sampler.tileSize, "zoneSampler tileSize", 1), tileBias: requireInteger(sampler.tileBias, "zoneSampler tileBias"),
    originTileX: requireInteger(sampler.originTileX, "zoneSampler originTileX"), originTileY: requireInteger(sampler.originTileY, "zoneSampler originTileY"),
    missingTextureKey: requireInteger(sampler.missingTextureKey, "zoneSampler missingTextureKey", 0, 255) };
}

function parseZoneKeyRows(value: unknown): readonly NativeMinimapRouteZoneKeyRow[] {
  const zoneKeys = requireRecord(value, "zoneKeys");
  return requireList(zoneKeys.rows, "zone key rows").map((entry, index) => {
    const row = requireRecord(entry, `zone key row ${index}`);
    if (typeof row.name !== "string") fail(`zone key row ${index} name must be text.`);
    return { rowIndex: requireInteger(row.rowIndex, `zone key row ${index} rowIndex`, 0), name: row.name, key: requireInteger(row.key, `zone key row ${index} key`, 0),
      bottom: requireFinite(row.bottom, `zone key row ${index} bottom`), top: requireFinite(row.top, `zone key row ${index} top`) };
  });
}

function parseGaps(value: unknown): readonly NativeMinimapRouteGap[] {
  return requireList(value, "gaps").map((entry, index) => {
    const gap = requireRecord(entry, `gap ${index}`);
    return { reason: requireText(gap.reason, `gap ${index} reason`), evidence: requireText(gap.evidence, `gap ${index} evidence`) };
  });
}

export function parseNativeMinimapRoute(input: unknown): NativeMinimapRoute {
  const manifest = requireRecord(input, "root");
  if (manifest.kind !== "native-minimap-route" || manifest.schemaVersion !== 1) fail("kind or schema version is invalid.");
  return { radar: parseRadar(manifest.radar), worldMap: parseWorldMap(manifest.worldMap), zoneSampler: parseZoneSampler(manifest.zoneSampler),
    zoneKeyRows: parseZoneKeyRows(manifest.zoneKeys), gaps: parseGaps(manifest.gaps) };
}
