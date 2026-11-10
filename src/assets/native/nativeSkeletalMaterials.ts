import type { AssetContainer } from "@babylonjs/core/assetContainer";
import type { Material } from "@babylonjs/core/Materials/material";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Scene } from "@babylonjs/core/scene";
import { createNativeMaterial, type NativeMaterial } from "../../materials/ue2/babylon/material";
import type { LoadedNativeMaterial } from "../../materials/ue2/babylon/loadNativeMaterial";

export type SkeletalSlotStatus = "library-compiled" | "library-diagnostic" | "program-unconverted" | "library-vertex-stage-unskinned";

export interface SkeletalSlotInspection {
  readonly slot: string;
  readonly status: SkeletalSlotStatus;
  readonly programMaterialId: string | null;
  readonly meshes: number;
}

export interface SkeletalSlotMaterialBinding {
  readonly slots: readonly SkeletalSlotInspection[];
  dispose(): void;
}

export interface SkeletalSlotMaterialOptions {
  readonly sessionSeed: number;
  readonly loadProgram: (materialId: string, signal: AbortSignal) => Promise<LoadedNativeMaterial>;
}

export const SKELETAL_SLOT_PROGRAM_EXTRAS_FIELD = "nativeMaterialProgram";
const programMaterialIdPattern = /^[a-f0-9]{64}$/;

function slotProgramMaterialId(material: Material): string | null {
  const metadata: unknown = material.metadata;
  const extras: unknown = typeof metadata === "object" && metadata !== null ? (metadata as { gltf?: { extras?: unknown } }).gltf?.extras : undefined;
  const value: unknown = typeof extras === "object" && extras !== null ? (extras as Record<string, unknown>)[SKELETAL_SLOT_PROGRAM_EXTRAS_FIELD] : undefined;
  if (value === undefined) return null;
  if (typeof value !== "string" || !programMaterialIdPattern.test(value)) {
    throw new Error(`Skeletal slot ${material.name}: ${SKELETAL_SLOT_PROGRAM_EXTRAS_FIELD} ${JSON.stringify(value)} is not a material program SHA-256.`);
  }
  return value;
}

export async function bindSkeletalSlotMaterials(scene: Scene, container: AssetContainer, options: SkeletalSlotMaterialOptions, signal: AbortSignal): Promise<SkeletalSlotMaterialBinding> {
  const created: NativeMaterial[] = [], slots: SkeletalSlotInspection[] = [];
  try {
    for (const slotMaterial of [...container.materials]) {
      const programMaterialId = slotProgramMaterialId(slotMaterial);
      const users: AbstractMesh[] = container.meshes.filter(mesh => mesh.material === slotMaterial);
      const inspection = (status: SkeletalSlotStatus) => ({ slot: slotMaterial.name, status, programMaterialId, meshes: users.length });
      if (programMaterialId === null) { slots.push(inspection("program-unconverted")); continue; }
      if (users.some(mesh => mesh.skeleton !== null)) { slots.push(inspection("library-vertex-stage-unskinned")); continue; }
      const nativeMaterial = createNativeMaterial(scene, await options.loadProgram(programMaterialId, signal), { sessionSeed: options.sessionSeed, lighting: "unlit" });
      created.push(nativeMaterial);
      signal.throwIfAborted();
      for (const mesh of users) mesh.material = nativeMaterial.material;
      slots.push(inspection(nativeMaterial.inspect().status === "compiled" ? "library-compiled" : "library-diagnostic"));
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
