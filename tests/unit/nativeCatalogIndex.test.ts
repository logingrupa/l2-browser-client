import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultNativePlayerProfile } from "../../src/assets/native/loadNativePlayerProfiles";
import {
  buildNativeCatalogIndex, characterCatalogKey, describeNativeCatalogLookup, itemCatalogKey, unavailableNativeCatalogIndex, npcCatalogKey,
  parseItemModelRecordId, skillCatalogKey, tableCatalogKey, tileCatalogKey, windowCatalogKey,
} from "../../src/assets/native/nativeCatalogIndex";
import { readNativeCatalog, type NativeCatalog } from "../../src/assets/native/readNativeCatalog";
import {
  catalogWith, goldenCatalogIndex, goldenCatalogSha256, model, musverenProfile, nativeCoveragePath, npcProfileManifest, playerProfileManifest, serveFiles,
  unconvertedProfile,
} from "../support/nativeCatalogIndexFixtures";

async function inlineCatalog(profiles: unknown[] = [musverenProfile, unconvertedProfile]) {
  const manifest = await npcProfileManifest(profiles);
  serveFiles(new Map([[manifest.record.manifest, manifest.bytes]]));
  return catalogWith({
    models: [model("fighter-equipment:0", "Fighter.MFighter_m001_u"), model("musveren:0", "LineageMonsters.field_stalker_m00")],
    npcProfiles: [manifest.record],
    sections: [{ id: "map-20-20-section" }],
    effectComponents: [{ id: "interlude:skill:3:level:1:raw-source-dispatch" }],
  });
}

afterEach(() => { vi.unstubAllGlobals(); });

