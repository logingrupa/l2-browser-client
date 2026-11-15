import { buildNativeCatalogIndex, unavailableNativeCatalogIndex, type NativeCatalogIndex } from "../assets/native/nativeCatalogIndex";
import type { NativeCatalog } from "../assets/native/readNativeCatalog";
import { failureText } from "./settledTasks";

export interface NativeCatalogIndexOutcome {
  readonly catalogIndex: NativeCatalogIndex;
  readonly catalogIndexFailure: string | null;
}

export async function buildNativeCatalogIndexOrUnavailable(catalog: NativeCatalog, signal: AbortSignal): Promise<NativeCatalogIndexOutcome> {
  try {
    return { catalogIndex: await buildNativeCatalogIndex(catalog, signal), catalogIndexFailure: null };
  } catch (error) {
    signal.throwIfAborted();
    const failure = failureText(error, "The native catalog index could not be built.");
    return { catalogIndex: unavailableNativeCatalogIndex(failure), catalogIndexFailure: failure };
  }
}
