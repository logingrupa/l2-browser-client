import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture";
import type { Material } from "@babylonjs/core/Materials/material";
import { nativeEnvironmentSource, skyEnvironmentBindings, type NativeSkyLiteral } from "./nativeEnvironmentTables";

/** Private, reversible comparison. It never edits stored materials, transfer,
 * opacity, texture coordinates, blend/cull/depth state or a native clock. */
export function createNativeSkyLiteralComparison(meshes: readonly AbstractMesh[]) {
  const scene = meshes[0]?.getScene();
  if (!scene || meshes.length !== skyEnvironmentBindings.length) throw new Error("Literal sky comparison needs exactly three material meshes.");
  const entries = skyEnvironmentBindings.map(binding => {
    const matches = meshes.filter(mesh => mesh.material?.metadata?.gltf?.extras?.nativeSourceReference === binding.material);
    const mesh = matches[0], original = mesh?.material;
    if (matches.length !== 1 || !(original instanceof PBRMaterial) || mesh!.getScene() !== scene) {
      throw new Error(`Literal sky comparison requires one PBR material for ${binding.material}.`);
    }
    return { mesh: mesh!, original, source: binding.material, clone: null as PBRMaterial | null };
  });
  const ownedTextures = new Set<BaseTexture>();
  const ownedMaterials = new Set<Material>();
  let selected: NativeSkyLiteral | null = null, disposed = false;
  function release() {
    for (const entry of entries) if (entry.clone && entry.mesh.material === entry.clone) entry.mesh.material = entry.original;
    const adoptedClone = [...ownedMaterials].some(material => scene!.meshes.some(mesh => mesh.material === material));
    for (const material of ownedMaterials) if (!scene!.meshes.some(mesh => mesh.material === material)) material.dispose(false, false);
    for (const entry of entries) entry.clone = null;
    for (const texture of ownedTextures) {
      // Preserve a wrapper explicitly adopted by another live material.
      if (!adoptedClone && !scene!.materials.some(material => material.getActiveTextures().includes(texture))) texture.dispose();
    }
    ownedMaterials.clear(); ownedTextures.clear(); selected = null;
  }
  return {
    apply(literal: NativeSkyLiteral) {
      if (disposed) throw new Error("Sky comparison was disposed.");
      if (entries.some(entry => entry.mesh.isDisposed() || entry.mesh.material !== (entry.clone ?? entry.original))) {
        throw new Error("Sky material assignment changed; newer edits are retained.");
      }
      // Validate every row before creating or changing any temporary material.
      const colors = entries.map(entry => {
        const layers = literal.layers.filter(layer => layer.material === entry.source), rgb = layers[0]?.row.rgb;
        if (layers.length !== 1 || !rgb || rgb.length !== 3 || rgb.some(channel => !Number.isInteger(channel) || channel < 0 || channel > 255)) {
          throw new Error(`Invalid literal color for ${entry.source}.`);
        }
        return Color3.FromArray(rgb.map(channel => channel / 255));
      });
      try {
        for (const entry of entries) {
          if (entry.clone) continue;
          const beforeTextures = new Set(scene.textures);
          const beforeMaterials = new Set(scene.materials);
          try {
            entry.clone = entry.original.clone(`${entry.original.name} · literal source comparison`);
            if (!entry.clone || beforeMaterials.has(entry.clone)) throw new Error("Sky comparison clone did not create a private material.");
          } finally {
            // Clone can throw after constructing a material or plugin texture.
            for (const material of scene.materials) if (!beforeMaterials.has(material)) ownedMaterials.add(material);
            for (const texture of scene.textures) if (!beforeTextures.has(texture)) ownedTextures.add(texture);
          }
        }
        entries.forEach((entry, index) => { entry.clone!.albedoColor = colors[index]!; entry.mesh.material = entry.clone; });
        selected = structuredClone(literal);
      } catch (error) { release(); throw error; }
    },
    restore() { release(); },
    inspection: () => ({ mode: disposed ? "disposed" : selected ? "literal-source-row-comparison" : "stored-materials",
      ownedMaterials: ownedMaterials.size, ownedTextureWrappers: ownedTextures.size,
      sceneMaterials: scene.materials.length, sceneTextures: scene.textures.length,
      source: { ...nativeEnvironmentSource }, selected: selected ? structuredClone(selected) : null,
      convention: "RGB bytes / 255 into PBR albedoColor; existing browser factor convention; alpha and texture transfer unchanged",
      nativeSelection: "unverified", nativeInterpolation: "unverified", nativeColorConsumer: "unverified",
      materials: entries.map(entry => ({ source: entry.source, temporary: entry.mesh.material === entry.clone && !!entry.clone,
        originalId: entry.original.id, effectiveId: entry.mesh.material?.id ?? null,
        albedo: entry.mesh.material instanceof PBRMaterial ? entry.mesh.material.albedoColor.asArray() : null,
        originalAlbedo: entry.original.albedoColor.asArray(), alpha: entry.mesh.material?.alpha ?? null,
        renderState: { alphaMode: entry.mesh.material?.alphaMode, transparencyMode: entry.mesh.material?.transparencyMode,
          depthWriteDisabled: entry.mesh.material?.disableDepthWrite, backFaceCulling: entry.mesh.material?.backFaceCulling,
          useAlphaFromAlbedoTexture: entry.mesh.material instanceof PBRMaterial ? entry.mesh.material.useAlphaFromAlbedoTexture : null,
          unlit: entry.mesh.material instanceof PBRMaterial ? entry.mesh.material.unlit : null },
        textures: entry.clone?.getActiveTextures().map(texture => ({ name: texture.name,
          hasAlpha: texture.hasAlpha, gammaSpace: texture.gammaSpace,
          sharedInternalTexture: entry.original.getActiveTextures().some(original => original.getInternalTexture() === texture.getInternalTexture()) })) ?? [] })),
    }),
    dispose() { if (disposed) return; release(); disposed = true; },
  };
}
