import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

interface RecipeRadarCase { readonly zoneName: string; readonly texture: string; readonly mapX: number; readonly mapY: number }
interface RecipeOpenItem { readonly id: string; readonly what: string; readonly tileGap: string | null }
interface MinimapRadarRouteRecipe {
  readonly radar: { readonly textureGroup: string; readonly cases: readonly RecipeRadarCase[];
    readonly default: { readonly texture: string; readonly mapX: number; readonly mapY: number; readonly isGlobal: boolean } };
  readonly worldMap: {
    readonly initializeMapDisplay: { readonly english: string; readonly suffixes: readonly number[] };
    readonly drawWorldMap: { readonly columns: number; readonly pieceWidth: number; readonly pieceHeight: number };
    readonly getMinimapPosition: Record<string, unknown>;
  };
  readonly zoneSampler: Record<string, unknown>;
  readonly open: readonly RecipeOpenItem[];
}

export interface SyntheticZoneKeyRow {
  readonly name: string;
  readonly key: number;
  readonly color: number;
  readonly mapX: number;
  readonly mapY: number;
  readonly bottom: number;
  readonly top: number;
  readonly tileId: string | null;
}

export interface SyntheticMinimapRouteOptions {
  readonly zoneKeyRows?: readonly SyntheticZoneKeyRow[];
  readonly convertedPieceSuffixes?: readonly number[];
}

export const minimapRadarRouteRecipe = JSON.parse(readFileSync("recipes/world/minimap-radar-route.json", "utf8")) as MinimapRadarRouteRecipe;

export function syntheticArchiveSha256(objectName: string): string {
  return createHash("sha256").update(objectName).digest("hex");
}

export function syntheticRouteTexture(objectName: string, rule: string) {
  const archiveSha256 = syntheticArchiveSha256(objectName);
  return { archive: `/l2/${archiveSha256}/asset.l2asset`, archiveSha256, archiveBytes: 4096, object: objectName, rule, format: "DXT1" };
}

function syntheticWorldMapPieces(convertedSuffixes: readonly number[]) {
  const { initializeMapDisplay, drawWorldMap } = minimapRadarRouteRecipe.worldMap;
  return initializeMapDisplay.suffixes.map((suffix, index) => {
    const column = index % drawWorldMap.columns, row = Math.floor(index / drawWorldMap.columns);
    return { suffix, index, column, row, originX: column * drawWorldMap.pieceWidth, originY: row * drawWorldMap.pieceHeight,
      width: drawWorldMap.pieceWidth, height: drawWorldMap.pieceHeight,
      texture: convertedSuffixes.includes(suffix) ? syntheticRouteTexture(`${initializeMapDisplay.english}${suffix}`, "world-map-piece") : null };
  });
}

function everyTileOpenGaps() {
  return minimapRadarRouteRecipe.open.filter(item => item.tileGap !== null && ["zone-title-source", "radar-anchor"].includes(item.id))
    .map(item => ({ reason: item.tileGap!, evidence: item.what }));
}

export function syntheticMinimapRouteManifest(options: SyntheticMinimapRouteOptions = {}): Record<string, unknown> {
  const { radar, worldMap, zoneSampler, open } = minimapRadarRouteRecipe;
  const rows = (options.zoneKeyRows ?? []).map((row, rowIndex) => ({ rowIndex, id: rowIndex, ...row }));
  const convertedPieceSuffixes = options.convertedPieceSuffixes ?? worldMap.initializeMapDisplay.suffixes;
  return {
    kind: "native-minimap-route", schemaVersion: 1,
    recipe: { path: "recipes/world/minimap-radar-route.json", sha256: "a".repeat(64) },
    sourceInputs: [{ path: "systextures/L2_RadarMap.utx", sha256: "b".repeat(64) }],
    radar: {
      cases: radar.cases.map(entry => ({ ...entry, texture: syntheticRouteTexture(`${radar.textureGroup}.${entry.texture}`, "radar-case") })),
      default: { ...radar.default, texture: syntheticRouteTexture(`${radar.textureGroup}.${radar.default.texture}`, "radar-default") },
    },
    worldMap: { pieces: syntheticWorldMapPieces(convertedPieceSuffixes), projection: worldMap.getMinimapPosition, fallback: "L2Font.Minimap.ch4_worldmap" },
    zoneSampler,
    zoneKeys: { rows, overlappingRuns: [] },
    open,
    gaps: everyTileOpenGaps(),
  };
}

export function syntheticMinimapRouteBytes(options: SyntheticMinimapRouteOptions = {}): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(syntheticMinimapRouteManifest(options)));
}
