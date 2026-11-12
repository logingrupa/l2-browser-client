import type { Scene } from "@babylonjs/core/scene";
import { attachNativeTileSystems, type AttachedNativeTileSystems, type NativeTileChunkSystemContents } from "./attachNativeTileSystems";
import type { UnmappedVisibilityChunk } from "./bspVisibility/attachTileVisibility";
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

export interface StreamedTileVisibilitySummary {
  readonly gap: string | null;
  readonly culling: boolean;
  readonly targetChunkIds: readonly string[];
  readonly unmappedChunks: readonly UnmappedVisibilityChunk[];
}

export interface StreamedTileLightingSummary {
  readonly gap: string | null;
  readonly sectionCount: number;
  readonly lightmappedSectionCount: number;
  readonly lightmappedChunkIds: readonly string[];
}

export interface StreamedTileSystemsInspection {
  readonly attached: boolean;
  readonly gap: string | null;
  readonly residentChunkIds: readonly string[];
  readonly boundChunkIds: readonly string[];
  readonly chunkFailures: readonly StreamedTileChunkFailure[];
  readonly visibility: StreamedTileVisibilitySummary | null;
  readonly lighting: StreamedTileLightingSummary | null;
  readonly mapEmitterGap: string | null;
  readonly moverCount: number;
  readonly moverGap: string | null;
}

export interface StreamedTileSystems extends ResidencyChunkEventListener<LoadedTileResidencyChunk> {
  attachSelectedTile(): Promise<AttachedNativeTileSystems>;
  setCulling(enabled: boolean): void;
  inspection(tileId: string): StreamedTileSystemsInspection | null;
  dispose(): void;
}

interface TileSystemsRecord {
  readonly tileId: string;
  readonly residentChunks: Map<string, LoadedTileResidencyChunk>;
  readonly chunkFailures: Map<string, string>;
  systems: AttachedNativeTileSystems | null;
  gap: string | null;
  released: boolean;
}

const disposedDuringLoading = () => new Error("Native tile was disposed during loading.");
const failureText = (error: unknown) => error instanceof Error ? error.message : String(error);
const compareText = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;

function chunkSystemContents(chunkId: string, loaded: LoadedTileResidencyChunk): NativeTileChunkSystemContents {
  return { chunkId, bspChunk: loaded.bspChunk, instances: loaded.instances, terrainMeshes: loaded.terrainMeshes };
}

function visibilitySummary(systems: AttachedNativeTileSystems): StreamedTileVisibilitySummary {
  const inspection = systems.visibility.inspection();
  if (inspection.gap !== null) return { gap: inspection.gap, culling: false, targetChunkIds: [], unmappedChunks: [] };
  return { gap: null, culling: inspection.culling, targetChunkIds: inspection.targetChunkIds, unmappedChunks: inspection.unmappedChunks };
}

function lightingSummary(systems: AttachedNativeTileSystems): StreamedTileLightingSummary {
  const inspection = systems.lighting.inspection();
  if (inspection.gap !== null) return { gap: inspection.gap, sectionCount: 0, lightmappedSectionCount: 0, lightmappedChunkIds: [] };
  const lightmapped = inspection.sections.filter(section => section.lighting === "lightmapped");
  return { gap: null, sectionCount: inspection.sectionCount, lightmappedSectionCount: lightmapped.length,
    lightmappedChunkIds: [...new Set(lightmapped.map(section => section.chunkId))].sort(compareText) };
}