describe("native catalog L2-ID index", () => {
  it("reports converted IDs only when a catalog record backs them", async () => {
    const index = await buildNativeCatalogIndex(await inlineCatalog(), new AbortController().signal);
    expect(index.lookup(npcCatalogKey(21622))).toEqual({ status: "converted", key: "npc:21622",
      record: { npcId: 21622, profileId: "npc:21622", modelCatalogId: "musveren:0", join: "legacy-single-mesh-match" } });
    expect(index.lookup(npcCatalogKey(1))).toEqual({ status: "not-in-catalog", key: "npc:1", reason: "not in catalog" });
    expect(index.lookup(npcCatalogKey(20001))).toEqual({ status: "not-in-catalog", key: "npc:20001",
      reason: "NPC profile staged but mesh LineageMonsters.unconverted_m00 has no converted model" });
    expect(index.lookup(itemCatalogKey(22))).toEqual({ status: "converted", key: "item:22",
      record: { itemId: 22, slot: "upper", catalogIds: ["fighter-equipment:0"], playerProfileIds: ["human-male-fighter"] } });
    expect(index.lookup(skillCatalogKey(3, 1))).toEqual({ status: "converted", key: "skill:3:1",
      record: { skillId: 3, level: 1, effectComponentId: "interlude:skill:3:level:1:raw-source-dispatch" } });
    expect(index.lookup(skillCatalogKey(3, 2)).status).toBe("not-in-catalog");
    expect(index.lookup(tileCatalogKey("20_20"))).toEqual({ status: "converted", key: "tile:20_20",
      record: { tile: "20_20", sectionId: "map-20-20-section" } });
    expect(index.lookup(windowCatalogKey("StatusWnd"))).toEqual({ status: "not-in-catalog", key: "window:StatusWnd",
      reason: "interface windows are not converted yet (UI-01)" });
    expect(index.keys("npc:")).toEqual(["npc:20001", "npc:21622"]);
  });

  it("answers item keys from item model records with the body-part slot built from the record id", async () => {
    const catalog = await inlineCatalog();
    const index = await buildNativeCatalogIndex({ ...catalog, models: [...catalog.models,
      model("interlude:item:1:body-part:7:weapon", "LineageWeapons.small_sword_m00_wp"),
      model("interlude:item:26:body-part:6:armor:2", "Fighter.FFighter_m002_l"), model("interlude:item:26:body-part:6:armor:0", "Fighter.MFighter_m002_l"),
      model("interlude:item:22:body-part:10:armor:0", "Fighter.MFighter_m001_u")] }, new AbortController().signal);
    expect(index.lookup(itemCatalogKey(1))).toEqual({ status: "converted", key: "item:1",
      record: { itemId: 1, slot: "body-part:7", catalogIds: ["interlude:item:1:body-part:7:weapon"], playerProfileIds: [] } });
    expect(index.lookup(itemCatalogKey(26))).toEqual({ status: "converted", key: "item:26", record: { itemId: 26, slot: "body-part:6",
      catalogIds: ["interlude:item:26:body-part:6:armor:0", "interlude:item:26:body-part:6:armor:2"], playerProfileIds: [] } });
    expect(index.lookup(itemCatalogKey(22))).toEqual({ status: "converted", key: "item:22",
      record: { itemId: 22, slot: "upper", catalogIds: ["fighter-equipment:0"], playerProfileIds: ["human-male-fighter"] } });
    expect(index.keys("item:")).toEqual(["item:1", "item:22", "item:26"]);
  });

  it.each([
    ["interlude:item:1:body-part:7:weapon", { itemId: 1, bodyPart: 7, unitKind: "weapon", raceColumnOrdinal: null }],
    ["interlude:item:22:body-part:10:armor:0", { itemId: 22, bodyPart: 10, unitKind: "armor", raceColumnOrdinal: 0 }],
    ["interlude:item:1:body-part:7:weapon:0", null], ["interlude:item:22:body-part:10:armor", null], ["interlude:item:01:body-part:7:weapon", null],
    ["interlude:item:1:body-part:7:shield", null], ["interlude:item:1234567890:body-part:7:weapon", null], ["fighter-equipment:0", null],
  ])("parses the item model record id %s canonically", (id, identity) => {
    expect(parseItemModelRecordId(id)).toEqual(identity);
  });

  it("refuses item model records of one item that disagree on body part or unit kind", async () => {
    serveFiles(new Map());
    const catalog = catalogWith({ models: [model("interlude:item:26:body-part:6:armor:0", "Fighter.A"), model("interlude:item:26:body-part:7:armor:1", "Fighter.B")] });
    await expect(buildNativeCatalogIndex(catalog, new AbortController().signal))
      .rejects.toThrow("Native catalog item 26 model records disagree on body part or unit kind.");
  });

  it("resolves lane skill records that share one root bundle through the cast skill identity owner", async () => {
    serveFiles(new Map());
    const record = (level: number) => ({ id: `interlude:skill:1011:level:${level}:native-description-action`, bundleId: "interlude:skill-root:skill.wh.1011",
      manifest: `/l2/effects/${"a".repeat(64)}/manifest.json`, manifestSha256: "a".repeat(64) });
    const index = await buildNativeCatalogIndex(catalogWith({ effectComponents: [record(1), record(2), { id: "interlude:skill:1011:level:0:x" }] }),
      new AbortController().signal);
    expect(index.lookup(skillCatalogKey(1011, 2))).toEqual({ status: "converted", key: "skill:1011:2",
      record: { skillId: 1011, level: 2, effectComponentId: "interlude:skill:1011:level:2:native-description-action" } });
    expect(index.keys("skill:")).toEqual(["skill:1011:1", "skill:1011:2"]);
  });

  it("reports every lookup as not in catalog for a catalog with only an empty model list", async () => {
    serveFiles(new Map());
    const index = await buildNativeCatalogIndex(catalogWith({}), new AbortController().signal);
    for (const key of [npcCatalogKey(21622), itemCatalogKey(22), skillCatalogKey(3, 1), tileCatalogKey("20_20"), windowCatalogKey("StatusWnd")]) {
      expect(index.lookup(key).status).toBe("not-in-catalog");
    }
    expect(index.keys("")).toEqual([]);
  });

  it("does not depend on record order", async () => {
    const catalog = await inlineCatalog();
    const forward = await buildNativeCatalogIndex(catalog, new AbortController().signal);
    const reversed = await buildNativeCatalogIndex(catalogWith({ ...catalog, models: [...catalog.models].reverse(),
      sections: [...catalog.sections].reverse(), effectComponents: [...catalog.effectComponents].reverse() }), new AbortController().signal);
    for (const prefix of ["npc:", "item:", "skill:", "tile:"]) {
      expect(reversed.keys(prefix)).toEqual(forward.keys(prefix));
      for (const key of forward.keys(prefix)) expect(reversed.lookup(key)).toEqual(forward.lookup(key));
    }
  });

  it.each([
    ["section ids", (catalog: NativeCatalog) => ({ ...catalog, sections: [{ id: "map-20-20-section" }, { id: "map-20-20-section" }] }), "map-20-20-section"],
    ["model ids", (catalog: NativeCatalog) => ({ ...catalog, models: [...catalog.models, model("musveren:0", "Other.mesh")] }), "musveren:0"],
    ["skill keys", (catalog: NativeCatalog) => ({ ...catalog, effectComponents: [{ id: "interlude:skill:3:level:1:a" }, { id: "interlude:skill:3:level:1:b" }] }), "skill:3:1"],
  ])("rejects duplicate %s instead of resolving last-one-wins", async (_label, duplicate, key) => {
    const catalog = duplicate(await inlineCatalog());
    await expect(buildNativeCatalogIndex(catalog, new AbortController().signal)).rejects.toThrow(`Native catalog has duplicate entries for ${key}.`);
  });

  it("records an NPC whose mesh several converted packages share as not in catalog, without failing the index", async () => {
    const catalog = await inlineCatalog();
    const index = await buildNativeCatalogIndex({ ...catalog, models: [...catalog.models, model("musveren:1", "LineageMonsters.field_stalker_m00")] },
      new AbortController().signal);
    expect(index.lookup(npcCatalogKey(21622))).toEqual({ status: "not-in-catalog", key: "npc:21622",
      reason: "mesh LineageMonsters.field_stalker_m00 matches 2 converted packages (musveren:0, musveren:1)" });
    expect(index.lookup(skillCatalogKey(3, 1)).status).toBe("converted");
  });

  it("reports every lookup of an unavailable index as not in catalog with the failure", () => {
    const index = unavailableNativeCatalogIndex("Native NPC profile manifest hash mismatch.");
    expect(describeNativeCatalogLookup(index.lookup(npcCatalogKey(21622))))
      .toBe("npc:21622 not in catalog: catalog index unavailable: Native NPC profile manifest hash mismatch.");
    expect(index.keys("")).toEqual([]);
  });

  it.each([-1, 1.5, Number.NaN])("key builders reject %s", value => {
    expect(() => npcCatalogKey(value)).toThrow(RangeError);
    expect(() => itemCatalogKey(value)).toThrow(RangeError);
    expect(() => skillCatalogKey(value, 1)).toThrow(RangeError);
    expect(() => skillCatalogKey(3, value)).toThrow(RangeError);
  });

  it("key builders reject a skill level of zero, unbounded window names and malformed tiles", () => {
    expect(() => skillCatalogKey(3, 0)).toThrow(RangeError);
    expect(() => windowCatalogKey("Status Wnd")).toThrow(RangeError);
    expect(() => windowCatalogKey("W".repeat(65))).toThrow(RangeError);
    expect(() => tileCatalogKey("20-20")).toThrow(RangeError);
    expect(() => tileCatalogKey("2_20")).toThrow(RangeError);
  });

  it("builds table, character and ordinal window keys and rejects malformed ones", () => {
    expect(tableCatalogKey("itemname-e")).toBe("table:itemname-e");
    expect(() => tableCatalogKey("SkillGrp")).toThrow(RangeError);
    expect(() => tableCatalogKey("")).toThrow(RangeError);
    expect(characterCatalogKey(0)).toBe("character:0");
    expect(() => characterCatalogKey(-1)).toThrow(RangeError);
    expect(() => characterCatalogKey(1.5)).toThrow(RangeError);
    expect(windowCatalogKey("StatusWnd#2")).toBe("window:StatusWnd#2");
    expect(() => windowCatalogKey("StatusWnd#0")).toThrow(RangeError);
  });

  it("describes a gap answer with its reason", () => {
    expect(describeNativeCatalogLookup({ status: "gap", key: "npc:20001", reason: "skeletal-licensee-unsupported:123/30", coverageStatus: "gap" }))
      .toBe("npc:20001 gap: skeletal-licensee-unsupported:123/30");
  });
});

