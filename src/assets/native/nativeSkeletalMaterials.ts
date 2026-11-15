import type { AssetContainer } from "@babylonjs/core/assetContainer";
import type { Material } from "@babylonjs/core/Materials/material";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Scene } from "@babylonjs/core/scene";
import { createNativeMaterial, type NativeMaterial } from "../../materials/ue2/babylon/material";
import type { LoadedNativeMaterial } from "../../materials/ue2/babylon/loadNativeMaterial";
import { actorSlotProvenanceAbsentReason, type ActorMaterialPrograms, type ActorModelSlotSourceObjects, type ActorSlotProgramJoin } from "./actorMaterialPrograms";

export type SkeletalSlotStatus = "library-compiled" | "library-diagnostic" | "program-gap";

export interface SkeletalSlotInspection {
  readonly slot: string;
  readonly sourceObject: string | null;
  readonly status: SkeletalSlotStatus;
  readonly programMaterialId: string | null;
  readonly reasons: readonly string[];
  readonly meshes: number;
}

export interface SkeletalSlotMaterialBinding {
  readonly slots: readonly SkeletalSlotInspection[];
  dispose(): void;
}

export interface SkeletalSlotMaterialOptions {
  readonly sessionSeed: number;
  readonly loadProgram: (materialId: string, signal: AbortSignal) => Promise<LoadedNativeMaterial>;
  readonly slotSourceObjects: ActorModelSlotSourceObjects;
  readonly materialPrograms: ActorMaterialPrograms;
}

const gltfMaterialPointerPattern = /^\/materials\/(0|[1-9]\d*)$/;

function gltfMaterialIndex(material: Material): number {
  const pointers: unknown = material._internalMetadata?.gltf?.pointers;
  const indices = (Array.isArray(pointers) ? pointers : []).map(pointer => typeof pointer === "string" ? gltfMaterialPointerPattern.exec(pointer)?.[1] : undefined)
    .filter((index): index is string => index !== undefined);
  if (indices.length !== 1) throw new Error(`Native actor slot ${material.name} has no glTF material index.`);
  return Number(indices[0]);
}

function slotJoin(material: Material, options: SkeletalSlotMaterialOptions, signal: AbortSignal): Promise<ActorSlotProgramJoin> {
  if (options.slotSourceObjects.kind === "absent") return Promise.resolve({ kind: "gap", sourceObject: null, reasons: [actorSlotProvenanceAbsentReason] });
  const index = gltfMaterialIndex(material), sourceObjects = options.slotSourceObjects.sourceObjects;
  if (index >= sourceObjects.length) throw new Error(`Native actor slot ${material.name} is glTF material ${index}, beyond the ${sourceObjects.length} slots of its provenance.`);
  return options.materialPrograms.joinSlot(sourceObjects[index]!, signal);
}

export async function bindSkeletalSlotMaterials(scene: Scene, container: AssetContainer, options: SkeletalSlotMaterialOptions, signal: AbortSignal): Promise<SkeletalSlotMaterialBinding> {
  const created: NativeMaterial[] = [], slots: SkeletalSlotInspection[] = [];
  try {
    for (const slotMaterial of [...container.materials]) {
      const users: AbstractMesh[] = container.meshes.filter(mesh => mesh.material === slotMaterial);
      const join = await slotJoin(slotMaterial, options, signal);
      signal.throwIfAborted();
      if (join.kind === "gap") {
        slots.push({ slot: slotMaterial.name, sourceObject: join.sourceObject, status: "program-gap", programMaterialId: null, reasons: join.reasons, meshes: users.length });
        continue;
      }
      const nativeMaterial = createNativeMaterial(scene, await options.loadProgram(join.programMaterialId, signal), { sessionSeed: options.sessionSeed, lighting: "unlit" });
      const inspection = nativeMaterial.inspect();
      if (inspection.status !== "compiled") {
        nativeMaterial.dispose();
        slots.push({ slot: slotMaterial.name, sourceObject: join.sourceObject, status: "library-diagnostic", programMaterialId: join.programMaterialId,
          reasons: inspection.reasons, meshes: users.length });
        continue;
      }
      created.push(nativeMaterial);
      signal.throwIfAborted();
      for (const mesh of users) mesh.material = nativeMaterial.material;
      slots.push({ slot: slotMaterial.name, sourceObject: join.sourceObject, status: "library-compiled", programMaterialId: join.programMaterialId, reasons: [],
        meshes: users.length });
    }
  } catch (error) {
    for (const nativeMaterial of created) nativeMaterial.dispose();
    throw error;
  }
  let disposed = false;
  return {
    slots,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const nativeMaterial of created) nativeMaterial.dispose();
    },
  };
}
