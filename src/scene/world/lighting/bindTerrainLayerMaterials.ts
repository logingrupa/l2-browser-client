import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Scene } from "@babylonjs/core/scene";
import type { FogState, LoadedNativeMaterial } from "../../../materials/ue2/babylon/material";
import {
  createTerrainLayerMaterial, terrainLayerSamplerCount, type TerrainLayerMaterial, type TerrainLayerMaterialLayer,
} from "../../../materials/ue2/babylon/terrainLayerMaterial";
import {
  alphaMapChannelsAreEqual, singleTextureSampler, terrainLayerAlphaChannelsDifferReason, terrainLayerProgramNotSingleTextureReason,
} from "../../../materials/ue2/model/terrainLayers";
import { readTerrainLayerUvRows, type TerrainLayerListingEntry, type TerrainLayerUvRows, type TerrainMaterialsLoad } from "../terrainLayerMaterials";

export type TerrainLayerMeshStatus = "library-terrain-layers" | "terrain-layer-gap";

export interface TerrainLayerReasons {
  readonly index: number;
  readonly reasons: readonly string[];
}

export interface TerrainLayerInspection {
  readonly gap: string | null;
  readonly lighting: "unlit";
  readonly lightingReasons: readonly string[];
  readonly drawnLayers: readonly number[];
  readonly layerReasons: readonly TerrainLayerReasons[];
  readonly samplerCount: number;
  readonly constantIds: readonly string[];
  readonly meshCount: number;
  readonly statusCounts: Readonly<Record<TerrainLayerMeshStatus, number>>;
}

export interface TerrainLayerSettings {
  readonly scene: Scene;
  readonly load: TerrainMaterialsLoad;
  readonly fog: () => FogState;
  readonly loadProgram: (materialId: string, signal: AbortSignal) => Promise<LoadedNativeMaterial>;
}

export interface TerrainLayerBinding {
  addChunk(chunkId: string, meshes: readonly AbstractMesh[]): Promise<void>;
  removeChunk(chunkId: string): void;
  inspection(): TerrainLayerInspection;
  dispose(): void;
}

interface DrawnTerrainLayer {
  readonly entry: TerrainLayerListingEntry;
  readonly texture: LoadedNativeMaterial;
  readonly alphaMap: LoadedNativeMaterial;
}

interface TileTerrainLayers {
  readonly gap: string | null;
  readonly drawn: readonly DrawnTerrainLayer[];
  readonly layerReasons: readonly TerrainLayerReasons[];
}

export const terrainLightingUnportedReason = "library-terrain-lighting-unported";
export const terrainLayerUseAlphaUnverifiedReasonPrefix = "terrain-layer-use-alpha-unverified:";
export const terrainLayerBaseUnconvertedReasonPrefix = "terrain-layer-base-unconverted:";
export const terrainLayerSamplerBudgetReasonPrefix = "terrain-layer-sampler-budget:";
export const terrainLayerUvRowsDifferReason = "terrain-layer-uv-rows-differ";

function textureInput(loaded: LoadedNativeMaterial) {
  const sampler = singleTextureSampler(loaded.plan);
  if (sampler === null) return null;
  const pixels = loaded.texturePixels.get(sampler.frameImages[0]!.sha256);
  if (pixels === undefined) throw new Error(`Terrain layer program ${loaded.materialId} has no loaded texture.`);
  return { pixels, clampU: sampler.clampU, clampV: sampler.clampV, name: `UE2 terrain layer: ${sampler.textureNode}` };
}

function layerDrawReasons(layer: DrawnTerrainLayer, isBase: boolean): string[] {
  const reasons: string[] = [];
  const alphaMap = textureInput(layer.alphaMap);
  if (textureInput(layer.texture) === null || alphaMap === null) reasons.push(terrainLayerProgramNotSingleTextureReason);
  else if (!isBase && !alphaMapChannelsAreEqual(alphaMap.pixels)) reasons.push(terrainLayerAlphaChannelsDifferReason);
  return reasons;
}

function uvRowsFor(meshRows: readonly TerrainLayerUvRows[], entry: TerrainLayerListingEntry): TerrainLayerUvRows | null {
  const rows = meshRows.find(candidate => candidate.index === entry.index);
  return rows !== undefined && rows.texture === entry.texture && rows.alphaMap === entry.alphaMap ? rows : null;
}

function materialLayers(drawn: readonly DrawnTerrainLayer[], meshRows: readonly TerrainLayerUvRows[]): TerrainLayerMaterialLayer[] | null {
  const layers: TerrainLayerMaterialLayer[] = [];
  for (const layer of drawn) {
    const rows = uvRowsFor(meshRows, layer.entry);
    const texture = textureInput(layer.texture), alphaMap = textureInput(layer.alphaMap);
    if (rows === null || texture === null || alphaMap === null) return null;
    layers.push({ texture, alphaMap: { pixels: alphaMap.pixels, clampU: alphaMap.clampU, clampV: alphaMap.clampV }, rowU: rows.rowU, rowV: rows.rowV });
  }
  return layers;
}

const meshRowsKey = (layers: readonly TerrainLayerMaterialLayer[]) => JSON.stringify(layers.map(layer => [layer.rowU, layer.rowV]));

