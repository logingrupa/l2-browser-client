import type { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Scene } from "@babylonjs/core/scene";
import { createNativeMaterial, type FogState, type LightmapLighting, type LoadedNativeMaterial, type NativeMaterial } from "../../../materials/ue2/babylon/material";
import type { LoadedTextureMipChain } from "../../../materials/ue2/babylon/loadNativeMaterial";
import {
  applyNativeSampler, blockCompressionGapReason, createNativeMipChainTexture, createNativeSingleLevelTexture, nativeMipChainUpload,
} from "../../../materials/ue2/babylon/samplerTextures";
import { TEXTURE_SAMPLING_CONSTANTS } from "../../../materials/ue2/model/constants/textureSamplingConstants";
import { lightmapStageColourOperation, type LightmapColourOperation } from "../../../environment/model/nativeDrawLightingStates";
import { bspLightmapSlot } from "../../../environment/model/bspLightmapSelection";
import type { NativeBspNodeRange, NativeBspSection } from "../nativeBspResources";
import type { BspLightmapPageSource } from "../../../environment/model/bspLightmapSelection";
import type { RebuiltLightmapResult } from "./composeRebuiltLightmap";
import type { TileLightingModel, TileLightmapPage } from "./decodeTileLighting";
import { decodeDxt1Texels, lightmapHourPages, lightmapPageAtHour, lightmapPageSource } from "./lightmapPages";
import type { RebuiltLightmapRequest } from "./rebuiltLightmapRequest";
import { createRebuiltLightmapStore, type LightmapTextureSource } from "./rebuiltLightmapStore";
import type { RebuildLightEnvironment } from "./rebuildShadowLights";
import { ENVIRONMENT_ENGINE_CONSTANTS } from "../../../environment/model/nativeEnvironmentEngineConstants";
import { readNativeMaterialProgramPin } from "../../../assets/native/nativeMaterialProgramPin";
import { planLightmapSections, sectionLightmapTextures, type LightmapSectionPlan } from "./tileLightmapSections";
import {
  planWithVisibilityNodeRanges, sunAffectedNodeVisible, sunAffectNodeSetOf, type SunAffectNodeSet, type TileLightingVisibility,
} from "./tileLightingVisibility";
import type { WorldEnvironmentSample } from "../worldTimeOfDay";

export type TileLightingSurfaceStatus = "library-compiled" | "library-diagnostic" | "program-unconverted" | "lighting-gap";

export interface TileLightingBspChunk {
  readonly chunkId: string;
  readonly chunkOrdinal: number;
  readonly sections: readonly NativeBspSection[];
  readonly nodeRanges: readonly NativeBspNodeRange[];
  readonly meshes: readonly AbstractMesh[];
}

export interface TileLightingSettings {
  readonly scene: Scene;
  readonly model: TileLightingModel;
  readonly sessionSeed: number;
  readonly environment: () => WorldEnvironmentSample;
  readonly levelSeconds: () => number;
  readonly fog: () => FogState;
  readonly visibility: TileLightingVisibility | null;
  readonly loadProgram: (materialId: string, signal: AbortSignal) => Promise<LoadedNativeMaterial>;
  readonly rebuildEnvironment: () => RebuildLightEnvironment;
  readonly composeRebuiltLightmap: (request: RebuiltLightmapRequest) => Promise<RebuiltLightmapResult>;
}

export interface TileLightingSectionInspection {
  readonly chunkId: string;
  readonly primitive: number;
  readonly lighting: LightmapSectionPlan["kind"];
  readonly lightmapTexture: number | null;
  readonly nativeRenderSection: number | null;
  readonly sunAffect: boolean | null;
  readonly colourOperation: LightmapColourOperation | null;
  readonly page: number | null;
  readonly pageSource: BspLightmapPageSource | null;
  readonly hourPages: readonly number[];
  readonly status: TileLightingSurfaceStatus;
  readonly programMaterialId: string | null;
  readonly reasons: readonly string[];
}

export interface LightmapTextureSlot {
  readonly texture: number;
  readonly childCount: number;
  readonly sunAffectedSlot: number | null;
}

export interface LightmapPageUpload {
  readonly format: string;
  readonly reason: string | null;
}

export interface LightmapPageUploads {
  readonly compressedChild: LightmapPageUpload;
  readonly rebuiltComposite: LightmapPageUpload;
}

