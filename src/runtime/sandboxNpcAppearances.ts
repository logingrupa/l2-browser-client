import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { NativeCharacterProfile } from "../assets/native/NativeCharacterVisual";
import { loadConvertedNpcModel } from "../assets/native/loadConvertedNpcModel";
import type { NativeNpcProfile } from "../assets/native/loadNativeNpcProfiles";
import type { NativeNpcCatalogRecord } from "../assets/native/nativeCatalogIndex";
import type { NativeCatalog } from "../assets/native/readNativeCatalog";
import type { SandboxAppearanceOfNpc } from "./sandboxNpcVisual";

export const nativeNpcStateClips: NativeCharacterProfile["clips"] = { idle: "Wait", run: "run", attack: "atk01", death: "death" };

export interface SandboxNpcAppearanceSources {
  readonly catalog: NativeCatalog;
  readonly npcProfiles: ReadonlyMap<string, NativeNpcProfile>;
  readonly loadedAppearanceByModel: ReadonlyMap<string, string>;
  readonly characterProfiles: Map<string, NativeCharacterProfile>;
}

export function hasUnappliedActorPivot(npcProfile: NativeNpcProfile): boolean {
  return npcProfile.prePivot?.some(value => value !== 0) ?? false;
}

export function nativeNpcCharacterProfile(npcProfile: NativeNpcProfile, asset: NativeCharacterProfile["asset"]): NativeCharacterProfile {
  const [scaleX, scaleY, scaleZ] = npcProfile.drawScale3D;
  return { asset, clips: nativeNpcStateClips, collisionHalfHeight: npcProfile.collisionHeight / npcProfile.sourceUnitsPerMetre,
    actorScale: new Vector3(scaleX, scaleZ, scaleY).scale(npcProfile.drawScale) };
}

export function convertedNpcAppearanceId(record: NativeNpcCatalogRecord): string {
  return `native-npc:${record.npcId}`;
}

export function sandboxNpcAppearances(sources: SandboxNpcAppearanceSources): SandboxAppearanceOfNpc {
  return record => {
    const loadedAppearanceId = sources.loadedAppearanceByModel.get(record.modelCatalogId);
    if (loadedAppearanceId !== undefined) return { appearanceId: loadedAppearanceId };
    const npcProfile = sources.npcProfiles.get(record.profileId);
    if (npcProfile === undefined) return { unavailableReason: `profile ${record.profileId} is not in the served NPC profiles` };
    if (hasUnappliedActorPivot(npcProfile)) return { unavailableReason: `profile ${record.profileId} has an actor pivot the sandbox does not apply` };
    const appearanceId = convertedNpcAppearanceId(record);
    if (!sources.characterProfiles.has(appearanceId)) {
      sources.characterProfiles.set(appearanceId, nativeNpcCharacterProfile(npcProfile,
        signal => loadConvertedNpcModel(sources.catalog, record, npcProfile, signal)));
    }
    return { appearanceId };
  };
}