export function createStreamedTileSystems(options: StreamedTileSystemsOptions): StreamedTileSystems {
  const { scene, selectedTileId, signal } = options;
  const records = new Map<string, TileSystemsRecord>();
  let disposed = false, cullingEnabled = false;
  const isDisposed = () => disposed || options.isDisposed();
  const stillResident = (record: TileSystemsRecord, chunkId: string, loaded: LoadedTileResidencyChunk) =>
    !isDisposed() && !record.released && record.residentChunks.get(chunkId) === loaded;
  const newRecord = (tileId: string): TileSystemsRecord => {
    const record: TileSystemsRecord = { tileId, residentChunks: new Map(), chunkFailures: new Map(), systems: null, gap: null, released: false };
    records.set(tileId, record);
    return record;
  };
  const selected = newRecord(selectedTileId);
  const bindChunk = (record: TileSystemsRecord, systems: AttachedNativeTileSystems, chunkId: string, loaded: LoadedTileResidencyChunk) =>
    systems.addChunk(chunkSystemContents(chunkId, loaded)).catch((error: unknown) => {
      if (stillResident(record, chunkId, loaded)) record.chunkFailures.set(chunkId, failureText(error));
    });
  const adoptSystems = (record: TileSystemsRecord, systems: AttachedNativeTileSystems) => {
    record.systems = systems;
    systems.visibility.binding?.setCulling(cullingEnabled);
    for (const chunkId of systems.boundChunkIds()) if (!record.residentChunks.has(chunkId)) systems.removeChunk(chunkId);
    const boundChunkIds = new Set(systems.boundChunkIds());
    return [...record.residentChunks].filter(([chunkId]) => !boundChunkIds.has(chunkId));
  };
  const attachStreamedTile = (record: TileSystemsRecord) => {
    attachNativeTileSystems(scene, options.manifestOf(record.tileId), [], signal, () => isDisposed() || record.released).then(systems => {
      if (isDisposed() || record.released) { systems.dispose(); return; }
      for (const [chunkId, loaded] of adoptSystems(record, systems)) void bindChunk(record, systems, chunkId, loaded);
    }, (error: unknown) => {
      if (!isDisposed() && !record.released) record.gap = failureText(error);
    });
  };
  const release = (record: TileSystemsRecord) => {
    record.released = true;
    records.delete(record.tileId);
    record.systems?.dispose();
  };
  return {
    async attachSelectedTile() {
      const startupChunks = [...selected.residentChunks].map(([chunkId, loaded]) => chunkSystemContents(chunkId, loaded));
      const systems = await attachNativeTileSystems(scene, options.manifestOf(selectedTileId), startupChunks, signal, isDisposed);
      if (isDisposed()) { systems.dispose(); throw disposedDuringLoading(); }
      for (const [chunkId, loaded] of adoptSystems(selected, systems)) {
        try { await systems.addChunk(chunkSystemContents(chunkId, loaded)); }
        catch (error) { if (stillResident(selected, chunkId, loaded)) throw error; }
      }
      return systems;
    },
    chunkLoaded({ chunk, loaded }) {
      if (isDisposed()) return;
      const existing = records.get(chunk.tileId), record = existing ?? newRecord(chunk.tileId);
      record.residentChunks.set(chunk.chunkId, loaded);
      if (record.systems !== null) void bindChunk(record, record.systems, chunk.chunkId, loaded);
      else if (existing === undefined) attachStreamedTile(record);
    },
    chunkDisposed({ chunk, loaded }) {
      const record = records.get(chunk.tileId);
      if (record === undefined || record.residentChunks.get(chunk.chunkId) !== loaded) return;
      record.residentChunks.delete(chunk.chunkId);
      record.chunkFailures.delete(chunk.chunkId);
      record.systems?.removeChunk(chunk.chunkId);
      if (record !== selected && record.residentChunks.size === 0) release(record);
    },
    setCulling(enabled) {
      cullingEnabled = enabled;
      for (const record of records.values()) record.systems?.visibility.binding?.setCulling(enabled);
    },
    inspection(tileId) {
      const record = records.get(tileId);
      if (record === undefined) return null;
      const { systems } = record;
      return { attached: systems !== null, gap: record.gap, residentChunkIds: [...record.residentChunks.keys()].sort(compareText),
        boundChunkIds: systems?.boundChunkIds() ?? [],
        chunkFailures: [...record.chunkFailures].map(([chunkId, reason]) => ({ chunkId, reason })).sort((left, right) => compareText(left.chunkId, right.chunkId)),
        visibility: systems === null ? null : visibilitySummary(systems), lighting: systems === null ? null : lightingSummary(systems),
        mapEmitterGap: systems?.mapEmitterPlacements.gap ?? null, moverCount: systems?.movers?.targets.length ?? 0, moverGap: systems?.moverGap ?? null };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const record of [...records.values()]) release(record);
    },
  };
}
