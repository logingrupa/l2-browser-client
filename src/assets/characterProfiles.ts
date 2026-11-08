import type { WorldEntity } from "../world/worldTypes";

export const nativeAppearanceProfiles: Readonly<Record<string, string>> = {
  MFighter: "human-male-fighter",
  FFighter: "human-female-fighter",
  MMagic: "human-male-mystic",
  FMagic: "human-female-mystic",
};

export function nativeAppearanceProfileId(entity: WorldEntity): string | undefined {
  return entity.appearanceId && Object.hasOwn(nativeAppearanceProfiles, entity.appearanceId)
    ? nativeAppearanceProfiles[entity.appearanceId] : undefined;
}
