import type { NativeTileMinimap, NativeTileMinimapRoutePin } from "../../scene/world/minimapJoin";
import { worldPositionToSource } from "../../world/sourceFrame";
import type { WorldEntity } from "../../world/worldTypes";
import type { NativeMinimapRoute, NativeTextureArchivePin } from "./nativeMinimapRoute";
import type { NativeWindowMinimapSource, NativeWindowTextureResolution } from "./nativeWindowManifestLoader";
import { placeNativeWindowElement } from "./nativeWindowPlacement";
import { planWorldMapView, worldMapViewOriginPresentationReason, type WorldMapPiecePlacement } from "./worldMapView";

export const minimapControlType = "MinimapCtrl";

export interface MinimapControlSize { readonly width: number; readonly height: number }

export interface MinimapControlContext {
  readonly localPlayer: WorldEntity | null;
  readonly minimapSource: NativeWindowMinimapSource;
  readonly onGapsChanged: () => void;
}

export interface RenderedMinimapControl {
  readonly gaps: readonly string[];
  refresh(localPlayer: WorldEntity | null): void;
  resize(controlSize: MinimapControlSize): void;
  dispose(): void;
}

interface LoadedMinimapRoute {
  readonly route: NativeMinimapRoute | null;
  readonly tileMinimaps: ReadonlyMap<string, NativeTileMinimap>;
}

type TextureImageState = { readonly status: "loading" } | NativeWindowTextureResolution;

const minimapLoadFailedReason = "minimap-load-failed";
const minimapRouteNotInCatalogReason = "minimap-route-not-in-catalog";
const markerTextureGapReason = "texture-reference-unresolved";
const zoneNameTextGapReason = "label-unresolved";
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

function singleRoutePin(tileMinimaps: readonly NativeTileMinimap[]): NativeTileMinimapRoutePin | null {
  const pins = new Map(tileMinimaps.map(minimap => [minimap.route.manifestSha256, minimap.route]));
  if (pins.size > 1) throw new Error(`Tile minimaps pin different minimap routes: ${[...pins.keys()].sort().join(", ")}.`);
  return pins.values().next().value ?? null;
}

async function loadMinimapRoute(source: NativeWindowMinimapSource): Promise<LoadedMinimapRoute> {
  const loaded = await Promise.all(source.tileIds.map(async tileId => source.loadTileMinimap(tileId)));
  const tileMinimaps = loaded.filter(minimap => minimap !== null);
  const routePin = singleRoutePin(tileMinimaps);
  return { route: routePin === null ? null : await source.loadMinimapRoute(routePin),
    tileMinimaps: new Map(tileMinimaps.map(minimap => [minimap.tileId, minimap])) };
}

