import { describeNativeCatalogLookup, windowCatalogKey, type NativeCatalogIndex, type NativeCatalogLookup } from "../../assets/native/nativeCatalogIndex";

export interface NativeWindowRegistryEntry {
  readonly windowId: string;
  readonly key: string;
  readonly status: "converted" | "gap" | "not-in-catalog";
  readonly reason: string | null;
  readonly description: string;
}

const windowKeyPrefix = "window:";
const windowOrdinalSeparator = "#";

interface WindowIdOrder { readonly baseName: string; readonly ordinal: number }

function windowIdOrder(windowId: string): WindowIdOrder {
  const separatorIndex = windowId.indexOf(windowOrdinalSeparator);
  if (separatorIndex < 0) return { baseName: windowId, ordinal: 0 };
  return { baseName: windowId.slice(0, separatorIndex), ordinal: Number(windowId.slice(separatorIndex + 1)) };
}

function compareCodePoints(left: string, right: string): number {
  const leftCodePoints = Array.from(left, character => character.codePointAt(0)!);
  const rightCodePoints = Array.from(right, character => character.codePointAt(0)!);
  for (let position = 0; position < Math.min(leftCodePoints.length, rightCodePoints.length); position += 1) {
    const difference = leftCodePoints[position]! - rightCodePoints[position]!;
    if (difference !== 0) return difference;
  }
  return leftCodePoints.length - rightCodePoints.length;
}

function compareRegistryEntries(left: NativeWindowRegistryEntry, right: NativeWindowRegistryEntry): number {
  const leftOrder = windowIdOrder(left.windowId), rightOrder = windowIdOrder(right.windowId);
  return compareCodePoints(leftOrder.baseName, rightOrder.baseName) || leftOrder.ordinal - rightOrder.ordinal;
}

function registryStatus(lookup: NativeCatalogLookup): NativeWindowRegistryEntry["status"] {
  if (lookup.status === "gap" && lookup.coverageStatus === "pending") return "not-in-catalog";
  return lookup.status;
}

function registryEntry(catalogIndex: NativeCatalogIndex, key: string): NativeWindowRegistryEntry {
  const windowId = key.slice(windowKeyPrefix.length);
  if (windowCatalogKey(windowId) !== key) throw new RangeError(`Catalog window key ${key} does not round-trip.`);
  const lookup = catalogIndex.lookup(key);
  if (lookup.key !== key) throw new Error(`Catalog lookup of ${key} answered for ${lookup.key}.`);
  return { windowId, key, status: registryStatus(lookup), reason: lookup.status === "converted" ? null : lookup.reason,
    description: describeNativeCatalogLookup(lookup) };
}

export function buildNativeWindowRegistry(catalogIndex: NativeCatalogIndex): readonly NativeWindowRegistryEntry[] {
  return catalogIndex.keys(windowKeyPrefix).map(key => registryEntry(catalogIndex, key)).sort(compareRegistryEntries);
}
