import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultNativePlayerProfile, loadNativePlayerProfiles, validateNativePlayerAssets, type NativePlayerProfile } from "../../src/assets/native/loadNativePlayerProfiles";
import { loadNativeActorCatalog } from "../../src/assets/native/loadNativeCatalog";
import { readAssetPackage, sha256 } from "../../src/assets/package/readAssetPackage";
import { assetFixture } from "../fixtures/assetPackageFixture";

const encoder = new TextEncoder();
const profile: NativePlayerProfile = {
  ...defaultNativePlayerProfile, id: "human-female-fighter", name: "Human female fighter", catalogId: "human-female-fighter:0",
  assetId: "fixture-model", sourceObject: "Fixture.Female", sourceSha256: "a".repeat(64),
  clips: { idle: "Wait_Native", run: "Wait_Native", attack: "Wait_Native", death: "Wait_Native" },
  collisionRadius: 8, collisionHeight: 23.5,
  upperItems: [{ itemId: 22, catalogId: "female-equipment:0", sourceObject: "Fixture.Female", sourceSha256: "a".repeat(64) }],
  sourceEvidence: { fixture: true }, limitations: ["Synthetic fixture, not native acceptance."],
};
async function manifest(profiles: unknown[] = [profile]) {
  const bytes = encoder.encode(JSON.stringify({ schemaVersion: 1, kind: "native-player-profiles", profiles }));
  const manifestSha256 = await sha256(bytes);
  return { bytes, record: { id: "native-player-profiles", manifest: `/l2/player-profiles/${manifestSha256}/manifest.json`, manifestSha256, manifestBytes: bytes.length } };
}
function serve(files: Map<string, Uint8Array>) {
  const fetcher = vi.fn(async (url: string) => {
    const bytes = files.get(url);
    if (!bytes) throw new Error(`Unexpected request ${url}`);
    return { ok: true, arrayBuffer: async () => bytes.slice().buffer, json: async () => JSON.parse(new TextDecoder().decode(bytes)) };
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("native player profile loading and source boundaries", () => {
  it("keeps the original male default without fetching a character manifest", async () => {
    const fetcher = serve(new Map());
    expect(await loadNativePlayerProfiles([], new AbortController().signal)).toEqual(new Map([[defaultNativePlayerProfile.id, defaultNativePlayerProfile]]));
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("loads an immutable additional profile with its own dimensions and equipment", async () => {
    const input = await manifest(); serve(new Map([[input.record.manifest, input.bytes]]));
    const profiles = await loadNativePlayerProfiles([input.record], new AbortController().signal);
    expect(profiles.size).toBe(2); expect(profiles.get(profile.id)).toEqual(profile);
    expect(profiles.get(defaultNativePlayerProfile.id)).toEqual(defaultNativePlayerProfile);
  });
  it.each(["hash", "length", "path"])("rejects %s tampering before using a profile", async field => {
    const input = await manifest(); const record = { ...input.record };
    if (field === "hash") input.bytes[input.bytes.length - 2] = input.bytes[input.bytes.length - 2]! ^ 1;
    if (field === "length") record.manifestBytes++;
    if (field === "path") record.manifest = "https://example.invalid/manifest.json";
    const fetcher = serve(new Map([[input.record.manifest, input.bytes]]));
    await expect(loadNativePlayerProfiles([record], new AbortController().signal)).rejects.toThrow();
    if (field === "path") expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([
    { actorScale: [0, 1, 1] }, { forwardAxis: [0, 1, 0] }, { collisionRadius: -1 },
    { sourceUnitsPerMetre: 1 }, { limitations: [] }, { sourceEvidence: {} },
    { upperItems: [...profile.upperItems, ...profile.upperItems] },
  ])("rejects invalid source/presentation metadata %j", async patch => {
    const input = await manifest([{ ...profile, ...patch }]); serve(new Map([[input.record.manifest, input.bytes]]));
    await expect(loadNativePlayerProfiles([input.record], new AbortController().signal)).rejects.toThrow();
  });
  it.each([{ rows: [profile, profile] }, { rows: [defaultNativePlayerProfile] }])("refuses duplicate or replacement profile identities", async ({ rows }) => {
    const input = await manifest(rows); serve(new Map([[input.record.manifest, input.bytes]]));
    await expect(loadNativePlayerProfiles([input.record], new AbortController().signal)).rejects.toThrow("duplicated");
  });
  it("rejects mismatched body, missing clips and equipment from another source", async () => {
    const fixture = await assetFixture("model", { source: { edition: "interlude", package: "Fixture", object: profile.sourceObject,
      sha256: profile.sourceSha256, assembly: [profile.sourceObject] } });
    const asset = await readAssetPackage(fixture.bytes);
    const assets = new Map([[profile.catalogId, asset], [profile.upperItems[0]!.catalogId, asset]]);
    expect(() => validateNativePlayerAssets(profile, assets)).not.toThrow();
    expect(() => validateNativePlayerAssets({ ...profile, sourceObject: "Fixture.Other" }, assets)).toThrow("body source");
    expect(() => validateNativePlayerAssets({ ...profile, clips: { ...profile.clips, run: "Run_Other" } }, assets)).toThrow("missing or ambiguous");
    expect(() => validateNativePlayerAssets({ ...profile, upperItems: [{ ...profile.upperItems[0]!, sourceObject: "Fixture.Other" }] }, assets)).toThrow("equipment source");
  });
  it("fetches only the selected body/equipment and NPC, preserving other catalog families", async () => {
    const input = await manifest();
    const fixture = await assetFixture("model", { source: { edition: "interlude", package: "Fixture", object: profile.sourceObject,
      sha256: profile.sourceSha256, assembly: [profile.sourceObject] } });
    const archiveSha256 = await sha256(fixture.bytes), archive = `/l2/${archiveSha256}/asset.l2asset`;
    const selected = [profile.catalogId, profile.upperItems[0]!.catalogId, "musveren:0"];
    const otherHash = "b".repeat(64);
    const catalog = { schemaVersion: 1, playerProfiles: [input.record], npcProfiles: [],
      models: [...selected.map(id => ({ id, archive, archiveSha256 })),
        { id: "human-male-fighter:0", archive: `/l2/${otherHash}/asset.l2asset`, archiveSha256: otherHash }],
      sections: [{ id: "retained-world" }] };
    const fetcher = serve(new Map([["/l2/catalog.json", encoder.encode(JSON.stringify(catalog))], [input.record.manifest, input.bytes], [archive, fixture.bytes]]));
    const loaded = await loadNativeActorCatalog(new AbortController().signal, profile.id);
    expect([...loaded.models.keys()]).toEqual(selected); expect(loaded.playerProfile).toEqual(profile);
    expect(fetcher.mock.calls.some(([url]) => url.includes(otherHash))).toBe(false);
    await expect(loadNativeActorCatalog(new AbortController().signal, "not-staged")).rejects.toThrow("not staged");
  });
});