export function renderMinimapControl(element: HTMLElement, initialControlSize: MinimapControlSize, context: MinimapControlContext): RenderedMinimapControl {
  let controlSize = initialControlSize;
  let localPlayer = context.localPlayer;
  let loadedRoute: LoadedMinimapRoute | null = null;
  let loadFailure: string | null = null;
  let stateGap: string | null = null;
  let pieceGaps: readonly string[] = [];
  let disposed = false;
  const textureImages = new Map<string, TextureImageState>();
  const pieceElements = new Map<number, HTMLElement>();
  const stateGapElement = minimapPartElement("state");
  placeNativeWindowElement(stateGapElement, 0, 0, controlSize.width, controlSize.height);
  const zoneNameElement = minimapPartElement("zone-name");
  zoneNameElement.setAttribute("data-native-gap", zoneNameTextGapReason);
  const markerElement = minimapPartElement("marker");
  markerElement.setAttribute("data-native-gap", markerTextureGapReason);
  element.style.overflow = clippedOverflow;
  element.append(zoneNameElement);

  const textureImage = (texture: NativeTextureArchivePin): TextureImageState => {
    const known = textureImages.get(texture.archiveSha256);
    if (known !== undefined) return known;
    textureImages.set(texture.archiveSha256, { status: "loading" });
    void context.minimapSource.loadTextureImage(texture).then(
      resolution => resolution,
      (error: unknown): NativeWindowTextureResolution => ({ status: "gap", reason: errorText(error) }),
    ).then(resolution => {
      if (disposed) {
        if (resolution.status === "resolved") URL.revokeObjectURL(resolution.url);
        return;
      }
      textureImages.set(texture.archiveSha256, resolution);
      draw();
    });
    return { status: "loading" };
  };

  const showTexture = (target: HTMLElement, state: TextureImageState, width: number, height: number): void => {
    target.setAttribute("data-native-texture-state", state.status);
    if (state.status === "gap") target.setAttribute("data-native-gap", state.reason);
    else target.removeAttribute("data-native-gap");
    if (state.status !== "resolved") return;
    const existing = target.querySelector("img");
    if (existing?.getAttribute("src") === state.url) return placeNativeWindowElement(existing, 0, 0, width, height);
    existing?.remove();
    const imageElement = document.createElement("img");
    imageElement.setAttribute("alt", "");
    imageElement.setAttribute("src", state.url);
    placeNativeWindowElement(imageElement, 0, 0, width, height);
    target.append(imageElement);
  };

  const removePieces = (): void => {
    for (const pieceElement of pieceElements.values()) pieceElement.remove();
    pieceElements.clear();
    pieceGaps = [];
  };

  const showStateGap = (reason: string): void => {
    stateGap = reason;
    removePieces();
    markerElement.remove();
    stateGapElement.setAttribute("data-native-gap", reason);
    if (stateGapElement.parentNode !== element) element.append(stateGapElement);
    context.onGapsChanged();
  };

  const drawPiece = (piece: WorldMapPiecePlacement): void => {
    let pieceElement = pieceElements.get(piece.suffix);
    if (pieceElement === undefined) {
      pieceElement = document.createElement("div");
      pieceElement.setAttribute("data-native-world-map-piece", String(piece.suffix));
      pieceElements.set(piece.suffix, pieceElement);
      element.insertBefore(pieceElement, zoneNameElement);
    }
    placeNativeWindowElement(pieceElement, piece.left, piece.top, piece.width, piece.height);
    const state: TextureImageState = piece.texture === null ? { status: "gap", reason: piece.gap! } : textureImage(piece.texture);
    showTexture(pieceElement, state, piece.width, piece.height);
  };

  const draw = (): void => {
    if (disposed) return;
    if (loadFailure !== null) return showStateGap(minimapLoadFailedReason);
    if (loadedRoute === null) return;
    if (loadedRoute.route === null) return showStateGap(minimapRouteNotInCatalogReason);
    const playerSourcePosition = localPlayer === null ? null : worldPositionToSource(localPlayer.position);
    const plan = planWorldMapView({ controlWidth: controlSize.width, controlHeight: controlSize.height, worldMap: loadedRoute.route.worldMap,
      playerSourcePosition });
    element.setAttribute("data-native-minimap-view-origin", plan.labels.viewOrigin);
    element.setAttribute("data-native-minimap-scale", plan.labels.scale);
    if (plan.gap !== null) return showStateGap(plan.gap);
    stateGap = null;
    stateGapElement.remove();
    plan.pieces.forEach(drawPiece);
    pieceGaps = plan.pieces.flatMap(piece => piece.gap === null ? [] : [piece.gap]);
    const marker = plan.marker!;
    placeNativeWindowElement(markerElement, marker.left, marker.top, 0, 0);
    markerElement.setAttribute("data-native-map-x", String(marker.mapX));
    markerElement.setAttribute("data-native-map-y", String(marker.mapY));
    if (markerElement.parentNode !== element) element.append(markerElement);
    context.onGapsChanged();
  };

  element.setAttribute("data-native-minimap-state", "loading");
  void loadMinimapRoute(context.minimapSource).then(
    loaded => { loadedRoute = loaded; },
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
    get gaps() {
      const routeGaps = loadedRoute?.route?.gaps.map(gap => gap.reason) ?? [];
      return [...new Set([...(stateGap === null ? [] : [stateGap]), ...routeGaps, ...pieceGaps, markerTextureGapReason, worldMapViewOriginPresentationReason,
        zoneNameTextGapReason])];
    },
    refresh: nextLocalPlayer => {
      localPlayer = nextLocalPlayer;
      draw();
    },
    resize: nextControlSize => {
      controlSize = nextControlSize;
      placeNativeWindowElement(stateGapElement, 0, 0, controlSize.width, controlSize.height);
      draw();
    },
    dispose: () => {
      disposed = true;
      for (const image of textureImages.values()) if (image.status === "resolved") URL.revokeObjectURL(image.url);
      textureImages.clear();
    },
  };
}
