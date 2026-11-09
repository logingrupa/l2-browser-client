import type { AssetPackage } from "../package/readAssetPackage";
import { loadNativeModelPackages } from "./loadNativeCatalog";
import type { NativeNpcProfile } from "./loadNativeNpcProfiles";
import type { NativeNpcCatalogRecord } from "./nativeCatalogIndex";
import type { NativeCatalog } from "./readNativeCatalog";

export async function loadConvertedNpcModel(catalog: NativeCatalog, record: NativeNpcCatalogRecord, profile: NativeNpcProfile,
  signal: AbortSignal): Promise<AssetPackage> {
  const asset = (await loadNativeModelPackages(catalog, signal, [record.modelCatalogId])).get(record.modelCatalogId);
  if (!asset) throw new Error(`Converted NPC model ${record.modelCatalogId} is not in the catalog.`);
  if (asset.manifest.source.object !== profile.mesh) throw new Error("Converted NPC model source differs from its profile mesh.");
  return asset;
}
