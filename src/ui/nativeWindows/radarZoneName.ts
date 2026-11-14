import type { SourcePosition } from "../../world/sourceFrame";
import { zoneKeyHelper } from "./minimapRadarRouteRecipe";
import type { NativeMinimapRoute, NativeMinimapRouteZoneKeyRow, NativeMinimapRouteZoneSampler } from "./nativeMinimapRoute";
import { truncateToInt32 } from "./worldMapView";

export interface ZoneSamplerTile { readonly tileX: number; readonly tileY: number; readonly tileId: string }

export interface ZoneKeyMip { readonly width: number; readonly height: number; readonly bytes: Uint8Array }

export type ZoneKeyMipLoad = { readonly status: "loaded"; readonly mip: ZoneKeyMip } | { readonly status: "gap"; readonly reason: string };

export type ZoneKeyByte = { readonly status: "sampled"; readonly byte: number } | { readonly status: "gap"; readonly reason: string };

export type RadarZoneNameSample =
  | { readonly status: "named"; readonly zoneName: string; readonly rowIndex: number }
  | { readonly status: "gap"; readonly reason: string };

export interface RadarZoneNameInput {
  readonly route: NativeMinimapRoute;
  readonly sourcePosition: SourcePosition;
  readonly zoneKeyMip: ZoneKeyMip | null;
}

export const zoneKeyBytesGapReason = "minimap-join-unresolved:zone-key-bytes";
export const zoneKeyRunGapReason = "minimap-join-unresolved:zone-key-run";
const zoneSamplerPixelOutsideMipReason = "zone-sampler-pixel-outside-mip";
const zoneNameRowAbsentReason = "zone-name-row-absent";
const nativeTextureSourceFile = "native-texture-source.json";
const zoneKeyShift = 8;
const maximumMipDimension = 16384;

function tileCoordinateText(coordinate: number): string {
  return String(coordinate).padStart(2, "0");
}

export function zoneSamplerTile(sampler: NativeMinimapRouteZoneSampler, sourcePosition: SourcePosition): ZoneSamplerTile {
  const tileX = truncateToInt32((sourcePosition.x + sampler.worldOffsetX) / sampler.tileSize + sampler.tileBias);
  const tileY = truncateToInt32((sourcePosition.y + sampler.worldOffsetY) / sampler.tileSize + sampler.tileBias);
  return { tileX, tileY, tileId: `${tileCoordinateText(tileX)}_${tileCoordinateText(tileY)}` };
}

export function zoneKeyByte(sampler: NativeMinimapRouteZoneSampler, tile: ZoneSamplerTile, sourcePosition: SourcePosition, mip: ZoneKeyMip | null): ZoneKeyByte {
  if (mip === null) return { status: "sampled", byte: sampler.missingTextureKey };
  const originX = truncateToInt32((tile.tileX - sampler.originTileX) * sampler.tileSize);
  const originY = truncateToInt32((tile.tileY - sampler.originTileY) * sampler.tileSize);
  const pixelX = truncateToInt32(truncateToInt32((sourcePosition.x - originX) * mip.width) / sampler.tileSize);
  const pixelY = truncateToInt32(truncateToInt32((sourcePosition.y - originY) * mip.height) / sampler.tileSize);
  if (pixelX < 0 || pixelX >= mip.width || pixelY < 0 || pixelY >= mip.height) return { status: "gap", reason: zoneSamplerPixelOutsideMipReason };
  return { status: "sampled", byte: mip.bytes[pixelY * mip.width + pixelX]! };
}

export function zoneNameKey(color: number, tileX: number, tileY: number): number {
  if (color < zoneKeyHelper.globalBelowColor) return color << zoneKeyShift;
  return ((((tileY << zoneKeyShift) | tileX) << zoneKeyShift) | color) << zoneKeyShift;
}

export function zoneNameRow(rows: readonly NativeMinimapRouteZoneKeyRow[], key: number, sourceZ: number): RadarZoneNameSample {
  const z = Math.fround(sourceZ);
  const holding = rows.filter(row => row.key === key && row.bottom < z && z < row.top);
  if (holding.length > 1) return { status: "gap", reason: zoneKeyRunGapReason };
  const row = holding[0];
  return row === undefined ? { status: "gap", reason: zoneNameRowAbsentReason } : { status: "named", zoneName: row.name, rowIndex: row.rowIndex };
}

export function sampleRadarZoneName(input: RadarZoneNameInput): RadarZoneNameSample {
  const sampler = input.route.zoneSampler;
  const tile = zoneSamplerTile(sampler, input.sourcePosition);
  const sampled = zoneKeyByte(sampler, tile, input.sourcePosition, input.zoneKeyMip);
  if (sampled.status === "gap") return sampled;
  return zoneNameRow(input.route.zoneKeyRows, zoneNameKey(sampled.byte, tile.tileX, tile.tileY), input.sourcePosition.z);
}

function firstMipRecord(nativeTextureSourceBytes: Uint8Array): { readonly file: string; readonly width: number; readonly height: number } | null {
  let source: unknown;
  try { source = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(nativeTextureSourceBytes)); }
  catch { return null; }
  const mips = (source as { readonly mips?: unknown }).mips;
  const mip = Array.isArray(mips) ? mips[0] as Record<string, unknown> | undefined : undefined;
  const isDimension = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= maximumMipDimension;
  if (mip === undefined || mip === null || typeof mip.file !== "string" || !isDimension(mip.width) || !isDimension(mip.height)) return null;
  return { file: mip.file, width: mip.width, height: mip.height };
}

export function zoneKeyMipFromTexturePackage(files: ReadonlyMap<string, Uint8Array>): ZoneKeyMipLoad {
  const nativeTextureSourceBytes = files.get(nativeTextureSourceFile);
  const mip = nativeTextureSourceBytes === undefined ? null : firstMipRecord(nativeTextureSourceBytes);
  const bytes = mip === null ? undefined : files.get(mip.file);
  if (mip === null || bytes === undefined || bytes.byteLength !== mip.width * mip.height) return { status: "gap", reason: zoneKeyBytesGapReason };
  return { status: "loaded", mip: { width: mip.width, height: mip.height, bytes } };
}
