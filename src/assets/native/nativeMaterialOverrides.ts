import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture";
import type { Scene } from "@babylonjs/core/scene";

export interface NativeMaterialOverride {
  readonly entityId: string;
  /** Exact qualified material name retained in the converted GLB. This is a
   * source texture/material identity, not a reconstruction of its native shader. */
  readonly sourceMaterial: string;
  /** Linear RGB multipliers applied to the original albedo, each in [0, 1]. */
  readonly tint?: readonly [number, number, number];
  /** Absolute glTF preview roughness in [0, 1]; omitted preserves the source. */
  readonly roughness?: number;
}

interface MaterialCopy {
  readonly source: PBRMaterial;
  readonly material: PBRMaterial;
  readonly textures: readonly BaseTexture[];
}

function validate(settings: NativeMaterialOverride): void {
  if (typeof settings.entityId !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,127}$/.test(settings.entityId) ||
    typeof settings.sourceMaterial !== "string" || settings.sourceMaterial.length > 256 ||
    !/^[a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)+$/.test(settings.sourceMaterial)) {
    throw new Error("Native material override requires an exact entity ID and qualified source material identity.");
  }
  const unit = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
  if (settings.tint !== undefined && (!Array.isArray(settings.tint) || settings.tint.length !== 3 || !settings.tint.every(unit)) ||
    settings.roughness !== undefined && !unit(settings.roughness) || settings.tint === undefined && settings.roughness === undefined) {
    throw new Error("Native material override needs a finite RGB tint or roughness in [0, 1].");
  }
}

/** An optional presentation edit on one entity's exact imported material.
 * Call update after entity updates to include asynchronous loads/equipment.
 * Babylon clones the existing PBR configuration, including its source texture
 * settings. Only albedo/roughness change; alpha, UVs, culling and native payloads
 * remain untouched. The caller owns this adapter's lifetime. */
export function createNativeMaterialOverrides(scene: Scene, settings?: NativeMaterialOverride) {
  if (settings) validate(settings);
  // Snapshot the authored settings so external Editor property mutation cannot
  // silently alter an active runtime's selection or accumulate another tint.
  const target = settings ? { entityId: settings.entityId, sourceMaterial: settings.sourceMaterial,
    tint: settings.tint ? [...settings.tint] as [number, number, number] : null, roughness: settings.roughness ?? null } : null;
  const copies = new Map<PBRMaterial, MaterialCopy>(), bindings = new Map<AbstractMesh, MaterialCopy>();
  let disposed = false, failure: string | null = null;
  const release = (copy: MaterialCopy) => {
    copy.material.dispose(false, false);
    // Render-target textures and the scene BRDF may be shared by Babylon's
    // clone. Dispose only textures allocated by this synchronous clone.
    for (const texture of copy.textures) texture.dispose();
  };
  function clone(source: PBRMaterial): MaterialCopy {
    const beforeMaterials = new Set(scene.materials), beforeTextures = new Set(scene.textures);
    try {
      // Retain the source name for existing diagnostics and exact identity.
      const material = source.clone(source.name);
      if (target!.tint) material.albedoColor = source.albedoColor.multiply(Color3.FromArray(target!.tint));
      if (target!.roughness !== null) material.roughness = target!.roughness;
      return { source, material, textures: scene.textures.filter(texture => !beforeTextures.has(texture)) };
    } catch (error) {
      for (const material of [...scene.materials]) if (!beforeMaterials.has(material)) material.dispose(false, false);
      for (const texture of [...scene.textures]) if (!beforeTextures.has(texture)) texture.dispose();
      throw error;
    }
  }
  function detach(mesh: AbstractMesh, copy: MaterialCopy): void {
    if (!mesh.isDisposed() && mesh.material === copy.material) mesh.material = copy.source;
    bindings.delete(mesh);
  }
  function unused(): void {
    const used = new Set(bindings.values());
    for (const [source, copy] of copies) if (!used.has(copy)) { release(copy); copies.delete(source); }
  }
  function update(): void {
    if (disposed || !target || scene.isDisposed) return;
    const eligible = (mesh: AbstractMesh) => !mesh.isDisposed() && mesh.isEnabled() && mesh.getTotalVertices() > 0 &&
      mesh.metadata?.clientEntityId === target!.entityId;
    for (const [mesh, copy] of bindings) if (!eligible(mesh) || mesh.material !== copy.material) detach(mesh, copy);
    const candidates = scene.meshes.filter(mesh => eligible(mesh) && mesh.material?.name === target.sourceMaterial);
    const pending = new Map<PBRMaterial, MaterialCopy>();
    try {
      // Validate all selected primitives before committing any newly loaded one.
      for (const mesh of candidates) {
        const source = bindings.get(mesh)?.source ?? mesh.material;
        if (!(source instanceof PBRMaterial) || source.getClassName() !== "PBRMaterial") {
          throw new Error(`Native material ${target.sourceMaterial} is not a supported imported PBR material.`);
        }
      }
      for (const mesh of candidates) {
        const source = bindings.get(mesh)?.source ?? mesh.material as PBRMaterial;
        if (!copies.has(source) && !pending.has(source)) pending.set(source, clone(source));
      }
      for (const [source, copy] of pending) copies.set(source, copy);
      for (const mesh of candidates) {
        const source = bindings.get(mesh)?.source ?? mesh.material as PBRMaterial, copy = copies.get(source)!;
        mesh.material = copy.material; bindings.set(mesh, copy);
      }
      failure = null;
    } catch (error) {
      for (const copy of pending.values()) release(copy);
      failure = error instanceof Error ? error.message : "Native material override could not be applied.";
    }
    unused();
  }
  return { update,
    snapshot: () => ({ enabled: target !== null, disposed, entityId: target?.entityId ?? null, sourceMaterial: target?.sourceMaterial ?? null,
      tint: target?.tint ? [...target.tint] : null, roughness: target?.roughness ?? null,
      matchedMeshes: bindings.size, matchedMaterials: copies.size, failure,
      materials: [...copies.values()].map(copy => ({ sourceAlbedo: copy.source.albedoColor.asArray(), albedo: copy.material.albedoColor.asArray(),
        sourceRoughness: copy.source.roughness, roughness: copy.material.roughness, alpha: copy.material.alpha,
        transparencyMode: copy.material.transparencyMode, alphaCutOff: copy.material.alphaCutOff })) }),
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const [mesh, copy] of bindings) detach(mesh, copy);
      for (const copy of copies.values()) release(copy);
      copies.clear();
    },
  };
}
