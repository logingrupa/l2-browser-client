import type { AssetPackage } from "../package/readAssetPackage";
import { loadNativeModelPackages } from "./loadNativeCatalog";
import { itemCatalogKey, type NativeCatalogIndex, type NativeCatalogLookup } from "./nativeCatalogIndex";
import type { NativeCatalog } from "./readNativeCatalog";

export interface NativeEquippedItemSource {
  lookup(itemId: number, signal: AbortSignal): Promise<NativeCatalogLookup>;
  loadModel(catalogId: string, signal: AbortSignal): Promise<AssetPackage>;
}

export function catalogEquippedItemSource(catalog: NativeCatalog, catalogIndex: NativeCatalogIndex): NativeEquippedItemSource {
  return {
    async lookup(itemId, signal) {
      signal.throwIfAborted();
      return catalogIndex.lookup(itemCatalogKey(itemId));
    },
    async loadModel(catalogId, signal) {
      const asset = (await loadNativeModelPackages(catalog, signal, [catalogId])).get(catalogId);
      if (!asset) throw new Error(`model ${catalogId} is not in the served catalog`);
      return asset;
    },
  };
}
