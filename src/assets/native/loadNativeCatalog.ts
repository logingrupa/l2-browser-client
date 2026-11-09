import { readAssetPackage, sha256, type AssetPackage } from "../package/readAssetPackage";
import { nativeResourceUrl } from "./nativeResourceUrl";
import { loadNativeNpcProfiles, type NativeNpcProfile } from "./loadNativeNpcProfiles";
import { defaultNativePlayerProfile, loadNativePlayerProfiles, validateNativePlayerAssets } from "./loadNativePlayerProfiles";
import { npcCatalogKey, readModelSourceObjects } from "./nativeCatalogIndex";
import { joinNpcProfileToModel } from "./nativeNpcModelJoin";
import { readNativeCatalog, type NativeCatalog } from "./readNativeCatalog";

export async function loadNativeModelPackages(catalog: NativeCatalog, signal: AbortSignal, wanted: readonly string[]): Promise<ReadonlyMap<string, AssetPackage>> {
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

export const nativeSliceNpcIds: readonly number[] = [21622];

function joinedSliceNpcModelIds(npcProfiles: ReadonlyMap<string, NativeNpcProfile>, catalog: NativeCatalog): string[] {
  const sourceObjectsByModelId = readModelSourceObjects(catalog.models), modelIds: string[] = [];
  for (const npcId of nativeSliceNpcIds) {
    const profile = npcProfiles.get(npcCatalogKey(npcId));
    if (!profile) continue;
    const modelJoin = joinNpcProfileToModel(profile, sourceObjectsByModelId);
    if (modelJoin.status === "joined") modelIds.push(modelJoin.modelCatalogId);
  }
  return modelIds;
}

export async function loadNativeActorCatalog(signal: AbortSignal, profileId = defaultNativePlayerProfile.id) {
  const catalog = await readNativeCatalog(signal);
  const npcProfiles = await loadNativeNpcProfiles(catalog.npcProfiles, signal);
  const { profiles: playerProfiles, unresolved } = await loadNativePlayerProfiles(catalog.playerProfiles, signal);
  const unresolvedFields = unresolved.get(profileId);
  if (unresolvedFields) {
    throw new Error(unresolvedFields.map(entry => `Native player profile ${profileId} has unresolved ${entry.field}: ${entry.reason}`).join("; "));
  }
  const playerProfile = playerProfiles.get(profileId);
  if (!playerProfile) throw new Error(`Native player profile ${profileId} is not staged.`);
  const models = await loadNativeModelPackages(catalog, signal,
    [playerProfile.catalogId, ...playerProfile.upperItems.map(item => item.catalogId), ...joinedSliceNpcModelIds(npcProfiles, catalog)]);
  validateNativePlayerAssets(playerProfile, models);
  const archiveHashes = new Map((catalog.models as readonly { id: string; archiveSha256: string }[])
    .filter(record => models.has(record.id)).map(record => [record.id, record.archiveSha256]));
  return { models, npcProfiles, playerProfiles, playerProfile, archiveHashes, animationAudio: catalog.animationAudio };
}
