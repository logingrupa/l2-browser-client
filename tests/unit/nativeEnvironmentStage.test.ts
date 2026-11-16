import { createHash } from "node:crypto";
import { existsSync, promises as fs } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const { planNativeEnvironmentStage, applyNativeEnvironmentStage, stageNativeEnvironment } =
  await import(pathToFileURL(resolve("scripts/stage-native-environment.mjs")).href);
const roots: string[] = [];
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const json = (value: unknown) => Buffer.from(JSON.stringify(value, null, 2) + "\n");

async function temporary() {
  const root = await fs.mkdtemp(join(tmpdir(), "native-environment-stage-test-")); roots.push(root); return root;
}

async function tree(root: string): Promise<Record<string, { bytes: Buffer; mtimeMs: number }>> {
  const result: Record<string, { bytes: Buffer; mtimeMs: number }> = {};
  async function visit(path: string, prefix: string) {
    for (const item of await fs.readdir(path, { withFileTypes: true })) {
      if (item.isDirectory()) await visit(join(path, item.name), prefix + item.name + "/");
      else result[prefix + item.name] = { bytes: await fs.readFile(join(path, item.name)), mtimeMs: (await fs.stat(join(path, item.name))).mtimeMs };
    }
  }
  await visit(root, ""); return result;
}

interface FixtureRecord {
  readonly recordIndex: number;
  readonly line: number;
  readonly sourceOffset: number;
  readonly key?: string;
  readonly valueAscii?: string;
  readonly valueSourceOffset?: number;
}

function sourceRecords(lines: readonly string[]) {
  let offset = 0, section = "", sectionIndex = 0;
  return lines.map((text, index) => {
    const bytes = Buffer.from(text), body = text.trimEnd();
    const common = { recordIndex: index, line: index + 1, decodedOffset: offset, sourceOffset: offset + 28,
      bytes: bytes.length, rawHex: bytes.toString("hex"), hex: Buffer.from(body).toString("hex") };
    offset += bytes.length;
    if (body.startsWith("[")) { section = body.slice(1, -1); sectionIndex = index; return { ...common, kind: "section", name: section, sectionIndex }; }
    const [key, ...tail] = body.split("="), valueAscii = tail.join("="), valueDecodedOffset = common.decodedOffset + key!.length + 1;
    return { ...common, kind: "property", section, sectionIndex, key, valueAscii, valueHex: Buffer.from(valueAscii).toString("hex"),
      valueDecodedOffset, valueSourceOffset: valueDecodedOffset + 28 };
  });
}

function timeTableRow(record: FixtureRecord, keyNumber: number, values: Record<string, number>) {
  return { key: record.key!, keyNumber, recordIndex: record.recordIndex, line: record.line, sourceOffset: record.sourceOffset,
    valueSourceOffset: record.valueSourceOffset!, raw: record.valueAscii!, values, defaultedFields: [] as string[], unresolved: [] as string[] };
}

function unlocatedSetting(key: string, value: unknown, source: string, unresolved: string | null) {
  return { key, value, source, recordIndex: null as number | null, valueSourceOffset: null as number | null, raw: null as string | null, unresolved };
}

