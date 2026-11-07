import { readAssetPackage, sha256, type AssetPackage } from "../package/readAssetPackage";
import { nativeResourceUrl } from "./nativeResourceUrl";
import { loadNativeNpcProfiles } from "./loadNativeNpcProfiles";
import { defaultNativePlayerProfile, loadNativePlayerProfiles, validateNativePlayerAssets } from "./loadNativePlayerProfiles";

async function readCatalog(signal: AbortSignal) {
  const response = await fetch(nativeResourceUrl("/l2/catalog.json"), { signal });
  if (!response.ok) throw new Error("The native asset catalog is unavailable. Restore its verified staged assets.");
  const catalog: unknown = await response.json();
  if (typeof catalog !== "object" || !catalog || !("schemaVersion" in catalog) || catalog.schemaVersion !== 1 ||
    !("models" in catalog) || !Array.isArray(catalog.models)) throw new Error("Native model catalog is invalid.");
  return { models: catalog.models as unknown[], npcProfiles: "npcProfiles" in catalog ? catalog.npcProfiles : [],
    playerProfiles: "playerProfiles" in catalog ? catalog.playerProfiles : [],
    animationAudio: "animationAudio" in catalog ? catalog.animationAudio : [] };
}

async function loadModels(catalog: { models: unknown[] }, signal: AbortSignal,
  wanted: readonly string[] = ["human-male-fighter:0", "fighter-equipment:0", "musveren:0"]): Promise<ReadonlyMap<string, AssetPackage>> {
  const result = new Map<string, AssetPackage>(), ids = new Set<string>();
  for (const record of catalog.models as unknown[]) {
    if (typeof record !== "object" || !record || !("id" in record) || typeof record.id !== "string" ||
      !("archive" in record) || typeof record.archive !== "string" || !/^\/l2\/[a-f0-9]{64}\/asset\.l2asset$/.test(record.archive) ||
      !("archiveSha256" in record) || typeof record.archiveSha256 !== "string" || !/^[a-f0-9]{64}$/.test(record.archiveSha256) ||
      record.archive !== `/l2/${record.archiveSha256}/asset.l2asset` || ids.has(record.id)) throw new Error("Native catalog entry is invalid.");
    ids.add(record.id);
    if (!wanted.includes(record.id)) continue;
    const archive = await fetch(nativeResourceUrl(record.archive), { signal });
    if (!archive.ok) throw new Error(`Native package request returned ${archive.status}.`);
    const bytes = new Uint8Array(await archive.arrayBuffer());
    if (await sha256(bytes) !== record.archiveSha256) throw new Error("Native catalog archive hash mismatch.");
    const asset = await readAssetPackage(bytes);
    signal.throwIfAborted(); result.set(record.id, asset);
  }
  return result;
}

export async function loadNativeCatalog(signal: AbortSignal): Promise<ReadonlyMap<string, AssetPackage>> {
  return loadModels(await readCatalog(signal), signal);
}

export async function loadNativeActorCatalog(signal: AbortSignal, profileId = defaultNativePlayerProfile.id) {
  const catalog = await readCatalog(signal);
  const playerProfiles = await loadNativePlayerProfiles(catalog.playerProfiles, signal), playerProfile = playerProfiles.get(profileId);
  if (!playerProfile) throw new Error(`Native player profile ${profileId} is not staged.`);
  const models = await loadModels(catalog, signal, [playerProfile.catalogId, ...playerProfile.upperItems.map(item => item.catalogId), "musveren:0"]);
  validateNativePlayerAssets(playerProfile, models);
  const npcProfiles = await loadNativeNpcProfiles("npcProfiles" in catalog ? catalog.npcProfiles : [], signal);
  const archiveHashes = new Map((catalog.models as { id: string; archiveSha256: string }[])
    .filter(record => models.has(record.id)).map(record => [record.id, record.archiveSha256]));
  return { models, npcProfiles, playerProfiles, playerProfile, archiveHashes, animationAudio: catalog.animationAudio };
}
