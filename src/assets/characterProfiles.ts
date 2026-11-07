import type { CharacterAnimationProfile } from "../animation/ModelAnimator";
import type { WorldEntity } from "../world/worldTypes";

/** Presentation data, independent of adapter/protocol details. */
export interface CharacterModelProfile {
  readonly id: string;
  readonly resource: { readonly url: string };
  /** Conversion outputs already use metres and grounded origins. Never fit to bounds. */
  readonly metresPerUnit: number;
  readonly facingYawRadians: number;
  readonly animations?: CharacterAnimationProfile;
}

// Verified unarmed family only. Equipment families must supply their own mapping.
const unarmedAnimations: CharacterAnimationProfile = {
  idle: { name: "wait_Hand", loop: true, transitionSeconds: 0.18 },
  run: { name: "run_Hand", loop: true, transitionSeconds: 0.12 },
  attack: { name: "Atk01_Hand", loop: false, transitionSeconds: 0.08 },
};

export const characterProfiles: Readonly<Record<string, CharacterModelProfile>> = Object.fromEntries(
  ["MFighter", "FFighter", "MMagic", "FMagic"].map(id => [id, {
    id, resource: { url: `/assets/characters/${id}.glb` },
    metresPerUnit: 1, facingYawRadians: 0, animations: unarmedAnimations,
  }]),
);

export function resolveCharacterProfile(entity: WorldEntity): CharacterModelProfile | undefined {
  // Explicit ad-hoc URLs remain useful for failures and independent model fixtures.
  if (entity.modelUrl) return { id: entity.modelUrl, resource: { url: entity.modelUrl }, metresPerUnit: 1, facingYawRadians: 0 };
  return entity.appearanceId && Object.hasOwn(characterProfiles, entity.appearanceId) ? characterProfiles[entity.appearanceId] : undefined;
}
