import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { NativeCharacterProfile } from "../assets/native/NativeCharacterVisual";
import { loadNativeModelPackages } from "../assets/native/loadNativeCatalog";
import { validateNativePlayerAssets, type NativePlayerProfile } from "../assets/native/loadNativePlayerProfiles";
import type { NativeCatalog } from "../assets/native/readNativeCatalog";
import type { AssetPackage } from "../assets/package/readAssetPackage";
import type { SandboxAppearanceOfCharacterRecord } from "./sandboxCharacterVisual";

export interface SandboxCharacterAppearanceSources {
  readonly catalog: NativeCatalog;
  readonly playerProfiles: ReadonlyMap<string, NativePlayerProfile>;
  readonly loadedAppearanceByProfile: ReadonlyMap<string, string>;
  readonly characterProfiles: Map<string, NativeCharacterProfile>;
}

export function servedPlayerAppearanceId(profileId: string): string {
  return `native-player:${profileId}`;
}

export async function loadServedPlayerModel(catalog: NativeCatalog, profile: NativePlayerProfile, signal: AbortSignal): Promise<AssetPackage> {
  const assets = await loadNativeModelPackages(catalog, signal, [profile.catalogId]);
  validateNativePlayerAssets(profile, assets);
  return assets.get(profile.catalogId)!;
}

export function servedPlayerCharacterProfile(profile: NativePlayerProfile, asset: NativeCharacterProfile["asset"]): NativeCharacterProfile {
  return { asset, clips: profile.clips, forwardAxis: Vector3.FromArray(profile.forwardAxis), actorScale: Vector3.FromArray(profile.actorScale),
    collisionHalfHeight: profile.collisionHeight / profile.sourceUnitsPerMetre };
}

export function sandboxCharacterAppearances(sources: SandboxCharacterAppearanceSources): SandboxAppearanceOfCharacterRecord {
  return record => {
    const loadedAppearanceId = sources.loadedAppearanceByProfile.get(record.playerProfileId);
    if (loadedAppearanceId !== undefined) return { appearanceId: loadedAppearanceId };
    const profile = sources.playerProfiles.get(record.playerProfileId);
    if (profile === undefined) return { unavailableReason: `player profile ${record.playerProfileId} is not in the served player profiles` };
    const appearanceId = servedPlayerAppearanceId(profile.id);
    if (!sources.characterProfiles.has(appearanceId)) {
      sources.characterProfiles.set(appearanceId, servedPlayerCharacterProfile(profile, signal => loadServedPlayerModel(sources.catalog, profile, signal)));
    }
    return { appearanceId };
  };
}
