import { describe, expect, it, vi } from "vitest";
import { NativeCoverageCatalogMismatchError, readNativeCoverageUnlessAbsent } from "../../src/assets/native/readNativeCoverage";

const servedCatalogSha256 = "c".repeat(64);
const laneCatalogSha256 = "e".repeat(64);
const otherCatalogSha256 = "d".repeat(64);

const gapRow = { key: "npc:20001", part: "npcs", status: "gap", reason: "skeletal-licensee-unsupported:123/30", converted: false, loads: "unverified",
  steps: [{ step: "convert", status: "gap", reason: "skeletal-licensee-unsupported:123/30" }] };
const passRow = { key: "table:npcgrp", part: "tables", status: "pass", reason: null, converted: true, loads: "pass",
  steps: [{ step: "decode", status: "pass", reason: null }] };

function coverageBody(overrides: Record<string, unknown> = {}) {
  return { schemaVersion: 1, catalogSha256: servedCatalogSha256, storeRoot: "artifacts/lane-store/actors/l2",
    generatedAtRiga: "2026-11-08T22:00:00+02:00", denominators: { npcs: { count: "unknown", source: "docs/parts/npcs/actor-unit-census.json" } },
    parts: { npcs: { denominator: "unknown", converted: 0, loads: { pass: 0, failed: 0, unverified: 1 }, gap: 1, pending: 0 } },
    rows: [gapRow, passRow], ...overrides };
}

