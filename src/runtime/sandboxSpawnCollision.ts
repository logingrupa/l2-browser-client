import { characterCatalogKey, npcCatalogKey, type NativeCatalogIndex, type NativeCatalogRecord } from "../assets/native/nativeCatalogIndex";
import type { SpawnCollisionOfEntity } from "../world/NativeSliceAdapter";
import type { SourceCollisionCylinder } from "../world/worldTypes";

interface CollisionClassDefaults {
  readonly collisionRadius: number;
  readonly collisionHeight: number;
}

interface SandboxSpawnCollisionSources {
  readonly catalogIndex: NativeCatalogIndex;
  readonly npcProfiles: ReadonlyMap<string, CollisionClassDefaults>;
  readonly playerProfiles: ReadonlyMap<string, CollisionClassDefaults>;
  readonly cylinderByAppearanceId: ReadonlyMap<string, SourceCollisionCylinder>;
}

export const collisionCylinderOf = (defaults: CollisionClassDefaults): SourceCollisionCylinder =>
  ({ radius: defaults.collisionRadius, height: defaults.collisionHeight });

function convertedRecord(catalogIndex: NativeCatalogIndex, key: string): NativeCatalogRecord | null {
  const lookup = catalogIndex.lookup(key);
  return lookup.status === "converted" ? lookup.record : null;
}

export function sandboxSpawnCollision(sources: SandboxSpawnCollisionSources): SpawnCollisionOfEntity {
  const cylinderOrNull = (defaults: CollisionClassDefaults | undefined) => defaults === undefined ? null : collisionCylinderOf(defaults);
  return entity => {
    if (entity.npcId !== undefined) {
      const record = convertedRecord(sources.catalogIndex, npcCatalogKey(entity.npcId));
      return record !== null && "profileId" in record ? cylinderOrNull(sources.npcProfiles.get(record.profileId)) : null;
    }
    if (entity.characterTemplateIndex !== undefined) {
      const record = convertedRecord(sources.catalogIndex, characterCatalogKey(entity.characterTemplateIndex));
      return record !== null && "playerProfileId" in record && "chargrpIndex" in record ? cylinderOrNull(sources.playerProfiles.get(record.playerProfileId)) : null;
    }
    return entity.appearanceId === undefined ? null : sources.cylinderByAppearanceId.get(entity.appearanceId) ?? null;
  };
}
