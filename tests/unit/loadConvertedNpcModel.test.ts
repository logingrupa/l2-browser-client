import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConvertedNpcModel } from "../../src/assets/native/loadConvertedNpcModel";
import type { NativeNpcProfile } from "../../src/assets/native/loadNativeNpcProfiles";
import { sha256 } from "../../src/assets/package/readAssetPackage";
import { assetFixture } from "../fixtures/assetPackageFixture";
import { catalogWith, musverenProfile, serveFiles } from "../support/nativeCatalogIndexFixtures";

const modelCatalogId = `npc-model:${"b".repeat(64)}`;
const gremlinMesh = "LineageMonsters.gremlin_m00";
const gremlinProfile = { ...musverenProfile, id: "npc:20001", npcId: 20001, name: "Gremlin", mesh: gremlinMesh, modelCatalogId } as unknown as NativeNpcProfile;
const record = { npcId: 20001, profileId: "npc:20001", modelCatalogId };

async function servedModelCatalog(sourceObject: string) {
  const fixture = await assetFixture("model", { source: { edition: "interlude", package: "LineageMonsters", object: sourceObject, sha256: "a".repeat(64) } });
  const archiveSha256 = await sha256(fixture.bytes);
  const archive = `/l2/${archiveSha256}/asset.l2asset`;
  serveFiles(new Map([[archive, fixture.bytes]]));
  return catalogWith({ models: [{ id: modelCatalogId, archive, archiveSha256, source: { object: sourceObject } }] });
}

describe("loadConvertedNpcModel", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("loads the model joined by modelCatalogId when its source object is the profile mesh", async () => {
    const catalog = await servedModelCatalog(gremlinMesh);
    const asset = await loadConvertedNpcModel(catalog, record, gremlinProfile, new AbortController().signal);
    expect(asset.manifest.source.object).toBe(gremlinMesh);
    expect(asset.manifest.kind).toBe("model");
  });

  it("refuses a modelCatalogId that the catalog does not hold", async () => {
    const catalog = await servedModelCatalog(gremlinMesh);
    const missing = { ...record, modelCatalogId: `npc-model:${"c".repeat(64)}` };
    await expect(loadConvertedNpcModel(catalog, missing, gremlinProfile, new AbortController().signal))
      .rejects.toThrow(`Converted NPC model npc-model:${"c".repeat(64)} is not in the catalog.`);
  });

  it("refuses a joined model whose source object differs from the profile mesh", async () => {
    const catalog = await servedModelCatalog("LineageMonsters.rabbit_m00");
    await expect(loadConvertedNpcModel(catalog, record, gremlinProfile, new AbortController().signal))
      .rejects.toThrow("Converted NPC model source differs from its profile mesh.");
  });
});