export interface TileLightingInspection {
  readonly gap: null;
  readonly sourceSha256: string;
  readonly environment: WorldEnvironmentSample;
  readonly lightmapHourGap: string | null;
  readonly fog: FogState;
  readonly sectionCount: number;
  readonly lightmappedSectionCount: number;
  readonly sunAffectedSectionCount: number;
  readonly sunAffectNodeSet: SunAffectNodeSet;
  readonly textureSlots: readonly LightmapTextureSlot[];
  readonly lightmapUploads: LightmapPageUploads;
  readonly textureSources: readonly LightmapTextureSource[];
  readonly statusCounts: Readonly<Record<TileLightingSurfaceStatus, number>>;
  readonly sections: readonly TileLightingSectionInspection[];
}

export interface TileLightingBinding {
  addChunk(chunk: TileLightingBspChunk): Promise<void>;
  removeChunk(chunkId: string): void;
  inspection(): TileLightingInspection;
  dispose(): void;
}

interface BoundSection {
  readonly plan: LightmapSectionPlan;
  readonly status: TileLightingSurfaceStatus;
  readonly programMaterialId: string | null;
  readonly reasons: readonly string[];
  readonly colourOperation: LightmapColourOperation | null;
  readonly nativeMaterial: NativeMaterial | null;
  boundPage: number | null;
}

interface PreparedSection {
  readonly section: BoundSection;
  readonly mesh: Mesh | null;
}

interface BoundChunk {
  readonly chunkOrdinal: number;
  readonly abort: AbortController;
  sections: readonly BoundSection[];
}

const lightmapHourOutsideDayReason = "lightmap-hour-outside-day";
const colourModifierClass = "Engine.ColorModifier";
const compressedLightmapFormat = "DXT1";
const lightmapAddress = TEXTURE_SAMPLING_CONSTANTS.lightmapAddress.runtimeDefault;
const rebuiltCompositeUpload: LightmapPageUpload = { format: "rgba8-single-mip-rebuilt", reason: null };

function lightmapPageUploads(scene: Scene): LightmapPageUploads {
  const unavailableReason = blockCompressionGapReason(scene);
  return { compressedChild: unavailableReason === null ? { format: "bc1-native-levels", reason: null } : { format: "rgba8-mip0-cpu-decoded", reason: unavailableReason },
    rebuiltComposite: rebuiltCompositeUpload };
}

function textureSlots(model: TileLightingModel, hour: number): LightmapTextureSlot[] {
  return Array.from({ length: model.textureCount }, (_, texture) => {
    const childCount = model.texturePageStart[texture + 1]! - model.texturePageStart[texture]!;
    return { texture, childCount, sunAffectedSlot: isHourOfDay(hour) ? bspLightmapSlot(hour, childCount, true) : null };
  });
}

export function lightmapColourOperationOf(loaded: LoadedNativeMaterial): LightmapColourOperation {
  const rootClass = loaded.program.nodes.find(node => node.id === loaded.program.root)?.class;
  return lightmapStageColourOperation(rootClass === colourModifierClass);
}

function lightmapLightingFor(operation: LightmapColourOperation): LightmapLighting {
  return operation.operation === "modulate" ? "lightmap-modulate" : "lightmap-modulate2x";
}

function isHourOfDay(hour: number): boolean {
  return hour >= 0 && hour < ENVIRONMENT_ENGINE_CONSTANTS.hoursPerDay.value;
}

function lightmapHourGap(hour: number): string | null {
  return isHourOfDay(hour) ? null : `${lightmapHourOutsideDayReason}:${hour}`;
}

function pageAtHour(model: TileLightingModel, plan: LightmapSectionPlan, hour: number, sunAffect: boolean): number | null {
  return plan.kind === "lightmapped" && isHourOfDay(hour) ? lightmapPageAtHour(model, plan.lightmapTexture, hour, sunAffect) : null;
}

function disposeSectionMaterials(sections: readonly BoundSection[]): void {
  for (const section of sections) section.nativeMaterial?.dispose();
}

function applyPreparedSections(prepared: readonly PreparedSection[]): BoundSection[] {
  for (const { section, mesh } of prepared) {
    if (mesh === null || section.nativeMaterial === null) continue;
    if (section.plan.kind === "lightmapped") mesh.setVerticesData(VertexBuffer.UV2Kind, section.plan.lightmapCoordinates, false, 2);
    mesh.material = section.nativeMaterial.material;
  }
  return prepared.map(({ section }) => section);
}

function lightmapTexture(texture: BaseTexture, name: string): BaseTexture {
  return applyNativeSampler(texture, name, lightmapAddress, lightmapAddress);
}