async function fixture() {
  const root = await temporary(), inputDir = join(root, "converted"), outputDir = join(root, "public/l2/environments");
  await fs.mkdir(inputDir);
  const lines = ["[EnvSetup]\r\n", "TimeRatio=6\r\n", "[SkyBoxColor]\r\n", "NUM=2\r\n",
    "COLOR1=(T=0,R=40,G=49,B=70)\r\n", "COLOR2=(T=12,R=66,G=124,B=176)\r\n"];
  const decoded = Buffer.from(lines.join("")), encrypted = Buffer.from(decoded.map(byte => byte ^ 0xac));
  const original = Buffer.concat([Buffer.from("Lineage2Ver111", "utf16le"), encrypted, Buffer.alloc(20)]);
  const source = { name: "Fixture.int", originalBytes: original.length, originalSha256: hash(original) };
  const records = sourceRecords(lines) as unknown as FixtureRecord[];
  const timeRatio = records[1]!;
  const tables = {
    schemaVersion: 1, kind: "native-environment-time-tables", rules: { path: "recipes/world/environment-native-rules.json", canonicalSha256: "d".repeat(64) },
    setup: { file: source.name, section: "EnvSetup",
      values: { TimeRatio: { key: "TimeRatio", value: 6 as unknown, source: "file", recordIndex: timeRatio.recordIndex as number | null,
        valueSourceOffset: timeRatio.valueSourceOffset! as number | null, raw: timeRatio.valueAscii! as string | null, unresolved: null as string | null },
      IsClock: unlocatedSetting("IsClock", true, "native-default", null) },
      bindings: { SKYBOX: unlocatedSetting("SKYBOX", "SkybackgroundColor", "native-default", null),
        HAZERING: unlocatedSetting("HAZERING", null, "unresolved", "environment-setup-value-missing:HAZERING"),
        NumCloudColor: unlocatedSetting("NumCloudColor", null, "unresolved", "environment-setup-value-missing:NumCloudColor"), CLOUD: [] },
      timeEnvironmentFiles: [] },
    environmentTypes: [{ file: source.name, originalSha256: source.originalSha256, decodedSha256: hash(decoded), environmentType: 0,
      environmentTypeSource: "native-default", environmentTypeRecordIndex: null, mergedDuplicateSections: [],
      tables: [{ section: "SkyBoxColor", kind: "rgb", sectionPresent: true, num: 2, numRecordIndex: 3, numSourceOffset: records[3]!.valueSourceOffset!,
        rows: [timeTableRow(records[4]!, 1, { T: 0, R: 40, G: 49, B: 70 }), timeTableRow(records[5]!, 2, { T: 12, R: 66, G: 124, B: 176 })],
        unresolved: [] as string[] }],
      unresolved: [] as string[] }],
    tableCount: 1, rowCount: 2, unresolved: ["environment-setup-value-missing:HAZERING", "environment-setup-value-missing:NumCloudColor"],
    typedComplete: false,
  };
  const ordered = { schemaVersion: 1, kind: "native-environment-ordered-records", sourceFileCount: 1, propertyRecords: 4,
    offsetSpace: "synthetic fixture", files: [{ ...source, decodedBytes: decoded.length, decodedSha256: hash(decoded), records }] };
  const products = new Map([
    ["original/Fixture.int", original], ["decoded/Fixture.int.bin", decoded], ["decoded/Fixture.int.txt", decoded],
    ["environment-records.json", json(ordered)], ["time-tables.json", json(tables)],
  ]);
  const manifest = { schemaVersion: 1, kind: "native-environment-conversion", implementation: { "fixture.py": "a".repeat(64) },
    inputs: [source], products: Object.fromEntries([...products].map(([name, bytes]) => [name, { bytes: bytes.length, sha256: hash(bytes) }])),
    runtimeIntegration: false, nativeRenderingParity: "unverified" };
  const write = async (name: string, bytes: Buffer) => { const path = join(inputDir, name); await fs.mkdir(dirname(path), { recursive: true }); await fs.writeFile(path, bytes); };
  for (const [name, bytes] of products) await write(name, bytes);
  await write("manifest.json", json(manifest));
  const updateProduct = async (name: string, value: unknown) => {
    const bytes = Buffer.isBuffer(value) ? value : json(value); await write(name, bytes);
    manifest.products[name] = { bytes: bytes.length, sha256: hash(bytes) }; await write("manifest.json", json(manifest));
  };
  return { root, inputDir, outputDir, options: { inputDir, outputDir }, manifest, tables, ordered, write, updateProduct };
}

