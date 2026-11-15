import type { SourcePosition } from "../../world/sourceFrame";
import type { NativeMinimapRouteProjection, NativeMinimapRouteTexture, NativeMinimapRouteWorldMap } from "./nativeMinimapRoute";

export interface WorldMapPosition { readonly mapX: number; readonly mapY: number }

export interface WorldMapPiecePlacement {
  readonly suffix: number;
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly texture: NativeMinimapRouteTexture | null;
  readonly gap: string | null;
}

export interface WorldMapMarker extends WorldMapPosition { readonly left: number; readonly top: number }

export interface WorldMapViewLabels {
  readonly viewOrigin: "centred on the marker, presentation";
  readonly scale: "one map pixel per CSS pixel, presentation";
}

export interface WorldMapViewPlan {
  readonly pieces: readonly WorldMapPiecePlacement[];
  readonly marker: WorldMapMarker | null;
  readonly viewOrigin: { readonly left: number; readonly top: number };
  readonly gap: string | null;
  readonly labels: WorldMapViewLabels;
}

export interface WorldMapViewInput {
  readonly controlWidth: number;
  readonly controlHeight: number;
  readonly worldMap: NativeMinimapRouteWorldMap;
  readonly playerSourcePosition: SourcePosition | null;
}

export const worldMapViewLabels: WorldMapViewLabels = { viewOrigin: "centred on the marker, presentation", scale: "one map pixel per CSS pixel, presentation" };
export const worldMapViewOriginPresentationReason = "presentation:view-origin-centred-on-marker";
const localPlayerAbsentReason = "adapter-field-absent:position";
const worldMapPieceTextureAbsentReason = "world-map-piece-texture-absent";

export function truncateToInt32(value: number): number {
  return value | 0;
}

export function worldMapPosition(projection: NativeMinimapRouteProjection, sourcePosition: SourcePosition): WorldMapPosition {
  const scale = projection.scaleNumerator / projection.scaleDenominator;
  return { mapX: truncateToInt32((sourcePosition.x + projection.offsetX) * scale), mapY: truncateToInt32((sourcePosition.y + projection.offsetY) * scale) };
}

export function planWorldMapView(input: WorldMapViewInput): WorldMapViewPlan {
  if (input.playerSourcePosition === null) return { pieces: [], marker: null, viewOrigin: { left: 0, top: 0 }, gap: localPlayerAbsentReason, labels: worldMapViewLabels };
  const position = worldMapPosition(input.worldMap.projection, input.playerSourcePosition);
  const markerLeft = input.controlWidth / 2, markerTop = input.controlHeight / 2;
  const viewOrigin = { left: markerLeft - position.mapX, top: markerTop - position.mapY };
  const pieces = input.worldMap.pieces.map(piece => ({ suffix: piece.suffix, left: viewOrigin.left + piece.originX, top: viewOrigin.top + piece.originY,
    width: piece.width, height: piece.height, texture: piece.texture, gap: piece.texture === null ? worldMapPieceTextureAbsentReason : null }));
  return { pieces, marker: { left: markerLeft, top: markerTop, ...position }, viewOrigin, gap: null, labels: worldMapViewLabels };
}
