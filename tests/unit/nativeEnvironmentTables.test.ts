import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadNativeEnvironmentTables, nativeEnvironmentSource, parseNativeEnvironmentTables, selectNativeSkyLiteral,
  type NativeEnvironmentTables } from "../../src/scene/world/nativeEnvironmentTables";

const bytes = readFileSync("artifacts/native-parity/research/sky-environment-conversion-20261107/converted/sky-tables.json");
const original = JSON.parse(bytes.toString("utf8")) as NativeEnvironmentTables;
const copy = () => structuredClone(original);
const table = (data: NativeEnvironmentTables, section = "SkyBoxColor", file = "timeenv0.int") =>
  data.tables.find(value => value.file === file && value.section === section)!;

afterEach(() => vi.unstubAllGlobals());

describe("literal environment source records", () => {
  it("pins the retained input and preserves every ordered table, row and anomaly without aliasing", () => {
    expect(bytes.length).toBe(nativeEnvironmentSource.tablesBytes);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(nativeEnvironmentSource.tablesSha256);
    const parsed = parseNativeEnvironmentTables(original);
    expect(parsed).toEqual(original);
    expect(parsed.tableCount).toBe(20); expect(parsed.physicalColorRows).toBe(500);
    expect(parsed.duplicateSectionHeaders).toHaveLength(4);
    table(parsed).rows[0]!.rgb[0] = 0;
    expect(table(original).rows[0]!.rgb[0]).toBe(40);
  });

  it("selects the exact three COLOR13 rows and retains their source coordinates and identities", () => {
    const data = parseNativeEnvironmentTables(original), selected = selectNativeSkyLiteral(data, "timeenv0.int", "COLOR13");
    expect(selected).toMatchObject({ file: "timeenv0.int", key: "COLOR13", tLiteral: 12 });
    expect(selected.layers.map(layer => layer.material)).toEqual([
      "l2_skies.Shaders.SkybackgroundColor", "l2_skies.Shaders.HazeRing_Final", "l2_skies.Shaders.Cloud_Final",
    ]);
    expect(selected.layers.map(layer => layer.row.rgb)).toEqual([[66, 124, 176], [188, 203, 224], [255, 255, 255]]);
    expect(selected.layers.map(layer => [layer.row.recordIndex, layer.row.sourceOffset, layer.row.valueSourceOffset])).toEqual([
      [53, 1076, 1084], [88, 1984, 1992], [123, 2886, 2894],
    ]);
    expect(selected.layers.every(layer => layer.originalSha256 === "99fe1d3c71298a03f22d1d9491600e3cec89e0934e56b67a50c8afec08cfae54")).toBe(true);
    expect(selected.layers.every(layer => layer.decodedSha256 === "a32a972ab65bf633277fe84ad35a9ae9c35d21f6dd77eddea21dbed732cc4869")).toBe(true);
    selected.layers[0]!.row.rgb[0] = 0;
    expect(table(data).rows.find(row => row.key === "COLOR13")!.rgb).toEqual([66, 124, 176]);
  });

  it("selects an explicitly named physical row beyond NUM=1 while retaining the mismatch", () => {
    const data = parseNativeEnvironmentTables(original), selected = selectNativeSkyLiteral(data, "timeenv3.int", "COLOR25");
    expect(selected.tLiteral).toBe(24);
    expect(selected.layers[0]).toMatchObject({ declaredNum: 1, physicalColorRows: 25, declaredNumMatchesPhysicalRows: false,
      row: { key: "COLOR25", rgb: [255, 35, 35], recordIndex: 68, sourceOffset: 1518 } });
    expect(table(data, "SkyBoxColor", "timeenv3.int").rows).toHaveLength(25);
    expect(data.anomalies).toEqual(original.anomalies);
  });

  const malformed: [string, (data: NativeEnvironmentTables) => void][] = [
    ["RGB outside byte range", data => { table(data).rows[0]!.rgb[1] = 256; }],
    ["fractional RGB", data => { table(data).rows[0]!.rgb[1] = .5; }],
    ["missing RGB component", data => { table(data).rows[0]!.rgb.pop(); }],
    ["incomplete typed input", data => { Object.assign(data, { typedComplete: false }); }],
    ["table count", data => { data.tableCount--; }],
    ["global row count", data => { data.physicalColorRows--; }],
    ["physical row count", data => { table(data).physicalColorRows--; }],
    ["inconsistent count flag", data => { table(data).declaredNumMatchesPhysicalRows = false; }],
    ["invalid source identity", data => { table(data).originalSha256 = "unknown"; }],
    ["negative source offset", data => { table(data).rows[0]!.sourceOffset = -1; }],
    ["source path traversal", data => { table(data).file = "../timeenv0.int"; }],
  ];
  it.each(malformed)("rejects %s before returning usable source data", (_label, mutate) => {
    const data = copy(); mutate(data); expect(() => parseNativeEnvironmentTables(data)).toThrow();
  });

  const ambiguous: [string, (data: NativeEnvironmentTables) => void, RegExp][] = [
    ["duplicate section", data => { data.tables.push(structuredClone(table(data))); }, /ambiguous.*table/i],
    ["duplicate named row", data => { table(data).rows.push(structuredClone(table(data).rows.find(row => row.key === "COLOR13")!)); }, /ambiguous.*row/i],
    ["duplicate setup declaration", data => { data.envSetupDeclarations.push(structuredClone(data.envSetupDeclarations.find(entry => entry.key === "SKYBOX")!)); }, /binding/i],
    ["changed setup leaf", data => { data.envSetupDeclarations.find(entry => entry.key === "SKYBOX")!.valueAscii = "OtherSky"; }, /binding/i],
    ["different T literal", data => { table(data, "CloudColor1").rows.find(row => row.key === "COLOR13")!.tLiteral = 13; }, /different T literals/i],
    ["missing section", data => { data.tables = data.tables.filter(value => value !== table(data, "HazeringColor")); }, /ambiguous.*table/i],
    ["missing row", data => { table(data, "CloudColor1").rows = table(data, "CloudColor1").rows.filter(row => row.key !== "COLOR13"); }, /ambiguous.*row/i],
  ];
  it.each(ambiguous)("rejects %s without selecting implicit precedence or interpolation", (_label, mutate, reason) => {
    const data = copy(); mutate(data);
    expect(() => selectNativeSkyLiteral(data, "timeenv0.int", "COLOR13")).toThrow(reason);
  });
});

