import { Scene } from "@babylonjs/core/scene";
import { loadConvertedNpcModel } from "../../../src/assets/native/loadConvertedNpcModel";
import { loadNativeModelPackages } from "../../../src/assets/native/loadNativeCatalog";
import { loadNativeNpcProfiles } from "../../../src/assets/native/loadNativeNpcProfiles";
import { NativeActor } from "../../../src/assets/native/NativeActor";
import {
  buildNativeCatalogIndex, type NativeCatalogRecord, type NativeItemCatalogRecord, type NativeNpcCatalogRecord, type NativeSkillCatalogRecord,
} from "../../../src/assets/native/nativeCatalogIndex";
import { readNativeCatalog, type NativeCatalog } from "../../../src/assets/native/readNativeCatalog";
import { createPackagePreview, type PackagePreview } from "../../../src/assets/package/PackagePreview";
import type { AssetPackage } from "../../../src/assets/package/readAssetPackage";
import { loadEffectComponent, type LoadedEffectComponent } from "../../../src/effects/loadEffectComponent";
import { loadNativeEffectComponents } from "../../../src/effects/nativeEffectComponents";
import { createWebGPUEngine } from "../../../src/engine/createWebGPUEngine";

export interface LoadCheckHarnessKeyResult {
  readonly assetManifestSchemaVersions: readonly AssetPackage["manifest"]["schemaVersion"][];
}

export type LoadCheckHarnessState =
  | { readonly state: "running" }
  | { readonly state: "done"; readonly convertedKeys: readonly string[] }
  | { readonly state: "done"; readonly result: LoadCheckHarnessKeyResult }
  | { readonly state: "failed"; readonly reason: string };

declare global {
  interface Window { __loadCheckHarness?: LoadCheckHarnessState }
}

interface LoadCheckPage {
  readonly catalog: NativeCatalog;
  readonly signal: AbortSignal;
  readonly host: HTMLElement;
  scene(): Promise<Scene>;
}

const lifetime = new AbortController();

function requiredElement<ElementType extends HTMLElement>(id: string, elementType: { new(): ElementType }): ElementType {
  const element = document.getElementById(id);
  if (!(element instanceof elementType)) throw new Error(`Load-check harness page is missing #${id}.`);
  return element;
}

function lazyScene(canvas: HTMLCanvasElement): () => Promise<Scene> {
  let scene: Promise<Scene> | null = null;
  return () => {
    scene ??= createWebGPUEngine(canvas).then(engine => new Scene(engine));
    return scene;
  };
}

async function fetchVerifiedAssetPackage(catalog: NativeCatalog, catalogId: string, signal: AbortSignal): Promise<AssetPackage> {
  const asset = (await loadNativeModelPackages(catalog, signal, [catalogId])).get(catalogId);
  if (asset === undefined) throw new Error(`model ${catalogId} is not in the served catalog`);
  return asset;
}

function isNpcRecord(record: NativeCatalogRecord): record is NativeNpcCatalogRecord {
  return "npcId" in record && "modelCatalogId" in record;
}

function isItemRecord(record: NativeCatalogRecord): record is NativeItemCatalogRecord {
  return "itemId" in record && "catalogIds" in record;
}

function isSkillRecord(record: NativeCatalogRecord): record is NativeSkillCatalogRecord {
  return "skillId" in record && "effectComponentId" in record;
}

export async function checkNpcLoadKey(page: LoadCheckPage, key: string, record: NativeNpcCatalogRecord): Promise<LoadCheckHarnessKeyResult> {
  const profile = (await loadNativeNpcProfiles(page.catalog.npcProfiles, page.signal)).get(record.profileId);
  if (profile === undefined) throw new Error(`${key} names NPC profile ${record.profileId}, which is not loaded`);
  const asset = await loadConvertedNpcModel(page.catalog, record, profile, page.signal);
  const actor = await NativeActor.create(await page.scene(), asset, page.signal);
  try {
    if (!actor.ownedMeshes().some(mesh => mesh.getTotalVertices() > 0)) throw new Error(`${key} built a NativeActor without a mesh with vertices`);
  } finally {
    actor.dispose();
  }
  return { assetManifestSchemaVersions: [asset.manifest.schemaVersion] };
}