const tableManifestSha256 = "5e4cbff3f9a9bb05450e6b39c5f8abdd25cd964542ac7a7033cec2781205d3d1";
function tableRecord(id: string) {
  return { id, manifest: `/l2/tables/${tableManifestSha256}/${id}.json`, manifestSha256: tableManifestSha256, manifestBytes: 343,
    recordCount: 1, sourceSha256: "8".repeat(64) };
}

describe("native catalog table and window keys", () => {
  it("answers the golden table and window records and keeps the agreed key list", async () => {
    const { index } = await goldenCatalogIndex();
    expect(index.lookup(tableCatalogKey("syntheticfixture"))).toEqual({ status: "converted", key: "table:syntheticfixture", record: {
      table: "syntheticfixture", manifest: `/l2/tables/${tableManifestSha256}/syntheticfixture.json`, manifestSha256: tableManifestSha256,
      manifestBytes: 343, recordCount: 1, sourceSha256: "87ee2596f2296f45554c8d048b5b270e409be68c3120048871fa1d2e84bffde6" } });
    expect(index.lookup(tableCatalogKey("npcgrp"))).toEqual({ status: "not-in-catalog", key: "table:npcgrp", reason: "not in catalog" });
    expect(index.lookup(windowCatalogKey("SyntheticFixtureWnd"))).toMatchObject({ status: "converted", record: { window: "SyntheticFixtureWnd" } });
    expect(index.lookup(windowCatalogKey("StatusWnd"))).toEqual({ status: "not-in-catalog", key: "window:StatusWnd", reason: "not in catalog" });
  });

  it("keeps the UI-01 window reason while a catalog has no window records", async () => {
    const index = await indexOf({ tables: [tableRecord("npcgrp")] });
    expect(index.lookup(windowCatalogKey("StatusWnd"))).toEqual({ status: "not-in-catalog", key: "window:StatusWnd",
      reason: "interface windows are not converted yet (UI-01)" });
  });

  it("keeps adjacent table names apart and lists table keys in order", async () => {
    const index = await indexOf({ tables: [tableRecord("skillname-e"), tableRecord("skillgrp")] });
    expect(index.keys("table:")).toEqual(["table:skillgrp", "table:skillname-e"]);
    expect(index.lookup(tableCatalogKey("skillgrp"))).toMatchObject({ status: "converted", record: { table: "skillgrp" } });
  });

  it("answers not in catalog for table keys of an empty tables slice", async () => {
    const index = await indexOf({});
    expect(index.lookup(tableCatalogKey("skillgrp"))).toEqual({ status: "not-in-catalog", key: "table:skillgrp", reason: "not in catalog" });
  });

  it.each([
    ["tables", { tables: [{ ...tableRecord("npcgrp"), manifest: `/l2/tables/${tableManifestSha256}/itemgrp.json` }] }],
    ["tables", { tables: [{ ...tableRecord("npcgrp"), recordCount: -1 }] }],
    ["tables", { tables: [{ ...tableRecord("npcgrp"), sourceSha256: "abc" }] }],
    ["tables", { tables: [{ ...tableRecord("npcgrp"), manifestBytes: 33_554_433 }] }],
    ["windows", { windows: [{ id: "StatusWnd#0", manifest: `/l2/windows/${"6".repeat(64)}/window.json`, manifestSha256: "6".repeat(64), manifestBytes: 1 }] }],
  ])("refuses a malformed %s record", async (sliceName, slices) => {
    await expect(indexOf(slices)).rejects.toThrow(`Native catalog ${sliceName} entry is invalid.`);
  });
});

