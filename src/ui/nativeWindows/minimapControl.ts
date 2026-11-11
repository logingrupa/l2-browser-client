import type { NativeTileMinimapRadarTexture } from "../../scene/world/minimapJoin";
import type { WorldEntity } from "../../world/worldTypes";
import type { NativeWindowMinimapTileSource, NativeWindowTextureResolution } from "./nativeWindowManifestLoader";
import { placeNativeWindowElement } from "./nativeWindowPlacement";
import { planWorldMapView, type WorldMapCell, type WorldMapTile } from "./worldMapView";

export const minimapControlType = "MinimapCtrl";

export interface MinimapControlSize { readonly width: number; readonly height: number }

export interface MinimapControlContext {
  readonly localPlayer: WorldEntity | null;
  readonly tileSource: NativeWindowMinimapTileSource;
}

export interface RenderedMinimapControl {
  refresh(localPlayer: WorldEntity | null): void;
  dispose(): void;
}

type RadarImageState = { readonly status: "loading" } | NativeWindowTextureResolution;

const minimapLoadFailedReason = "minimap-load-failed";
const markerTextureGapReason = "texture-reference-unresolved";
const zoneNameGapReason = "label-unresolved";
const clippedOverflow = "hidden";

function minimapPartElement(part: string): HTMLElement {
  const element = document.createElement("div");
  element.setAttribute("data-native-minimap-part", part);
  placeNativeWindowElement(element, 0, 0, 0, 0);
  return element;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function renderMinimapControl(element: HTMLElement, controlSize: MinimapControlSize, context: MinimapControlContext): RenderedMinimapControl {
  let localPlayer = context.localPlayer;
  let loadedTiles: readonly WorldMapTile[] | null = null;
  let loadFailure: string | null = null;
  let disposed = false;
  const radarImages = new Map<string, RadarImageState>();
  const cellElements = new Map<string, HTMLElement>();
  const stateGapElement = minimapPartElement("state");
  placeNativeWindowElement(stateGapElement, 0, 0, controlSize.width, controlSize.height);
  const zoneNameElement = minimapPartElement("zone-name");
  zoneNameElement.setAttribute("data-native-gap", zoneNameGapReason);
  const markerElement = minimapPartElement("marker");
  markerElement.setAttribute("data-native-gap", markerTextureGapReason);
  element.style.overflow = clippedOverflow;
  element.append(zoneNameElement);

  const removeCellsOutside = (visibleTileIds: ReadonlySet<string>): void => {
    for (const [tileId, cellElement] of cellElements) {
      if (visibleTileIds.has(tileId)) continue;
      cellElement.remove();
      cellElements.delete(tileId);
    }
  };

  const showStateGap = (reason: string): void => {
    removeCellsOutside(new Set());
    markerElement.remove();
    stateGapElement.setAttribute("data-native-gap", reason);
    if (stateGapElement.parentNode !== element) element.append(stateGapElement);
  };

  const radarImage = (tileId: string, radarTexture: NativeTileMinimapRadarTexture): RadarImageState => {
    const known = radarImages.get(tileId);
    if (known !== undefined) return known;
    radarImages.set(tileId, { status: "loading" });
    void context.tileSource.loadRadarImage(radarTexture).then(
      resolution => resolution,
      (error: unknown): NativeWindowTextureResolution => ({ status: "gap", reason: errorText(error) }),
    ).then(resolution => {
      if (disposed) {
        if (resolution.status === "resolved") URL.revokeObjectURL(resolution.url);
        return;
      }
      radarImages.set(tileId, resolution);
      draw();
    });
    return { status: "loading" };
  };

  const cellElementFor = (tileId: string): HTMLElement => {
    const existing = cellElements.get(tileId);
    if (existing !== undefined) return existing;
    const created = document.createElement("div");
    created.setAttribute("data-native-minimap-tile", tileId);
    cellElements.set(tileId, created);
    element.insertBefore(created, zoneNameElement);
    return created;
  };

  const drawCell = (cell: WorldMapCell, radarTexture: NativeTileMinimapRadarTexture | null): void => {
    const cellElement = cellElementFor(cell.tileId);
    placeNativeWindowElement(cellElement, cell.left, cell.top, cell.width, cell.height);
    const image: RadarImageState = cell.status === "gap" || radarTexture === null
      ? { status: "gap", reason: cell.reason! } : radarImage(cell.tileId, radarTexture);
    cellElement.setAttribute("data-native-minimap-cell", image.status === "resolved" ? "texture" : image.status);
    if (image.status === "gap") cellElement.setAttribute("data-native-gap", image.reason);
    else cellElement.removeAttribute("data-native-gap");
    if (image.status !== "resolved" || cellElement.querySelector("img") !== null) return;
    const imageElement = document.createElement("img");
    imageElement.setAttribute("alt", "");
    imageElement.setAttribute("src", image.url);
    placeNativeWindowElement(imageElement, 0, 0, cell.width, cell.height);
    cellElement.append(imageElement);
  };

  const draw = (): void => {
    if (loadFailure !== null) return showStateGap(minimapLoadFailedReason);
    if (loadedTiles === null) return;
    const plan = planWorldMapView({ controlWidth: controlSize.width, controlHeight: controlSize.height, tiles: loadedTiles,
      playerScenePosition: localPlayer?.position ?? null });
    element.setAttribute("data-native-minimap-arrangement", plan.labels.arrangement);
    element.setAttribute("data-native-minimap-scale", plan.labels.scale);
    if (plan.gap !== null) return showStateGap(plan.gap);
    stateGapElement.remove();
    removeCellsOutside(new Set(plan.cells.map(cell => cell.tileId)));
    const radarTextureByTileId = new Map(loadedTiles.map(tile => [tile.tileId, tile.minimap?.radarTexture ?? null]));
    for (const cell of plan.cells) drawCell(cell, radarTextureByTileId.get(cell.tileId) ?? null);
    placeNativeWindowElement(markerElement, plan.marker!.left, plan.marker!.top, 0, 0);
    markerElement.setAttribute("data-native-status", plan.marker!.status);
    if (markerElement.parentNode !== element) element.append(markerElement);
  };

  element.setAttribute("data-native-minimap-state", "loading");
  void Promise.all(context.tileSource.tileIds.map(async tileId => ({ tileId, minimap: await context.tileSource.loadTileMinimap(tileId) }))).then(
    tiles => { loadedTiles = tiles; },
    (error: unknown) => {
      loadFailure = errorText(error);
      element.setAttribute("data-native-minimap-error", loadFailure);
    },
  ).then(() => {
    if (disposed) return;
    element.setAttribute("data-native-minimap-state", loadFailure === null ? "ready" : "failed");
    draw();
  });

  return {
    refresh: nextLocalPlayer => {
      localPlayer = nextLocalPlayer;
      draw();
    },
    dispose: () => {
      disposed = true;
      for (const image of radarImages.values()) if (image.status === "resolved") URL.revokeObjectURL(image.url);
      radarImages.clear();
    },
  };
}