export async function checkItemLoadKey(page: LoadCheckPage, key: string, record: NativeItemCatalogRecord): Promise<LoadCheckHarnessKeyResult> {
  if (record.catalogIds.length === 0) throw new Error(`${key} names no model archive`);
  const previews: PackagePreview[] = [];
  const versions: AssetPackage["manifest"]["schemaVersion"][] = [];
  try {
    for (const catalogId of record.catalogIds) {
      const asset = await fetchVerifiedAssetPackage(page.catalog, catalogId, page.signal);
      previews.push(await createPackagePreview(asset, page.host, page.signal));
      versions.push(asset.manifest.schemaVersion);
    }
  } finally {
    for (const preview of previews) preview.dispose();
  }
  return { assetManifestSchemaVersions: versions };
}

export async function checkSkillLoadKey(page: LoadCheckPage, key: string, record: NativeSkillCatalogRecord): Promise<LoadCheckHarnessKeyResult> {
  const bundle = await loadNativeEffectComponents(page.signal);
  if (bundle === null || (bundle.manifest.bundleId ?? bundle.manifest.id) !== record.effectComponentId) {
    throw new Error(`effect component ${record.effectComponentId} is not in the served bundle`);
  }
  if (bundle.manifest.components.length === 0) throw new Error(`${key} effect component ${record.effectComponentId} has no emitter components`);
  const scene = await page.scene();
  const loadedComponents: LoadedEffectComponent[] = [];
  try {
    for (const component of bundle.manifest.components) {
      loadedComponents.push(await loadEffectComponent(scene, bundle, component, { frameIndex: 0 }, page.signal));
    }
  } finally {
    for (const loaded of loadedComponents) loaded.dispose();
  }
  return { assetManifestSchemaVersions: [] };
}

async function checkKey(page: LoadCheckPage, key: string): Promise<LoadCheckHarnessKeyResult> {
  const lookup = (await buildNativeCatalogIndex(page.catalog, page.signal)).lookup(key);
  if (lookup.status !== "converted") throw new Error(`${key} is ${lookup.status}: ${lookup.reason}`);
  const record = lookup.record;
  if (key.startsWith("npc:") && isNpcRecord(record)) return checkNpcLoadKey(page, key, record);
  if (key.startsWith("item:") && isItemRecord(record)) return checkItemLoadKey(page, key, record);
  if (key.startsWith("skill:") && isSkillRecord(record)) return checkSkillLoadKey(page, key, record);
  throw new Error(`the load-check harness checks npc:, item: and skill: keys; ${key} is not one of them`);
}

async function listConvertedKeys(catalog: NativeCatalog, prefix: string): Promise<readonly string[]> {
  const index = await buildNativeCatalogIndex(catalog, lifetime.signal);
  return index.keys(prefix).filter(key => index.lookup(key).status === "converted");
}

async function runRequestedMode(): Promise<LoadCheckHarnessState> {
  const parameters = new URLSearchParams(location.search);
  const prefix = parameters.get("list"), key = parameters.get("key");
  if ((prefix === null) === (key === null) || prefix === "" || key === "") {
    throw new Error("the load-check harness needs exactly one of ?list=<prefix> or ?key=<key>");
  }
  const catalog = await readNativeCatalog(lifetime.signal);
  if (prefix !== null) return { state: "done", convertedKeys: await listConvertedKeys(catalog, prefix) };
  const page: LoadCheckPage = {
    catalog, signal: lifetime.signal, host: requiredElement("load-check-host", HTMLElement),
    scene: lazyScene(requiredElement("load-check-canvas", HTMLCanvasElement)),
  };
  return { state: "done", result: await checkKey(page, key!) };
}

window.__loadCheckHarness = { state: "running" };
void runRequestedMode().then(
  state => { window.__loadCheckHarness = state; },
  error => { window.__loadCheckHarness = { state: "failed", reason: error instanceof Error ? error.message : String(error) }; });
