import type { Scene } from "@babylonjs/core/scene";
import { attachNativeTileSystems, type AttachedNativeTileSystems, type NativeTileChunkSystemContents } from "./attachNativeTileSystems";
import type { LoadedTileResidencyChunk } from "./loadResidencyChunk";
import type { ResidencyChunkEventListener } from "./nativeTileChunkResidency";
import type { NativeTileManifest } from "./nativeTileManifest";

export interface StreamedTileSystemsOptions {
  readonly scene: Scene;
  readonly selectedTileId: string;
  readonly signal: AbortSignal;
  manifestOf(tileId: string): NativeTileManifest;
  isDisposed(): boolean;
}

export interface StreamedTileChunkFailure {
  readonly chunkId: string;
  readonly reason: string;
}

export interface StreamedTileSystemsInspection {
  readonly boundChunkIds: readonly string[];
  readonly chunkFailures: readonly StreamedTileChunkFailure[];
}

export interface StreamedTileSystems extends ResidencyChunkEventListener<LoadedTileResidencyChunk> {
  attachSelectedTile(): Promise<AttachedNativeTileSystems>;
  inspection(tileId: string): StreamedTileSystemsInspection | null;
  dispose(): void;
}

interface TileSystemsRecord {
  readonly residentChunks: Map<string, LoadedTileResidencyChunk>;
  readonly chunkFailures: Map<string, string>;
  systems: AttachedNativeTileSystems | null;
}

const disposedDuringLoading = () => new Error("Native tile was disposed during loading.");
const failureText = (error: unknown) => error instanceof Error ? error.message : String(error);

function chunkSystemContents(chunkId: string, loaded: LoadedTileResidencyChunk): NativeTileChunkSystemContents {
  return { chunkId, bspChunk: loaded.bspChunk, instances: loaded.instances, terrainMeshes: loaded.terrainMeshes };
}

export function createStreamedTileSystems(options: StreamedTileSystemsOptions): StreamedTileSystems {
  const { scene, selectedTileId, signal } = options;
  const selected: TileSystemsRecord = { residentChunks: new Map(), chunkFailures: new Map(), systems: null };
  let disposed = false;
  const isDisposed = () => disposed || options.isDisposed();
  const stillResident = (record: TileSystemsRecord, chunkId: string, loaded: LoadedTileResidencyChunk) => !isDisposed() && record.residentChunks.get(chunkId) === loaded;
  const bindChunk = (record: TileSystemsRecord, systems: AttachedNativeTileSystems, chunkId: string, loaded: LoadedTileResidencyChunk) =>
    systems.addChunk(chunkSystemContents(chunkId, loaded)).catch((error: unknown) => {
      if (stillResident(record, chunkId, loaded)) record.chunkFailures.set(chunkId, failureText(error));
    });
  return {
    async attachSelectedTile() {
      const startupChunks = [...selected.residentChunks].map(([chunkId, loaded]) => chunkSystemContents(chunkId, loaded));
      const systems = await attachNativeTileSystems(scene, options.manifestOf(selectedTileId), startupChunks, signal, isDisposed);
      if (isDisposed()) { systems.dispose(); throw disposedDuringLoading(); }
      selected.systems = systems;
      for (const chunkId of systems.boundChunkIds()) if (!selected.residentChunks.has(chunkId)) systems.removeChunk(chunkId);
      const boundChunkIds = new Set(systems.boundChunkIds());
      for (const [chunkId, loaded] of [...selected.residentChunks]) {
        if (boundChunkIds.has(chunkId)) continue;
        try { await systems.addChunk(chunkSystemContents(chunkId, loaded)); }
        catch (error) { if (stillResident(selected, chunkId, loaded)) throw error; }
      }
      return systems;
    },
    chunkLoaded({ chunk, loaded }) {
      if (isDisposed() || chunk.tileId !== selectedTileId) return;
      selected.residentChunks.set(chunk.chunkId, loaded);
      if (selected.systems !== null) void bindChunk(selected, selected.systems, chunk.chunkId, loaded);
    },
    chunkDisposed({ chunk, loaded }) {
      if (chunk.tileId !== selectedTileId || selected.residentChunks.get(chunk.chunkId) !== loaded) return;
      selected.residentChunks.delete(chunk.chunkId);
      selected.chunkFailures.delete(chunk.chunkId);
      selected.systems?.removeChunk(chunk.chunkId);
    },
    inspection(tileId) {
      if (tileId !== selectedTileId || selected.systems === null) return null;
      return { boundChunkIds: selected.systems.boundChunkIds(),
        chunkFailures: [...selected.chunkFailures].map(([chunkId, reason]) => ({ chunkId, reason })).sort((left, right) => left.chunkId < right.chunkId ? -1 : 1) };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      selected.systems?.dispose();
      selected.residentChunks.clear();
    },
  };
}
