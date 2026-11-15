import { afterEach, describe, expect, it, vi } from "vitest";
import { loadNativeActorCatalog } from "../../src/assets/native/loadNativeCatalog";
import { loadNativeNpcProfiles, maximumNpcProfileBundles, maximumProfilesPerBundle } from "../../src/assets/native/loadNativeNpcProfiles";
import { fixturePlayerProfile, modelArchiveFixture, serveStoreFiles } from "../support/nativeActorCatalogFixtures";
import { musverenProfile as profile, npcProfileManifest, playerProfileManifest } from "../support/nativeCatalogIndexFixtures";

const unitModelId = (npcId: number) => `npc-model:${npcId.toString(16).padStart(64, "0")}`;
const laneProfile = (npcId: number) => ({ ...profile, id: `npc:${npcId}`, npcId, modelCatalogId: unitModelId(npcId) });
const lanePackRecordId = "interlude:npc-profiles:pack-0123456789abcdef";
const unservedArchiveSha256 = "b".repeat(64);
const unservedModel = (id: string, sourceObject: string) =>
  ({ id, archive: `/l2/${unservedArchiveSha256}/asset.l2asset`, archiveSha256: unservedArchiveSha256, source: { object: sourceObject } });

async function actorCatalogStore(npcManifests: readonly { bytes: Uint8Array; record: { id: string; manifest: string } }[], extraModels: unknown[] = []) {
  const playerManifest = await playerProfileManifest([fixturePlayerProfile]);
  const body = await modelArchiveFixture(fixturePlayerProfile.sourceObject, fixturePlayerProfile.sourceSha256);
  const npcModel = await modelArchiveFixture(profile.mesh, "c".repeat(64));
  const catalog = { schemaVersion: 1, playerProfiles: [playerManifest.record], npcProfiles: npcManifests.map(manifest => manifest.record),
    models: [
      { id: fixturePlayerProfile.catalogId, archive: body.archive, archiveSha256: body.archiveSha256 },
      { id: fixturePlayerProfile.upperItems[0]!.catalogId, archive: body.archive, archiveSha256: body.archiveSha256 },
      { id: "musveren:0", archive: npcModel.archive, archiveSha256: npcModel.archiveSha256, source: { object: profile.mesh } },
      ...extraModels,
    ] };
  const files = new Map<string, Uint8Array>([["/l2/catalog.json", new TextEncoder().encode(JSON.stringify(catalog))],
    ...npcManifests.map(manifest => [manifest.record.manifest, manifest.bytes] as const),
    [playerManifest.record.manifest, playerManifest.bytes], [body.archive, body.bytes], [npcModel.archive, npcModel.bytes]]);
  return { files, playerManifest, body, npcModel };
}

afterEach(() => { vi.unstubAllGlobals(); });

