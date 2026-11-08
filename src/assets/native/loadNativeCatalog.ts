import { readAssetPackage, sha256, type AssetPackage } from "../package/readAssetPackage";
import { nativeResourceUrl } from "./nativeResourceUrl";
import { loadNativeNpcProfiles } from "./loadNativeNpcProfiles";
import { defaultNativePlayerProfile, loadNativePlayerProfiles, validateNativePlayerAssets, type NativePlayerProfile } from "./loadNativePlayerProfiles";
import { readNativeCatalog, type NativeCatalog } from "./readNativeCatalog";

async function loadModels(catalog: NativeCatalog, signal: AbortSignal, wanted: readonly string[]): Promise<ReadonlyMap<string, AssetPackage>> {
  const result = new Map<string, AssetPackage>(), ids = new Set<string>();
  for (const record of catalog.models) {
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

export async function loadNativePlayerPackages(signal: AbortSignal, profileIds: readonly string[]) {
  const catalog = await readNativeCatalog(signal);
  const playerProfiles = await loadNativePlayerProfiles(catalog.playerProfiles, signal);
  const staged = profileIds.flatMap(id => playerProfiles.get(id) ?? []);
  const models = await loadModels(catalog, signal, [...new Set(staged.flatMap(profile => [profile.catalogId, ...profile.upperItems.map(item => item.catalogId)]))]);
  const profiles = new Map<string, NativePlayerProfile>(), failures = new Map<string, string>();
  for (const id of profileIds) {
    const profile = playerProfiles.get(id);
    if (!profile) { failures.set(id, `Native player profile ${id} is not staged.`); continue; }
    try { validateNativePlayerAssets(profile, models); profiles.set(id, profile); }
    catch (error) { failures.set(id, error instanceof Error ? error.message : `Native player profile ${id} is invalid.`); }
  }
  return { profiles, models, failures };
}

export async function loadNativeActorCatalog(signal: AbortSignal, profileId = defaultNativePlayerProfile.id) {
  const catalog = await readNativeCatalog(signal);
  const playerProfiles = await loadNativePlayerProfiles(catalog.playerProfiles, signal), playerProfile = playerProfiles.get(profileId);
  if (!playerProfile) throw new Error(`Native player profile ${profileId} is not staged.`);
  const models = await loadModels(catalog, signal, [playerProfile.catalogId, ...playerProfile.upperItems.map(item => item.catalogId), "musveren:0"]);
  validateNativePlayerAssets(playerProfile, models);
  const npcProfiles = await loadNativeNpcProfiles(catalog.npcProfiles, signal);
  const archiveHashes = new Map((catalog.models as readonly { id: string; archiveSha256: string }[])
    .filter(record => models.has(record.id)).map(record => [record.id, record.archiveSha256]));
  return { models, npcProfiles, playerProfiles, playerProfile, archiveHashes, animationAudio: catalog.animationAudio };
}
