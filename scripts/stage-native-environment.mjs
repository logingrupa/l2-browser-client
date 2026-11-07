/** Stage exact converted environment tables for an explicitly selected browser
 * comparison. No environment, time, interpolation or material policy is chosen.
 * Source inputs and existing destinations are never overwritten. */
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

const plans = new WeakMap();
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const encode = value => Buffer.from(JSON.stringify(value, null, 2) + "\n");
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const digest = value => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
const fail = message => { throw Error(`Native environment stage: ${message}`); };
const require = (condition, message) => { if (!condition) fail(message); };
const inside = (parent, child) => { const rel = relative(parent, child); return !rel || !isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`); };

function safeRelative(value) {
  require(typeof value === "string" && !!value && !isAbsolute(value) && !value.includes("\\"), "invalid relative file path");
  require(value.split("/").every(part => part && part !== "." && part !== ".." &&
    !/[:\x00-\x1f]/.test(part) && !/[. ]$/.test(part) &&
    !/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(part)), "unsafe file path component");
  return value;
}

/** Check every existing ancestor, including a non-existing output's parents. */
async function checkedPath(value, directory = false) {
  require(typeof value === "string" && value.length > 0, "explicit input/output path required");
  const absolute = resolve(value), chain = [];
  for (let current = absolute; dirname(current) !== current; current = dirname(current)) chain.unshift(current);
  let leaf;
  for (const current of chain) {
    try {
      const stat = await fs.lstat(current);
      require(!stat.isSymbolicLink(), `symlink/junction refused: ${current}`);
      require(current === absolute || stat.isDirectory(), "path ancestor is not a directory");
      if (current === absolute) leaf = stat;
    } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  if (directory) require(leaf?.isDirectory(), "input must be an existing real directory");
  return { absolute, stat: leaf };
}

async function listFiles(root) {
  const files = [], directories = [];
  async function visit(path, prefix) {
    for (const entry of await fs.readdir(path, { withFileTypes: true })) {
      const rel = safeRelative(`${prefix}${entry.name}`), full = join(root, rel);
      require(!entry.isSymbolicLink(), `symlink/junction refused: ${rel}`);
      if (entry.isDirectory()) { directories.push(rel); await visit(full, `${rel}/`); }
      else { require(entry.isFile(), `non-file product refused: ${rel}`); files.push(rel); }
    }
  }
  await visit(root, "");
  return { files: files.sort(), directories: directories.sort() };
}

async function readBounded(root, rel, limit) {
  const path = await checkedPath(join(root, safeRelative(rel)));
  require(inside(root, path.absolute) && path.stat?.isFile(), `missing regular file: ${rel}`);
  require(path.stat.size > 0 && path.stat.size <= limit, `file exceeds supported size: ${rel}`);
  const bytes = await fs.readFile(path.absolute);
  require(bytes.length === path.stat.size, `file changed while reading: ${rel}`);
  return bytes;
}

function parse(bytes, label) {
  try { return JSON.parse(bytes.toString("utf8")); }
  catch { fail(`invalid JSON: ${label}`); }
}

function descriptor(bytes, file) { return { file, bytes: bytes.length, sha256: hash(bytes) }; }

function verifySources(manifest, payloads, records, tables) {
  require(records.schemaVersion === 1 && records.kind === "native-environment-ordered-records" &&
    Array.isArray(records.files) && records.files.length === manifest.inputs.length && records.sourceFileCount === records.files.length,
  "unsupported or inconsistent source records");
  const sources = new Map(), names = new Set();
  for (const source of manifest.inputs) {
    require(object(source) && typeof source.name === "string" && /^[A-Za-z0-9_.-]+\.int$/i.test(source.name) &&
      !source.name.startsWith(".") && !names.has(source.name.toLowerCase()) && integer(source.originalBytes) && source.originalBytes > 0 && digest(source.originalSha256),
    "invalid or duplicate source identity");
    safeRelative(source.name); names.add(source.name.toLowerCase());
    const original = payloads.get(`original/${source.name}`), decoded = payloads.get(`decoded/${source.name}.bin`);
    require(!!original && !!decoded && original.length === source.originalBytes && hash(original) === source.originalSha256,
      `source identity mismatch: ${source.name}`);
    require(original.length === decoded.length + 48 && original.subarray(0, 28).equals(Buffer.from("Lineage2Ver111", "utf16le")) &&
      decoded.every((byte, index) => (original[28 + index] ^ 0xac) === byte), `source/decoded span mismatch: ${source.name}`);
    const entries = records.files.filter(file => file.name === source.name);
    require(entries.length === 1, `missing or ambiguous source record: ${source.name}`);
    const entry = entries[0];
    require(entry.originalBytes === original.length && entry.originalSha256 === source.originalSha256 &&
      entry.decodedBytes === decoded.length && entry.decodedSha256 === hash(decoded) && Array.isArray(entry.records),
    `source-record identity mismatch: ${source.name}`);
    let offset = 0;
    for (const [index, row] of entry.records.entries()) {
      require(object(row) && row.recordIndex === index && row.line === index + 1 && row.decodedOffset === offset && row.sourceOffset === offset + 28 &&
        integer(row.bytes) && row.bytes > 0 && typeof row.rawHex === "string" && /^(?:[0-9a-f]{2})+$/.test(row.rawHex) &&
        row.rawHex.length === row.bytes * 2 && decoded.subarray(offset, offset + row.bytes).equals(Buffer.from(row.rawHex, "hex")),
      `raw record span mismatch: ${source.name}:${index}`);
      offset += row.bytes;
    }
    require(offset === decoded.length, `records do not cover decoded bytes: ${source.name}`);
    sources.set(source.name, entry);
  }
  require(records.propertyRecords === records.files.reduce((sum, file) => sum + file.records.filter(row => row.kind === "property").length, 0),
    "property record count mismatch");
  require(tables.schemaVersion === 1 && tables.kind === "native-environment-source-tables" && Array.isArray(tables.tables) &&
    tables.tableCount === tables.tables.length && integer(tables.physicalColorRows) && Array.isArray(tables.envSetupDeclarations) &&
    Array.isArray(tables.duplicateSectionHeaders) && Array.isArray(tables.anomalies) && object(tables.selection) &&
    Object.values(tables.selection).every(value => value === null), "unsupported tables or selected native policy");
  const identities = new Set();
  for (const table of tables.tables) {
    const source = sources.get(table.file), identity = `${table.file}:${table.sectionIndex}`;
    require(source && !identities.has(identity) && table.originalSha256 === source.originalSha256 && table.decodedSha256 === source.decodedSha256 &&
      integer(table.sectionIndex) && Array.isArray(table.rows) && table.physicalColorRows === table.rows.length && table.runtimeConsumedRows === null,
    "invalid table source identity or row count");
    identities.add(identity);
    const header = source.records[table.sectionIndex];
    require(header?.kind === "section" && header.name === table.section && header.line === table.headerLine && header.sourceOffset === table.headerSourceOffset,
      `table header does not join source: ${identity}`);
    const indices = new Set();
    for (const row of table.rows) {
      const raw = source.records[row.recordIndex];
      require(integer(row.recordIndex) && !indices.has(row.recordIndex) && raw?.kind === "property" && raw.sectionIndex === table.sectionIndex &&
        raw.key === row.key && raw.line === row.line && raw.sourceOffset === row.sourceOffset && raw.decodedOffset === row.decodedOffset &&
        raw.valueSourceOffset === row.valueSourceOffset && raw.valueAscii === row.rawValue,
      `table color row does not join source: ${identity}:${row.recordIndex}`);
      indices.add(row.recordIndex);
      if (row.typed) {
        const literal = /^\(\s*T\s*=\s*(\d+)\s*,\s*R\s*=\s*(\d+)\s*,\s*G\s*=\s*(\d+)\s*,\s*B\s*=\s*(\d+)\s*\)$/.exec(row.rawValue);
        const values = literal?.slice(1).map(Number);
        require(values && values[0] === row.tLiteral && Array.isArray(row.rgb) && row.rgb.length === 3 &&
          row.rgb.every((channel, index) => Number.isInteger(channel) && channel >= 0 && channel <= 255 && channel === values[index + 1]),
        `typed color differs from retained literal: ${identity}:${row.recordIndex}`);
      }
    }
    const expectedRows = source.records.filter(row => row.kind === "property" && row.sectionIndex === table.sectionIndex && /^COLOR\d+$/.test(row.key));
    require(isDeepStrictEqual(expectedRows.map(row => row.recordIndex), table.rows.map(row => row.recordIndex)), "table rows omitted or reordered");
    const declarations = source.records.filter(row => row.kind === "property" && row.sectionIndex === table.sectionIndex && row.key === "NUM");
    require(isDeepStrictEqual(declarations, table.numDeclarations), "NUM declarations differ from source");
  }
  require(tables.physicalColorRows === tables.tables.reduce((sum, table) => sum + table.rows.length, 0), "physical color total mismatch");
  const setup = records.files.flatMap(source => source.records.filter(row => row.kind === "property" && row.section === "EnvSetup").map(row => ({ file: source.name, ...row })));
  require(isDeepStrictEqual(setup, tables.envSetupDeclarations), "environment material/setup declarations differ from source");
}

/** Read and pin all inputs and existing output; this function writes nothing. */
export async function planNativeEnvironmentStage(options = {}) {
  const input = (await checkedPath(options.inputDir, true)).absolute;
  const output = (await checkedPath(options.outputDir)).absolute;
  require(!inside(input, output) && !inside(output, input), "input/output directories overlap");
  const manifestBytes = await readBounded(input, "manifest.json", 1024 * 1024), conversionSha256 = hash(manifestBytes);
  if (options.expectedManifestSha256 !== undefined) require(digest(options.expectedManifestSha256) && options.expectedManifestSha256 === conversionSha256,
    "conversion manifest differs from expected pin");
  const manifest = parse(manifestBytes, "manifest.json");
  require(manifest.schemaVersion === 1 && manifest.kind === "native-environment-conversion" && object(manifest.products) &&
    object(manifest.implementation) && Object.keys(manifest.implementation).length > 0 && Object.values(manifest.implementation).every(digest) &&
    Array.isArray(manifest.inputs) && manifest.inputs.length > 0 && manifest.inputs.length <= 32 && manifest.runtimeIntegration === false &&
    manifest.nativeRenderingParity === "unverified", "unsupported conversion manifest");
  const names = Object.keys(manifest.products);
  require(names.length > 0 && names.length <= 128 && new Set(names.map(name => name.toLowerCase())).size === names.length, "invalid product file set");
  const expectedFiles = ["manifest.json", ...names.map(safeRelative)].sort();
  const expectedDirectories = [...new Set(names.flatMap(name => { const parts = name.split("/"); return parts.slice(0, -1).map((_part, index) => parts.slice(0, index + 1).join("/")); }))].sort();
  const listing = await listFiles(input);
  require(isDeepStrictEqual(listing, { files: expectedFiles, directories: expectedDirectories }), "conversion directory has missing or unowned entries");
  const payloads = new Map([["manifest.json", manifestBytes]]); let total = manifestBytes.length;
  for (const name of names) {
    const pin = manifest.products[name];
    require(object(pin) && integer(pin.bytes) && pin.bytes > 0 && pin.bytes <= 32 * 1024 * 1024 && digest(pin.sha256), `invalid product descriptor: ${name}`);
    const bytes = await readBounded(input, name, 32 * 1024 * 1024);
    require(bytes.length === pin.bytes && hash(bytes) === pin.sha256, `product hash/size mismatch: ${name}`);
    total += bytes.length; require(total <= 128 * 1024 * 1024, "conversion exceeds supported total size");
    payloads.set(name, bytes);
  }
  require(payloads.has("environment-records.json") && payloads.has("sky-tables.json"), "source records or tables missing");
  const records = parse(payloads.get("environment-records.json"), "environment-records.json"), tables = parse(payloads.get("sky-tables.json"), "sky-tables.json");
  verifySources(manifest, payloads, records, tables);
  const browserManifest = {
    schemaVersion: 1, kind: "native-environment-browser-source",
    conversionManifest: descriptor(manifestBytes, "conversion-manifest.json"),
    tables: descriptor(payloads.get("sky-tables.json"), "sky-tables.json"),
    sources: manifest.inputs, tableCount: tables.tableCount, physicalColorRows: tables.physicalColorRows,
    sourceVerification: { conversionProductsVerifiedOffline: names.length, originalSourcePinsVerifiedOffline: manifest.inputs.length,
      sourceRecordAndTableJoinsVerifiedOffline: true, originalFilesStaged: false, decodedFilesStaged: false },
    selection: tables.selection, runtimePolicy: "unselected; literal source data only", nativeRenderingParity: "unverified",
  };
  const staged = new Map([["manifest.json", encode(browserManifest)], ["conversion-manifest.json", manifestBytes], ["sky-tables.json", payloads.get("sky-tables.json")]]);
  const target = join(output, conversionSha256);
  const targetState = await checkedPath(target);
  if (targetState.stat) {
    require(targetState.stat.isDirectory(), "staged destination is not a directory");
    require(isDeepStrictEqual(await listFiles(target), { files: [...staged.keys()].sort(), directories: [] }), "staged destination is partial or has unowned entries");
    for (const [name, bytes] of staged) require((await readBounded(target, name, 32 * 1024 * 1024)).equals(bytes), `immutable staged file differs: ${name}`);
  }
  const summary = { schemaVersion: 1, kind: "native-environment-stage-receipt", status: targetState.stat ? "preserved" : "planned",
    inputDir: input, outputDir: target, conversionManifestSha256: conversionSha256, browserManifestSha256: hash(staged.get("manifest.json")),
    sourceProductsVerified: names.length, sourceFilesVerified: manifest.inputs.length, tableCount: tables.tableCount, physicalColorRows: tables.physicalColorRows,
    originalFilesStaged: false, files: [...staged].map(([name, bytes]) => descriptor(bytes, name)), writes: targetState.stat ? 0 : staged.size };
  const plan = { summary: structuredClone(summary) };
  plans.set(plan, { input, output, target, listing, payloads, staged, existing: !!targetState.stat, summary });
  return plan;
}

export async function applyNativeEnvironmentStage(plan, options = {}) {
  const state = plans.get(plan); require(!!state, "unknown or already-applied plan");
  const { input, output, target, listing, payloads, staged, existing, summary } = state;
  await checkedPath(input, true); await checkedPath(output);
  require(isDeepStrictEqual(await listFiles(input), listing), "conversion file set changed after planning");
  for (const [name, bytes] of payloads) require((await readBounded(input, name, 32 * 1024 * 1024)).equals(bytes), `input changed after planning: ${name}`);
  const present = await checkedPath(target);
  require(!!present.stat === existing, "destination changed after planning");
  if (existing) {
    require(isDeepStrictEqual(await listFiles(target), { files: [...staged.keys()].sort(), directories: [] }), "destination entries changed after planning");
    for (const [name, bytes] of staged) require((await readBounded(target, name, 32 * 1024 * 1024)).equals(bytes), `destination changed after planning: ${name}`);
  } else {
    require(!options.verifyOnly, "verify-only requires a complete existing staged bundle");
    await fs.mkdir(output, { recursive: true }); await checkedPath(output, true);
    // Exclusive directory creation and exclusive file writes never overwrite an
    // existing destination. An I/O failure retains an explicitly partial bundle;
    // the next invocation rejects it rather than filling/overwriting unknown work.
    await fs.mkdir(target);
    for (const [name, bytes] of staged) await fs.writeFile(join(target, name), bytes, { flag: "wx" });
  }
  plans.delete(plan);
  return { ...structuredClone(summary), status: existing ? options.verifyOnly ? "verified" : "preserved" : "staged" };
}

export async function stageNativeEnvironment(options = {}) {
  return applyNativeEnvironmentStage(await planNativeEnvironmentStage(options), { verifyOnly: options.verifyOnly === true });
}

async function main(args) {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const name = args[i];
    if (name === "--verify-only") { require(options.verifyOnly === undefined, "duplicate --verify-only"); options.verifyOnly = true; continue; }
    const key = { "--input": "inputDir", "--output": "outputDir", "--manifest-sha256": "expectedManifestSha256" }[name];
    require(key && options[key] === undefined && args[i + 1] && !args[i + 1].startsWith("--"), `invalid argument: ${name}`);
    options[key] = args[++i];
  }
  console.log(JSON.stringify(await stageNativeEnvironment(options), null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
