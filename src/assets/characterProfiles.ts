import type { CharacterAnimationProfile } from "../animation/ModelAnimator";
import type { WorldEntity } from "../world/worldTypes";

export interface CharacterModelProfile {
  readonly id: string;
  readonly resource: { readonly url: string };
  readonly metresPerUnit: number;
  readonly facingYawRadians: number;
  readonly animations?: CharacterAnimationProfile;
}

export const nativeAppearanceProfiles: Readonly<Record<string, string>> = {
  MFighter: "human-male-fighter",
  FFighter: "human-female-fighter",
  MMagic: "human-male-mystic",
  FMagic: "human-female-mystic",
};

export function nativeAppearanceProfileId(entity: WorldEntity): string | undefined {
  return !entity.modelUrl && entity.appearanceId && Object.hasOwn(nativeAppearanceProfiles, entity.appearanceId)
    ? nativeAppearanceProfiles[entity.appearanceId] : undefined;
}

export function resolveCharacterProfile(entity: WorldEntity): CharacterModelProfile | undefined {
  return entity.modelUrl ? { id: entity.modelUrl, resource: { url: entity.modelUrl }, metresPerUnit: 1, facingYawRadians: 0 } : undefined;
}
