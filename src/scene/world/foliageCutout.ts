// Adapted from the audited local Lineagen terrain preview; see docs/WORLD_ASSETS.md.
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { Material } from '@babylonjs/core/Materials/material';
import type { AssetContainer } from '@babylonjs/core/assetContainer';

/** Explicit visual repair for four audited opaque leaf cards. The retained
 * source materials contain _AlphaClipThreshold=.5 but omit _AlphaClip; their
 * shader is not recovered. This cutout approximation does not claim to recreate
 * Unity wind/lighting. Original GLBs, textures and bark remain unchanged. */
const obRepairs: Record<string, { sHash: string; arMaterials: readonly string[] }> = {
  spLand_Legend_tree01_ac6c9d508f: {
    sHash: '6e83aed096e31b779a2cf6de6bf4fcb4ece308e6f3aa7feabdb2c22826660aaa',
    arMaterials: ['7d1ae4ee8cf6fff4b8acc31af6908918', '7b7694b6e3e52994e8f29303ac522434', '71919eff66d9ffa45b846db6f9f9c5e3'],
  },
  splandddztree1_4ad8c30e4b: {
    sHash: 'f37a253110fdd229493819e54c44420c9afcf80399e98810f79524f76cceb043',
    arMaterials: ['e41a83c8f74b7854da4f2af0542a790a'],
  },
};

/** Invoke immediately after GLB loading, before instances/material readiness caching. */
export function fnRepairFoliageCutouts(obContainer: Pick<AssetContainer, 'materials'>,
  sModelId: string, sModelSha256: string): number {
  const obRepair = obRepairs[sModelId];
  if (!obRepair || obRepair.sHash !== sModelSha256) return 0;
  const arTargets = obRepair.arMaterials.map(sGuid => obContainer.materials.find(obMaterial => obMaterial.name === sGuid));
  // Validate the entire known variant before mutating any of its materials.
  if (arTargets.some(obMaterial => !(obMaterial instanceof PBRMaterial) || !obMaterial.albedoTexture)) {
    throw new Error(`Audited foliage material/texture missing: ${sModelId}`);
  }
  for (const obTarget of arTargets) {
    const obMaterial = obTarget as PBRMaterial;
    obMaterial.albedoTexture!.hasAlpha = true;
    obMaterial.useAlphaFromAlbedoTexture = true;
    obMaterial.transparencyMode = Material.MATERIAL_ALPHATEST;
    obMaterial.alphaCutOff = .5;
    // Leaf cards must be visible from below as well as above. This is explicit
    // preview repair policy, not an inferred source culling setting.
    obMaterial.backFaceCulling = false;
    obMaterial.twoSidedLighting = true;
  }
  return arTargets.length;
}
