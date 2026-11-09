import { loadConvertedNpcModel } from "../../../src/assets/native/loadConvertedNpcModel";
import { loadNativeNpcProfiles, type NativeNpcProfile } from "../../../src/assets/native/loadNativeNpcProfiles";
import { buildNativeCatalogIndex, npcCatalogKey, type NativeCatalogLookup, type NativeNpcCatalogRecord } from "../../../src/assets/native/nativeCatalogIndex";
import { readNativeCatalog, type NativeCatalog } from "../../../src/assets/native/readNativeCatalog";
import { createPackagePreview, type PackagePreview } from "../../../src/assets/package/PackagePreview";

export interface NativeNpcHarnessEntry {
  readonly key: string;
  readonly status: NativeCatalogLookup["status"] | "failed";
  readonly reason: string | null;
  readonly modelCatalogId: string | null;
  readonly clips: PackagePreview["clips"];
  readonly preview: ReturnType<PackagePreview["snapshot"]> | null;
}

export interface NativeNpcHarness {
  readonly ready: Promise<void>;
  snapshot(): readonly NativeNpcHarnessEntry[];
  play(key: string, clipIndex: number): void;
}

declare global {
  interface Window { __nativeNpcHarness?: NativeNpcHarness }
}

interface SpawnedNpc {
  readonly key: string;
  readonly status: NativeNpcHarnessEntry["status"];
  readonly reason: string | null;
  readonly modelCatalogId: string | null;
  readonly preview: PackagePreview | null;
}

const npcIdQueryPattern = /^[0-9]{1,10}$/;
const previewHostStyle = "position: relative; width: 640px; max-width: 100%; height: 360px";
const harnessContainer = document.getElementById("native-npc-harness");
if (!(harnessContainer instanceof HTMLElement)) throw new Error("Native NPC harness page is missing #native-npc-harness.");
const container = harnessContainer;
const spawnedNpcs: SpawnedNpc[] = [];
const lifetime = new AbortController();

function requestedNpcKeys(): string[] {
  return new URLSearchParams(location.search).getAll("npc").map(value => {
    if (!npcIdQueryPattern.test(value)) throw new RangeError(`?npc= must match ${npcIdQueryPattern.source}`);
    return npcCatalogKey(Number(value));
  });
}

function npcElement(key: string): HTMLElement {
  const element = document.createElement("section");
  element.setAttribute("data-npc-key", key);
  container.append(element);
  return element;
}

function showMarker(element: HTMLElement, key: string, status: string, reason: string): void {
  const marker = document.createElement("p");
  marker.setAttribute("data-npc-marker", status);
  marker.textContent = `${key} ${status}: ${reason}`;
  element.append(marker);
}

async function spawnConvertedNpc(catalog: NativeCatalog, profiles: ReadonlyMap<string, NativeNpcProfile>, key: string,
  record: NativeNpcCatalogRecord, element: HTMLElement): Promise<SpawnedNpc> {
  const profile = profiles.get(record.profileId);
  if (!profile) throw new Error(`NPC profile ${record.profileId} is not loaded.`);
  const asset = await loadConvertedNpcModel(catalog, record, profile, lifetime.signal);
  const host = document.createElement("div");
  host.setAttribute("data-npc-preview", key);
  host.setAttribute("style", previewHostStyle);
  element.append(host);
  const preview = await createPackagePreview(asset, host, lifetime.signal);
  preview.element.style.visibility = "visible";
  return { key, status: "converted", reason: null, modelCatalogId: record.modelCatalogId, preview };
}

async function spawnNpc(catalog: NativeCatalog, profiles: ReadonlyMap<string, NativeNpcProfile>, lookup: NativeCatalogLookup): Promise<SpawnedNpc> {
  const element = npcElement(lookup.key);
  try {
    if (lookup.status === "converted") {
      if (!("modelCatalogId" in lookup.record)) throw new Error(`${lookup.key} resolved to a record that is not an NPC model record.`);
      return await spawnConvertedNpc(catalog, profiles, lookup.key, lookup.record, element);
    }
    showMarker(element, lookup.key, lookup.status, lookup.reason);
    return { key: lookup.key, status: lookup.status, reason: lookup.reason, modelCatalogId: null, preview: null };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    showMarker(element, lookup.key, "failed", reason);
    return { key: lookup.key, status: "failed", reason, modelCatalogId: null, preview: null };
  }
}

async function spawnRequestedNpcs(): Promise<void> {
  const keys = requestedNpcKeys();
  const catalog = await readNativeCatalog(lifetime.signal);
  const index = await buildNativeCatalogIndex(catalog, lifetime.signal);
  const profiles = await loadNativeNpcProfiles(catalog.npcProfiles, lifetime.signal);
  for (const key of keys) spawnedNpcs.push(await spawnNpc(catalog, profiles, index.lookup(key)));
}

function spawnedPreview(key: string): PackagePreview {
  const preview = spawnedNpcs.find(candidate => candidate.key === key)?.preview;
  if (!preview) throw new Error(`${key} has no converted preview on the harness page.`);
  return preview;
}

const ready = spawnRequestedNpcs().then(
  () => container.setAttribute("data-status", "ready"),
  error => {
    container.setAttribute("data-status", "failed");
    container.setAttribute("data-failure", error instanceof Error ? error.message : String(error));
  });

window.__nativeNpcHarness = {
  ready,
  snapshot: () => spawnedNpcs.map(spawned => ({ key: spawned.key, status: spawned.status, reason: spawned.reason,
    modelCatalogId: spawned.modelCatalogId, clips: spawned.preview?.clips ?? [], preview: spawned.preview?.snapshot() ?? null })),
  play: (key, clipIndex) => spawnedPreview(key).play(clipIndex),
};
