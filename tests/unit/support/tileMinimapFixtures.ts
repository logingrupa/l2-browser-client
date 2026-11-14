import { parseNativeTileMinimapManifest, type NativeTileMinimap } from "../../../src/scene/world/minimapJoin";
import { parseNativeMinimapRoute, type NativeMinimapRoute } from "../../../src/ui/nativeWindows/nativeMinimapRoute";
import { parseNativeWindowManifest, type NativeWindowManifest } from "../../../src/ui/nativeWindows/nativeWindowLayoutTree";
import type { NativeWindowMinimapSource, NativeWindowTextureResolution } from "../../../src/ui/nativeWindows/nativeWindowManifestLoader";
import type { ZoneKeyMipLoad } from "../../../src/ui/nativeWindows/radarZoneName";
import type { WorldEntity } from "../../../src/world/worldTypes";
import { syntheticArchiveSha256, syntheticMinimapRouteManifest, type SyntheticMinimapRouteOptions } from "../../fixtures/minimapRouteManifestFixture";
import { syntheticTileMinimapManifest } from "../../fixtures/tileMinimapManifestFixture";

export interface SyntheticTileMinimapOptions {
  readonly zoneKeyTexture?: boolean;
  readonly gaps?: readonly { readonly reason: string; readonly evidence: string }[];
  readonly routeManifestSha256?: string;
}

const zoneNamePackageSha256 = "c".repeat(64);

export function syntheticZoneKeyObject(tileId: string): string {
  return `l2zonename.${tileId}`;
}

export function syntheticTileMinimap(tileId: string, options: SyntheticTileMinimapOptions = {}): NativeTileMinimap {
  const manifest = syntheticTileMinimapManifest(tileId, null);
  const zoneKeyArchiveSha256 = syntheticArchiveSha256(syntheticZoneKeyObject(tileId));
  const routeManifestSha256 = options.routeManifestSha256 ?? "f".repeat(64);
  return parseNativeTileMinimapManifest({
    ...manifest,
    route: { manifest: `/l2/maps/${routeManifestSha256}/native-minimap-route/manifest.json`, manifestSha256: routeManifestSha256, manifestBytes: 4096 },
    zoneKeyTexture: options.zoneKeyTexture === false ? null : { archive: `/l2/${zoneKeyArchiveSha256}/asset.l2asset`, archiveSha256: zoneKeyArchiveSha256,
      archiveBytes: 2048, sourceObject: syntheticZoneKeyObject(tileId), rule: "zone-sampler-tile",
      source: { path: "systextures/l2zonename.utx", sha256: zoneNamePackageSha256, exportIndex: 93 } },
    gaps: options.gaps ?? [{ reason: "minimap-join-unresolved:zone-title-source", evidence: "synthetic zone title gap" }],
  }, tileId);
}

export function syntheticLocalPlayerAtSource(sourceX: number, sourceY: number, sourceZ = 0): WorldEntity {
  return { id: "local-player", kind: "local-player", displayName: "Synthetic player", position: { x: sourceX / 100, y: sourceZ / 100, z: sourceY / 100 },
    orientationRadians: 0, health: 100, maximumHealth: 100, animation: "idle" };
}

export function syntheticTextureImageUrl(archiveSha256: string): string {
  return `blob:synthetic/${archiveSha256}`;
}

export interface SyntheticMinimapSourceInput {
  readonly tileMinimaps: ReadonlyMap<string, NativeTileMinimap | null>;
  readonly route?: SyntheticMinimapRouteOptions;
  readonly zoneKeyMips?: ReadonlyMap<string, ZoneKeyMipLoad>;
}

export function syntheticRoute(options: SyntheticMinimapRouteOptions = {}): NativeMinimapRoute {
  return parseNativeMinimapRoute(syntheticMinimapRouteManifest(options));
}

export function syntheticMinimapSource(input: SyntheticMinimapSourceInput): NativeWindowMinimapSource {
  const route = syntheticRoute(input.route);
  return {
    tileIds: [...input.tileMinimaps.keys()],
    loadTileMinimap: async tileId => input.tileMinimaps.get(tileId) ?? null,
    loadMinimapRoute: async () => route,
    loadTextureImage: async (texture): Promise<NativeWindowTextureResolution> => ({ status: "resolved", url: syntheticTextureImageUrl(texture.archiveSha256) }),
    loadZoneKeyMip: async zoneKeyTexture => input.zoneKeyMips?.get(zoneKeyTexture.sourceObject) ?? { status: "gap", reason: "minimap-join-unresolved:zone-key-bytes" },
  };
}

export const emptyMinimapSource: NativeWindowMinimapSource = syntheticMinimapSource({ tileMinimaps: new Map() });

const syntheticTail = { offset: 10, end: 20, sha256: "d".repeat(64) };
const topLeftAnchor = { selfAnchor: 1, targetAnchor: 1, target: "", offsetX: 0, offsetY: 0 };

function syntheticNode(name: string, type: string, width: number, height: number, children: readonly unknown[] = []) {
  return { name, type, width, height, x: 0, y: 0, sizeMode: "absolute", position: topLeftAnchor, textures: [], children, sourceOffset: 10, tail: syntheticTail };
}

export function syntheticMinimapWindowManifest(controlWidth: number, controlHeight: number, windowId = "SyntheticMinimapWnd",
  extraControlNames: readonly string[] = []): NativeWindowManifest {
  const children = [syntheticNode("SyntheticMinimap", "MinimapCtrl", controlWidth, controlHeight),
    ...extraControlNames.map(name => syntheticNode(name, "Texture", controlWidth, controlHeight))];
  return parseNativeWindowManifest({
    kind: "native-window-layout", schemaVersion: 1, windowId, name: windowId, sourceSha256: "e".repeat(64),
    sourceOffset: 0, textureRefs: [], anchorProof: "Elbera NWindow af6c3437 proof, unverified on IMPORTA 7c12fb6b",
    root: { ...syntheticNode(windowId, "Window", controlWidth, controlHeight, children), sourceOffset: 0 },
  });
}
