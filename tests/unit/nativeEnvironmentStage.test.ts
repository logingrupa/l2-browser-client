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
const actual = resolve("artifacts/native-parity/research/sky-environment-conversion-20261107/converted");
const actualPin = "e10827c4e98daeed18062c9e85117a1f862a3e6dfcaad08638798f887081183d";

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

/** Small synthetic converted product, not an additional native source identity.
 * Declared NUM=1 deliberately retains two physical rows without precedence. */
async function fixture() {
  const root = await temporary(), inputDir = join(root, "converted"), outputDir = join(root, "public/l2/environments");
  await fs.mkdir(inputDir);
  const lines = ["[EnvSetup]\r\n", "SKYBOX=SkybackgroundColor\r\n", "[SkyBoxColor]\r\n", "NUM=1\r\n",
    "COLOR1=(T=0,R=40,G=49,B=70)\r\n", "COLOR2=(T=12,R=66,G=124,B=176)\r\n"];
  const decoded = Buffer.from(lines.join("")), encrypted = Buffer.from(decoded.map(byte => byte ^ 0xac));
  const original = Buffer.concat([Buffer.from("Lineage2Ver111", "utf16le"), encrypted, Buffer.alloc(20)]);
  const source = { name: "Fixture.int", originalBytes: original.length, originalSha256: hash(original) };
  let offset = 0, section = "", sectionIndex = 0;
  const records = lines.map((text, index) => {
    const bytes = Buffer.from(text), body = text.trimEnd();
    const common = { recordIndex: index, line: index + 1, decodedOffset: offset, sourceOffset: offset + 28,
      bytes: bytes.length, rawHex: bytes.toString("hex"), hex: Buffer.from(body).toString("hex") };
    offset += bytes.length;
    if (body.startsWith("[")) { section = body.slice(1, -1); sectionIndex = index; return { ...common, kind: "section", name: section, sectionIndex }; }
    const [key, ...tail] = body.split("="), valueAscii = tail.join("="), valueDecodedOffset = common.decodedOffset + key!.length + 1;
    return { ...common, kind: "property", section, sectionIndex, key, valueAscii, valueHex: Buffer.from(valueAscii).toString("hex"),
      valueDecodedOffset, valueSourceOffset: valueDecodedOffset + 28 };
  });
  const tables = {
    schemaVersion: 1, kind: "native-environment-source-tables", tableCount: 1, physicalColorRows: 2,
    tables: [{ file: source.name, originalSha256: source.originalSha256, decodedSha256: hash(decoded), section: "SkyBoxColor",
      sectionIndex: 2, headerLine: 3, headerSourceOffset: records[2]!.sourceOffset, envTypeDeclarations: [],
      declaredNum: 1, numDeclarations: [records[3]], physicalColorRows: 2, declaredNumMatchesPhysicalRows: false,
      rows: [4, 5].map((index, rowIndex) => {
        const raw = records[index]!;
        if (!("key" in raw)) throw Error("Expected fixture property record");
        return { key: raw.key, tLiteral: rowIndex ? 12 : 0, rgb: rowIndex ? [66, 124, 176] : [40, 49, 70], typed: true,
          line: raw.line, sourceOffset: raw.sourceOffset, decodedOffset: raw.decodedOffset, valueSourceOffset: raw.valueSourceOffset,
          rawValue: raw.valueAscii, recordIndex: index };
      }), otherProperties: [], typedComplete: true, runtimeConsumedRows: null }],
    envSetupDeclarations: [{ file: source.name, ...records[1] }], duplicateSectionHeaders: [],
    anomalies: [{ file: source.name, kind: "declared-count-mismatch", sectionIndex: 2, declaredNum: 1, physicalColorRows: 2 }],
    typedComplete: true, selection: { nativeEnvironmentType: null, nativeTime: null, interpolation: null,
      numConsumption: null, duplicateSectionPrecedence: null, liveColorWriter: null },
  };
  const ordered = { schemaVersion: 1, kind: "native-environment-ordered-records", sourceFileCount: 1, propertyRecords: 4,
    offsetSpace: "synthetic fixture", files: [{ ...source, decodedBytes: decoded.length, decodedSha256: hash(decoded), records }] };
  const products = new Map([
    ["original/Fixture.int", original], ["decoded/Fixture.int.bin", decoded], ["decoded/Fixture.int.txt", decoded],
    ["environment-records.json", json(ordered)], ["sky-tables.json", json(tables)],
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
  it("plans read-only, stages exact table bytes with provenance, and repeat/verify-only preserve every mtime", async () => {
    const f = await fixture(), input = await tree(f.inputDir), plan = await planNativeEnvironmentStage(f.options);
    expect(await tree(f.inputDir)).toEqual(input); expect(existsSync(f.outputDir)).toBe(false);
    const result = await applyNativeEnvironmentStage(plan);
    expect(result).toMatchObject({ status: "staged", writes: 3, tableCount: 1, physicalColorRows: 2, originalFilesStaged: false });
    expect(basename(result.outputDir)).toBe(hash(await fs.readFile(join(f.inputDir, "manifest.json"))));
    const staged = await tree(result.outputDir);
    expect(Object.keys(staged).sort()).toEqual(["conversion-manifest.json", "manifest.json", "sky-tables.json"]);
    expect(staged["sky-tables.json"]!.bytes).toEqual(input["sky-tables.json"]!.bytes);
    expect(staged["conversion-manifest.json"]!.bytes).toEqual(input["manifest.json"]!.bytes);
    const browser = JSON.parse(staged["manifest.json"]!.bytes.toString());
    expect(browser).toMatchObject({ kind: "native-environment-browser-source", sources: f.manifest.inputs,
      selection: f.tables.selection, sourceVerification: { sourceRecordAndTableJoinsVerifiedOffline: true, originalFilesStaged: false, decodedFilesStaged: false } });
    expect(await stageNativeEnvironment(f.options)).toMatchObject({ status: "preserved", writes: 0 });
    expect(await stageNativeEnvironment({ ...f.options, verifyOnly: true })).toMatchObject({ status: "verified", writes: 0 });
    expect(await tree(result.outputDir)).toEqual(staged); expect(await tree(f.inputDir)).toEqual(input);
  });

  it("fails verify-only without creating any missing output", async () => {
    const f = await fixture(); await expect(stageNativeEnvironment({ ...f.options, verifyOnly: true })).rejects.toThrow("verify-only");
    expect(existsSync(f.outputDir)).toBe(false);
  });

  it.each(["decoded/Fixture.int.txt", "original/Fixture.int", "sky-tables.json"])("verifies every declared payload before writes: %s", async path => {
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

  it("rejects a fabricated typed color or missing physical row rather than normalizing NUM", async () => {
    const f = await fixture(); f.tables.tables[0]!.rows[0]!.rgb = [1, 2, 3]; await f.updateProduct("sky-tables.json", f.tables);
    await expect(stageNativeEnvironment(f.options)).rejects.toThrow("typed color differs");
    f.tables.tables[0]!.rows[0]!.rgb = [40, 49, 70]; f.tables.tables[0]!.rows.pop(); f.tables.tables[0]!.physicalColorRows = 1; f.tables.physicalColorRows = 1;
    await f.updateProduct("sky-tables.json", f.tables);
    await expect(stageNativeEnvironment(f.options)).rejects.toThrow("rows omitted or reordered");
  });

  it("rejects non-null native selection and changed material setup declarations", async () => {
    const f = await fixture(); const tables = f.tables as any;
    tables.selection.nativeTime = 12; await f.updateProduct("sky-tables.json", tables);
    await expect(stageNativeEnvironment(f.options)).rejects.toThrow("selected native policy");
    tables.selection.nativeTime = null; tables.envSetupDeclarations[0].valueAscii = "guessed"; await f.updateProduct("sky-tables.json", tables);
    await expect(stageNativeEnvironment(f.options)).rejects.toThrow("setup declarations differ");
  });

  it("refuses changed or partial existing destinations without overwriting bytes", async () => {
    const f = await fixture(), result = await stageNativeEnvironment(f.options), table = join(result.outputDir, "sky-tables.json");
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

  it.skipIf(!existsSync(actual))("retains all 20 actual tables/500 rows and source anomalies from the pinned conversion", async () => {
    const output = join(await temporary(), "stage"), inputBefore = await tree(actual);
    const result = await stageNativeEnvironment({ inputDir: actual, outputDir: output, expectedManifestSha256: actualPin });
    expect(result).toMatchObject({ sourceProductsVerified: 17, sourceFilesVerified: 5, tableCount: 20, physicalColorRows: 500 });
    const bytes = await fs.readFile(join(result.outputDir, "sky-tables.json"));
    expect(bytes).toEqual(inputBefore["sky-tables.json"]!.bytes);
    const tables = JSON.parse(bytes.toString());
    expect(tables.tables.find((row: any) => row.file === "timeenv3.int" && row.section === "SkyBoxColor"))
      .toMatchObject({ declaredNum: 1, physicalColorRows: 25, declaredNumMatchesPhysicalRows: false });
    expect(tables.duplicateSectionHeaders).toHaveLength(4); expect(await tree(actual)).toEqual(inputBefore);
  });
});
