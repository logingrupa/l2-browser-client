import { buildNativeCatalogIndex } from "../../../src/assets/native/nativeCatalogIndex";
import { readNativeCatalog } from "../../../src/assets/native/readNativeCatalog";

export type LoadCheckHarnessState =
  | { readonly state: "running" }
  | { readonly state: "done"; readonly convertedKeys: readonly string[] }
  | { readonly state: "failed"; readonly reason: string };

declare global {
  interface Window { __loadCheckHarness?: LoadCheckHarnessState }
}

const lifetime = new AbortController();

async function listConvertedKeys(prefix: string): Promise<readonly string[]> {
  const catalog = await readNativeCatalog(lifetime.signal);
  const index = await buildNativeCatalogIndex(catalog, lifetime.signal);
  return index.keys(prefix).filter(key => index.lookup(key).status === "converted");
}

async function runRequestedMode(): Promise<LoadCheckHarnessState> {
  const prefix = new URLSearchParams(location.search).get("list");
  if (prefix === null || prefix === "") throw new Error("the load-check harness needs ?list=<prefix>");
  return { state: "done", convertedKeys: await listConvertedKeys(prefix) };
}

window.__loadCheckHarness = { state: "running" };
void runRequestedMode().then(
  state => { window.__loadCheckHarness = state; },
  error => { window.__loadCheckHarness = { state: "failed", reason: error instanceof Error ? error.message : String(error) }; });
