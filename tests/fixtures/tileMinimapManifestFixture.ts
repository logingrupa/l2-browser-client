export const syntheticTileTextureSize = 256;
export const syntheticTileFrameNativeSize = 25600;
const syntheticGridOriginTileCoordinate = 20;
const sourceSha256 = "c".repeat(64);
const radarGapReason = "minimap-join-unresolved:radar-texture";

export interface SyntheticRadarArchive { readonly archiveSha256: string; readonly archiveBytes: number }

export function syntheticTileFrameMinimumNative(tileId: string): readonly [number, number] {
  const [column, row] = tileId.split("_").map(Number);
  return [(column! - syntheticGridOriginTileCoordinate) * syntheticTileFrameNativeSize, (row! - syntheticGridOriginTileCoordinate) * syntheticTileFrameNativeSize];
}

export function syntheticTileFrameCentreScene(tileId: string): { readonly x: number; readonly y: number; readonly z: number } {
  const [minimumX, minimumY] = syntheticTileFrameMinimumNative(tileId);
  const sceneUnitsPerNativeUnit = 0.01;
  return { x: (minimumX + syntheticTileFrameNativeSize / 2) * sceneUnitsPerNativeUnit, y: 0, z: (minimumY + syntheticTileFrameNativeSize / 2) * sceneUnitsPerNativeUnit };
}

export function syntheticTileMinimapManifest(tileId: string, radarArchive: SyntheticRadarArchive | null): Record<string, unknown> {
  const [minimumX, minimumY] = syntheticTileFrameMinimumNative(tileId);
  return {
    kind: "native-tile-minimap", schemaVersion: 1, tileId,
    sourceInputs: [{ path: "systextures/L2_RadarMap.utx", sha256: sourceSha256 }],
    radarTexture: radarArchive === null ? null : { archive: `/l2/${radarArchive.archiveSha256}/asset.l2asset`, archiveSha256: radarArchive.archiveSha256,
      archiveBytes: radarArchive.archiveBytes, sourceObject: `Radar.Maps.${tileId}`, rule: "tile-id" },
    townMapTextures: [], zoneNameTextures: [], zones: [], huntingZones: [],
    projection: radarArchive === null ? null : { rule: "tile-frame-extent", status: "unverified", frameMinimumNative: [minimumX, minimumY],
      frameMaximumNative: [minimumX + syntheticTileFrameNativeSize, minimumY + syntheticTileFrameNativeSize],
      textureWidth: syntheticTileTextureSize, textureHeight: syntheticTileTextureSize },
    gaps: radarArchive === null ? [{ reason: radarGapReason, evidence: "synthetic radar gap" }] : [],
    labels: { schemaFieldMeaning: "synthetic fixture, not client data" },
  };
}
