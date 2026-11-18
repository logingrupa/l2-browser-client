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

function verifySources(manifest, payloads, records) {
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
  return sources;
}

const folded = value => typeof value === "string" ? value.toLowerCase() : value;

function joinedProperty(source, recordIndex, section, label) {
  const record = integer(recordIndex) ? source.records[recordIndex] : undefined;
  require(record?.kind === "property" && folded(record.section) === folded(section), `${label} does not join a source property`);
  return record;
}

function verifySetting(source, section, setting, label) {
  require(object(setting) && typeof setting.key === "string" && ["file", "native-default", "unresolved"].includes(setting.source), `${label} is not a setting`);
  if (setting.recordIndex === null) {
    require(setting.source !== "file" && setting.valueSourceOffset === null && setting.raw === null, `${label} claims a value without a source record`);
    return;
  }
  const record = joinedProperty(source, setting.recordIndex, section, label);
  require(folded(record.key) === folded(setting.key) && record.valueSourceOffset === setting.valueSourceOffset && record.valueAscii === setting.raw,
    `${label} differs from its source record`);
}

function verifySetup(sources, setup) {
  if (setup === null) return;
  const source = object(setup) ? [...sources.values()].find(entry => folded(entry.name) === folded(setup.file)) : undefined;
  require(source && object(setup.values) && object(setup.bindings) && Array.isArray(setup.bindings.CLOUD) && Array.isArray(setup.timeEnvironmentFiles) &&
    object(setup.fog) && typeof setup.fog.section === "string" && Array.isArray(setup.fog.startRanges) && Array.isArray(setup.fog.endRanges),
    "time tables setup does not join its source");
  const settings = [...Object.values(setup.values), setup.bindings.SKYBOX, setup.bindings.HAZERING, setup.bindings.NumCloudColor,
    ...setup.bindings.CLOUD, ...setup.timeEnvironmentFiles];
  settings.forEach((setting, index) => verifySetting(source, setup.section, setting, `setup setting ${index}`));
  const fogSettings = [...setup.fog.startRanges, ...setup.fog.endRanges, setup.fog.FogSpeed];
  fogSettings.forEach((setting, index) => verifySetting(source, setup.fog.section, setting, `fog setting ${index}`));
}

function verifyTimeTable(source, table, label) {
  require(object(table) && typeof table.section === "string" && Array.isArray(table.rows) && Array.isArray(table.unresolved), `${label} is not a table`);
  if (table.numRecordIndex !== null) {
    const record = joinedProperty(source, table.numRecordIndex, table.section, `${label} Num`);
    require(record.valueSourceOffset === table.numSourceOffset, `${label} Num offset differs from its source record`);
  }
  const keyNumbers = table.rows.map(row => row.keyNumber);
  require(keyNumbers.every((number, index) => Number.isSafeInteger(number) && number >= 1 && number <= table.num && (index === 0 || number > keyNumbers[index - 1])),
    `${label} rows are not ascending key numbers 1..Num`);
  for (const row of table.rows) {
    const record = joinedProperty(source, row.recordIndex, table.section, `${label} ${row.key}`);
    require(folded(record.key) === folded(row.key) && record.line === row.line && record.sourceOffset === row.sourceOffset &&
      record.valueSourceOffset === row.valueSourceOffset && record.valueAscii === row.raw && object(row.values),
    `${label} ${row.key} differs from its source record`);
  }
}

function verifyTimeTables(sources, tables) {
  require(tables.schemaVersion === 2 && tables.kind === "native-environment-time-tables" && Array.isArray(tables.environmentTypes) &&
    Array.isArray(tables.unresolved) && tables.unresolved.every(reason => typeof reason === "string") &&
    tables.typedComplete === (tables.unresolved.length === 0), "unsupported time tables");
  verifySetup(sources, tables.setup);
  let tableCount = 0, rowCount = 0;
  for (const entry of tables.environmentTypes) {
    const source = object(entry) ? sources.get(entry.file) : undefined;
    require(source && entry.originalSha256 === source.originalSha256 && entry.decodedSha256 === source.decodedSha256 && Array.isArray(entry.tables),
      `environment type file does not join its source: ${entry?.file}`);
    entry.tables.forEach((table, index) => verifyTimeTable(source, table, `${entry.file} table ${index}`));
    tableCount += entry.tables.length;
    rowCount += entry.tables.reduce((sum, table) => sum + table.rows.length, 0);
  }
  require(tables.tableCount === tableCount && tables.rowCount === rowCount, "time table counts differ from their tables");
}

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
  require(payloads.has("environment-records.json") && payloads.has("time-tables.json"), "source records or time tables missing");
  const records = parse(payloads.get("environment-records.json"), "environment-records.json"), tables = parse(payloads.get("time-tables.json"), "time-tables.json");
  verifyTimeTables(verifySources(manifest, payloads, records), tables);
  const browserManifest = {
    schemaVersion: 1, kind: "native-environment-browser-source",
    conversionManifest: descriptor(manifestBytes, "conversion-manifest.json"),
    tables: descriptor(payloads.get("time-tables.json"), "time-tables.json"),
    sources: manifest.inputs, tableCount: tables.tableCount, rowCount: tables.rowCount, unresolved: tables.unresolved,
    sourceVerification: { conversionProductsVerifiedOffline: names.length, originalSourcePinsVerifiedOffline: manifest.inputs.length,
      sourceRecordAndTableJoinsVerifiedOffline: true, originalFilesStaged: false, decodedFilesStaged: false },
    runtimePolicy: "effective native time tables; clock, environment type selection and colour writes are runtime work",
    nativeRenderingParity: "unverified",
  };
  const staged = new Map([["manifest.json", encode(browserManifest)], ["conversion-manifest.json", manifestBytes], ["time-tables.json", payloads.get("time-tables.json")]]);
  const browserManifestSha256 = hash(staged.get("manifest.json"));
  const target = join(output, browserManifestSha256);
  const targetState = await checkedPath(target);
  if (targetState.stat) {
    require(targetState.stat.isDirectory(), "staged destination is not a directory");
    require(isDeepStrictEqual(await listFiles(target), { files: [...staged.keys()].sort(), directories: [] }), "staged destination is partial or has unowned entries");
    for (const [name, bytes] of staged) require((await readBounded(target, name, 32 * 1024 * 1024)).equals(bytes), `immutable staged file differs: ${name}`);
  }
  const summary = { schemaVersion: 1, kind: "native-environment-stage-receipt", status: targetState.stat ? "preserved" : "planned",
    inputDir: input, outputDir: target, conversionManifestSha256: conversionSha256, browserManifestSha256,
    sourceProductsVerified: names.length, sourceFilesVerified: manifest.inputs.length, tableCount: tables.tableCount, rowCount: tables.rowCount,
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
