import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defaultNativePlayerProfile, loadNativePlayerProfiles, validateNativePlayerAssets, type NativePlayerProfile } from "../../src/assets/native/loadNativePlayerProfiles";
import { loadNativeActorCatalog } from "../../src/assets/native/loadNativeCatalog";
import { nativeAliasCoverage, nativeAliasCoverageText, nativeAnimationAliases } from "../../src/assets/native/nativeAnimationAliases";
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
    return new Response(bytes.slice());
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
  it("keeps a chargrpIndex of a staged profile and gives the built-in default none", async () => {
    const input = await manifest([{ ...profile, chargrpIndex: 3 }]); serve(new Map([[input.record.manifest, input.bytes]]));
    const profiles = await loadNativePlayerProfiles([input.record], new AbortController().signal);
    expect(profiles.get(profile.id)!.chargrpIndex).toBe(3);
    expect(profiles.get(defaultNativePlayerProfile.id)).not.toHaveProperty("chargrpIndex");
  });
  it.each([-1, "3", 1.5])("refuses the chargrpIndex %j", async chargrpIndex => {
    const input = await manifest([{ ...profile, chargrpIndex }]); serve(new Map([[input.record.manifest, input.bytes]]));
    await expect(loadNativePlayerProfiles([input.record], new AbortController().signal)).rejects.toThrow("Native player profile chargrpIndex is invalid.");
  });
  it("refuses duplicate profile identities", async () => {
    const input = await manifest([profile, profile]); serve(new Map([[input.record.manifest, input.bytes]]));
    await expect(loadNativePlayerProfiles([input.record], new AbortController().signal)).rejects.toThrow("duplicated");
  });
  it.each([
    { collisionRadius: 10 }, { catalogId: "other-fighter:0" }, { sourceSha256: "c".repeat(64) }, { actorScale: [2, 2, 2] },
    { clips: { ...defaultNativePlayerProfile.clips, idle: "Wait_1HS_MFighter" } }, { upperItems: [] },
  ])("refuses a staged built-in male fighter row with another identity %j", async patch => {
    const input = await manifest([{ ...defaultNativePlayerProfile, ...patch }]); serve(new Map([[input.record.manifest, input.bytes]]));
    await expect(loadNativePlayerProfiles([input.record], new AbortController().signal)).rejects.toThrow("built-in male fighter identity");
  });
  it("keeps the built-in male fighter first and default when a staged row adds only its aliases", async () => {
    const aliased = { ...defaultNativePlayerProfile, clips: { ...defaultNativePlayerProfile.clips, walk: "Walk_Hand_MFighter" } };
    const input = await manifest([profile, aliased]); serve(new Map([[input.record.manifest, input.bytes]]));
    const profiles = await loadNativePlayerProfiles([input.record], new AbortController().signal);
    expect([...profiles.keys()]).toEqual([defaultNativePlayerProfile.id, profile.id]);
    expect(profiles.get(defaultNativePlayerProfile.id)!.clips).toEqual(aliased.clips);
    const twice = await manifest([aliased, aliased]); serve(new Map([[twice.record.manifest, twice.bytes]]));
    await expect(loadNativePlayerProfiles([twice.record], new AbortController().signal)).rejects.toThrow("duplicated");
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

describe("native animation alias maps", () => {
  const recipe = JSON.parse(readFileSync(resolve("recipes/native-player-aliases-stage.json"), "utf8")) as { profiles: NativePlayerProfile[] };
  const base = JSON.parse(readFileSync(resolve("recipes/native-player-mfighter-base.json"), "utf8")) as { profile: NativePlayerProfile };
  async function load(rows: unknown[]) {
    const input = await manifest(rows); serve(new Map([[input.record.manifest, input.bytes]]));
    return loadNativePlayerProfiles([input.record], new AbortController().signal);
  }

  it("keeps the TypeScript built-in male fighter equal to the base recipe the alias stager starts from", () => {
    expect(base.profile).toEqual(defaultNativePlayerProfile);
  });
  it("accepts the staged alias update for all four Human models with 45 of 46 aliases and no damage clip", async () => {
    const profiles = await load(recipe.profiles);
    expect([...profiles.keys()]).toEqual(["human-male-fighter", "human-female-fighter", "human-male-mystic", "human-female-mystic"]);
    for (const [id, loaded] of profiles) {
      const coverage = nativeAliasCoverage(loaded.clips, loaded.aliasEvidence);
      expect(nativeAliasCoverageText(coverage), id).toBe("45 of 46 aliases");
      expect(coverage.rows.map(row => row.alias)).toEqual(nativeAnimationAliases.map(row => row.alias));
      const unbound = coverage.rows.filter(row => row.summary !== null);
      expect(unbound.map(row => row.alias)).toEqual(["damage"]);
      const cls = loaded.assetId.match(/:assembly:(\w+?)-native/)![1]!;
      expect(unbound[0]).toMatchObject({ key: "DamageAnimName[0]", status: "no-family-value", nativeClip: null,
        summary: `Interlude has no hit-reaction clip; DamageFly = knock-back (Damagefly_${cls})` });
      expect(unbound[0]!.reason).toContain("do not substitute DamageFly");
      expect(coverage.rows.find(row => row.alias === "idle")).toMatchObject({ key: "WaitAnimName[0]", nativeClip: `Wait_Hand_${cls}` });
      expect(loaded.clips).toMatchObject({ walk: `Walk_Hand_${cls}`, damageFly: `Damagefly_${cls}` });
      expect(loaded.clips).not.toHaveProperty("damage");
      expect(loaded.actorScale).toEqual([1, 1, 1]); expect(loaded.sourceUnitsPerMetre).toBe(100);
    }
    expect(profiles.get("human-male-fighter")).toMatchObject({ ...defaultNativePlayerProfile, clips: expect.objectContaining(defaultNativePlayerProfile.clips) });
    expect(profiles.get("human-male-mystic")).toMatchObject({ collisionRadius: 7.5, collisionHeight: 22.8 });
    expect(profiles.get("human-female-mystic")).toMatchObject({ collisionRadius: 6.5, collisionHeight: 22.5 });
  });
  it("reports profiles without evidence without inventing clips", () => {
    const bare = nativeAliasCoverage(defaultNativePlayerProfile.clips, undefined);
    expect(nativeAliasCoverageText(bare)).toBe("4 of 46 aliases");
    expect(bare.rows.find(row => row.alias === "damage")).toMatchObject({ status: "no-evidence", summary: "no staged alias evidence" });
  });
  it.each([
    ["an unknown alias key", (row: NativePlayerProfile) => ({ ...row, clips: { ...row.clips, hitReaction: "Damagefly_FFighter" } }), "unknown"],
    ["a missing required alias", (row: NativePlayerProfile) => ({ ...row, clips: { idle: row.clips.idle, run: row.clips.run, attack: row.clips.attack } }), "required"],
    ["a bound row without its clip", (row: NativePlayerProfile) => { const { walk: _walk, ...clips } = row.clips; return { ...row, clips }; }, "disagrees"],
    ["a clip on an unbound row", (row: NativePlayerProfile) => ({ ...row, clips: { ...row.clips, damage: "Damagefly_FFighter" } }), "disagrees"],
    ["a clip without an evidence row", (row: NativePlayerProfile) => ({ ...row, aliasEvidence: { ...row.aliasEvidence!,
      rows: row.aliasEvidence!.rows.filter(entry => entry.alias !== "walk") } }), "no evidence row"],
    ["a duplicated evidence row", (row: NativePlayerProfile) => ({ ...row, aliasEvidence: { ...row.aliasEvidence!,
      rows: [...row.aliasEvidence!.rows, row.aliasEvidence!.rows[0]!] } }), "invalid or duplicated"],
  ])("rejects %s", async (_label, patch, message) => {
    const female = recipe.profiles.find(row => row.id === "human-female-fighter")!;
    await expect(load([patch(female)])).rejects.toThrow(message);
  });
  it("accepts optional aliases without evidence and validates each one against the package clips", async () => {
    const withWalk = { ...profile, clips: { ...profile.clips, walk: "Wait_Native" } };
    expect((await load([withWalk])).get(profile.id)!.clips).toEqual(withWalk.clips);
    const fixture = await assetFixture("model", { source: { edition: "interlude", package: "Fixture", object: profile.sourceObject,
      sha256: profile.sourceSha256, assembly: [profile.sourceObject] } });
    const asset = await readAssetPackage(fixture.bytes);
    const assets = new Map([[profile.catalogId, asset], [profile.upperItems[0]!.catalogId, asset]]);
    expect(() => validateNativePlayerAssets(withWalk, assets)).not.toThrow();
    expect(() => validateNativePlayerAssets({ ...withWalk, clips: { ...withWalk.clips, swim: "Swim_Missing" } }, assets)).toThrow("missing or ambiguous");
  });
});
