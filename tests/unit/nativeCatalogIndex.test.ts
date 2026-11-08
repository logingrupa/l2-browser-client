import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildNativeCatalogIndex, itemCatalogKey, npcCatalogKey, skillCatalogKey, tileCatalogKey, windowCatalogKey,
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
    animationAudio: [], combatAudio: [], worldAudio: [], effectComponents: [], ...slices };
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
    ["models sharing one NPC mesh", (catalog: NativeCatalog) => ({ ...catalog, models: [...catalog.models, model("musveren:1", "LineageMonsters.field_stalker_m00")] }), "npc:21622"],
  ])("rejects duplicate %s instead of resolving last-one-wins", async (_label, duplicate, key) => {
    const catalog = duplicate(await inlineCatalog());
    await expect(buildNativeCatalogIndex(catalog, new AbortController().signal)).rejects.toThrow(`Native catalog has duplicate entries for ${key}.`);
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