function coverageFetch(response: () => Response) {
  return vi.fn(async (_url: string | URL | Request) => response()) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

function readCoverage(response: () => Response, attestedLaneCatalogSha256: string | null = null) {
  return readNativeCoverageUnlessAbsent(new AbortController().signal, servedCatalogSha256, attestedLaneCatalogSha256, coverageFetch(response));
}

describe("native coverage report reader", () => {
  it("reads the rows of a coverage report pinned to the served catalog from /l2/coverage.json", async () => {
    const fetchResource = coverageFetch(() => Response.json(coverageBody()));
    const coverage = await readNativeCoverageUnlessAbsent(new AbortController().signal, servedCatalogSha256, null, fetchResource);
    expect(fetchResource.mock.calls[0]![0]).toBe("/l2/coverage.json");
    expect(coverage).toEqual({ schemaVersion: 1, catalogSha256: servedCatalogSha256, rows: [gapRow, passRow] });
  });

  it("reads a coverage report pinned to the served catalog when a lane catalog is attested", async () => {
    await expect(readCoverage(() => Response.json(coverageBody()), laneCatalogSha256))
      .resolves.toEqual({ schemaVersion: 1, catalogSha256: servedCatalogSha256, rows: [gapRow, passRow] });
  });

  it("reads a coverage report pinned to the attested lane catalog the served union came from", async () => {
    await expect(readCoverage(() => Response.json(coverageBody({ catalogSha256: laneCatalogSha256 })), laneCatalogSha256))
      .resolves.toEqual({ schemaVersion: 1, catalogSha256: laneCatalogSha256, rows: [gapRow, passRow] });
  });

  it.each([
    ["HTTP 404", () => new Response("missing", { status: 404 })],
    ["an HTML fallback page", () => new Response("<!DOCTYPE html><html><body>app</body></html>")],
  ])("answers null for %s", async (_label, response) => {
    await expect(readCoverage(response)).resolves.toBeNull();
  });

  it("reports other HTTP failures with their status", async () => {
    await expect(readCoverage(() => new Response("", { status: 503 }))).rejects.toThrow("Native coverage report returned HTTP 503.");
  });

  it.each([
    ["schemaVersion 2", coverageBody({ schemaVersion: 2 })],
    ["a row with status done", coverageBody({ rows: [{ ...gapRow, status: "done" }] })],
    ["a gap row with reason null", coverageBody({ rows: [{ ...gapRow, reason: null }] })],
    ["a pass row with a reason", coverageBody({ rows: [{ ...passRow, reason: "texture-missing" }] })],
    ["a duplicate key", coverageBody({ rows: [gapRow, gapRow] })],
    ["a catalogSha256 that is not 64 hex", coverageBody({ catalogSha256: "abc" })],
    ["a missing storeRoot", (({ storeRoot: _storeRoot, ...rest }) => rest)(coverageBody())],
    ["denominators that are not an object", coverageBody({ denominators: [] })],
    ["parts that are not an object", coverageBody({ parts: null })],
    ["a row with an unknown field", coverageBody({ rows: [{ ...gapRow, evidence: "docs/parts/npcs/EVIDENCE.md" }] })],
    ["a row with loads unknown", coverageBody({ rows: [{ ...gapRow, loads: "unknown" }] })],
    ["a step with a pass status and a reason", coverageBody({ rows: [{ ...gapRow, steps: [{ step: "convert", status: "pass", reason: "texture-missing" }] }] })],
    ["a step with a malformed step name", coverageBody({ rows: [{ ...gapRow, steps: [{ step: "Convert", status: "gap", reason: "texture-missing" }] }] })],
  ])("refuses a coverage report with %s", async (_label, body) => {
    await expect(readCoverage(() => Response.json(body))).rejects.toThrow("Native coverage report is invalid.");
  });

  it("refuses a body over 32 MiB", async () => {
    await expect(readCoverage(() => new Response(new Uint8Array(33_554_433).fill(0x20)))).rejects.toThrow("Native coverage report is invalid.");
  });

  it("refuses a body that is not UTF-8 or not JSON", async () => {
    await expect(readCoverage(() => new Response(new Uint8Array([0x7b, 0xff, 0x7d])))).rejects.toThrow("Native coverage report is invalid.");
    await expect(readCoverage(() => new Response("{rows"))).rejects.toThrow("Native coverage report is invalid.");
  });

  it("refuses a coverage report written for another catalog when no lane catalog is attested and names both SHA-256 values", async () => {
    const read = readCoverage(() => Response.json(coverageBody({ catalogSha256: otherCatalogSha256 })));
    await expect(read).rejects.toBeInstanceOf(NativeCoverageCatalogMismatchError);
    await expect(read).rejects.toThrow(`Native coverage report is pinned to catalog ${otherCatalogSha256}, but the served catalog is ${servedCatalogSha256}.`);
  });

  it("refuses a coverage report pinned to a lane catalog when the served catalog attests no lane catalog", async () => {
    const read = readCoverage(() => Response.json(coverageBody({ catalogSha256: laneCatalogSha256 })));
    await expect(read).rejects.toBeInstanceOf(NativeCoverageCatalogMismatchError);
    await expect(read).rejects.toThrow(`Native coverage report is pinned to catalog ${laneCatalogSha256}, but the served catalog is ${servedCatalogSha256}.`);
  });

  it("refuses a coverage report pinned to neither the served nor the attested lane catalog and names all three SHA-256 values", async () => {
    const read = readCoverage(() => Response.json(coverageBody({ catalogSha256: otherCatalogSha256 })), laneCatalogSha256);
    await expect(read).rejects.toBeInstanceOf(NativeCoverageCatalogMismatchError);
    await expect(read).rejects.toThrow(`Native coverage report is pinned to catalog ${otherCatalogSha256}, but the served catalog is ${servedCatalogSha256} `
      + `and the attested lane catalog is ${laneCatalogSha256}.`);
  });

  it("does not fetch for an aborted signal", async () => {
    const controller = new AbortController(), fetchResource = coverageFetch(() => Response.json(coverageBody()));
    controller.abort();
    await expect(readNativeCoverageUnlessAbsent(controller.signal, servedCatalogSha256, null, fetchResource)).rejects.toHaveProperty("name", "AbortError");
    expect(fetchResource).not.toHaveBeenCalled();
  });
});