const femaleFighterProfile = { ...defaultNativePlayerProfile, id: "human-female-fighter", name: "Human female fighter", catalogId: "human-female-fighter:0" };
const femaleMysticProfile = { ...femaleFighterProfile, id: "human-female-mystic", catalogId: "human-female-mystic:0" };

async function profileCatalog(npcProfiles: unknown[], playerProfiles: unknown[], models: unknown[]) {
  const npcManifest = await npcProfileManifest(npcProfiles), playerManifest = await playerProfileManifest(playerProfiles);
  serveFiles(new Map([[npcManifest.record.manifest, npcManifest.bytes], [playerManifest.record.manifest, playerManifest.bytes]]));
  return catalogWith({ models, npcProfiles: [npcManifest.record], playerProfiles: [playerManifest.record] });
}

describe("native catalog NPC model and character joins", () => {
  const sharedMesh = "LineageMonsters.field_stalker_m00";
  const firstUnitModelId = `npc-model:${"1".repeat(64)}`, secondUnitModelId = `npc-model:${"2".repeat(64)}`;
  const firstLaneProfile = { ...musverenProfile, id: "npc:20842", npcId: 20842, name: "Musveren", modelCatalogId: firstUnitModelId };
  const secondLaneProfile = { ...musverenProfile, id: "npc:20843", npcId: 20843, name: "Musveren", modelCatalogId: secondUnitModelId };
  const lanePackRecordId = "interlude:npc-profiles:pack-0123456789abcdef";

  it("resolves two profiles of one shared mesh to the two models they name by modelCatalogId", async () => {
    const catalog = await profileCatalog([firstLaneProfile, secondLaneProfile], [femaleFighterProfile],
      [model(firstUnitModelId, sharedMesh), model(secondUnitModelId, sharedMesh)]);
    const index = await buildNativeCatalogIndex(catalog, new AbortController().signal);
    expect(index.lookup(npcCatalogKey(20842))).toEqual({ status: "converted", key: "npc:20842",
      record: { npcId: 20842, profileId: "npc:20842", modelCatalogId: firstUnitModelId, join: "model-catalog-id" } });
    expect(index.lookup(npcCatalogKey(20843))).toEqual({ status: "converted", key: "npc:20843",
      record: { npcId: 20843, profileId: "npc:20843", modelCatalogId: secondUnitModelId, join: "model-catalog-id" } });
  });

  it("answers not in catalog with the model id when the named model is missing", async () => {
    const catalog = await profileCatalog([firstLaneProfile], [femaleFighterProfile], [model(secondUnitModelId, sharedMesh)]);
    const index = await buildNativeCatalogIndex(catalog, new AbortController().signal);
    expect(index.lookup(npcCatalogKey(20842))).toEqual({ status: "not-in-catalog", key: "npc:20842",
      reason: `NPC profile names model ${firstUnitModelId}, which is not in the catalog` });
  });

  it("refuses the catalog when a profile names a model of a different mesh", async () => {
    const catalog = await profileCatalog([firstLaneProfile], [femaleFighterProfile], [model(firstUnitModelId, "LineageMonsters.gremlin_m00")]);
    await expect(buildNativeCatalogIndex(catalog, new AbortController().signal))
      .rejects.toThrow("Native catalog NPC profile npc:20842 names a model of a different mesh.");
  });

  it.each(["NPC Model", "npc-model:20001", `npc-model:${"A".repeat(64)}`, `npc-model:${"1".repeat(63)}`, `npc-model:${"1".repeat(64)} `, 7])(
    "refuses the malformed modelCatalogId %j in an NPC profile", async modelCatalogId => {
      const catalog = await profileCatalog([{ ...unconvertedProfile, modelCatalogId }], [femaleFighterProfile], []);
      await expect(buildNativeCatalogIndex(catalog, new AbortController().signal)).rejects.toThrow("Native NPC profile model catalog id is invalid.");
    });

  it("joins a shared-store profile without modelCatalogId by its single legacy mesh match", async () => {
    const catalog = await profileCatalog([musverenProfile], [femaleFighterProfile], [model("musveren:0", sharedMesh)]);
    const index = await buildNativeCatalogIndex(catalog, new AbortController().signal);
    expect(index.lookup(npcCatalogKey(21622))).toEqual({ status: "converted", key: "npc:21622",
      record: { npcId: 21622, profileId: "npc:21622", modelCatalogId: "musveren:0", join: "legacy-single-mesh-match" } });
  });

  it("refuses a profile without modelCatalogId in a bundle other than the shared-store bundle", async () => {
    const npcManifest = await npcProfileManifest([musverenProfile]);
    serveFiles(new Map([[npcManifest.record.manifest, npcManifest.bytes]]));
    const catalog = catalogWith({ models: [model("musveren:0", sharedMesh)], npcProfiles: [{ ...npcManifest.record, id: lanePackRecordId }] });
    await expect(buildNativeCatalogIndex(catalog, new AbortController().signal))
      .rejects.toThrow(`Native NPC profile npc:21622 in bundle ${lanePackRecordId} has no model catalog id.`);
  });

  it("keeps the shared-store npc:21622 on musveren:0 in a catalog merged with a lane pack of the same mesh", async () => {
    const sharedStoreManifest = await npcProfileManifest([musverenProfile]);
    const lanePackManifest = await npcProfileManifest([firstLaneProfile, secondLaneProfile]);
    serveFiles(new Map([[sharedStoreManifest.record.manifest, sharedStoreManifest.bytes], [lanePackManifest.record.manifest, lanePackManifest.bytes]]));
    const catalog = catalogWith({
      models: [model("musveren:0", sharedMesh), model(firstUnitModelId, sharedMesh), model(secondUnitModelId, sharedMesh)],
      npcProfiles: [sharedStoreManifest.record, { ...lanePackManifest.record, id: lanePackRecordId }],
    });
    const index = await buildNativeCatalogIndex(catalog, new AbortController().signal);
    expect(index.lookup(npcCatalogKey(21622))).toMatchObject({ status: "converted",
      record: { modelCatalogId: "musveren:0", join: "legacy-single-mesh-match" } });
    expect(index.lookup(npcCatalogKey(20842))).toMatchObject({ status: "converted", record: { modelCatalogId: firstUnitModelId, join: "model-catalog-id" } });
    expect(index.lookup(npcCatalogKey(20843))).toMatchObject({ status: "converted", record: { modelCatalogId: secondUnitModelId, join: "model-catalog-id" } });
  });

  it("gives no npc keys for a catalog without an npcProfiles slice and refuses a manifest with zero profiles", async () => {
    expect((await indexOf({ models: [model("musveren:0", sharedMesh)] })).keys("npc:")).toEqual([]);
    const emptyManifest = await npcProfileManifest([]);
    serveFiles(new Map([[emptyManifest.record.manifest, emptyManifest.bytes]]));
    await expect(buildNativeCatalogIndex(catalogWith({ npcProfiles: [emptyManifest.record] }), new AbortController().signal))
      .rejects.toThrow("Native NPC profile manifest is incomplete.");
  });

  it("answers a character key from a player profile chargrpIndex whose model is staged", async () => {
    const catalog = await profileCatalog([musverenProfile], [{ ...femaleFighterProfile, chargrpIndex: 3 }, { ...femaleMysticProfile, chargrpIndex: 4 }],
      [model("human-female-fighter:0", "Fixture.Female")]);
    const index = await buildNativeCatalogIndex(catalog, new AbortController().signal);
    expect(index.lookup(characterCatalogKey(3))).toEqual({ status: "converted", key: "character:3",
      record: { chargrpIndex: 3, playerProfileId: "human-female-fighter", catalogId: "human-female-fighter:0" } });
    expect(index.lookup(characterCatalogKey(4))).toEqual({ status: "not-in-catalog", key: "character:4",
      reason: "player profile human-female-mystic model human-female-mystic:0 is not in the catalog" });
    expect(index.keys("character:")).toEqual(["character:3", "character:4"]);
  });

  it("refuses two player profiles with one chargrpIndex", async () => {
    const catalog = await profileCatalog([musverenProfile], [{ ...femaleFighterProfile, chargrpIndex: 3 }, { ...femaleMysticProfile, chargrpIndex: 3 }],
      [model("human-female-fighter:0", "Fixture.Female")]);
    await expect(buildNativeCatalogIndex(catalog, new AbortController().signal)).rejects.toThrow("Native catalog has duplicate entries for character:3.");
  });
});

