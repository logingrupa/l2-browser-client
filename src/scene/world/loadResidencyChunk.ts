import { AssetContainer } from "@babylonjs/core/assetContainer";
import { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import type { NativeTileBspChunk } from "./loadNativeTileChunks";
import { loadChunkCollisionCell } from "./movement/loadCollisionCells";
import { loadChunkBsp, loadChunkTerrain, loadTileModelTemplate, type LoadedChunkTerrain } from "./nativeTileChunkContents";
import { collisionCellTerrainFootprint, sameCollisionFootprint } from "./nativeTileChunkFootprints";
import { instantiateNativeModelPlacements, type NativeModelInstance } from "./nativeModelPlacements";
import type { LoadedResidencyChunk, ResidencyChunk, ResidencyChunkContainer } from "./nativeTileChunkResidency";
import type { NativeTileChunkManifest, NativeTileChunkModel, NativeTileChunkPlacement } from "./nativeTileChunkManifest";
import type { ResidencyTile } from "./nativeTileResidencyTiles";

export interface LoadedTileResidencyChunk extends LoadedResidencyChunk {
  readonly chunkManifest: NativeTileChunkManifest;
  readonly terrain: LoadedChunkTerrain | null;
  readonly bspChunk: NativeTileBspChunk | null;
  readonly instances: readonly NativeModelInstance<NativeTileChunkPlacement>[];
}

export interface TileModelTemplates {
  template(model: NativeTileChunkModel): Promise<AssetContainer>;
  readonly loadedCount: number;
  dispose(): void;
}

const chunkCollisionAbsentReason = "chunk-collision-resource-absent";

export function createTileModelTemplates(scene: Scene, lifetimeSignal: AbortSignal): TileModelTemplates {
  const templates = new Map<string, { readonly archiveSha256: string; readonly load: Promise<AssetContainer> }>();
  let disposed = false;
  return {
    template(model) {
      const listed = templates.get(model.id);
      if (listed !== undefined) {
        if (listed.archiveSha256 !== model.archiveSha256) return Promise.reject(new Error(`Native tile lists model ${model.id} with two archives.`));
        return listed.load;
      }
      const load = loadTileModelTemplate(scene, model, lifetimeSignal).then(template => {
        if (disposed) template.dispose();
        return template;
      });
      load.catch(() => { if (templates.get(model.id)?.load === load) templates.delete(model.id); });
      templates.set(model.id, { archiveSha256: model.archiveSha256, load });
      return load;
    },
    get loadedCount() { return templates.size; },
    dispose() {
      disposed = true;
      for (const { load } of templates.values()) load.then(template => template.dispose(), () => undefined);
      templates.clear();
    },
  };
}

function instancesContainer(scene: Scene, instances: readonly NativeModelInstance[]): AssetContainer {
  const container = new AssetContainer(scene);
  for (const instance of instances) {
    container.transformNodes.push(instance.root);
    for (const node of instance.root.getDescendants(false)) {
      if (node instanceof AbstractMesh) container.meshes.push(node);
      else if (node instanceof TransformNode) container.transformNodes.push(node);
    }
    container.skeletons.push(...instance.copy.skeletons);
    container.animationGroups.push(...instance.copy.animationGroups);
  }
  container.removeAllFromScene();
  return container;
}

function chunkContainer(parts: readonly AssetContainer[]): ResidencyChunkContainer {
  return {
    addAllToScene() { for (const part of parts) part.addAllToScene(); },
    removeAllFromScene() { for (const part of parts) part.removeAllFromScene(); },
    dispose() { for (const part of parts) part.dispose(); },
  };
}

const drawnMeshes = (meshes: readonly AbstractMesh[]) => meshes.filter((mesh): mesh is Mesh => mesh instanceof Mesh && mesh.getTotalVertices() > 0);

export async function loadResidencyChunk(scene: Scene, tile: ResidencyTile, templates: TileModelTemplates, chunk: ResidencyChunk,
  signal: AbortSignal): Promise<LoadedTileResidencyChunk> {
  const chunkManifest = tile.chunkManifestsById.get(chunk.chunkId);
  if (chunkManifest === undefined) throw new Error(`Native tile ${tile.tileId} lists no chunk ${chunk.chunkId}.`);
  if (chunkManifest.collision === null) {
    throw new Error(chunkManifest.gaps.find(row => row.step === "collision")?.reason ?? chunkCollisionAbsentReason);
  }
  const parts: AssetContainer[] = [];
  try {
    const [cell, tileBspTree] = await Promise.all([loadChunkCollisionCell(chunkManifest, signal), tile.tileBspTree()]);
    signal.throwIfAborted();
    const decodedFootprint = collisionCellTerrainFootprint(cell);
    if (decodedFootprint !== null && !sameCollisionFootprint(decodedFootprint, tile.expectedSourceFootprints.get(chunk.chunkId)!)) {
      throw new Error(`Native tile chunk ${chunk.cellId} collision terrain differs from its sector range footprint.`);
    }
    const terrain = chunkManifest.terrain === null ? null : await loadChunkTerrain(scene, chunkManifest, chunkManifest.terrain, signal);
    if (terrain !== null) parts.push(terrain.container);
    const bsp = chunkManifest.bsp === null ? null : await loadChunkBsp(scene, tile.tileId, chunk.chunkId, chunkManifest.bsp, signal);
    if (bsp !== null) parts.push(bsp.container);
    const chunkTemplates = new Map<string, AssetContainer>();
    for (const model of chunkManifest.models) chunkTemplates.set(model.id, await templates.template(model));
    signal.throwIfAborted();
    const instances = instantiateNativeModelPlacements(scene, chunkTemplates, chunkManifest.models.flatMap(model => model.placements));
    parts.push(instancesContainer(scene, instances));
    const instanceMeshes = instances.flatMap(instance => instance.root.getChildMeshes());
    return {
      container: chunkContainer(parts), terrainMeshes: terrain?.meshes ?? [], visualMeshes: [...drawnMeshes(bsp?.chunk.meshes ?? []), ...drawnMeshes(instanceMeshes)],
      collisionCell: cell, collisionBspTree: tileBspTree, chunkManifest, terrain, bspChunk: bsp?.chunk ?? null, instances,
    };
  } catch (error) {
    for (const part of parts) part.dispose();
    throw error;
  }
}
