import { parseNativeTileMinimapManifest, type NativeTileMinimap } from "../../../src/scene/world/minimapJoin";
import { parseNativeWindowManifest, type NativeWindowManifest } from "../../../src/ui/nativeWindows/nativeWindowLayoutTree";
import type { NativeWindowMinimapTileSource, NativeWindowTextureResolution } from "../../../src/ui/nativeWindows/nativeWindowManifestLoader";
import type { WorldEntity } from "../../../src/world/worldTypes";
import { syntheticTileMinimapManifest } from "../../fixtures/tileMinimapManifestFixture";

export { syntheticTileTextureSize } from "../../fixtures/tileMinimapManifestFixture";

export function syntheticRadarArchiveSha256(tileId: string): string {
  return tileId.replace("_", "").padStart(64, "a");
}

export function syntheticTileMinimap(tileId: string, options: { readonly radar: boolean } = { radar: true }): NativeTileMinimap {
  const radarArchive = options.radar ? { archiveSha256: syntheticRadarArchiveSha256(tileId), archiveBytes: 4096 } : null;
  return parseNativeTileMinimapManifest(syntheticTileMinimapManifest(tileId, radarArchive), tileId);
}

export function syntheticLocalPlayerAt(sceneX: number, sceneZ: number): WorldEntity {
  return { id: "local-player", kind: "local-player", displayName: "Synthetic player", position: { x: sceneX, y: 0, z: sceneZ },
    orientationRadians: 0, health: 100, maximumHealth: 100, animation: "idle" };
}

export function syntheticRadarImageUrl(tileId: string): string {
  return `blob:synthetic/radar-${tileId}`;
}

export function syntheticMinimapTileSource(minimaps: ReadonlyMap<string, NativeTileMinimap | null>): NativeWindowMinimapTileSource {
  return {
    tileIds: [...minimaps.keys()],
    loadTileMinimap: async tileId => minimaps.get(tileId) ?? null,
    loadRadarImage: async (radarTexture): Promise<NativeWindowTextureResolution> =>
      ({ status: "resolved", url: syntheticRadarImageUrl(radarTexture.sourceObject.split(".").at(-1)!) }),
  };
}

export const emptyMinimapTileSource: NativeWindowMinimapTileSource = syntheticMinimapTileSource(new Map());

const syntheticTail = { offset: 10, end: 20, sha256: "d".repeat(64) };
const topLeftAnchor = { selfAnchor: 1, targetAnchor: 1, target: "", offsetX: 0, offsetY: 0 };

export function syntheticMinimapWindowManifest(controlWidth: number, controlHeight: number): NativeWindowManifest {
  const minimapNode = { name: "SyntheticMinimap", type: "MinimapCtrl", width: controlWidth, height: controlHeight, x: 0, y: 0, sizeMode: "absolute",
    position: topLeftAnchor, textures: [], children: [], sourceOffset: 10, tail: syntheticTail };
  return parseNativeWindowManifest({
    kind: "native-window-layout", schemaVersion: 1, windowId: "SyntheticMinimapWnd", name: "SyntheticMinimapWnd", sourceSha256: "e".repeat(64),
    sourceOffset: 0, textureRefs: [], anchorProof: "Elbera NWindow af6c3437 proof, unverified on IMPORTA 7c12fb6b",
    root: { name: "SyntheticMinimapWnd", type: "Window", width: controlWidth, height: controlHeight, x: 0, y: 0, sizeMode: "absolute",
      position: topLeftAnchor, textures: [], children: [minimapNode], sourceOffset: 0, tail: syntheticTail },
  });
}
