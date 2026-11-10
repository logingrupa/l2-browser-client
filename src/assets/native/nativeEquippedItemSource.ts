import type { AssetPackage } from "../package/readAssetPackage";
import { loadNativeModelPackages } from "./loadNativeCatalog";
import { buildNativeCatalogIndex, itemCatalogKey, type NativeCatalogIndex, type NativeCatalogLookup } from "./nativeCatalogIndex";
import { readNativeCatalog, type NativeCatalog } from "./readNativeCatalog";

export interface NativeEquippedItemSource {
  lookup(itemId: number, signal: AbortSignal): Promise<NativeCatalogLookup>;
  loadModel(catalogId: string, signal: AbortSignal): Promise<AssetPackage>;
}

interface ServedItemCatalog {
  readonly catalog: NativeCatalog;
  readonly index: NativeCatalogIndex;
}

async function readServedItemCatalog(): Promise<ServedItemCatalog> {
  const unaborted = new AbortController().signal;
  const catalog = await readNativeCatalog(unaborted);
  return { catalog, index: await buildNativeCatalogIndex(catalog, unaborted) };
}

export function servedCatalogEquippedItemSource(): NativeEquippedItemSource {
  let served: Promise<ServedItemCatalog> | undefined;
  const servedItemCatalog = (signal: AbortSignal) => {
    served ??= readServedItemCatalog().catch((error: unknown) => { served = undefined; throw error; });
    return served.then(value => { signal.throwIfAborted(); return value; });
  };
  return {
    async lookup(itemId, signal) {
      return (await servedItemCatalog(signal)).index.lookup(itemCatalogKey(itemId));
    },
    async loadModel(catalogId, signal) {
      const asset = (await loadNativeModelPackages((await servedItemCatalog(signal)).catalog, signal, [catalogId])).get(catalogId);
      if (!asset) throw new Error(`model ${catalogId} is not in the served catalog`);
      return asset;
    },
  };
}