describe("lazy environment resource loading", () => {
  it.each(["https:", "file:"])("loads pinned bytes through the %s resource boundary only when called", async protocol => {
    vi.stubGlobal("location", { protocol });
    const fetcher = vi.fn().mockResolvedValue(new Response(new Uint8Array(bytes).buffer)); vi.stubGlobal("fetch", fetcher);
    expect(fetcher).not.toHaveBeenCalled();
    const abort = new AbortController(), loaded = await loadNativeEnvironmentTables(abort.signal);
    const path = `${protocol === "file:" ? "" : "/"}l2/environments/${nativeEnvironmentSource.conversionManifestSha256}/sky-tables.json`;
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(path, { signal: abort.signal });
    expect(loaded).toEqual(original);
  });
  it.each([404, 500])("reports HTTP %s instead of substituting a different table", async status => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status })); vi.stubGlobal("fetch", fetcher);
    await expect(loadNativeEnvironmentTables(new AbortController().signal)).rejects.toThrow(`HTTP ${status}`);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([false, true])("rejects changed source bytes (same length: %s)", async sameLength => {
    const changed = new Uint8Array(bytes); changed[40] = changed[40]! ^ 1;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(sameLength ? changed.buffer : changed.slice(1).buffer)));
    await expect(loadNativeEnvironmentTables(new AbortController().signal)).rejects.toThrow("hash/length mismatch");
  });
  it("does not fetch after pre-abort and rejects a body delivered after abort", async () => {
    const before = new AbortController(); before.abort();
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    await expect(loadNativeEnvironmentTables(before.signal)).rejects.toHaveProperty("name", "AbortError");
    expect(fetcher).not.toHaveBeenCalled();
    const during = new AbortController();
    fetcher.mockResolvedValue({ ok: true, arrayBuffer: async () => { during.abort(); return new Uint8Array(bytes).buffer; } });
    await expect(loadNativeEnvironmentTables(during.signal)).rejects.toHaveProperty("name", "AbortError");
  });
});
