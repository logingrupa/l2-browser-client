import { afterEach, describe, expect, it, vi } from "vitest";
import { sha256 } from "../../src/assets/package/readAssetPackage";
import { nameIndexRecordId, readNativeTableNameIndex } from "../../src/ui/nativeTables/readNativeTableNameIndex";

const sourceSha256 = "b".repeat(64);

function nameIndexManifest(entries: readonly Record<string, unknown>[], overrides: Record<string, unknown> = {}) {
  return { kind: "native-table-name-index", schemaVersion: 1, table: "npcname-e", sourceManifestSha256: "a".repeat(64), sourceSha256,
    identifierFields: ["id"], nameField: "name", entryCount: entries.length, duplicateIdentifierCount: 0, entries, ...overrides };
}

async function servedNameIndex(manifest: unknown, options: { tamper?: boolean; withRecord?: boolean } = {}) {
  const bytes = new TextEncoder().encode(JSON.stringify(manifest));
  const manifestSha256 = await sha256(bytes);
  const recordId = nameIndexRecordId("npcname-e");
  const manifestPath = `/l2/tables/${manifestSha256}/${recordId}.json`;
  const entryCount = (manifest as { entryCount: number }).entryCount;
  const tables = options.withRecord === false ? [] : [{ id: recordId, manifest: manifestPath, manifestSha256, manifestBytes: bytes.length,
    recordCount: entryCount, sourceSha256 }];
  const catalogBytes = new TextEncoder().encode(JSON.stringify({ schemaVersion: 1, models: [], tables }));
  const servedBytes = options.tamper ? new TextEncoder().encode(JSON.stringify(manifest).replace("Gremlin", "Gremlix")) : bytes;
  const fetchStub = vi.fn(async (url: string) => {
    if (url === "/l2/catalog.json") return new Response(catalogBytes.slice());
    if (url === manifestPath) return new Response(servedBytes.slice());
    throw new Error(`Unexpected request ${url}`);
  });
  vi.stubGlobal("fetch", fetchStub);
  return { fetchStub, manifestPath };
}

const gremlinEntries = [{ id: 20001, name: "Gremlin" }, { id: 20002, name: "Gremlin" }, { id: 21622, name: "Greater Musveren" }];

afterEach(() => { vi.unstubAllGlobals(); });

