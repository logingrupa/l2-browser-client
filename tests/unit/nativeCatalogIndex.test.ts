import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultNativePlayerProfile } from "../../src/assets/native/loadNativePlayerProfiles";
import {
  buildNativeCatalogIndex, characterCatalogKey, describeNativeCatalogLookup, itemCatalogKey, unavailableNativeCatalogIndex, npcCatalogKey, skillCatalogKey,
  tableCatalogKey, tileCatalogKey, windowCatalogKey,
} from "../../src/assets/native/nativeCatalogIndex";
import { readNativeCatalog, type NativeCatalog } from "../../src/assets/native/readNativeCatalog";
import { sha256 } from "../../src/assets/package/readAssetPackage";

const musverenProfile = { id: "npc:21622", npcId: 21622, name: "Greater Musveren", mesh: "LineageMonsters.field_stalker_m00",
  actorClass: "LineageMonster.field_stalker_20_bi", drawScale: 1.2, drawScale3D: [1, 1, 1], collisionRadius: 18,
  collisionHeight: 36, sourceUnitsPerMetre: 100, unsupportedFields: [{ field: "prePivot", reason: "Unverified." }] };
const unconvertedProfile = { ...musverenProfile, id: "npc:20001", npcId: 20001, mesh: "LineageMonsters.unconverted_m00" };

async function npcProfileManifest(profiles: unknown[]) {
  const bytes = new TextEncoder().encode(JSON.stringify({ schemaVersion: 1, kind: "native-npc-profiles",
    support: "source-profile-fields-ready", profiles, unsupported: [] }));
  const manifestSha256 = await sha256(bytes);
  return { bytes, record: { id: "native-npc-profiles", manifest: `/l2/npc-profiles/${manifestSha256}/manifest.json`, manifestSha256, manifestBytes: bytes.length } };
}

function serveFiles(files: ReadonlyMap<string, Uint8Array>) {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url === "/l2/coverage.json") return new Response("missing", { status: 404 });
    const bytes = files.get(url);
    if (!bytes) throw new Error(`Unexpected request ${url}`);
    return new Response(bytes.slice());
  }));
}

function model(id: string, sourceObject: string) {
  return { id, archive: `/l2/${"a".repeat(64)}/asset.l2asset`, archiveSha256: "a".repeat(64), source: { object: sourceObject } };
}

function catalogWith(slices: Partial<NativeCatalog>): NativeCatalog {
  return { schemaVersion: 1, models: [], textures: [], sections: [], movers: [], npcProfiles: [], playerProfiles: [],
    animationAudio: [], combatAudio: [], worldAudio: [], effectComponents: [], tables: [], windows: [], tiles: [],
    servedCatalogSha256: "c".repeat(64), ...slices };
}

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
      record: { npcId: 21622, profileId: "npc:21622", modelCatalogId: "musveren:0" } });
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

async function playerProfileManifest(profiles: unknown[]) {
  const bytes = new TextEncoder().encode(JSON.stringify({ schemaVersion: 1, kind: "native-player-profiles", profiles }));
  const manifestSha256 = await sha256(bytes);
  return { bytes, record: { id: "native-player-profiles", manifest: `/l2/player-profiles/${manifestSha256}/manifest.json`, manifestSha256, manifestBytes: bytes.length } };
}

const femaleFighterProfile = { ...defaultNativePlayerProfile, id: "human-female-fighter", name: "Human female fighter", catalogId: "human-female-fighter:0" };
const femaleMysticProfile = { ...femaleFighterProfile, id: "human-female-mystic", catalogId: "human-female-mystic:0" };

async function profileCatalog(npcProfiles: unknown[], playerProfiles: unknown[], models: unknown[]) {
  const npcManifest = await npcProfileManifest(npcProfiles), playerManifest = await playerProfileManifest(playerProfiles);
  serveFiles(new Map([[npcManifest.record.manifest, npcManifest.bytes], [playerManifest.record.manifest, playerManifest.bytes]]));
  return catalogWith({ models, npcProfiles: [npcManifest.record], playerProfiles: [playerManifest.record] });
}

describe("native catalog NPC model and character joins", () => {
  const sharedMesh = "LineageMonsters.unconverted_m00";
  const pinnedProfile = { ...unconvertedProfile, modelCatalogId: "npc-model:20001" };

  it("selects the model a profile names by modelCatalogId even when two models share its mesh", async () => {
    const catalog = await profileCatalog([pinnedProfile, musverenProfile], [femaleFighterProfile],
      [model("npc-model:20001", sharedMesh), model("npc-model:20001-other", sharedMesh), model("musveren:0", musverenProfile.mesh)]);
    const index = await buildNativeCatalogIndex(catalog, new AbortController().signal);
    expect(index.lookup(npcCatalogKey(20001))).toEqual({ status: "converted", key: "npc:20001",
      record: { npcId: 20001, profileId: "npc:20001", modelCatalogId: "npc-model:20001" } });
    expect(index.lookup(npcCatalogKey(21622))).toMatchObject({ status: "converted", record: { modelCatalogId: "musveren:0" } });
  });

  it("answers not in catalog with the model id when the named model is missing", async () => {
    const catalog = await profileCatalog([pinnedProfile], [femaleFighterProfile], [model("npc-model:20002", sharedMesh)]);
    const index = await buildNativeCatalogIndex(catalog, new AbortController().signal);
    expect(index.lookup(npcCatalogKey(20001))).toEqual({ status: "not-in-catalog", key: "npc:20001",
      reason: "NPC profile model npc-model:20001 is not in the catalog" });
  });

  it("refuses a malformed modelCatalogId in an NPC profile", async () => {
    const catalog = await profileCatalog([{ ...unconvertedProfile, modelCatalogId: "NPC Model" }], [femaleFighterProfile], []);
    await expect(buildNativeCatalogIndex(catalog, new AbortController().signal)).rejects.toThrow("Native NPC profile modelCatalogId is invalid.");
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

const goldenStoreRoot = "tests/fixtures/golden/l2";
const catalogIndexKeysFixturePath = "tests/fixtures/catalog-index-keys.json";

function serveGoldenStore() {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const path = `${goldenStoreRoot}${url.replace(/^\/l2/, "")}`;
    if (!url.startsWith("/l2/") || !existsSync(path)) return new Response("missing", { status: 404 });
    return new Response(await readFile(path));
  }));
}

async function goldenCatalogIndex() {
  serveGoldenStore();
  const signal = new AbortController().signal;
  const catalog = await readNativeCatalog(signal);
  return { catalog, index: await buildNativeCatalogIndex(catalog, signal) };
}

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
    expect(catalog.servedCatalogSha256).toBe(await sha256(new Uint8Array(await readFile(`${goldenStoreRoot}/catalog.json`))));
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
      return new Response(await readFile(`public${url}`));
    });
    vi.stubGlobal("fetch", readStagedFile);
    const signal = new AbortController().signal;
    const index = await buildNativeCatalogIndex(await readNativeCatalog(signal), signal);
    for (const key of [npcCatalogKey(21622), itemCatalogKey(22), skillCatalogKey(3, 1), tileCatalogKey("20_20")]) {
      expect(index.lookup(key), key).toMatchObject({ status: "converted", key });
    }
    expect(index.lookup(npcCatalogKey(21622))).toMatchObject({ record: { modelCatalogId: "musveren:0" } });
    expect(index.lookup(windowCatalogKey("StatusWnd")).status).toBe("not-in-catalog");
    expect(readStagedFile.mock.calls.filter(([url]) => url === "/l2/catalog.json")).toHaveLength(1);
  });
});
