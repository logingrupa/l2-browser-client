import type { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Scene } from "@babylonjs/core/scene";
import { createNativeMaterial, type FogState, type LoadedNativeMaterial, type NativeMaterial } from "../../../materials/ue2/babylon/material";
import type { NativeBspNodeRange, NativeBspSection } from "../nativeBspResources";
import type { TileLightingModel } from "./decodeTileLighting";
import { decodeDxt1Texels, lightmapHourPages, lightmapPageAtHour } from "./lightmapPages";
import { readNativeMaterialProgramPin } from "../../../assets/native/nativeMaterialProgramPin";
import { planLightmapSections, type LightmapSectionPlan } from "./tileLightmapSections";
import type { WorldEnvironmentSample } from "./worldEnvironmentClock";

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
  readonly loadProgram: (materialId: string, signal: AbortSignal) => Promise<LoadedNativeMaterial>;
}

export interface TileLightingSectionInspection {
  readonly chunkId: string;
  readonly primitive: number;
  readonly lighting: LightmapSectionPlan["kind"];
  readonly lightmapTexture: number | null;
  readonly outdoor: boolean | null;
  readonly page: number | null;
  readonly hourPages: readonly number[];
  readonly status: TileLightingSurfaceStatus;
  readonly programMaterialId: string | null;
  readonly reasons: readonly string[];
}

export interface TileLightingInspection {
  readonly gap: null;
  readonly sourceSha256: string;
  readonly environment: WorldEnvironmentSample;
  readonly fog: FogState;
  readonly sectionCount: number;
  readonly lightmappedSectionCount: number;
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

function pageAtHour(model: TileLightingModel, plan: LightmapSectionPlan, hour: number): number | null {
  return plan.kind === "lightmapped" ? lightmapPageAtHour(model, plan.lightmapTexture, hour, plan.outdoor) : null;
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

export function bindTileLighting(settings: TileLightingSettings): TileLightingBinding {
  const { scene, model } = settings;
  const pageTextures = new Map<number, BaseTexture>(), programs = new Map<string, LoadedNativeMaterial>(), chunks = new Map<string, BoundChunk>();
  let disposed = false;
  const pageTexture = (page: number): BaseTexture => {
    const cached = pageTextures.get(page);
    if (cached) return cached;
    const source = model.pages[page]!;
    const texture = RawTexture.CreateRGBATexture(decodeDxt1Texels(source.texels, source.edge), source.edge, source.edge, scene, false, false, Texture.BILINEAR_SAMPLINGMODE);
    texture.name = `Tile lightmap page ${page}`;
    texture.gammaSpace = false;
    texture.wrapU = Texture.CLAMP_ADDRESSMODE; texture.wrapV = Texture.CLAMP_ADDRESSMODE;
    pageTextures.set(page, texture);
    return texture;
  };
  const programFor = async (programMaterialId: string, signal: AbortSignal) => {
    let loaded = programs.get(programMaterialId);
    if (!loaded) { loaded = await settings.loadProgram(programMaterialId, signal); programs.set(programMaterialId, loaded); }
    signal.throwIfAborted();
    return loaded;
  };
  const prepareSection = async (plan: LightmapSectionPlan, mesh: AbstractMesh, signal: AbortSignal): Promise<PreparedSection> => {
    const programMaterialId = readNativeMaterialProgramPin(mesh.material);
    const unbound = (status: TileLightingSurfaceStatus, reasons: readonly string[]): PreparedSection =>
      ({ section: { plan, status, programMaterialId, reasons, nativeMaterial: null, boundPage: null }, mesh: null });
    if (plan.kind === "gap") return unbound("lighting-gap", [plan.reason]);
    if (programMaterialId === null) return unbound("program-unconverted", []);
    const loaded = await programFor(programMaterialId, signal);
    const nativeMaterial = createNativeMaterial(scene, loaded, { sessionSeed: settings.sessionSeed, lighting: plan.kind === "lightmapped" ? "lightmap" : "unlit" });
    const inspected = nativeMaterial.inspect();
    if (inspected.status !== "compiled") { nativeMaterial.dispose(); return unbound("library-diagnostic", inspected.reasons); }
    if (!(mesh instanceof Mesh)) { nativeMaterial.dispose(); return unbound("lighting-gap", [`lighting-mesh-not-editable:${mesh.name}`]); }
    return { section: { plan, status: "library-compiled", programMaterialId, reasons: [], nativeMaterial, boundPage: null }, mesh };
  };
  const boundSections = () => [...chunks.values()].sort((left, right) => left.chunkOrdinal - right.chunkOrdinal).flatMap(chunk => chunk.sections);
  const step = () => {
    const environment = settings.environment(), uniforms = { levelSeconds: settings.levelSeconds(), hour: environment.hour,
      environmentType: environment.environmentType, fog: settings.fog() };
    for (const chunk of chunks.values()) for (const section of chunk.sections) {
      if (!section.nativeMaterial) continue;
      const page = pageAtHour(model, section.plan, environment.hour);
      if (page !== null && page !== section.boundPage) { section.nativeMaterial.setLightmap(pageTexture(page)); section.boundPage = page; }
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
        const plans = planLightmapSections(model, [{ ...chunk, primitiveVertexCount: primitive => chunk.meshes[primitive]!.getTotalVertices(),
          primitiveIndices: primitive => chunk.meshes[primitive]!.getIndices() ?? [] }]);
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
      const environment = settings.environment(), sections = boundSections();
      const statusCounts = { "library-compiled": 0, "library-diagnostic": 0, "program-unconverted": 0, "lighting-gap": 0 };
      for (const section of sections) statusCounts[section.status] += 1;
      return { gap: null, sourceSha256: model.sourceSha256, environment, fog: settings.fog(), sectionCount: sections.length,
        lightmappedSectionCount: sections.filter(section => section.plan.kind === "lightmapped").length, statusCounts,
        sections: sections.map(({ plan, status, programMaterialId, reasons }) => ({ chunkId: plan.chunkId, primitive: plan.primitive, lighting: plan.kind,
          lightmapTexture: plan.kind === "lightmapped" ? plan.lightmapTexture : null, outdoor: plan.kind === "lightmapped" ? plan.outdoor : null,
          page: pageAtHour(model, plan, environment.hour), hourPages: plan.kind === "lightmapped" ? lightmapHourPages(model, plan.lightmapTexture) : [],
          status, programMaterialId, reasons: plan.kind === "unlit" ? [plan.reason, ...reasons] : reasons })) };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      scene.onBeforeRenderObservable.remove(observer);
      for (const chunkId of [...chunks.keys()]) removeChunk(chunkId);
      for (const texture of pageTextures.values()) texture.dispose();
    },
  };
}
