import { afterEach, describe, expect, it, vi } from "vitest";
import { buildNativeCatalogIndex, npcCatalogKey, tableCatalogKey, tileCatalogKey } from "../../src/assets/native/nativeCatalogIndex";
import { NativeCoverageCatalogMismatchError } from "../../src/assets/native/readNativeCoverage";
import { catalogWith, goldenCatalogIndex, goldenCatalogSha256, serveFiles } from "../support/nativeCatalogIndexFixtures";

function coverageRow(key: string, status: string, reason: string | null) {
  return { key, part: "npcs", status, reason, converted: false, loads: "unverified", steps: [{ step: "convert", status, reason }] };
}

function coverageFor(catalogSha256: string, rows: unknown[]) {
  return { schemaVersion: 1, catalogSha256, storeRoot: "artifacts/lane-store/actors/l2", generatedAtRiga: "2026-11-08T22:00:00+02:00",
    denominators: {}, parts: {}, rows };
}

async function indexWithCoverage(rows: unknown[]) {
  const catalog = catalogWith({});
  serveFiles(new Map(), coverageFor(catalog.servedCatalogSha256, rows));
  return buildNativeCatalogIndex(catalog, new AbortController().signal);
}

afterEach(() => { vi.unstubAllGlobals(); });

describe("native catalog index gap answers from the coverage report", () => {
  it("answers a gap with its reason for a key the catalog lacks and lists it among the keys", async () => {
    const index = await indexWithCoverage([coverageRow("npc:20001", "gap", "skeletal-licensee-unsupported:123/30")]);
    expect(index.lookup(npcCatalogKey(20001))).toEqual({ status: "gap", key: "npc:20001", reason: "skeletal-licensee-unsupported:123/30", coverageStatus: "gap" });
    expect(index.keys("npc:")).toEqual(["npc:20001"]);
  });

  it.each(["pending", "failed"] as const)("answers a %s row as a gap with that coverage status", async coverageStatus => {
    const index = await indexWithCoverage([coverageRow("npc:20001", coverageStatus, "step-pending:convert")]);
    expect(index.lookup(npcCatalogKey(20001))).toEqual({ status: "gap", key: "npc:20001", reason: "step-pending:convert", coverageStatus });
  });

  it("never makes a key converted from a coverage pass row", async () => {
    const index = await indexWithCoverage([{ ...coverageRow("table:npcgrp", "pass", null), converted: true }]);
    expect(index.lookup(tableCatalogKey("npcgrp"))).toEqual({ status: "not-in-catalog", key: "table:npcgrp", reason: "not in catalog" });
    expect(index.keys("table:")).toEqual([]);
  });

  it("keeps a key the catalog converts as converted when a stale coverage row says gap", async () => {
    const { index } = await goldenCatalogIndex(coverageFor(await goldenCatalogSha256(), [coverageRow("tile:00_00", "gap", "terrain-unsupported")]));
    expect(index.lookup(tileCatalogKey("00_00"))).toMatchObject({ status: "converted", key: "tile:00_00" });
  });

  it("refuses to build an index next to coverage written for another catalog", async () => {
    serveFiles(new Map(), coverageFor("d".repeat(64), []));
    await expect(buildNativeCatalogIndex(catalogWith({}), new AbortController().signal)).rejects.toBeInstanceOf(NativeCoverageCatalogMismatchError);
  });
});
