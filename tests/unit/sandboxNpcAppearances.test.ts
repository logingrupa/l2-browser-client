import { afterEach, describe, expect, it, vi } from "vitest";
import type { NativeCharacterProfile } from "../../src/assets/native/NativeCharacterVisual";
import type { NativeNpcProfile } from "../../src/assets/native/loadNativeNpcProfiles";
import type { NativeCatalogIndex } from "../../src/assets/native/nativeCatalogIndex";
import { sha256 } from "../../src/assets/package/readAssetPackage";
import { nativeNpcStateClips, sandboxNpcAppearances, type SandboxNpcAppearanceSources } from "../../src/runtime/sandboxNpcAppearances";
import { resolveSandboxNpcPresentation } from "../../src/runtime/sandboxNpcVisual";
import { assetFixture } from "../fixtures/assetPackageFixture";
import { catalogWith, musverenProfile, serveFiles } from "../support/nativeCatalogIndexFixtures";

const modelCatalogId = `npc-model:${"b".repeat(64)}`;
const gremlinMesh = "LineageMonsters.gremlin_m00";
const gremlinProfile = { ...musverenProfile, id: "npc:20001", npcId: 20001, name: "Gremlin", mesh: gremlinMesh, modelCatalogId,
  collisionHeight: 15, drawScale: 1, drawScale3D: [1, 2, 3] } as unknown as NativeNpcProfile;
const gremlinRecord = { npcId: 20001, profileId: "npc:20001", modelCatalogId, join: "model-catalog-id" } as const;
const musverenRecord = { npcId: 21622, profileId: "native-npc-profiles", modelCatalogId: "musveren:0", join: "legacy-single-mesh-match" } as const;

async function laneSources(npcProfiles: ReadonlyMap<string, NativeNpcProfile> = new Map([["npc:20001", gremlinProfile]])): Promise<SandboxNpcAppearanceSources> {
  const fixture = await assetFixture("model", { source: { edition: "interlude", package: "LineageMonsters", object: gremlinMesh, sha256: "a".repeat(64) } });
  const archiveSha256 = await sha256(fixture.bytes);
  const archive = `/l2/${archiveSha256}/asset.l2asset`;
  serveFiles(new Map([[archive, fixture.bytes]]));
  return { catalog: catalogWith({ models: [{ id: modelCatalogId, archive, archiveSha256, source: { object: gremlinMesh } }] }), npcProfiles,
    loadedAppearanceByModel: new Map([["musveren:0", "native-musveren"]]), characterProfiles: new Map<string, NativeCharacterProfile>() };
}

describe("sandbox NPC appearances", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("gives a converted lane NPC a native profile whose model loads through loadConvertedNpcModel", async () => {
    const sources = await laneSources();
    expect(sandboxNpcAppearances(sources)(gremlinRecord)).toEqual({ appearanceId: "native-npc:20001" });
    const profile = sources.characterProfiles.get("native-npc:20001")!;
    expect(profile.clips).toEqual(nativeNpcStateClips);
    expect(profile.collisionHalfHeight).toBe(.15);
    expect(profile.actorScale?.asArray()).toEqual([1, 3, 2]);
    if (typeof profile.asset !== "function") throw new Error("the converted NPC profile must load its model on spawn");
    const asset = await profile.asset(new AbortController().signal);
    expect(asset.manifest.source.object).toBe(gremlinMesh);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it("keeps one profile for repeated spawns of the same NPC and leaves a loaded model on its loaded appearance", async () => {
    const sources = await laneSources(), appearanceOfNpc = sandboxNpcAppearances(sources);
    appearanceOfNpc(gremlinRecord);
    const firstProfile = sources.characterProfiles.get("native-npc:20001");
    expect(appearanceOfNpc(gremlinRecord)).toEqual({ appearanceId: "native-npc:20001" });
    expect(sources.characterProfiles.get("native-npc:20001")).toBe(firstProfile);
    expect(appearanceOfNpc(musverenRecord)).toEqual({ appearanceId: "native-musveren" });
    expect([...sources.characterProfiles.keys()]).toEqual(["native-npc:20001"]);
  });

  it("names why a converted NPC has no sandbox body", async () => {
    expect(sandboxNpcAppearances(await laneSources(new Map()))(gremlinRecord))
      .toEqual({ unavailableReason: "profile npc:20001 is not in the served NPC profiles" });
    const pivoted = { ...gremlinProfile, prePivot: [0, 0, 4] } as NativeNpcProfile;
    expect(sandboxNpcAppearances(await laneSources(new Map([["npc:20001", pivoted]])))(gremlinRecord))
      .toEqual({ unavailableReason: "profile npc:20001 has an actor pivot the sandbox does not apply" });
  });

  it("presents a spawned lane NPC id with its converted model through the catalog index", async () => {
    const index: NativeCatalogIndex = {
      lookup: key => key === "npc:20001" ? { status: "converted", key, record: gremlinRecord } : { status: "not-in-catalog", key, reason: "not in catalog" },
      keys: () => ["npc:20001"],
    };
    expect(resolveSandboxNpcPresentation(index, 20001, sandboxNpcAppearances(await laneSources())))
      .toEqual({ key: "npc:20001", appearanceId: "native-npc:20001", modelCatalogId });
  });
});
