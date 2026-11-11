import { minimapTexturePosition, type NativeTileMinimap } from "../../scene/world/minimapJoin";
import type { WorldEntity } from "../../world/worldTypes";
import type { NativeWindowMinimapTileSource, NativeWindowTextureResolution } from "./nativeWindowManifestLoader";
import { placeNativeWindowElement } from "./nativeWindowPlacement";

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

interface LoadedMinimapTile { readonly tileId: string; readonly minimap: NativeTileMinimap | null }

type RadarImageState = { readonly status: "loading" } | NativeWindowTextureResolution;

const noConvertedTileReason = "no converted tile at the player position";
const localPlayerAbsentReason = "adapter-field-absent:position";
const minimapLoadFailedReason = "minimap-load-failed";
const markerTextureGapReason = "texture-reference-unresolved";
const zoneNameGapReason = "label-unresolved";

function unresolvedElement(role: string, reason: string): HTMLElement {
  const element = document.createElement("div");
  element.setAttribute("data-native-minimap-part", role);
  element.setAttribute("data-native-gap", reason);
  placeNativeWindowElement(element, 0, 0, 0, 0);
  return element;
}

function tileGapReason(minimap: NativeTileMinimap): string {
  return minimap.gaps.map(gap => gap.reason).join(" ");
}

export function renderMinimapControl(element: HTMLElement, controlSize: MinimapControlSize, context: MinimapControlContext): RenderedMinimapControl {
  let localPlayer = context.localPlayer;
  let loadedTiles: readonly LoadedMinimapTile[] | null = null;
  let loadFailure: string | null = null;
  let disposed = false;
  const radarImages = new Map<string, RadarImageState>();
  const cellElements = new Map<string, HTMLElement>();
  const stateGapElement = document.createElement("div");
  stateGapElement.setAttribute("data-native-minimap-part", "state");
  placeNativeWindowElement(stateGapElement, 0, 0, controlSize.width, controlSize.height);
  const markerElement = unresolvedElement("marker", markerTextureGapReason);
  markerElement.setAttribute("data-native-status", "unverified");
  const zoneNameElement = unresolvedElement("zone-name", zoneNameGapReason);
  element.append(zoneNameElement);

  const showStateGap = (reason: string): void => {
    for (const cellElement of cellElements.values()) cellElement.remove();
    cellElements.clear();
    markerElement.remove();
    stateGapElement.setAttribute("data-native-gap", reason);
    if (stateGapElement.parentNode !== element) element.append(stateGapElement);
  };

  const radarImage = (tileId: string, minimap: NativeTileMinimap): RadarImageState => {
    const known = radarImages.get(tileId);
    if (known !== undefined) return known;
    radarImages.set(tileId, { status: "loading" });
    void context.tileSource.loadRadarImage(minimap.radarTexture!).then(
      resolution => resolution,
      (error: unknown): NativeWindowTextureResolution => ({ status: "gap", reason: error instanceof Error ? error.message : String(error) }),
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

  const cellElement = (tileId: string): HTMLElement => {
    const existing = cellElements.get(tileId);
    if (existing !== undefined) return existing;
    const created = document.createElement("div");
    created.setAttribute("data-native-minimap-tile", tileId);
    cellElements.set(tileId, created);
    element.insertBefore(created, zoneNameElement);
    return created;
  };

  const drawTileCell = (tile: LoadedMinimapTile & { readonly minimap: NativeTileMinimap }, width: number, height: number): void => {
    const cell = cellElement(tile.tileId);
    placeNativeWindowElement(cell, 0, 0, width, height);
    const image = tile.minimap.radarTexture === null ? { status: "gap" as const, reason: tileGapReason(tile.minimap) } : radarImage(tile.tileId, tile.minimap);
    if (image.status === "gap") cell.setAttribute("data-native-gap", image.reason);
    else cell.removeAttribute("data-native-gap");
    if (image.status !== "resolved" || cell.querySelector("img") !== null) return;
    const imageElement = document.createElement("img");
    imageElement.setAttribute("alt", "");
    imageElement.setAttribute("src", image.url);
    placeNativeWindowElement(imageElement, 0, 0, width, height);
    cell.append(imageElement);
  };

  const draw = (): void => {
    if (loadFailure !== null) return showStateGap(minimapLoadFailedReason);
    if (loadedTiles === null) return;
    if (localPlayer === null) return showStateGap(localPlayerAbsentReason);
    const scenePosition = { x: localPlayer.position.x, z: localPlayer.position.z };
    for (const tile of loadedTiles) {
      if (tile.minimap === null || tile.minimap.projection === null) continue;
      const projected = minimapTexturePosition(tile.minimap, scenePosition);
      if (projected.position === null) continue;
      stateGapElement.remove();
      const { textureWidth, textureHeight } = tile.minimap.projection;
      drawTileCell({ tileId: tile.tileId, minimap: tile.minimap }, textureWidth, textureHeight);
      placeNativeWindowElement(markerElement, projected.position.u * textureWidth, projected.position.v * textureHeight, 0, 0);
      if (markerElement.parentNode !== element) element.append(markerElement);
      return;
    }
    showStateGap(noConvertedTileReason);
  };

  element.setAttribute("data-native-minimap-state", "loading");
  void Promise.all(context.tileSource.tileIds.map(async tileId => ({ tileId, minimap: await context.tileSource.loadTileMinimap(tileId) }))).then(
    tiles => { loadedTiles = tiles; },
    (error: unknown) => {
      loadFailure = error instanceof Error ? error.message : String(error);
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
