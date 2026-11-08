import { sha256 } from "../package/readAssetPackage";
import { nativeResourceUrl } from "./nativeResourceUrl";

const nativeCatalogPath = "/l2/catalog.json";

export class NativeStoreNotStagedError extends Error {
  constructor() {
    super(`Native asset store not staged: ${nativeCatalogPath} is missing. Stage it from the main checkout.`);
    this.name = "NativeStoreNotStagedError";
  }
}

export interface NativeCatalog {
  readonly schemaVersion: 1;
  readonly models: readonly unknown[];
  readonly textures: readonly unknown[];
  readonly sections: readonly unknown[];
  readonly movers: readonly unknown[];
  readonly npcProfiles: readonly unknown[];
  readonly playerProfiles: readonly unknown[];
  readonly animationAudio: readonly unknown[];
  readonly combatAudio: readonly unknown[];
  readonly worldAudio: readonly unknown[];
  readonly effectComponents: readonly unknown[];
  readonly tables: readonly unknown[];
  readonly windows: readonly unknown[];
  readonly tiles: readonly unknown[];
  readonly sourceCatalogSha256?: string;
  readonly servedCatalogSha256: string;
}

const htmlFallbackPage = /^\s*(?:<!doctype html|<html)/i;
const sha256Pattern = /^[a-f0-9]{64}$/;
const catalogReadsBySignal = new WeakMap<AbortSignal, Promise<NativeCatalog>>();

function invalidCatalog(): Error {
  return new Error("Native asset catalog is invalid.");
}

function parseCatalogBody(body: string): unknown {
  try { return JSON.parse(body); }
  catch { throw invalidCatalog(); }
}

function decodeCatalogBytes(bytes: Uint8Array): string {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw invalidCatalog(); }
}

type OptionalCatalogSliceName = Exclude<keyof NativeCatalog, "schemaVersion" | "models" | "sourceCatalogSha256" | "servedCatalogSha256">;

function optionalCatalogSlice(catalog: Record<string, unknown>, name: OptionalCatalogSliceName): readonly unknown[] {
  const slice = catalog[name];
  if (slice === undefined) return [];
  if (!Array.isArray(slice)) throw invalidCatalog();
  return slice;
}

function optionalSourceCatalogSha256(catalog: Record<string, unknown>): { readonly sourceCatalogSha256?: string } {
  const sourceCatalogSha256 = catalog.sourceCatalogSha256;
  if (sourceCatalogSha256 === undefined) return {};
  if (typeof sourceCatalogSha256 !== "string" || !sha256Pattern.test(sourceCatalogSha256)) throw invalidCatalog();
  return { sourceCatalogSha256 };
}

function validateNativeCatalog(input: unknown, servedCatalogSha256: string): NativeCatalog {
  if (typeof input !== "object" || input === null || Array.isArray(input)) throw invalidCatalog();
  const catalog = input as Record<string, unknown>;
  if (catalog.schemaVersion !== 1 || !Array.isArray(catalog.models)) throw invalidCatalog();
  return { schemaVersion: 1, models: catalog.models,
    textures: optionalCatalogSlice(catalog, "textures"), sections: optionalCatalogSlice(catalog, "sections"),
    movers: optionalCatalogSlice(catalog, "movers"), npcProfiles: optionalCatalogSlice(catalog, "npcProfiles"),
    playerProfiles: optionalCatalogSlice(catalog, "playerProfiles"), animationAudio: optionalCatalogSlice(catalog, "animationAudio"),
    combatAudio: optionalCatalogSlice(catalog, "combatAudio"), worldAudio: optionalCatalogSlice(catalog, "worldAudio"),
    effectComponents: optionalCatalogSlice(catalog, "effectComponents"), tables: optionalCatalogSlice(catalog, "tables"),
    windows: optionalCatalogSlice(catalog, "windows"), tiles: optionalCatalogSlice(catalog, "tiles"),
    ...optionalSourceCatalogSha256(catalog), servedCatalogSha256 };
}

async function fetchNativeCatalog(signal: AbortSignal, fetchResource: typeof fetch): Promise<NativeCatalog> {
  signal.throwIfAborted();
  const response = await fetchResource(nativeResourceUrl(nativeCatalogPath), { signal });
  if (response.status === 404) throw new NativeStoreNotStagedError();
  if (!response.ok) throw new Error(`Native asset catalog returned HTTP ${response.status}.`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  signal.throwIfAborted();
  const body = decodeCatalogBytes(bytes);
  if (htmlFallbackPage.test(body)) throw new NativeStoreNotStagedError();
  const catalog = parseCatalogBody(body);
  const servedCatalogSha256 = await sha256(bytes);
  signal.throwIfAborted();
  return validateNativeCatalog(catalog, servedCatalogSha256);
}

export function readNativeCatalog(signal: AbortSignal, fetchResource: typeof fetch = fetch): Promise<NativeCatalog> {
  const pendingRead = catalogReadsBySignal.get(signal);
  if (pendingRead) return pendingRead;
  const catalogRead = fetchNativeCatalog(signal, fetchResource);
  catalogReadsBySignal.set(signal, catalogRead);
  catalogRead.catch(() => {
    if (catalogReadsBySignal.get(signal) === catalogRead) catalogReadsBySignal.delete(signal);
  });
  return catalogRead;
}

export async function readNativeCatalogUnlessNotStaged(signal: AbortSignal): Promise<NativeCatalog | null> {
  try { return await readNativeCatalog(signal); }
  catch (error) {
    if (error instanceof NativeStoreNotStagedError) return null;
    throw error;
  }
}