describe("source-backed native NPC profile loading", () => {
  it.each(["https:", "file:"] as const)("uses one catalog snapshot and exact hashed metadata in %s", async protocol => {
    const npcManifest = await npcProfileManifest([profile]);
    const store = await actorCatalogStore([npcManifest]);
    const fetcher = serveStoreFiles(store.files, protocol);
    const catalog = await loadNativeActorCatalog(new AbortController().signal, fixturePlayerProfile.id);
    const loaded = catalog.npcProfiles.get("npc:21622");
    expect(loaded).toMatchObject({ npcId: 21622, actorClass: profile.actorClass, drawScale: 1.2, collisionHeight: 36, drawScale3D: [1, 1, 1] });
    expect(loaded).not.toHaveProperty("prePivot");
    expect([...catalog.models.keys()]).toEqual([fixturePlayerProfile.catalogId, fixturePlayerProfile.upperItems[0]!.catalogId, "musveren:0"]);
    const prefix = protocol === "file:" ? "l2/" : "/l2/", served = (path: string) => path.replace("/l2/", prefix);
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([served("/l2/catalog.json"), served(npcManifest.record.manifest),
      served(store.playerManifest.record.manifest), served(store.body.archive), served(store.body.archive), served(store.npcModel.archive)]);
  });

  it("keeps the shared-store npc 21622 on musveren:0 in a merged catalog and requests no npc-model: archive", async () => {
    const sharedStoreManifest = await npcProfileManifest([profile]);
    const lanePack = await npcProfileManifest([laneProfile(20842), laneProfile(20843)]);
    const store = await actorCatalogStore([sharedStoreManifest, { ...lanePack, record: { ...lanePack.record, id: lanePackRecordId } }],
      [unservedModel(unitModelId(20842), profile.mesh), unservedModel(unitModelId(20843), profile.mesh)]);
    const fetcher = serveStoreFiles(store.files);
    const catalog = await loadNativeActorCatalog(new AbortController().signal, fixturePlayerProfile.id);
    expect(catalog.models.has("musveren:0")).toBe(true);
    expect([...catalog.models.keys()].some(id => id.startsWith("npc-model:"))).toBe(false);
    expect(fetcher.mock.calls.some(([url]) => url.includes(unservedArchiveSha256))).toBe(false);
    expect(catalog.npcProfiles.get("npc:20842")).toMatchObject({ modelCatalogId: unitModelId(20842) });
  });

  it("loads no NPC model from a catalog without an npcProfiles slice", async () => {
    const store = await actorCatalogStore([]);
    const fetcher = serveStoreFiles(store.files);
    const catalog = await loadNativeActorCatalog(new AbortController().signal, fixturePlayerProfile.id);
    expect(catalog.models.has("musveren:0")).toBe(false);
    expect(catalog.npcProfiles.size).toBe(0);
    expect(fetcher.mock.calls.some(([url]) => url === store.npcModel.archive)).toBe(false);
  });

  it("rejects corrupted bytes and an untrusted manifest path before using metadata", async () => {
    const { bytes, record } = await npcProfileManifest([profile]);
    const fetcher = vi.fn(async () => new Response(bytes.slice(1))); vi.stubGlobal("fetch", fetcher);
    await expect(loadNativeNpcProfiles([record], new AbortController().signal)).rejects.toThrow("hash/length mismatch");
    fetcher.mockClear();
    await expect(loadNativeNpcProfiles([{ ...record, manifest: "/l2/../elsewhere" }], new AbortController().signal)).rejects.toThrow("catalog entry");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    [{ ...profile, drawScale: 0 }], [{ ...profile, collisionHeight: -36 }], [{ ...profile, drawScale3D: [1, 0, 1] }],
    [{ ...profile, sourceUnitsPerMetre: 1 }], [{ ...profile, id: "npc:1" }], [profile, profile],
  ])("rejects invalid or ambiguous verified metadata %#", async (...profiles) => {
    const { bytes, record } = await npcProfileManifest(profiles);
    vi.stubGlobal("fetch", async () => new Response(bytes.slice()));
    await expect(loadNativeNpcProfiles([record], new AbortController().signal)).rejects.toThrow();
  });

  it("does not return metadata after its lifetime ends", async () => {
    const { bytes, record } = await npcProfileManifest([profile]), controller = new AbortController();
    vi.stubGlobal("fetch", async () => { controller.abort(); return new Response(bytes.slice()); });
    await expect(loadNativeNpcProfiles([record], controller.signal)).rejects.toHaveProperty("name", "AbortError");
  });
});

describe("NPC profile bounds", () => {
  async function bundles(count: number) {
    const manifests = await Promise.all(Array.from({ length: count }, async (_, index) => {
      const manifest = await npcProfileManifest([laneProfile(index + 1)]);
      return { ...manifest, record: { ...manifest.record, id: `interlude:npc-profiles:${index + 1}` } };
    }));
    serveStoreFiles(new Map(manifests.map(manifest => [manifest.record.manifest, manifest.bytes])));
    return manifests.map(manifest => manifest.record);
  }

  async function bundleOf(profileCount: number) {
    const manifest = await npcProfileManifest(Array.from({ length: profileCount }, (_, index) => laneProfile(index + 1)));
    const record = { ...manifest.record, id: lanePackRecordId };
    serveStoreFiles(new Map([[record.manifest, manifest.bytes]]));
    return record;
  }

  it(`accepts ${maximumNpcProfileBundles} catalog records and refuses one more`, async () => {
    const records = await bundles(maximumNpcProfileBundles + 1);
    expect((await loadNativeNpcProfiles(records.slice(0, maximumNpcProfileBundles), new AbortController().signal)).size).toBe(maximumNpcProfileBundles);
    await expect(loadNativeNpcProfiles(records, new AbortController().signal)).rejects.toThrow("Native NPC profile catalog is invalid.");
  });

  it(`accepts ${maximumProfilesPerBundle} profiles in one manifest and refuses one more or none`, async () => {
    expect((await loadNativeNpcProfiles([await bundleOf(maximumProfilesPerBundle)], new AbortController().signal)).size).toBe(maximumProfilesPerBundle);
    for (const profileCount of [maximumProfilesPerBundle + 1, 0]) {
      await expect(loadNativeNpcProfiles([await bundleOf(profileCount)], new AbortController().signal))
        .rejects.toThrow("Native NPC profile manifest is incomplete.");
    }
  });
});