function compressedLightmapChain(page: TileLightmapPage): LoadedTextureMipChain {
  return { format: compressedLightmapFormat, levels: page.levels.map(level => ({ width: level.edge, height: level.edge, data: level.texels })) };
}

function compressedLightmapTexture(scene: Scene, page: TileLightmapPage): BaseTexture {
  const chain = compressedLightmapChain(page), upload = nativeMipChainUpload(scene, chain);
  if ("babylonFormat" in upload) return createNativeMipChainTexture(scene, chain, upload.babylonFormat);
  const [firstLevel] = page.levels;
  return createNativeSingleLevelTexture(scene, decodeDxt1Texels(firstLevel!.texels, firstLevel!.edge), firstLevel!.edge, firstLevel!.edge);
}

function cachedTexture(cache: Map<number, BaseTexture>, key: number, create: () => BaseTexture): BaseTexture {
  const texture = cache.get(key) ?? create();
  cache.set(key, texture);
  return texture;
}

export function bindTileLighting(settings: TileLightingSettings): TileLightingBinding {
  const { scene, model } = settings;
  const pageTextures = new Map<number, BaseTexture>(), rebuiltTextures = new Map<number, BaseTexture>();
  const programs = new Map<string, LoadedNativeMaterial>(), chunks = new Map<string, BoundChunk>();
  const rebuiltLightmaps = createRebuiltLightmapStore({ model, environment: settings.rebuildEnvironment, compose: settings.composeRebuiltLightmap });
  let disposed = false;
  const compressedPageTexture = (page: number) => cachedTexture(pageTextures, page, () =>
    lightmapTexture(compressedLightmapTexture(scene, model.pages[page]!), `Tile lightmap page ${page}`));
  const rebuiltTexture = (texture: number) => cachedTexture(rebuiltTextures, texture, () => {
    const rebuilt = rebuiltLightmaps.result(texture);
    if (rebuilt.status !== "resolved") throw new RangeError(`Lightmap texture ${texture} is bound although its rebuild is ${rebuilt.reason}.`);
    return lightmapTexture(createNativeSingleLevelTexture(scene, rebuilt.value.rgba, rebuilt.value.edge, rebuilt.value.edge), `Tile rebuilt lightmap ${texture}`);
  });
  const pageTexture = (page: number, texture: number): BaseTexture =>
    lightmapPageSource(model, page) === "rebuilt-composite" ? rebuiltTexture(texture) : compressedPageTexture(page);
  const programFor = async (programMaterialId: string, signal: AbortSignal) => {
    let loaded = programs.get(programMaterialId);
    if (!loaded) { loaded = await settings.loadProgram(programMaterialId, signal); programs.set(programMaterialId, loaded); }
    signal.throwIfAborted();
    return loaded;
  };
  const prepareSection = async (plan: LightmapSectionPlan, mesh: AbstractMesh, signal: AbortSignal): Promise<PreparedSection> => {
    const programMaterialId = readNativeMaterialProgramPin(mesh.material);
    const unbound = (status: TileLightingSurfaceStatus, reasons: readonly string[]): PreparedSection =>
      ({ section: { plan, status, programMaterialId, reasons, colourOperation: null, nativeMaterial: null, boundPage: null }, mesh: null });
    if (plan.kind === "gap") return unbound("lighting-gap", [plan.reason]);
    if (programMaterialId === null) return unbound("program-unconverted", []);
    const loaded = await programFor(programMaterialId, signal);
    const colourOperation = plan.kind === "lightmapped" ? lightmapColourOperationOf(loaded) : null;
    const nativeMaterial = createNativeMaterial(scene, loaded, { sessionSeed: settings.sessionSeed,
      lighting: colourOperation === null ? "unlit" : lightmapLightingFor(colourOperation) });
    const inspected = nativeMaterial.inspect();
    if (inspected.status !== "compiled") { nativeMaterial.dispose(); return unbound("library-diagnostic", inspected.reasons); }
    if (!(mesh instanceof Mesh)) { nativeMaterial.dispose(); return unbound("lighting-gap", [`lighting-mesh-not-editable:${mesh.name}`]); }
    const reasons = colourOperation?.operation === "global-modulation" ? [colourOperation.reason] : [];
    return { section: { plan, status: "library-compiled", programMaterialId, reasons, colourOperation, nativeMaterial, boundPage: null }, mesh };
  };
  const { visibility } = settings;
  const sortedChunks = () => [...chunks.values()].sort((left, right) => left.chunkOrdinal - right.chunkOrdinal);
  const step = () => {
    const environment = settings.environment(), uniforms = { levelSeconds: settings.levelSeconds(), hour: environment.hour,
      environmentType: environment.targetType, fog: settings.fog() };
    for (const chunk of chunks.values()) for (const section of chunk.sections) {
      if (!section.nativeMaterial) continue;
      const page = pageAtHour(model, section.plan, environment.hour, sunAffectedNodeVisible(visibility, chunk.chunkOrdinal, section.plan));
      if (page !== null && page !== section.boundPage && section.plan.kind === "lightmapped") {
        section.nativeMaterial.setLightmap(pageTexture(page, section.plan.lightmapTexture));
        section.boundPage = page;
      }
      section.nativeMaterial.update(uniforms);
    }
  };
  const removeChunk = (chunkId: string) => {
    const bound = chunks.get(chunkId);
    if (bound === undefined) return;
    chunks.delete(chunkId);
    bound.abort.abort();
    disposeSectionMaterials(bound.sections);
  };
  const observer = scene.onBeforeRenderObservable.add(step);
  return {
    async addChunk(chunk) {
      if (disposed || chunks.has(chunk.chunkId)) return;
      const bound: BoundChunk = { chunkOrdinal: chunk.chunkOrdinal, abort: new AbortController(), sections: [] };
      chunks.set(chunk.chunkId, bound);
      const prepared: PreparedSection[] = [];
      try {
        await rebuiltLightmaps.prepare(sectionLightmapTextures(model, chunk.sections));
        bound.abort.signal.throwIfAborted();
        const plans = planLightmapSections(model, [{ ...chunk, primitiveVertexCount: primitive => chunk.meshes[primitive]!.getTotalVertices(),
          primitiveIndices: primitive => chunk.meshes[primitive]!.getIndices() ?? [] }], rebuiltLightmaps.textureSource)
          .map(plan => planWithVisibilityNodeRanges(visibility, chunk.chunkOrdinal, plan));
        for (const plan of plans) prepared.push(await prepareSection(plan, chunk.meshes[plan.primitive]!, bound.abort.signal));
        bound.abort.signal.throwIfAborted();
      } catch (error) {
        disposeSectionMaterials(prepared.map(({ section }) => section));
        if (chunks.get(chunk.chunkId) === bound) chunks.delete(chunk.chunkId);
        throw error;
      }
      bound.sections = applyPreparedSections(prepared);
      step();
    },
    removeChunk,
    inspection() {
      const environment = settings.environment();
      const sections = sortedChunks().flatMap(chunk => chunk.sections.map(section =>
        ({ section, sunAffect: sunAffectedNodeVisible(visibility, chunk.chunkOrdinal, section.plan) })));
      const statusCounts = { "library-compiled": 0, "library-diagnostic": 0, "program-unconverted": 0, "lighting-gap": 0 };
      for (const { section } of sections) statusCounts[section.status] += 1;
      return { gap: null, sourceSha256: model.sourceSha256, environment, lightmapHourGap: lightmapHourGap(environment.hour), fog: settings.fog(), sectionCount: sections.length,
        lightmappedSectionCount: sections.filter(({ section }) => section.plan.kind === "lightmapped").length,
        sunAffectedSectionCount: sections.filter(({ sunAffect }) => sunAffect).length, sunAffectNodeSet: sunAffectNodeSetOf(visibility),
        textureSlots: textureSlots(model, environment.hour), lightmapUploads: lightmapPageUploads(scene), textureSources: rebuiltLightmaps.textureSources(), statusCounts,
        sections: sections.map(({ section: { plan, status, programMaterialId, reasons, colourOperation }, sunAffect }) => {
          const page = pageAtHour(model, plan, environment.hour, sunAffect);
          return { chunkId: plan.chunkId, primitive: plan.primitive, lighting: plan.kind, lightmapTexture: plan.kind === "lightmapped" ? plan.lightmapTexture : null,
            nativeRenderSection: plan.kind === "lightmapped" ? plan.nativeRenderSection : null, sunAffect: plan.kind === "lightmapped" ? sunAffect : null, colourOperation,
            page, pageSource: page === null ? null : lightmapPageSource(model, page),
            hourPages: plan.kind === "lightmapped" ? lightmapHourPages(model, plan.lightmapTexture) : [],
            status, programMaterialId, reasons: plan.kind === "unlit" ? [plan.reason, ...reasons] : reasons };
        }) };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      scene.onBeforeRenderObservable.remove(observer);
      for (const chunkId of [...chunks.keys()]) removeChunk(chunkId);
      for (const texture of [...pageTextures.values(), ...rebuiltTextures.values()]) texture.dispose();
    },
  };
}