const catalogIndexKeysFixturePath = "tests/fixtures/catalog-index-keys.json";

async function catalogIndexKeysFixture(): Promise<readonly string[]> {
  return (JSON.parse(await readFile(catalogIndexKeysFixturePath, "utf-8")) as { keys: string[] }).keys;
}

const tileManifestSha256 = "bda58735e24af8da075d8acc808efdb632711c9f5ea6fa60067a7ccbc5bde5ef";
function tileRecord(id: string, overrides: Record<string, unknown> = {}) {
  return { id, manifest: `/l2/tiles/${tileManifestSha256}/tile.json`, manifestSha256: tileManifestSha256, manifestBytes: 620, ...overrides };
}

async function indexOf(slices: Partial<NativeCatalog>) {
  serveFiles(new Map());
  return buildNativeCatalogIndex(catalogWith(slices), new AbortController().signal);
}

describe("native catalog L2-ID index on the golden catalog", () => {
  it("reads tile 00_00 from the tiles record of the golden catalog bytes", async () => {
    const { catalog, index } = await goldenCatalogIndex();
    expect(catalog.servedCatalogSha256).toBe(await goldenCatalogSha256());
    expect(index.lookup(tileCatalogKey("00_00"))).toEqual({ status: "converted", key: "tile:00_00", record: { tile: "00_00", tileCatalogId: "00_00",
      manifest: `/l2/tiles/${tileManifestSha256}/tile.json`, manifestSha256: tileManifestSha256, manifestBytes: 620 } });
  });

  it("derives exactly the keys that the 02-04 key fixture lists", async () => {
    const { index } = await goldenCatalogIndex();
    expect(index.keys("")).toEqual(await catalogIndexKeysFixture());
  });
});

