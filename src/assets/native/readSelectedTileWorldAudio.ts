import { readNativeTileManifest } from "../../scene/world/nativeTileManifest";
import { selectedNativeTileIdentity } from "../../scene/world/selectedNativeTile";

export const tileWorldAudioRecordKind = "world-audio";

export interface TileWorldAudioRecord {
  readonly id: string;
  readonly kind: typeof tileWorldAudioRecordKind;
  readonly manifest: string;
  readonly manifestSha256: string;
  readonly manifestBytes: number;
}

export interface SelectedTileWorldAudioRecords {
  readonly tileId: string;
  readonly records: readonly TileWorldAudioRecord[];
}

export async function readSelectedTileWorldAudioRecords(location: Pick<Location, "search"> | undefined, signal: AbortSignal):
  Promise<SelectedTileWorldAudioRecords | null> {
  const tileId = selectedNativeTileIdentity(location);
  if (tileId === null) return null;
  const pinnedManifest = await readNativeTileManifest(tileId, signal);
  const resources = pinnedManifest?.manifest.resources.filter(resource => resource.kind === tileWorldAudioRecordKind) ?? [];
  return { tileId, records: resources.map(resource => ({ id: `tile:${tileId}:${resource.manifestSha256}`, kind: tileWorldAudioRecordKind,
    manifest: resource.manifest, manifestSha256: resource.manifestSha256, manifestBytes: resource.manifestBytes })) };
}
