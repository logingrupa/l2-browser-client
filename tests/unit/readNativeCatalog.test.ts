import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { NATIVE_STORE_LANE_CATALOG_SHA256_HEADER } from "../../src/assets/native/nativeStoreLaneCatalogHeader";
import { NativeStoreNotStagedError, readNativeCatalog } from "../../src/assets/native/readNativeCatalog";
import { sha256 } from "../../src/assets/package/readAssetPackage";

const goldenCatalogPath = "tests/fixtures/golden/l2/catalog.json";

function catalogFetch(response: () => Response) {
  return vi.fn(async (_url: string | URL | Request) => response()) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

function catalogAttestingLaneCatalog(laneCatalogSha256: string) {
  return () => Response.json({ schemaVersion: 1, models: [] }, { headers: { [NATIVE_STORE_LANE_CATALOG_SHA256_HEADER]: laneCatalogSha256 } });
}

describe("native catalog reader", () => {
  it("issues one fetch for two reads on the same signal and fills absent slices with empty arrays", async () => {
    const fetchResource = catalogFetch(() => Response.json({ schemaVersion: 1, models: [{ id: "musveren:0" }], sections: [{ id: "map-20-20-section" }] }));
    const signal = new AbortController().signal;
    const [first, second] = await Promise.all([readNativeCatalog(signal, fetchResource), readNativeCatalog(signal, fetchResource)]);
    expect(first).toBe(second);
    expect(fetchResource).toHaveBeenCalledTimes(1);
    expect(fetchResource.mock.calls[0]![0]).toBe("/l2/catalog.json");
    expect(first.sections).toEqual([{ id: "map-20-20-section" }]);
    expect(first.effectComponents).toEqual([]);
    await readNativeCatalog(new AbortController().signal, fetchResource);
    expect(fetchResource).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["HTTP 404", () => new Response("missing", { status: 404 })],
    ["an HTML fallback page", () => new Response("<!DOCTYPE html><html><body>app</body></html>")],
    ["an html tag page", () => new Response("  <html></html>")],
  ])("reports %s as a store that is not staged", async (_label, response) => {
    const read = readNativeCatalog(new AbortController().signal, catalogFetch(response));
    await expect(read).rejects.toBeInstanceOf(NativeStoreNotStagedError);
    await expect(read).rejects.toThrow("Native asset store not staged: /l2/catalog.json is missing. Stage it from the main checkout.");
  });

  it("reports other HTTP failures with their status", async () => {
    await expect(readNativeCatalog(new AbortController().signal, catalogFetch(() => new Response("", { status: 503 }))))
      .rejects.toThrow("Native asset catalog returned HTTP 503.");
  });

  it.each([
    ["schemaVersion 2", { schemaVersion: 2, models: [] }],
    ["missing models", { schemaVersion: 1 }],
    ["a non-array sections slice", { schemaVersion: 1, models: [], sections: {} }],
    ["an array body", [{ schemaVersion: 1, models: [] }]],
    ["a non-array tiles slice", { schemaVersion: 1, models: [], tiles: {} }],
    ["a non-array tables slice", { schemaVersion: 1, models: [], tables: "npcgrp" }],
    ["a non-array windows slice", { schemaVersion: 1, models: [], windows: null }],
    ["a sourceCatalogSha256 that is not 64 hex", { schemaVersion: 1, models: [], sourceCatalogSha256: "abc" }],
    ["an upper-case sourceCatalogSha256", { schemaVersion: 1, models: [], sourceCatalogSha256: "A".repeat(64) }],
  ])("rejects a catalog with %s", async (_label, body) => {
    await expect(readNativeCatalog(new AbortController().signal, catalogFetch(() => Response.json(body))))
      .rejects.toThrow("Native asset catalog is invalid.");
  });

  it("keeps the tiles, tables and windows slices and the SHA-256 of the served golden catalog bytes", async () => {
    const bytes = new Uint8Array(await readFile(goldenCatalogPath));
    const catalog = await readNativeCatalog(new AbortController().signal, catalogFetch(() => new Response(bytes.slice())));
    expect(catalog.tiles).toEqual([expect.objectContaining({ id: "00_00" })]);
    expect(catalog.tables).toEqual([expect.objectContaining({ id: "syntheticfixture", recordCount: 1 })]);
    expect(catalog.windows).toEqual([expect.objectContaining({ id: "SyntheticFixtureWnd" })]);
    expect(catalog.servedCatalogSha256).toBe(await sha256(bytes));
    expect(catalog).not.toHaveProperty("sourceCatalogSha256");
  });

  it("answers a null lane catalog SHA-256 when the catalog answer has no lane catalog header", async () => {
    const catalog = await readNativeCatalog(new AbortController().signal, catalogFetch(() => Response.json({ schemaVersion: 1, models: [] })));
    expect(catalog.laneCatalogSha256).toBeNull();
  });

  it("keeps the lane catalog SHA-256 that the catalog answer attests in its header", async () => {
    const catalog = await readNativeCatalog(new AbortController().signal, catalogFetch(catalogAttestingLaneCatalog("e".repeat(64))));
    expect(catalog.laneCatalogSha256).toBe("e".repeat(64));
    expect(catalog.servedCatalogSha256).not.toBe("e".repeat(64));
  });

  it.each([
    ["not 64 hex digits", "abc"],
    ["upper-case hex", "E".repeat(64)],
    ["empty", ""],
    ["two values", `${"e".repeat(64)}, ${"f".repeat(64)}`],
  ])("rejects a catalog whose lane catalog header is %s and names the header and its value", async (_label, laneCatalogSha256) => {
    await expect(readNativeCatalog(new AbortController().signal, catalogFetch(catalogAttestingLaneCatalog(laneCatalogSha256))))
      .rejects.toThrow(`Native asset catalog is invalid: its X-Native-Store-Lane-Catalog-Sha256 header ${JSON.stringify(laneCatalogSha256)} is not 64 lowercase hex digits.`);
  });

  it("keeps a lane catalog's sourceCatalogSha256 and fills absent new slices with empty arrays", async () => {
    const catalog = await readNativeCatalog(new AbortController().signal,
      catalogFetch(() => Response.json({ schemaVersion: 1, models: [], sourceCatalogSha256: "e".repeat(64) })));
    expect(catalog.sourceCatalogSha256).toBe("e".repeat(64));
    expect(catalog.tiles).toEqual([]);
    expect(catalog.tables).toEqual([]);
    expect(catalog.windows).toEqual([]);
    expect(catalog.servedCatalogSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects a body that is not UTF-8 as an invalid catalog", async () => {
    await expect(readNativeCatalog(new AbortController().signal, catalogFetch(() => new Response(new Uint8Array([0x7b, 0xff, 0x7d])))))
      .rejects.toThrow("Native asset catalog is invalid.");
  });

  it("rejects a body that is not JSON as an invalid catalog", async () => {
    await expect(readNativeCatalog(new AbortController().signal, catalogFetch(() => new Response("{schemaVersion"))))
      .rejects.toThrow("Native asset catalog is invalid.");
  });

  it("evicts a rejected read so a later read with the same signal fetches again", async () => {
    let attempt = 0;
    const fetchResource = catalogFetch(() => ++attempt === 1 ? new Response("", { status: 500 }) : Response.json({ schemaVersion: 1, models: [] }));
    const signal = new AbortController().signal;
    await expect(readNativeCatalog(signal, fetchResource)).rejects.toThrow("HTTP 500");
    await expect(readNativeCatalog(signal, fetchResource)).resolves.toMatchObject({ schemaVersion: 1, models: [] });
    expect(fetchResource).toHaveBeenCalledTimes(2);
  });

  it("does not fetch for an aborted signal", async () => {
    const controller = new AbortController(), fetchResource = catalogFetch(() => Response.json({ schemaVersion: 1, models: [] }));
    controller.abort();
    await expect(readNativeCatalog(controller.signal, fetchResource)).rejects.toHaveProperty("name", "AbortError");
    expect(fetchResource).not.toHaveBeenCalled();
  });
});