describe("native table name index reader", () => {
  it("names the derived tables record id from the inventory table name", () => {
    expect(nameIndexRecordId("npcname-e")).toBe("npcname_e_names");
    expect(nameIndexRecordId("skillname-e")).toBe("skillname_e_names");
    expect(() => nameIndexRecordId("NpcName")).toThrow(RangeError);
  });

  it("returns hash-verified entries with their identifiers, names and source order", async () => {
    const { manifestPath } = await servedNameIndex(nameIndexManifest(gremlinEntries));
    const read = await readNativeTableNameIndex("npcname-e", new AbortController().signal);
    expect(read).toEqual({ status: "converted", key: "table:npcname_e_names", manifest: manifestPath, identifierFields: ["id"], entries: [
      { identifiers: [20001], name: "Gremlin", sourceOrder: 0 }, { identifiers: [20002], name: "Gremlin", sourceOrder: 1 },
      { identifiers: [21622], name: "Greater Musveren", sourceOrder: 2 },
    ] });
  });

  it("keeps two identifier fields for skill rows", async () => {
    const entries = [{ skill_id: 3, skill_level: 1, name: "Power Strike" }, { skill_id: 3, skill_level: 2, name: "Power Strike" }];
    const manifest = nameIndexManifest(entries, { table: "skillname-e", identifierFields: ["skill_id", "skill_level"] });
    const bytes = new TextEncoder().encode(JSON.stringify(manifest));
    const manifestSha256 = await sha256(bytes);
    const manifestPath = `/l2/tables/${manifestSha256}/skillname_e_names.json`;
    const catalogBytes = new TextEncoder().encode(JSON.stringify({ schemaVersion: 1, models: [], tables: [{ id: "skillname_e_names",
      manifest: manifestPath, manifestSha256, manifestBytes: bytes.length, recordCount: 2, sourceSha256 }] }));
    vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response((url === manifestPath ? bytes : catalogBytes).slice())));
    const read = await readNativeTableNameIndex("skillname-e", new AbortController().signal);
    expect(read.status === "converted" ? read.entries.map(entry => entry.identifiers) : null).toEqual([[3, 1], [3, 2]]);
  });

  it("refuses a manifest whose bytes differ from the catalog SHA-256", async () => {
    await servedNameIndex(nameIndexManifest(gremlinEntries), { tamper: true });
    await expect(readNativeTableNameIndex("npcname-e", new AbortController().signal)).rejects.toThrow(/differs from its catalog length or SHA-256/);
  });

  it("reports not-in-catalog with its reason when the catalog has no name index record", async () => {
    await servedNameIndex(nameIndexManifest(gremlinEntries), { withRecord: false });
    await expect(readNativeTableNameIndex("npcname-e", new AbortController().signal)).resolves.toEqual({ status: "not-in-catalog",
      key: "table:npcname_e_names", reason: "npcname_e_names has no tables record in the served catalog" });
  });

  it.each([
    ["a wrong kind", { kind: "native-table" }, /kind must be native-table-name-index version 1/],
    ["a wrong version", { schemaVersion: 2 }, /kind must be native-table-name-index version 1/],
    ["another table", { table: "itemname-e" }, /table must be npcname-e/],
    ["no identifier fields", { identifierFields: [] }, /identifierFields must list one or two field names/],
    ["a negative identifier", { entries: [{ id: -1, name: "Gremlin" }], entryCount: 1 }, /entry 0 has an identifier that is not a safe non-negative integer/],
    ["a fractional identifier", { entries: [{ id: 1.5, name: "Gremlin" }], entryCount: 1 }, /entry 0 has an identifier/],
    ["a missing name", { entries: [{ id: 1 }], entryCount: 1 }, /entry 0 has no string name/],
    ["a wrong entry count", { entryCount: 2 }, /entryCount must equal/],
  ])("refuses a manifest with %s", async (_label, overrides, message) => {
    const entries = (overrides as { entries?: Record<string, unknown>[] }).entries ?? gremlinEntries;
    const manifest = { ...nameIndexManifest(entries), ...overrides };
    const bytes = new TextEncoder().encode(JSON.stringify(manifest));
    const manifestSha256 = await sha256(bytes);
    const manifestPath = `/l2/tables/${manifestSha256}/npcname_e_names.json`;
    const catalogBytes = new TextEncoder().encode(JSON.stringify({ schemaVersion: 1, models: [], tables: [{ id: "npcname_e_names",
      manifest: manifestPath, manifestSha256, manifestBytes: bytes.length, recordCount: entries.length, sourceSha256 }] }));
    vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response((url === manifestPath ? bytes : catalogBytes).slice())));
    await expect(readNativeTableNameIndex("npcname-e", new AbortController().signal)).rejects.toThrow(message);
  });

  it("shares one fetch between two reads under one signal", async () => {
    const { fetchStub, manifestPath } = await servedNameIndex(nameIndexManifest(gremlinEntries));
    const signal = new AbortController().signal;
    const [first, second] = await Promise.all([readNativeTableNameIndex("npcname-e", signal), readNativeTableNameIndex("npcname-e", signal)]);
    expect(second).toBe(first);
    expect(fetchStub.mock.calls.filter(([url]) => url === manifestPath)).toHaveLength(1);
  });

  it("rejects a pending read when its signal aborts", async () => {
    await servedNameIndex(nameIndexManifest(gremlinEntries));
    const controller = new AbortController();
    const pending = readNativeTableNameIndex("npcname-e", controller.signal);
    controller.abort(new DOMException("Sheet closed", "AbortError"));
    await expect(pending).rejects.toThrow("Sheet closed");
  });
});
