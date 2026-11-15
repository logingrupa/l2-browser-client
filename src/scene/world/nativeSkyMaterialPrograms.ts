import type { Material } from "@babylonjs/core/Materials/material";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Scene } from "@babylonjs/core/scene";
import { readNativeMaterialProgramPin } from "../../assets/native/nativeMaterialProgramPin";
import { createNativeMaterial, FOG_DISABLED, type LoadedNativeMaterial, type NativeMaterial, type NativeMaterialUniforms } from "../../materials/ue2/babylon/material";

export type SkySurfaceProgramStatus = "program-unconverted" | "library-environment-clock-unwired" | "library-compiled" | "library-diagnostic";

export interface SkySurfaceProgramInspection {
  readonly mesh: string;
  readonly programMaterialId: string | null;
  readonly status: SkySurfaceProgramStatus;
  readonly reasons: readonly string[];
}

export interface SkyMaterialProgramSettings {
  readonly scene: Scene;
  readonly meshes: readonly AbstractMesh[];
  readonly sessionSeed: number;
  readonly materialUniforms: (() => NativeMaterialUniforms) | null;
  readonly loadProgram: (materialId: string, signal: AbortSignal) => Promise<LoadedNativeMaterial>;
  readonly signal: AbortSignal;
}

export interface SkyMaterialProgramBinding {
  readonly surfaces: readonly SkySurfaceProgramInspection[];
  showStoredSnapshotMaterials(): void;
  showProgramMaterials(): void;
  dispose(): void;
}

interface CompiledSkySurface {
  readonly mesh: AbstractMesh;
  readonly snapshotMaterial: Material | null;
  readonly nativeMaterial: NativeMaterial;
}

function skyUniformsWithoutFog(materialUniforms: () => NativeMaterialUniforms): NativeMaterialUniforms {
  return { ...materialUniforms(), fog: FOG_DISABLED };
}

export async function bindSkyMaterialPrograms(settings: SkyMaterialProgramSettings): Promise<SkyMaterialProgramBinding> {
  const { scene, materialUniforms, signal } = settings;
  const compiled: CompiledSkySurface[] = [], surfaces: SkySurfaceProgramInspection[] = [];
  const disposeCompiled = () => { for (const surface of compiled) surface.nativeMaterial.dispose(); };
  try {
    for (const mesh of settings.meshes) {
      const programMaterialId = readNativeMaterialProgramPin(mesh.material);
      const surface = (status: SkySurfaceProgramStatus, reasons: readonly string[]) => surfaces.push({ mesh: mesh.name, programMaterialId, status, reasons });
      if (programMaterialId === null) { surface("program-unconverted", []); continue; }
      if (materialUniforms === null) { surface("library-environment-clock-unwired", []); continue; }
      const loaded = await settings.loadProgram(programMaterialId, signal);
      signal.throwIfAborted();
      const nativeMaterial = createNativeMaterial(scene, loaded, { sessionSeed: settings.sessionSeed, lighting: "unlit" });
      const inspected = nativeMaterial.inspect();
      if (inspected.status !== "compiled") { nativeMaterial.dispose(); surface("library-diagnostic", inspected.reasons); continue; }
      nativeMaterial.material.disableDepthWrite = true;
      nativeMaterial.material.forceDepthWrite = false;
      nativeMaterial.update(skyUniformsWithoutFog(materialUniforms));
      compiled.push({ mesh, snapshotMaterial: mesh.material, nativeMaterial });
      surface("library-compiled", []);
    }
  } catch (error) { disposeCompiled(); throw error; }
  const showProgramMaterials = () => { for (const surface of compiled) surface.mesh.material = surface.nativeMaterial.material; };
  const showStoredSnapshotMaterials = () => { for (const surface of compiled) surface.mesh.material = surface.snapshotMaterial; };
  showProgramMaterials();
  const observer = materialUniforms === null || compiled.length === 0 ? null : scene.onBeforeRenderObservable.add(() => {
    const uniforms = skyUniformsWithoutFog(materialUniforms);
    for (const surface of compiled) surface.nativeMaterial.update(uniforms);
  });
  let disposed = false;
  return {
    surfaces,
    showStoredSnapshotMaterials,
    showProgramMaterials,
    dispose() {
      if (disposed) return;
      disposed = true;
      if (observer) scene.onBeforeRenderObservable.remove(observer);
      for (const surface of compiled) if (!surface.mesh.isDisposed() && surface.mesh.material === surface.nativeMaterial.material) surface.mesh.material = surface.snapshotMaterial;
      disposeCompiled();
    },
  };
}
