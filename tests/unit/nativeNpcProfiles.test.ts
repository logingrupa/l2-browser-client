import { afterEach, describe, expect, it, vi } from "vitest";
import { sha256 } from "../../src/assets/package/readAssetPackage";
import { loadNativeNpcProfiles } from "../../src/assets/native/loadNativeNpcProfiles";
import { loadNativeActorCatalog } from "../../src/assets/native/loadNativeCatalog";

const profile = { id: "npc:21622", npcId: 21622, name: "Greater Musveren", mesh: "LineageMonsters.field_stalker_m00",
  actorClass: "LineageMonster.field_stalker_20_bi", drawScale: 1.2, drawScale3D: [1, 1, 1], collisionRadius: 18,
  collisionHeight: 36, sourceUnitsPerMetre: 100, unsupportedFields: [{ field: "prePivot", reason: "Unverified." }] };
async function fixture(profiles: unknown[] = [profile]) {
  const bytes = new TextEncoder().encode(JSON.stringify({ schemaVersion: 1, kind: "native-npc-profiles", support: "source-profile-fields-ready", profiles, unsupported: [] }));
  const hash = await sha256(bytes), record = { id: "native-npc-profiles", manifest: `/l2/npc-profiles/${hash}/manifest.json`, manifestSha256: hash, manifestBytes: bytes.length };
  return { bytes, record };
}
afterEach(() => { vi.unstubAllGlobals(); });

describe("source-backed native NPC profile loading", () => {
  it.each(["https:", "file:"])("uses one catalog snapshot and exact hashed metadata in %s", async protocol => {
    const { bytes, record } = await fixture(); vi.stubGlobal("location", { protocol });
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      urls.push(url);
      if (url.endsWith("catalog.json")) return Response.json({ schemaVersion: 1, models: [], npcProfiles: [record] });
      return new Response(bytes.slice());
    }));
    const catalog = await loadNativeActorCatalog(new AbortController().signal);
    const loaded = catalog.npcProfiles.get("npc:21622");
    expect(loaded).toMatchObject({ npcId: 21622, actorClass: profile.actorClass, drawScale: 1.2, collisionHeight: 36, drawScale3D: [1, 1, 1] });
    expect(loaded).not.toHaveProperty("prePivot");
    const prefix = protocol === "file:" ? "l2/" : "/l2/";
    expect(urls).toEqual([`${prefix}catalog.json`, record.manifest.replace("/l2/", prefix)]);
  });

  it("rejects corrupted bytes and an untrusted manifest path before using metadata", async () => {
    const { bytes, record } = await fixture();
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
    const { bytes, record } = await fixture(profiles);
    vi.stubGlobal("fetch", async () => new Response(bytes.slice()));
    await expect(loadNativeNpcProfiles([record], new AbortController().signal)).rejects.toThrow();
  });

  it("does not return metadata after its lifetime ends", async () => {
    const { bytes, record } = await fixture(), controller = new AbortController();
    vi.stubGlobal("fetch", async () => { controller.abort(); return new Response(bytes.slice()); });
    await expect(loadNativeNpcProfiles([record], controller.signal)).rejects.toHaveProperty("name", "AbortError");
  });
});
