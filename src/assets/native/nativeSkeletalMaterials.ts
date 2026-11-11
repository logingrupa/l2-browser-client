import type { AssetContainer } from "@babylonjs/core/assetContainer";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Scene } from "@babylonjs/core/scene";
import { createNativeMaterial, type NativeMaterial } from "../../materials/ue2/babylon/material";
import type { LoadedNativeMaterial } from "../../materials/ue2/babylon/loadNativeMaterial";
import { readNativeMaterialProgramPin } from "./nativeMaterialProgramPin";

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

export async function bindSkeletalSlotMaterials(scene: Scene, container: AssetContainer, options: SkeletalSlotMaterialOptions, signal: AbortSignal): Promise<SkeletalSlotMaterialBinding> {
  const created: NativeMaterial[] = [], slots: SkeletalSlotInspection[] = [];
  try {
    for (const slotMaterial of [...container.materials]) {
      const programMaterialId = readNativeMaterialProgramPin(slotMaterial);
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
