/** Optional effectComponents registration; never stages resources or selects playback. */
import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const plans = new WeakMap(), sha = bytes => createHash("sha256").update(bytes).digest("hex");
const require = (condition, message) => { if (!condition) throw Error(`Effect registration: ${message}`); };
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const digest = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
async function checked(value, directory = false) {
  require(typeof value === "string" && value.length > 0, "explicit path required");
  const absolute = resolve(value), chain = [];
  for (let path = absolute; dirname(path) !== path; path = dirname(path)) chain.unshift(path);
  let leaf;
  for (const path of chain) {
    const stat = await fs.lstat(path);
    require(!stat.isSymbolicLink() && (path === absolute || stat.isDirectory()), `symlink/junction or invalid ancestor: ${path}`);
    if (path === absolute) leaf = stat;
  }
  require(directory ? leaf?.isDirectory() : leaf?.isFile(), "expected existing regular input");
  return absolute;
}
async function snapshot(path, maximum) {
  await checked(path);
  const before = await fs.stat(path, { bigint: true });
  require(before.size > 0n && before.size <= BigInt(maximum), `input size outside supported range: ${path}`);
  const bytes = await fs.readFile(path), after = await fs.stat(path, { bigint: true });
  require(before.size === after.size && before.mtimeNs === after.mtimeNs && BigInt(bytes.length) === after.size, "input changed while read");
  return { path, bytes, sha256: sha(bytes), mtimeNs: String(after.mtimeNs), size: bytes.length };
}
async function unchanged(pin) {
  const now = await snapshot(pin.path, Math.max(pin.size, 2 * 1024 * 1024));
  require(now.sha256 === pin.sha256 && now.mtimeNs === pin.mtimeNs && now.size === pin.size, `stale plan/input changed: ${pin.path}`);
}

/** Span scanner follows the existing Editor append helpers' narrow-edit pattern.
 * It also rejects duplicate keys so untouched source data cannot be ambiguous. */
function document(bytes) {
  const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes), spans = new Map();
  let position = 0;
  const whitespace = () => { while (/\s/.test(text[position] ?? "") && position < text.length) position++; };
  function string() {
    const start = position++; let closed = false;
    while (position < text.length) { const char = text[position++]; if (char === "\\") position++; else if (char === '"') { closed = true; break; } }
    require(closed, "unterminated JSON string"); return JSON.parse(text.slice(start, position));
  }
  function value(path, depth = 0) {
    require(depth < 128, "JSON nesting limit exceeded"); whitespace(); const start = position;
    if (text[position] === "{") {
      position++; whitespace(); const keys = new Set();
      if (text[position] !== "}") while (true) {
        require(text[position] === '"', "invalid object key"); const key = string();
        require(!keys.has(key), `duplicate JSON key: ${key}`); keys.add(key); whitespace();
        require(text[position++] === ":", "invalid object member"); value([...path, key], depth + 1); whitespace();
        if (text[position] !== ",") break; position++; whitespace();
      }
      require(text[position++] === "}", "invalid object end");
    } else if (text[position] === "[") {
      position++; whitespace(); let index = 0;
      if (text[position] !== "]") while (true) { value([...path, index++], depth + 1); whitespace(); if (text[position] !== ",") break; position++; whitespace(); }
      require(text[position++] === "]", "invalid array end");
    } else if (text[position] === '"') string();
    else { const token = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(position)); require(token, "invalid JSON value"); position += token[0].length; }
    spans.set(JSON.stringify(path), [start, position]);
  }
  value([]); whitespace(); require(position === text.length, "unexpected trailing JSON");
  return { text, data: JSON.parse(text), span: path => spans.get(JSON.stringify(path)) };
}
async function staged(manifestPath, expected) {
  const path = await checked(manifestPath), manifestPin = await snapshot(path, 2 * 1024 * 1024), manifest = document(manifestPin.bytes).data;
  require(basename(path) === "manifest.json" && basename(dirname(path)) === manifestPin.sha256, "manifest path must contain its exact content hash");
  if (expected !== undefined) require(digest(expected) && expected === manifestPin.sha256, "unexpected staged manifest hash");
  require(object(manifest) && manifest.schemaVersion === 1 && manifest.kind === "native-effect-components" &&
    typeof manifest.id === "string" && /^[A-Za-z0-9][A-Za-z0-9:._-]{0,255}$/.test(manifest.id) &&
    object(manifest.resources) && Array.isArray(manifest.actors) && manifest.actors.length > 0 &&
    Array.isArray(manifest.components) && manifest.components.length > 0, "invalid staged component manifest");
  const entries = Object.entries(manifest.resources); require(entries.length > 0 && entries.length <= 256, "invalid staged resource count");
  const pins = new Map([["manifest.json", manifestPin]]);
  for (const [id, resource] of entries) {
    require(object(resource) && resource.assetId === id && digest(resource.sha256) && Number.isSafeInteger(resource.bytes) && resource.bytes > 0 &&
      resource.bytes <= 128 * 1024 * 1024 && (resource.file === `resources/${resource.sha256}.png` || resource.file === `resources/${resource.sha256}.glb`), "invalid staged resource identity/path");
    const pin = await snapshot(join(dirname(path), resource.file), 128 * 1024 * 1024);
    require(pin.size === resource.bytes && pin.sha256 === resource.sha256, "staged resource hash/size mismatch");
    pins.set(resource.file, pin);
  }
  const actual = [];
  async function visit(parent, prefix) {
    for (const row of await fs.readdir(parent, { withFileTypes: true })) {
      require(!row.isSymbolicLink(), "staged symlink/junction refused");
      if (row.isDirectory()) await visit(join(parent, row.name), prefix + row.name + "/");
      else { require(row.isFile(), "non-file staged entry"); actual.push(prefix + row.name); }
    }
  }
  await visit(dirname(path), "");
  require(JSON.stringify(actual.sort()) === JSON.stringify([...pins.keys()].sort()), "unexpected staged file set");
  return { manifest, manifestPin, pins: [...pins.values()] };
}