export function bindTerrainLayerMaterials(settings: TerrainLayerSettings): TerrainLayerBinding {
  const { scene, load } = settings;
  const lifetime = new AbortController();
  const chunks = new Map<string, { readonly meshes: readonly AbstractMesh[]; readonly status: TerrainLayerMeshStatus }>();
  const materials = new Map<string, TerrainLayerMaterial>();
  let tileLayers: Promise<TileTerrainLayers> | null = null;
  let resolvedTileLayers: TileTerrainLayers | null = null;
  let samplerCount = 0;
  const readTileLayers = async (): Promise<TileTerrainLayers> => {
    if (load.listing === null) return { gap: load.gap, drawn: [], layerReasons: [] };
    const drawn: DrawnTerrainLayer[] = [], layerReasons: TerrainLayerReasons[] = [];
    for (const entry of load.listing.layers) {
      const isBase = entry === load.listing.layers[0];
      let reasons = [...entry.gapReasons];
      if (entry.rootsPorted) {
        const layer = { entry, texture: await settings.loadProgram(entry.textureProgramId!, lifetime.signal),
          alphaMap: await settings.loadProgram(entry.alphaMapProgramId!, lifetime.signal) };
        const drawReasons = layerDrawReasons(layer, isBase);
        if (drawReasons.length === 0) drawn.push(layer);
        reasons = [...reasons, ...drawReasons];
      }
      if (entry.useAlpha) reasons.push(`${terrainLayerUseAlphaUnverifiedReasonPrefix}${entry.index}`);
      if (reasons.length > 0) layerReasons.push({ index: entry.index, reasons });
      if (isBase && drawn.length === 0) return { gap: `${terrainLayerBaseUnconvertedReasonPrefix}${entry.index}`, drawn: [], layerReasons };
    }
    return { gap: null, drawn, layerReasons };
  };
  const materialFor = (resolved: TileTerrainLayers, meshes: readonly AbstractMesh[]): TerrainLayerMaterial | string => {
    const meshRows = meshes.map(readTerrainLayerUvRows);
    const layersOfMeshes = meshRows.map(rows => rows === null ? null : materialLayers(resolved.drawn, rows));
    const first = layersOfMeshes[0];
    if (first === null || first === undefined || layersOfMeshes.some(layers => layers === null || meshRowsKey(layers) !== meshRowsKey(first))) {
      return terrainLayerUvRowsDifferReason;
    }
    const key = meshRowsKey(first);
    const existing = materials.get(key);
    if (existing !== undefined) return existing;
    const required = terrainLayerSamplerCount(first.length, first.slice(1).map(layer => layer.alphaMap));
    if (required > scene.getEngine().getCaps().maxTexturesImageUnits) return `${terrainLayerSamplerBudgetReasonPrefix}${required}`;
    const material = createTerrainLayerMaterial(scene, `UE2 terrain layers: ${load.listing!.tileId}`, first);
    material.update(settings.fog());
    materials.set(key, material);
    samplerCount = material.samplerCount;
    return material;
  };
  const observer = scene.onBeforeRenderObservable.add(() => {
    if (materials.size === 0) return;
    const fog = settings.fog();
    for (const material of materials.values()) material.update(fog);
  });
  let gapOfMeshes: string | null = null;
  return {
    async addChunk(chunkId, meshes) {
      if (lifetime.signal.aborted || chunks.has(chunkId) || meshes.length === 0) return;
      tileLayers ??= readTileLayers();
      const resolved = await tileLayers;
      lifetime.signal.throwIfAborted();
      resolvedTileLayers = resolved;
      if (resolved.gap !== null) { chunks.set(chunkId, { meshes, status: "terrain-layer-gap" }); return; }
      const material = materialFor(resolved, meshes);
      if (typeof material === "string") { gapOfMeshes = material; chunks.set(chunkId, { meshes, status: "terrain-layer-gap" }); return; }
      for (const mesh of meshes) mesh.material = material.material;
      chunks.set(chunkId, { meshes, status: "library-terrain-layers" });
    },
    removeChunk(chunkId) { chunks.delete(chunkId); },
    inspection() {
      const statusCounts = { "library-terrain-layers": 0, "terrain-layer-gap": 0 };
      let meshCount = 0;
      for (const chunk of chunks.values()) { statusCounts[chunk.status] += chunk.meshes.length; meshCount += chunk.meshes.length; }
      return { gap: resolvedTileLayers?.gap ?? (load.listing === null ? load.gap : gapOfMeshes), lighting: "unlit", lightingReasons: [terrainLightingUnportedReason],
        drawnLayers: resolvedTileLayers?.drawn.map(layer => layer.entry.index) ?? [], layerReasons: resolvedTileLayers?.layerReasons ?? [], samplerCount,
        constantIds: [...materials.values()][0]?.constantIds ?? [], meshCount, statusCounts };
    },
    dispose() {
      if (lifetime.signal.aborted) return;
      lifetime.abort();
      scene.onBeforeRenderObservable.remove(observer);
      chunks.clear();
      for (const material of materials.values()) material.dispose();
      materials.clear();
    },
  };
}