describe("native catalog tile records", () => {
  it.each([
    ["a manifest outside /l2/tiles", tileRecord("20_20", { manifest: `/l2/maps/${tileManifestSha256}/tile.json` })],
    ["a path SHA-256 that differs from the pin", tileRecord("20_20", { manifestSha256: "d".repeat(64) })],
    ["a malformed tile id", tileRecord("0_00")],
    ["an extra field", tileRecord("20_20", { sectionId: "map-20-20-section" })],
    ["a missing manifestBytes", (({ manifestBytes: _manifestBytes, ...rest }) => rest)(tileRecord("20_20"))],
    ["manifestBytes over 8,000,000", tileRecord("20_20", { manifestBytes: 8_000_001 })],
    ["manifestBytes of zero", tileRecord("20_20", { manifestBytes: 0 })],
  ])("refuses a tiles record with %s", async (_label, record) => {
    await expect(indexOf({ tiles: [record] })).rejects.toThrow("Native catalog tiles entry is invalid.");
  });

  it("answers a tile from its tiles record and an adjacent tile from a legacy section", async () => {
    const index = await indexOf({ tiles: [tileRecord("20_20")], sections: [{ id: "map-20-21-section" }] });
    expect(index.lookup(tileCatalogKey("20_20"))).toMatchObject({ status: "converted", record: { tile: "20_20", tileCatalogId: "20_20" } });
    expect(index.lookup(tileCatalogKey("20_21"))).toEqual({ status: "converted", key: "tile:20_21", record: { tile: "20_21", sectionId: "map-20-21-section" } });
    expect(index.keys("tile:")).toEqual(["tile:20_20", "tile:20_21"]);
  });

  it("keeps one entry from the tiles record when a legacy section names the same tile", async () => {
    const index = await indexOf({ tiles: [tileRecord("20_20")], sections: [{ id: "map-20-20-section" }] });
    expect(index.lookup(tileCatalogKey("20_20"))).toMatchObject({ status: "converted", record: { tileCatalogId: "20_20" } });
    expect(index.keys("tile:")).toEqual(["tile:20_20"]);
  });

  it("refuses two tiles records with one id", async () => {
    await expect(indexOf({ tiles: [tileRecord("20_20"), tileRecord("20_20")] })).rejects.toThrow("Native catalog has duplicate entries for tile:20_20.");
  });

  it("lists tile keys in lexical order, identically across two builds of one catalog", async () => {
    const slices = { tiles: [tileRecord("21_20"), tileRecord("19_22")], sections: [{ id: "map-20-21-section" }] };
    const first = await indexOf(slices), second = await indexOf(slices);
    expect(first.keys("tile:")).toEqual(["tile:19_22", "tile:20_21", "tile:21_20"]);
    expect(second.keys("tile:")).toEqual(first.keys("tile:"));
  });

  it("answers not in catalog for every tile key of a catalog without tiles and sections", async () => {
    const index = await indexOf({});
    for (const tile of ["00_00", "20_20", "20_21"]) {
      expect(index.lookup(tileCatalogKey(tile))).toEqual({ status: "not-in-catalog", key: `tile:${tile}`, reason: "not in catalog" });
    }
  });
});

