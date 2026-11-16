import type { NativeTileMinimap, NativeTileMinimapRoutePin } from "../../scene/world/minimapJoin";
import { worldPositionToSource, type SourcePosition } from "../../world/sourceFrame";
import type { WorldEntity } from "../../world/worldTypes";
import type { NativeMinimapRoute, NativeTextureArchivePin } from "./nativeMinimapRoute";
import type { NativeWindowMinimapSource, NativeWindowTextureResolution } from "./nativeWindowManifestLoader";
import { placeNativeWindowElement } from "./nativeWindowPlacement";
import { showTextureImage, type TextureImageState } from "./nativeTextureImageElement";
import { renderNewRadarTextureMap, type RadarZoneNameState } from "./newRadarTextureMap";
import { sampleRadarZoneName, zoneSamplerTile, type ZoneKeyMipLoad } from "./radarZoneName";
import { planWorldMapView, worldMapViewOriginPresentationReason, type WorldMapPiecePlacement } from "./worldMapView";

export const minimapControlType = "MinimapCtrl";

export interface MinimapControlSize { readonly width: number; readonly height: number }

export interface MinimapControlContext {
  readonly localPlayer: WorldEntity | null;
  readonly minimapSource: NativeWindowMinimapSource;
  readonly radarTextureMap: HTMLElement | null;
  readonly onGapsChanged: () => void;
  readonly onZoneNameChanged: (zoneName: string | null) => void;
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

const minimapLoadFailedReason = "minimap-load-failed";
const minimapRouteNotInCatalogReason = "minimap-route-not-in-catalog";
const markerTextureGapReason = "texture-reference-unresolved";
const tileMinimapNotInCatalogReason = "tile minimap resource not in catalog";
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
  let zoneGaps: readonly string[] = [];
  let disposed = false;
  let shownZoneName: string | null = null;
  const textureImages = new Map<string, TextureImageState>();
  const zoneKeyMips = new Map<string, { readonly status: "loading" } | ZoneKeyMipLoad>();
  const newRadarTextureMap = context.radarTextureMap === null ? null : renderNewRadarTextureMap(context.radarTextureMap);
  const pieceElements = new Map<number, HTMLElement>();
  const stateGapElement = minimapPartElement("state");
  placeNativeWindowElement(stateGapElement, 0, 0, controlSize.width, controlSize.height);
  const zoneNameElement = minimapPartElement("zone-name");
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

  const zoneKeyMip = (tileId: string, minimap: NativeTileMinimap): { readonly status: "loading" } | ZoneKeyMipLoad => {
    const known = zoneKeyMips.get(tileId);
    if (known !== undefined) return known;
    zoneKeyMips.set(tileId, { status: "loading" });
    void context.minimapSource.loadZoneKeyMip(minimap.zoneKeyTexture!).then(
      load => load,
      (error: unknown): ZoneKeyMipLoad => ({ status: "gap", reason: errorText(error) }),
    ).then(load => {
      zoneKeyMips.set(tileId, load);
      draw();
    });
    return { status: "loading" };
  };

  const sampleZoneName = (route: NativeMinimapRoute, tileMinimaps: ReadonlyMap<string, NativeTileMinimap>, sourcePosition: SourcePosition): RadarZoneNameState => {
    const tileId = zoneSamplerTile(route.zoneSampler, sourcePosition).tileId;
    const minimap = tileMinimaps.get(tileId);
    if (minimap === undefined) return { status: "gap", reason: tileMinimapNotInCatalogReason };
    zoneGaps = minimap.gaps.map(gap => gap.reason);
    if (minimap.zoneKeyTexture === null) return sampleRadarZoneName({ route, sourcePosition, zoneKeyMip: null });
    const mip = zoneKeyMip(tileId, minimap);
    if (mip.status !== "loaded") return mip;
    return sampleRadarZoneName({ route, sourcePosition, zoneKeyMip: mip.mip });
  };

  const showZoneName = (zoneName: string | null): void => {
    if (zoneName === null) zoneNameElement.removeAttribute("data-native-zone-name");
    else zoneNameElement.setAttribute("data-native-zone-name", zoneName);
    if (zoneName === shownZoneName) return;
    shownZoneName = zoneName;
    context.onZoneNameChanged(zoneName);
  };

  const drawZoneName = (route: NativeMinimapRoute, tileMinimaps: ReadonlyMap<string, NativeTileMinimap>, sourcePosition: SourcePosition): void => {
    zoneGaps = [];
    const zoneName = sampleZoneName(route, tileMinimaps, sourcePosition);
    if (zoneName.status === "gap") zoneGaps = [...zoneGaps, zoneName.reason];
    showZoneName(zoneName.status === "named" ? zoneName.zoneName : null);
    newRadarTextureMap?.show(zoneName, route.radar, textureImage);
  };

  const removePieces = (): void => {
    for (const pieceElement of pieceElements.values()) pieceElement.remove();
    pieceElements.clear();
    pieceGaps = [];
    zoneGaps = [];
    showZoneName(null);
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
    showTextureImage(pieceElement, state, image => placeNativeWindowElement(image, 0, 0, piece.width, piece.height));
    if (state.status === "gap") pieceElement.setAttribute("data-native-gap", state.reason);
    else pieceElement.removeAttribute("data-native-gap");
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
    drawZoneName(loadedRoute.route, loadedRoute.tileMinimaps, playerSourcePosition!);
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
      return [...new Set([...(stateGap === null ? [] : [stateGap]), ...routeGaps, ...pieceGaps, ...zoneGaps, markerTextureGapReason,
        worldMapViewOriginPresentationReason])];
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