afterEach(async () => {
  for (const root of roots.splice(0)) {
    const real = await fs.realpath(root);
    if (dirname(real) !== await fs.realpath(tmpdir()) || !basename(real).startsWith("native-environment-stage-test-")) throw Error("Unexpected cleanup root");
    await fs.rm(real, { recursive: true, force: true });
  }
});

describe("immutable converted environment browser staging", () => {
  it("plans read-only, stages exact time table bytes with provenance, and repeat/verify-only preserve every mtime", async () => {
    const f = await fixture(), input = await tree(f.inputDir), plan = await planNativeEnvironmentStage(f.options);
    expect(await tree(f.inputDir)).toEqual(input); expect(existsSync(f.outputDir)).toBe(false);
    const result = await applyNativeEnvironmentStage(plan);
    expect(result).toMatchObject({ status: "staged", writes: 3, tableCount: 1, rowCount: 2, originalFilesStaged: false });
    expect(basename(result.outputDir)).toBe(hash(await fs.readFile(join(f.inputDir, "manifest.json"))));
    const staged = await tree(result.outputDir);
    expect(Object.keys(staged).sort()).toEqual(["conversion-manifest.json", "manifest.json", "time-tables.json"]);
    expect(staged["time-tables.json"]!.bytes).toEqual(input["time-tables.json"]!.bytes);
    expect(staged["conversion-manifest.json"]!.bytes).toEqual(input["manifest.json"]!.bytes);
    const browser = JSON.parse(staged["manifest.json"]!.bytes.toString());
    expect(browser).toMatchObject({ kind: "native-environment-browser-source", sources: f.manifest.inputs, rowCount: 2, unresolved: f.tables.unresolved,
      sourceVerification: { sourceRecordAndTableJoinsVerifiedOffline: true, originalFilesStaged: false, decodedFilesStaged: false } });
    expect(await stageNativeEnvironment(f.options)).toMatchObject({ status: "preserved", writes: 0 });
    expect(await stageNativeEnvironment({ ...f.options, verifyOnly: true })).toMatchObject({ status: "verified", writes: 0 });
    expect(await tree(result.outputDir)).toEqual(staged); expect(await tree(f.inputDir)).toEqual(input);
  });

  it("fails verify-only without creating any missing output", async () => {
    const f = await fixture(); await expect(stageNativeEnvironment({ ...f.options, verifyOnly: true })).rejects.toThrow("verify-only");
    expect(existsSync(f.outputDir)).toBe(false);
  });

  it.each(["decoded/Fixture.int.txt", "original/Fixture.int", "time-tables.json"])("verifies every declared payload before writes: %s", async path => {
    const f = await fixture(); await f.write(path, Buffer.from("changed payload"));
    await expect(stageNativeEnvironment(f.options)).rejects.toThrow("hash/size mismatch"); expect(existsSync(f.outputDir)).toBe(false);
  });

  it("rejects a substituted conversion pin and an unowned source entry", async () => {
    const f = await fixture(); await expect(stageNativeEnvironment({ ...f.options, expectedManifestSha256: "b".repeat(64) })).rejects.toThrow("expected pin");
    await f.write("unexpected.txt", Buffer.from("retain"));
    await expect(stageNativeEnvironment(f.options)).rejects.toThrow("unowned entries"); expect(existsSync(f.outputDir)).toBe(false);
  });

  it.each(["../outside.bin", "decoded/../outside.bin", "decoded\\outside.bin", "decoded/NUL.bin", "decoded/trailing. "])("rejects unsafe declared path %s", async path => {
    const f = await fixture(); f.manifest.products[path] = { bytes: 1, sha256: "a".repeat(64) }; await f.write("manifest.json", json(f.manifest));
    await expect(stageNativeEnvironment(f.options)).rejects.toThrow(/path/); expect(existsSync(f.outputDir)).toBe(false);
  });

  it("refuses overlapping input/output and symlinked input ancestors", async () => {
    const f = await fixture(); await expect(stageNativeEnvironment({ inputDir: f.inputDir, outputDir: join(f.inputDir, "nested") })).rejects.toThrow("overlap");
    await expect(stageNativeEnvironment({ inputDir: f.inputDir, outputDir: f.root })).rejects.toThrow("overlap");
    const alias = join(f.root, "source-alias"); await fs.symlink(f.inputDir, alias, "junction");
    await expect(stageNativeEnvironment({ inputDir: alias, outputDir: f.outputDir })).rejects.toThrow("symlink/junction");
  });

  it("rejects an altered source identity even when product hashes are internally updated", async () => {
    const f = await fixture(); f.ordered.files[0]!.originalSha256 = "c".repeat(64);
    await f.updateProduct("environment-records.json", f.ordered);
    await expect(stageNativeEnvironment(f.options)).rejects.toThrow("source-record identity mismatch");
  });

  it("rejects a time table row that differs from its source record, rows out of key order and changed counts", async () => {
    const f = await fixture(), table = f.tables.environmentTypes[0]!.tables[0]!;
    table.rows[0]!.raw = "(T=0,R=1,G=2,B=3)"; await f.updateProduct("time-tables.json", f.tables);
    await expect(stageNativeEnvironment(f.options)).rejects.toThrow("differs from its source record");
    table.rows[0]!.raw = "(T=0,R=40,G=49,B=70)"; table.rows.reverse(); await f.updateProduct("time-tables.json", f.tables);
    await expect(stageNativeEnvironment(f.options)).rejects.toThrow("ascending key numbers");
    table.rows.reverse(); f.tables.rowCount = 3; await f.updateProduct("time-tables.json", f.tables);
    await expect(stageNativeEnvironment(f.options)).rejects.toThrow("counts differ");
  });

  it("rejects a setup value claimed from the file without a source record and a typedComplete that hides unresolved reasons", async () => {
    const f = await fixture();
    f.tables.setup.values.IsClock.source = "file"; await f.updateProduct("time-tables.json", f.tables);
    await expect(stageNativeEnvironment(f.options)).rejects.toThrow("claims a value without a source record");
    f.tables.setup.values.IsClock.source = "native-default"; f.tables.setup.values.TimeRatio.raw = "60"; await f.updateProduct("time-tables.json", f.tables);
    await expect(stageNativeEnvironment(f.options)).rejects.toThrow("differs from its source record");
    f.tables.setup.values.TimeRatio.raw = "6"; f.tables.typedComplete = true; await f.updateProduct("time-tables.json", f.tables);
    await expect(stageNativeEnvironment(f.options)).rejects.toThrow("unsupported time tables");
  });

  it("refuses changed or partial existing destinations without overwriting bytes", async () => {
    const f = await fixture(), result = await stageNativeEnvironment(f.options), table = join(result.outputDir, "time-tables.json");
    await fs.writeFile(table, "authored conflict"); const before = await tree(result.outputDir);
    await expect(stageNativeEnvironment(f.options)).rejects.toThrow("immutable staged file differs"); expect(await tree(result.outputDir)).toEqual(before);
    await fs.unlink(table); const partial = await tree(result.outputDir);
    await expect(stageNativeEnvironment(f.options)).rejects.toThrow("partial"); expect(await tree(result.outputDir)).toEqual(partial);
  });

  it("guards source and destination races between planning and application", async () => {
    const f = await fixture(), plan = await planNativeEnvironmentStage(f.options);
    await f.write("decoded/Fixture.int.txt", Buffer.from("changed after planning"));
    await expect(applyNativeEnvironmentStage(plan)).rejects.toThrow("input changed after planning"); expect(existsSync(f.outputDir)).toBe(false);
    const fresh = await fixture(), planned = await planNativeEnvironmentStage(fresh.options);
    await fs.mkdir(planned.summary.outputDir, { recursive: true });
    await expect(applyNativeEnvironmentStage(planned)).rejects.toThrow("destination changed after planning");
    expect(await fs.readdir(planned.summary.outputDir)).toEqual([]);
  });
});