/** Explicit existing catalog only. Plan never writes a lock/temp/catalog. */
export async function planNativeEffectRegistration(options = {}) {
  const catalogPath = await checked(options.catalogPath), catalogPin = await snapshot(catalogPath, 8 * 1024 * 1024);
  require(basename(catalogPath) === "catalog.json", "catalog must be an explicit catalog.json file");
  if (options.expectedCatalogSha256 !== undefined) require(digest(options.expectedCatalogSha256) && options.expectedCatalogSha256 === catalogPin.sha256, "unexpected current catalog hash");
  const input = await staged(options.manifestPath, options.expectedManifestSha256), manifestSha256 = input.manifestPin.sha256;
  require(input.manifestPin.path === join(dirname(catalogPath), "effects", manifestSha256, "manifest.json"), "staged manifest is not at this catalog's /l2/effects path");
  const doc = document(catalogPin.bytes), catalog = doc.data;
  require(object(catalog) && catalog.schemaVersion === 1, "unsupported catalog");
  require(catalog.effectComponents === undefined || Array.isArray(catalog.effectComponents), "effectComponents must be an array");
  const entries = catalog.effectComponents ?? []; require(entries.length <= 64, "too many effect entries");
  require(entries.every(entry => object(entry) && typeof entry.id === "string"), "invalid existing effect entry");
  const matches = entries.map((entry, index) => entry.id === input.manifest.id ? index : -1).filter(index => index >= 0);
  require(matches.length <= 1, "duplicate selected effect ID");
  const index = matches[0], old = index === undefined ? undefined : entries[index];
  const entry = { ...old, id: input.manifest.id, manifest: `/l2/effects/${manifestSha256}/manifest.json`, manifestSha256 };
  let desired = catalogPin.bytes, editSpan = null;
  if (!old || old.manifest !== entry.manifest || old.manifestSha256 !== manifestSha256) {
    require(old || entries.length < 64, "too many effect entries");
    let start, end, text;
    if (index !== undefined) { [start, end] = doc.span(["effectComponents", index]); text = JSON.stringify(entry); }
    else if (catalog.effectComponents !== undefined) { const span = doc.span(["effectComponents"]); start = end = span[1] - 1; text = (entries.length ? "," : "") + JSON.stringify(entry); }
    else { const span = doc.span([]); start = end = span[1] - 1; text = `,"effectComponents":[${JSON.stringify(entry)}]`; }
    desired = Buffer.from(doc.text.slice(0, start) + text + doc.text.slice(end)); editSpan = { start, end, insertedText: text };
    const updated = document(desired).data, expected = { ...catalog, effectComponents: [...entries] };
    if (index === undefined) expected.effectComponents.push(entry); else expected.effectComponents[index] = entry;
    require(JSON.stringify(updated) === JSON.stringify(expected), "catalog edit changed unrelated semantic values");
  }
  const plan = Object.freeze({ status: "planned", catalogPath, catalogBeforeSha256: catalogPin.sha256, catalogAfterSha256: sha(desired),
    entry: Object.freeze(entry), change: !desired.equals(catalogPin.bytes), stagedResourcesVerified: input.pins.length - 1,
    manifestPath: input.manifestPin.path, manifestSha256, editedCharacterSpan: editSpan });
  plans.set(plan, { catalogPath, catalogPin, inputPins: input.pins, desired }); return plan;
}
async function removeOwned(path, expected) {
  try { await checked(path); require((await fs.readFile(path)).equals(expected), "owned temporary changed; retained"); await fs.unlink(path); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
}
/** Uses cooperative exclusive lock plus a final exact snapshot check. Atomic
 * rename is not OS-wide compare-and-swap against non-cooperating external tools;
 * callers must hold the shared catalog ownership window for those writers. */
export async function applyNativeEffectRegistration(plan, { verifyOnly = false } = {}) {
  const state = plans.get(plan); require(state, "apply requires this process's plan");
  for (const pin of state.inputPins) await unchanged(pin); await unchanged(state.catalogPin);
  if (!plan.change) return { status: verifyOnly ? "verified" : "preserved", catalogSha256: state.catalogPin.sha256, entry: plan.entry, filesWritten: 0 };
  require(!verifyOnly, "registration differs; verify writes nothing");
  const token = randomUUID(), lockPath = state.catalogPath + ".effect-registration.lock";
  const temporary = join(dirname(state.catalogPath), `.${basename(state.catalogPath)}.effect-${token}.tmp`), lockBytes = Buffer.from(token + "\n");
  let lock;
  try { lock = await fs.open(lockPath, "wx"); }
  catch (error) { if (error.code === "EEXIST") throw Error("Effect registration: another catalog registration holds the lock; preserved"); throw error; }
  try {
    await lock.writeFile(lockBytes); await lock.sync();
    for (const pin of state.inputPins) await unchanged(pin); await unchanged(state.catalogPin);
    const file = await fs.open(temporary, "wx");
    try { await file.writeFile(state.desired); await file.sync(); } finally { await file.close(); }
    await unchanged(state.catalogPin); // Last awaited read before the atomic move.
    await fs.rename(temporary, state.catalogPath);
    require((await fs.readFile(state.catalogPath)).equals(state.desired), "catalog changed after commit; newer contents retained");
    return { status: "registered", catalogSha256: sha(state.desired), entry: plan.entry, filesWritten: 1 };
  } finally {
    await lock.close(); await removeOwned(temporary, state.desired); await removeOwned(lockPath, lockBytes);
  }
}
export async function registerNativeEffectCatalog(options = {}) {
  if (options.catalogPath === undefined) return { status: "not-requested", filesWritten: 0 };
  const plan = await planNativeEffectRegistration(options);
  return options.planOnly ? plan : applyNativeEffectRegistration(plan, { verifyOnly: options.verifyOnly });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2), options = {};
    for (let index = 0; index < args.length; index++) {
      const key = args[index];
      if (key === "--plan") options.planOnly = true;
      else if (key === "--verify") options.verifyOnly = true;
      else {
        const field = { "--catalog": "catalogPath", "--manifest": "manifestPath", "--expected-manifest": "expectedManifestSha256", "--expected-catalog": "expectedCatalogSha256" }[key];
        require(field && args[index + 1] && !args[index + 1].startsWith("--") && options[field] === undefined, `invalid option: ${key}`); options[field] = args[++index];
      }
    }
    require(!(options.planOnly && options.verifyOnly), "choose plan or verify");
    console.log(JSON.stringify(await registerNativeEffectCatalog(options), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
