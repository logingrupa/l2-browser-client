import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadNativeTimeTables, nativeEnvironmentSource } from "../../src/scene/world/nativeEnvironmentTables";
import { readDayNightLoadedTables } from "../support/dayNightFixtures";
import { timeTablesDocument } from "../support/worldTimeOfDayFixture";

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const jsonBytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

function stagedExport(products: (tableBytes: Uint8Array) => Record<string, unknown>, document: unknown = timeTablesDocument()) {
  const tableBytes = jsonBytes(document);
  const manifestBytes = jsonBytes({ schemaVersion: 1, kind: "native-environment-conversion", products: products(tableBytes) });
  const conversionManifestSha256 = sha256(manifestBytes);
  const directory = `/l2/environments/${conversionManifestSha256}`;
  const files = new Map([[`${directory}/conversion-manifest.json`, manifestBytes], [`${directory}/time-tables.json`, tableBytes]]);
  const fetcher = vi.fn(async (url: string) => {
    const bytes = files.get(url);
    return bytes === undefined ? new Response("missing", { status: 404 }) : new Response(bytes.slice().buffer);
  });
  vi.stubGlobal("fetch", fetcher);
  return { conversionManifestSha256, fetcher };
}

const timeTablesProduct = (tableBytes: Uint8Array) => ({ "time-tables.json": { bytes: tableBytes.length, sha256: sha256(tableBytes) } });

afterEach(() => vi.unstubAllGlobals());

describe("loadNativeTimeTables", () => {
  it("loads the pinned conversion's time tables through the conversion manifest product pin", async () => {
    const staged = stagedExport(timeTablesProduct);
    const loaded = await loadNativeTimeTables(new AbortController().signal, staged.conversionManifestSha256);
    expect(loaded.status).toBe("loaded");
    if (loaded.status === "loaded") expect(loaded.timeTables.tables).toEqual(readDayNightLoadedTables());
    expect(staged.fetcher.mock.calls.map(([url]) => url)).toEqual([`/l2/environments/${staged.conversionManifestSha256}/conversion-manifest.json`,
      `/l2/environments/${staged.conversionManifestSha256}/time-tables.json`]);
  });

  it("reports an unstaged pin and an older export without time tables as environment-time-tables-unstaged", async () => {
    stagedExport(timeTablesProduct);
    expect(await loadNativeTimeTables(new AbortController().signal)).toMatchObject({ status: "gap", reason: "environment-time-tables-unstaged",
      detail: `/l2/environments/${nativeEnvironmentSource.conversionManifestSha256} is not staged.` });
    const olderExport = stagedExport(tableBytes => ({ "sky-tables.json": { bytes: tableBytes.length, sha256: sha256(tableBytes) } }));
    expect(await loadNativeTimeTables(new AbortController().signal, olderExport.conversionManifestSha256)).toMatchObject({ status: "gap",
      reason: "environment-time-tables-unstaged", detail: expect.stringContaining("older export without time-tables.json") });
  });

  it("reports an incomplete export with its own reasons and never builds tables from it", async () => {
    const document = { ...timeTablesDocument(), unresolved: ["environment-setup-value-missing:NumCloudColor"], typedComplete: false };
    const staged = stagedExport(timeTablesProduct, document);
    expect(await loadNativeTimeTables(new AbortController().signal, staged.conversionManifestSha256)).toEqual({ status: "gap",
      reason: "environment-time-tables-incomplete", detail: "environment-setup-value-missing:NumCloudColor" });
  });

  it("reports changed bytes, a malformed document and a server error as environment-time-tables-invalid instead of throwing", async () => {
    const changedBytes = stagedExport(tableBytes => ({ "time-tables.json": { bytes: tableBytes.length, sha256: "0".repeat(64) } }));
    expect(await loadNativeTimeTables(new AbortController().signal, changedBytes.conversionManifestSha256)).toMatchObject({ status: "gap",
      reason: "environment-time-tables-invalid", detail: expect.stringContaining("hash/length mismatch") });
    const malformed = stagedExport(timeTablesProduct, { ...timeTablesDocument(), kind: "native-environment-source-tables" });
    expect(await loadNativeTimeTables(new AbortController().signal, malformed.conversionManifestSha256)).toMatchObject({ status: "gap",
      reason: "environment-time-tables-invalid", detail: expect.stringContaining("is not native-environment-time-tables") });
    const staged = stagedExport(timeTablesProduct);
    expect(await loadNativeTimeTables(new AbortController().signal, "f".repeat(64))).toMatchObject({ reason: "environment-time-tables-unstaged" });
    staged.fetcher.mockResolvedValue(new Response("broken", { status: 500 }));
    expect(await loadNativeTimeTables(new AbortController().signal, staged.conversionManifestSha256)).toMatchObject({ status: "gap",
      reason: "environment-time-tables-invalid", detail: "The conversion manifest returned HTTP 500." });
  });

  it("rethrows an abort instead of reporting it as a gap", async () => {
    const staged = stagedExport(timeTablesProduct);
    const aborted = new AbortController();
    aborted.abort();
    await expect(loadNativeTimeTables(aborted.signal, staged.conversionManifestSha256)).rejects.toHaveProperty("name", "AbortError");
    expect(staged.fetcher).not.toHaveBeenCalled();
    const during = new AbortController();
    staged.fetcher.mockImplementation(async () => { during.abort(); throw during.signal.reason; });
    await expect(loadNativeTimeTables(during.signal, staged.conversionManifestSha256)).rejects.toHaveProperty("name", "AbortError");
  });
});