const stagedCatalogPath = "public/l2/catalog.json";
describe.skipIf(!existsSync(stagedCatalogPath))("native catalog L2-ID index on the staged store", () => {
  it("resolves the staged NPC, item, skill and tile through the one catalog reader", async () => {
    const readStagedFile = vi.fn(async (url: string) => {
      if (!url.startsWith("/l2/")) throw new Error(`Unexpected request ${url}`);
      if (!existsSync(`public${url}`)) return new Response("missing", { status: 404 });
      return new Response(await readFile(`public${url}`));
    });
    vi.stubGlobal("fetch", readStagedFile);
    const signal = new AbortController().signal;
    const index = await buildNativeCatalogIndex(await readNativeCatalog(signal), signal);
    for (const key of [npcCatalogKey(21622), itemCatalogKey(22), skillCatalogKey(3, 1), tileCatalogKey("20_20")]) {
      expect(index.lookup(key), key).toMatchObject({ status: "converted", key });
    }
    expect(index.lookup(npcCatalogKey(21622))).toMatchObject({ record: { modelCatalogId: "musveren:0", join: "legacy-single-mesh-match" } });
    expect(index.lookup(windowCatalogKey("StatusWnd")).status).toBe("not-in-catalog");
    expect(readStagedFile.mock.calls.filter(([url]) => url === "/l2/catalog.json")).toHaveLength(1);
  });
});

const laneStoreRoot = "artifacts/lane-store/actors/l2";
describe.skipIf(!existsSync(`${laneStoreRoot}/catalog.json`))("native catalog L2-ID index on the actors lane store, skipped while that store is absent", () => {
  it("resolves npc:20001 through its modelCatalogId", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url === nativeCoveragePath) return new Response("missing", { status: 404 });
      const path = `${laneStoreRoot}${url.replace(/^\/l2/, "")}`;
      if (!url.startsWith("/l2/") || !existsSync(path)) return new Response("missing", { status: 404 });
      return new Response(await readFile(path));
    }));
    const signal = new AbortController().signal;
    const index = await buildNativeCatalogIndex(await readNativeCatalog(signal), signal);
    expect(index.lookup(npcCatalogKey(20001))).toMatchObject({ status: "converted", key: "npc:20001",
      record: { npcId: 20001, modelCatalogId: expect.stringMatching(/^npc-model:[a-f0-9]{64}$/), join: "model-catalog-id" } });
  });
});
