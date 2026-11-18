import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadNativeTimeTables, nativeEnvironmentRecordId } from "../../src/scene/world/nativeEnvironmentTables";
import { readDayNightLoadedTables } from "../support/dayNightFixtures";
import { timeTablesDocument } from "../support/worldTimeOfDayFixture";

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const jsonBytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const timeTablesPin = (tableBytes: Uint8Array) => ({ file: "time-tables.json", bytes: tableBytes.length, sha256: sha256(tableBytes) });

interface StagedEnvironmentOptions {
  readonly document?: unknown;
  readonly tables?: (tableBytes: Uint8Array) => unknown;
  readonly environments?: (record: Record<string, unknown>) => readonly unknown[];
}

function stagedEnvironment(options: StagedEnvironmentOptions = {}) {
  const tableBytes = jsonBytes(options.document ?? timeTablesDocument());
  const manifestBytes = jsonBytes({ schemaVersion: 1, kind: "native-environment-browser-source", tables: (options.tables ?? timeTablesPin)(tableBytes) });
  const manifestSha256 = sha256(manifestBytes);
  const directory = `/l2/environments/${manifestSha256}`;
  const record = { id: nativeEnvironmentRecordId, manifest: `${directory}/manifest.json`, manifestSha256, manifestBytes: manifestBytes.length };
  const catalogBytes = jsonBytes({ schemaVersion: 1, models: [], environments: (options.environments ?? (pinned => [pinned]))(record) });
  const files = new Map([["/l2/catalog.json", catalogBytes], [`${directory}/manifest.json`, manifestBytes], [`${directory}/time-tables.json`, tableBytes]]);
  const fetcher = vi.fn(async (url: string) => {
    const bytes = files.get(url);
    return bytes === undefined ? new Response("missing", { status: 404 }) : new Response(bytes.slice().buffer);
  });
  vi.stubGlobal("fetch", fetcher);
  return { directory, fetcher, files };
}

const load = () => loadNativeTimeTables(new AbortController().signal);

afterEach(() => vi.unstubAllGlobals());

describe("loadNativeTimeTables", () => {
  it("loads the time tables the served catalog environments record pins through its browser manifest", async () => {
    const staged = stagedEnvironment();
    const loaded = await load();
    expect(loaded.status).toBe("loaded");
    if (loaded.status === "loaded") expect(loaded.timeTables.tables).toEqual(readDayNightLoadedTables());
    expect(staged.fetcher.mock.calls.map(([url]) => url)).toEqual(["/l2/catalog.json", `${staged.directory}/manifest.json`, `${staged.directory}/time-tables.json`]);
  });

  it("reports an unstaged catalog and a catalog without the environments record as environment-time-tables-unstaged", async () => {
    const staged = stagedEnvironment();
    staged.files.delete("/l2/catalog.json");
    expect(await load()).toEqual({ status: "gap", reason: "environment-time-tables-unstaged", detail: "/l2/catalog.json is not staged." });
    stagedEnvironment({ environments: () => [] });
    expect(await load()).toEqual({ status: "gap", reason: "environment-time-tables-unstaged",
      detail: `The served catalog has no environments record ${nativeEnvironmentRecordId}.` });
  });

  it("reports an incomplete export with its own reasons and never builds tables from it", async () => {
    stagedEnvironment({ document: { ...timeTablesDocument(), unresolved: ["environment-setup-value-missing:NumCloudColor"], typedComplete: false } });
    expect(await load()).toEqual({ status: "gap", reason: "environment-time-tables-incomplete", detail: "environment-setup-value-missing:NumCloudColor" });
  });

  it("reports changed bytes, a manifest without a tables pin, a malformed record or document, a schema 1 export and a server error as environment-time-tables-invalid", async () => {
    stagedEnvironment({ tables: tableBytes => ({ ...timeTablesPin(tableBytes), sha256: "0".repeat(64) }) });
    expect(await load()).toMatchObject({ status: "gap", reason: "environment-time-tables-invalid", detail: expect.stringContaining("hash/length mismatch") });
    stagedEnvironment({ tables: () => null });
    expect(await load()).toMatchObject({ status: "gap", reason: "environment-time-tables-invalid", detail: expect.stringContaining("pins no time-tables.json") });
    stagedEnvironment({ environments: record => [{ ...record, manifest: "/l2/environments/other/manifest.json" }] });
    expect(await load()).toMatchObject({ status: "gap", reason: "environment-time-tables-invalid", detail: "Native catalog environments entry is invalid." });
    stagedEnvironment({ document: { ...timeTablesDocument(), kind: "native-environment-source-tables" } });
    expect(await load()).toMatchObject({ status: "gap", reason: "environment-time-tables-invalid", detail: expect.stringContaining("is not native-environment-time-tables") });
    stagedEnvironment({ document: { ...timeTablesDocument(), schemaVersion: 1 } });
    expect(await load()).toMatchObject({ status: "gap", reason: "environment-time-tables-invalid", detail: expect.stringContaining("schema 2") });
    const staged = stagedEnvironment();
    staged.fetcher.mockResolvedValue(new Response("broken", { status: 500 }));
    expect(await load()).toMatchObject({ status: "gap", reason: "environment-time-tables-invalid", detail: "Native asset catalog returned HTTP 500." });
  });

  it("rethrows an abort instead of reporting it as a gap", async () => {
    const staged = stagedEnvironment();
    const aborted = new AbortController();
    aborted.abort();
    await expect(loadNativeTimeTables(aborted.signal)).rejects.toHaveProperty("name", "AbortError");
    expect(staged.fetcher).not.toHaveBeenCalled();
    const during = new AbortController();
    staged.fetcher.mockImplementation(async () => { during.abort(); throw during.signal.reason; });
    await expect(loadNativeTimeTables(during.signal)).rejects.toHaveProperty("name", "AbortError");
  });
});
