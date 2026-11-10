import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { AttachedNativeTileSystems } from "./attachNativeTileSystems";
import { inspectNativeWorldScene, terrainInfoChunkPlanWindow, type NativeWorldSceneInspection } from "./loadNativeSection";
import type { NativeTileBspChunk, NativeTileSpawnAnchor } from "./loadNativeTileChunks";
import { chunkMeshGapCount, describeTerrainChunks, tileMeshCounts } from "./nativeTileChunkContents";
import type { NativeModelInstance } from "./nativeModelPlacements";
import type { NativeTileChunkManifest, NativeTileChunkPlacement } from "./nativeTileChunkManifest";

export interface NativeTileSectionInspectionInput {
  readonly tileId: string;
  readonly chunks: readonly NativeTileChunkManifest[];
  readonly terrainMeshes: readonly AbstractMesh[];
  readonly instances: readonly NativeModelInstance<NativeTileChunkPlacement>[];
  readonly bspChunks: readonly NativeTileBspChunk[];
  readonly modelCount: number;
  readonly disposed: boolean;
  readonly anchor: NativeTileSpawnAnchor;
  readonly systems: AttachedNativeTileSystems;
  readonly loadedChunkCount: number;
  readonly countedMeshes: readonly AbstractMesh[];
}

export function inspectNativeTileSection(input: NativeTileSectionInspectionInput): NativeWorldSceneInspection {
  const { systems, bspChunks, instances } = input;
  const visibilityBinding = systems.visibility.binding;
  const moverTargets = systems.movers?.targets ?? [];
  return {
    ...inspectNativeWorldScene({ terrainMeshes: input.terrainMeshes, instances, modelCount: input.modelCount, disposed: input.disposed, preview: null,
      previewEnabled: false, materialFailure: null, unsupportedRuntimeMaterials: [], bspMeshes: bspChunks.flatMap(chunk => chunk.meshes), sectionWindow: terrainInfoChunkPlanWindow }),
    tileId: input.tileId, chunkCount: input.chunks.length, loadedChunkCount: input.loadedChunkCount, ...tileMeshCounts(input.countedMeshes),
    terrainChunks: describeTerrainChunks(input.chunks), tileAnchor: input.anchor, meshGapCount: chunkMeshGapCount(input.chunks),
    bspSections: bspChunks.reduce((sum, chunk) => sum + chunk.sections.length, 0), bspResources: bspChunks.map(chunk => chunk.resource),
    moverCount: moverTargets.length,
    moverCollisionMeshCount: moverTargets.flatMap(target => target.meshes).filter(mesh => mesh.metadata?.worldCollision === true).length,
    movers: moverTargets.map(target => target.inspection()), bspVisibility: systems.visibility.inspection(), lighting: systems.lighting.inspection(),
    mapEmitterPlacements: { gap: systems.mapEmitterPlacements.gap,
      placements: systems.mapEmitterPlacements.inspection(exportIndex => visibilityBinding?.memberVisible(exportIndex) ?? true) },
  };
}
