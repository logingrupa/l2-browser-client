import type { Material } from "@babylonjs/core/Materials/material";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Scene } from "@babylonjs/core/scene";
import { createNativeMaterial, type LoadedNativeMaterial, type NativeMaterial, type NativeMaterialUniforms } from "../../../materials/ue2/babylon/material";
import { joinStaticMeshSlot, readStaticMeshSlotSourceObject, type StaticMeshMaterialsLoad } from "../staticMeshLibraryMaterials";

export type StaticMeshSlotStatus = "library-compiled" | "library-diagnostic" | "program-gap";

export interface StaticMeshSlotInspection {
  readonly sourceObject: string | null;
  readonly status: StaticMeshSlotStatus;
  readonly programMaterialId: string | null;
  readonly reasons: readonly string[];
  readonly meshes: number;
}

export interface StaticMeshLibraryInspection {
  readonly gap: string | null;
  readonly lighting: "unlit";
  readonly lightingReasons: readonly string[];
  readonly meshCount: number;
  readonly statusCounts: Readonly<Record<StaticMeshSlotStatus, number>>;
  readonly slots: readonly StaticMeshSlotInspection[];
}

export interface StaticMeshLibrarySettings {
  readonly scene: Scene;
  readonly load: StaticMeshMaterialsLoad;
  readonly sessionSeed: number;
  readonly uniforms: () => NativeMaterialUniforms;
  readonly loadProgram: (materialId: string, signal: AbortSignal) => Promise<LoadedNativeMaterial>;
}

export interface StaticMeshLibraryBinding {
  addChunk(chunkId: string, meshes: readonly AbstractMesh[]): Promise<void>;
  removeChunk(chunkId: string): void;
  inspection(): StaticMeshLibraryInspection;
  dispose(): void;
}

interface BoundStaticMeshSlot {
  readonly mesh: AbstractMesh;
  readonly sourceObject: string | null;
  readonly status: StaticMeshSlotStatus;
  readonly programMaterialId: string | null;
  readonly reasons: readonly string[];
  readonly libraryMaterial: Material | null;
}

export const staticMeshFinalVertexColourReason = "ma-final-static-vertex";

const compareSourceObjects = (left: string | null, right: string | null) =>
  left === right ? 0 : left === null ? -1 : right === null ? 1 : left.toLowerCase() < right.toLowerCase() ? -1 : 1;

function slotInspections(slots: readonly BoundStaticMeshSlot[]): StaticMeshSlotInspection[] {
  const bySourceObject = new Map<string, StaticMeshSlotInspection>();
  for (const slot of slots) {
    const key = slot.sourceObject?.toLowerCase() ?? "";
    const listed = bySourceObject.get(key);
    bySourceObject.set(key, listed ? { ...listed, meshes: listed.meshes + 1 }
      : { sourceObject: slot.sourceObject, status: slot.status, programMaterialId: slot.programMaterialId, reasons: slot.reasons, meshes: 1 });
  }
  return [...bySourceObject.values()].sort((left, right) => compareSourceObjects(left.sourceObject, right.sourceObject));
}

export function bindStaticMeshLibraryMaterials(settings: StaticMeshLibrarySettings): StaticMeshLibraryBinding {
  const { scene, load } = settings;
  const lifetime = new AbortController();
  const pendingMaterials = new Map<string, Promise<NativeMaterial>>(), readyMaterials = new Map<string, NativeMaterial>();
  const chunks = new Map<string, readonly BoundStaticMeshSlot[]>();
  const sourceObjectByMesh = new WeakMap<AbstractMesh, string | null>();
  const createdMaterial = async (programMaterialId: string) => {
    const nativeMaterial = createNativeMaterial(scene, await settings.loadProgram(programMaterialId, lifetime.signal),
      { sessionSeed: settings.sessionSeed, lighting: "unlit" });
    if (lifetime.signal.aborted) { nativeMaterial.dispose(); lifetime.signal.throwIfAborted(); }
    readyMaterials.set(programMaterialId, nativeMaterial);
    return nativeMaterial;
  };
  const nativeMaterialFor = (programMaterialId: string) => {
    const ready = readyMaterials.get(programMaterialId);
    if (ready) return Promise.resolve(ready);
    let pending = pendingMaterials.get(programMaterialId);
    if (!pending) {
      pending = createdMaterial(programMaterialId);
      pendingMaterials.set(programMaterialId, pending);
      const settled = () => { if (pendingMaterials.get(programMaterialId) === pending) pendingMaterials.delete(programMaterialId); };
      pending.then(settled, settled);
    }
    return pending;
  };
  const slotSourceObject = (mesh: AbstractMesh) => {
    if (!sourceObjectByMesh.has(mesh)) sourceObjectByMesh.set(mesh, readStaticMeshSlotSourceObject(mesh.material));
    return sourceObjectByMesh.get(mesh)!;
  };
  const boundSlot = async (mesh: AbstractMesh): Promise<BoundStaticMeshSlot> => {
    const sourceObject = slotSourceObject(mesh);
    const gap = (reasons: readonly string[]): BoundStaticMeshSlot => ({ mesh, sourceObject, status: "program-gap", programMaterialId: null, reasons, libraryMaterial: null });
    if (load.listing === null) return gap([load.gap]);
    const join = joinStaticMeshSlot(load.listing, sourceObject);
    if (join.kind === "gap") return { ...gap(join.reasons), sourceObject: join.sourceObject };
    const nativeMaterial = await nativeMaterialFor(join.programMaterialId);
    const inspected = nativeMaterial.inspect();
    const compiled = inspected.status === "compiled";
    return { mesh, sourceObject: join.sourceObject, status: compiled ? "library-compiled" : "library-diagnostic", programMaterialId: join.programMaterialId,
      reasons: compiled ? [] : inspected.reasons, libraryMaterial: compiled ? nativeMaterial.material : null };
  };
  const observer = scene.onBeforeRenderObservable.add(() => {
    if (readyMaterials.size === 0) return;
    const uniforms = settings.uniforms();
    for (const nativeMaterial of readyMaterials.values()) nativeMaterial.update(uniforms);
  });
  return {
    async addChunk(chunkId, meshes) {
      if (lifetime.signal.aborted || chunks.has(chunkId)) return;
      const slots: BoundStaticMeshSlot[] = [];
      for (const mesh of meshes) slots.push(await boundSlot(mesh));
      lifetime.signal.throwIfAborted();
      for (const slot of slots) if (slot.libraryMaterial !== null) slot.mesh.material = slot.libraryMaterial;
      chunks.set(chunkId, slots);
    },
    removeChunk(chunkId) { chunks.delete(chunkId); },
    inspection() {
      const slots = [...chunks.values()].flat();
      const statusCounts = { "library-compiled": 0, "library-diagnostic": 0, "program-gap": 0 };
      for (const slot of slots) statusCounts[slot.status] += 1;
      return { gap: load.gap, lighting: "unlit", lightingReasons: [staticMeshFinalVertexColourReason], meshCount: slots.length, statusCounts,
        slots: slotInspections(slots) };
    },
    dispose() {
      if (lifetime.signal.aborted) return;
      lifetime.abort();
      scene.onBeforeRenderObservable.remove(observer);
      chunks.clear();
      for (const nativeMaterial of readyMaterials.values()) nativeMaterial.dispose();
      readyMaterials.clear();
    },
  };
}
