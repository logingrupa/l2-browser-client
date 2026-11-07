/** Append one source-backed BSP fragment without regenerating the authored world.
 * Input coordinates are already right-handed world metres. Only the new mesh,
 * its binary, and the three exact manifest metadata locations may be written. */
import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual as same } from "node:util";
import { geometryWriter } from "./native_editor_scene.mjs";

const SCENE = "assets/native-world.scene", HASH = /^[a-f0-9]{64}$/;
const BSP_SOURCES = {
  "interlude:20_20.Model798.Brush397": { brush: "20_20.Brush397", file: "bsp-floor", placement: "interlude:20_20.StaticMeshActor940", material: "L2fortress_01_T.Fort01_command_planw" },
  ...Object.fromEntries(Object.entries({ walls: "L2fortress_01_T.Fort01_deffense_wall01", floor: "L2fortress_01_T.Fort01_command_planw", ceiling: "L2fortress_01_T.fort_wsquare_bwall" })
    .map(([part, material]) => [`interlude:20_20.Model798.Brush610.${part}`, { brush: "20_20.Brush610", file: `bsp-command-${part}`, placement: "interlude:20_20.StaticMeshActor1913", material }]))
};
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const plans = new WeakMap();
const hash = value => createHash("sha256").update(value).digest("hex");
const clone = value => JSON.parse(JSON.stringify(value));
const encode = value => Buffer.from(JSON.stringify(value, null, 2) + "\n");
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const fail = message => { throw Error(`Native Editor BSP append: ${message}`); };

async function pathIn(root, input) {
  if (typeof input !== "string" || !input) fail("invalid path.");
  const absolute = resolve(root, input), rel = relative(root, absolute);
  if (!rel || isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) fail("path escapes project.");
  let current = root;
  const parts = rel.split(sep);
  for (const [index, part] of parts.entries()) {
    if (!part || /[:\x00-\x1f]/.test(part) || /[. ]$/.test(part) || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(part)) fail("unsafe path component.");
    current = join(current, part);
    try {
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink()) fail(`symlink/junction refused: ${rel}.`);
      if (index < parts.length - 1 && !stat.isDirectory()) fail(`path parent is not a directory: ${rel}.`);
    } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  return { absolute, path: rel.split(sep).join("/") };
}

// Preserve the original JSON bytes outside precisely selected value spans.
function valueSpan(text, wanted) {
  let offset = 0, found;
  const whitespace = () => { while (offset < text.length && /\s/.test(text[offset])) offset++; };
  const string = () => {
    const start = offset++;
    while (offset < text.length) {
      const ch = text[offset++];
      if (ch === "\\") offset++;
      else if (ch === '"') return JSON.parse(text.slice(start, offset));
    }
    fail("unterminated JSON string.");
  };
  const visit = keys => {
    whitespace(); const start = offset;
    if (text[offset] === "{") {
      offset++; whitespace(); const seen = new Set();
      while (text[offset] !== "}") {
        if (text[offset] !== '"') fail("invalid JSON object.");
        const key = string();
        if (seen.has(key)) fail("duplicate JSON key.");
        seen.add(key); whitespace();
        if (text[offset++] !== ":") fail("invalid JSON property.");
        visit([...keys, key]); whitespace();
        if (text[offset] !== ",") break;
        offset++; whitespace();
      }
      if (text[offset++] !== "}") fail("invalid JSON object end.");
    } else if (text[offset] === "[") {
      offset++; whitespace(); let index = 0;
      while (text[offset] !== "]") {
        visit([...keys, index++]); whitespace();
        if (text[offset] !== ",") break;
        offset++; whitespace();
      }
      if (text[offset++] !== "]") fail("invalid JSON array end.");
    } else if (text[offset] === '"') string();
    else { while (offset < text.length && !/[\s,}\]]/.test(text[offset])) offset++; }
    if (same(keys, wanted)) { if (found) fail("ambiguous JSON path."); found = [start, offset]; }
  };
  visit([]); whitespace();
  if (offset !== text.length || !found) fail("missing JSON replacement path.");
  return found;
}

function jsonText(bytes) {
  const text = bytes.toString("utf8");
  if (!Buffer.from(text).equals(bytes)) fail("invalid UTF-8 JSON.");
  JSON.parse(text); valueSpan(text, []); return text;
}
function replaceHash(bytes, keys, oldHash, newHash) {
  const text = jsonText(bytes), [start, end] = valueSpan(text, keys);
  if (text.slice(start, end) !== JSON.stringify(oldHash)) fail("expected exact old manifest hash token.");
  return Buffer.from(text.slice(0, start) + JSON.stringify(newHash) + text.slice(end));
}
function appendBsp(bytes, expected, bsp) {
  const text = jsonText(bytes), [start, end] = valueSpan(text, ["metadata", "nativeWorldRoot", "manifest"]);
  if (!same(JSON.parse(text.slice(start, end)), expected)) fail("embedded base manifest changed.");
  if (Object.hasOwn(expected, "bsp")) {
    if (!Array.isArray(expected.bsp) || bsp.length !== expected.bsp.length + 1 || !same(bsp.slice(0, -1), expected.bsp)) fail("existing BSP resources changed.");
    const [arrayStart, arrayEnd] = valueSpan(text, ["metadata", "nativeWorldRoot", "manifest", "bsp"]);
    let insertion = arrayEnd - 1;
    while (insertion > arrayStart && /\s/.test(text[insertion - 1])) insertion--;
    const added = `${expected.bsp.length ? "," : ""}${JSON.stringify(bsp.at(-1))}`;
    const output = Buffer.from(text.slice(0, insertion) + added + text.slice(insertion));
    jsonText(output); return output;
  }
  let insertion = end - 1;
  while (insertion > start && /\s/.test(text[insertion - 1])) insertion--;
  // All existing source values and whitespace survive; only add this property.
  const added = `${Object.keys(expected).length ? "," : ""}"bsp":${JSON.stringify(bsp)}`;
  const output = Buffer.from(text.slice(0, insertion) + added + text.slice(insertion));
  jsonText(output); return output;
}

function validateSnapshot(snapshot) {
  if (!object(snapshot) || snapshot.schemaVersion !== 1 || snapshot.kind !== "native-editor-bsp-snapshot" || !HASH.test(snapshot.baseManifestSha256)) fail("invalid BSP snapshot identity.");
  const bsp = snapshot.bspResource;
  const source = object(bsp) && Object.hasOwn(BSP_SOURCES, bsp.id) ? BSP_SOURCES[bsp.id] : null;
  if (!source || bsp.sourceModel !== "20_20.Model798" || bsp.sourceBrush !== source.brush ||
      !HASH.test(bsp.sourceMapSha256) || !same(snapshot.nativeBsp, bsp) || !Array.isArray(bsp.supportPlacementIds) ||
      bsp.supportPlacementIds.length !== 1 || bsp.supportPlacementIds[0] !== source.placement) fail("unsupported bounded BSP source identity.");
  for (const [key, file] of [["model", `${source.file}.glb`], ["source", `${source.file}.json`]]) {
    const resource = bsp[key];
    if (!object(resource) || resource.file !== file || !HASH.test(resource.sha256) || !Number.isSafeInteger(resource.bytes) || resource.bytes <= 0 || resource.bytes > 32 * 1024 * 1024) fail("invalid BSP resource descriptor.");
  }
  const geometry = snapshot.geometry, keys = ["positions", "normals", "uvs", "indices"];
  if (!object(geometry) || Object.keys(geometry).some(key => !keys.includes(key))) fail("unsupported BSP geometry channels.");
  for (const [key, stride] of [["positions", 3], ["normals", 3], ["uvs", 2], ["indices", 3]]) {
    const values = geometry[key];
    if (!Array.isArray(values) || !values.length || values.length > 300000 || values.length % stride ||
        values.some(value => typeof value !== "number" || !Number.isFinite(value) || !Number.isFinite(Math.fround(value)))) fail(`invalid BSP ${key}.`);
  }
  const vertices = geometry.positions.length / 3;
  if (geometry.normals.length !== vertices * 3 || geometry.uvs.length !== vertices * 2 ||
      geometry.indices.some(value => !Number.isSafeInteger(value) || value < 0 || value >= vertices)) fail("BSP vertex/index relationships differ.");
  const material = snapshot.material;
  if (!object(material) || typeof material.meshPath !== "string" || !material.meshPath.startsWith(`${SCENE}/meshes/`) ||
      !HASH.test(material.meshSha256) || typeof material.materialId !== "string" || !material.materialId ||
      material.nativeSourceReference !== source.material) fail("invalid existing BSP material binding.");
  return snapshot;
}

function stableIdentity(snapshotSha256, kind) {
  const digest = hash(`native-editor-bsp-v1:${snapshotSha256}:${kind}`);
  return { id: `native-bsp-${digest.slice(0, 24)}`, uniqueId: 2 ** 48 + Number.parseInt(digest.slice(0, 12), 16) };
}

async function packGeometry(snapshot, snapshotSha256, world, material, options) {
  const identity = stableIdentity(snapshotSha256, "mesh"), geometryId = stableIdentity(snapshotSha256, "geometry");
  const metadata = { parentId: world.uniqueId, nativeBsp: clone(snapshot.nativeBsp),
    nativeBspAppend: { schemaVersion: 1, snapshotSha256, baseManifestSha256: snapshot.baseManifestSha256 },
    nativeEditorSource: { originalId: snapshot.nativeBsp.id, originalName: snapshot.nativeBsp.sourceBrush, sideOrientation: 1 } };
  const mesh = { ...identity, name: snapshot.nativeBsp.id, type: "Mesh", position: [0, 0, 0], rotation: [0, 0, 0], scaling: [1, 1, 1],
    localMatrix: [...IDENTITY], isEnabled: true, isVisible: true, visibility: 1, pickable: true, receiveShadows: false,
    infiniteDistance: false, billboardMode: 0, alwaysSelectAsActiveMesh: false, checkCollisions: false, sideOrientation: 0,
    geometryId: geometryId.id, geometryUniqueId: geometryId.uniqueId, materialId: material.id, materialUniqueId: material.uniqueId,
    instances: [], animations: [], ranges: [], layerMask: 268435455, hasVertexAlpha: false, metadata,
    subMeshes: [{ materialIndex: 0, verticesStart: 0, verticesCount: snapshot.geometry.positions.length / 3, indexStart: 0, indexCount: snapshot.geometry.indices.length }],
    _binaryInfo: {} };
  const helper = await geometryWriter(options), temporaryRoot = await fs.mkdtemp(join(tmpdir(), "native-editor-bsp-pack-"));
  let binary;
  try {
    const temporary = join(temporaryRoot, "geometry.bin");
    // JSON serialization replaces -0 with +0. Keep source float32 channel bits
    // through packing, including signed zeros in the retained native normals.
    await helper.write({ mesh, geometry: { ...structuredClone(snapshot.geometry), ...geometryId }, path: temporary, write: true });
    binary = await fs.readFile(temporary);
  } finally {
    const tempParent = await fs.realpath(tmpdir()), actual = await fs.realpath(temporaryRoot);
    if (dirname(actual) !== tempParent || !basename(actual).startsWith("native-editor-bsp-pack-")) fail("unexpected packing temporary directory.");
    await fs.rm(actual, { recursive: true, force: true });
  }
  const binaryHash = hash(binary), binaryPath = `${SCENE}/geometries/${binaryHash}.babylonbinarymeshdata`;
  mesh.delayLoadingFile = binaryPath;
  mesh.boundingBoxMinimum = [Infinity, Infinity, Infinity]; mesh.boundingBoxMaximum = [-Infinity, -Infinity, -Infinity];
  for (const [index, source] of snapshot.geometry.positions.entries()) {
    const axis = index % 3, value = Math.fround(source);
    mesh.boundingBoxMinimum[axis] = Math.min(mesh.boundingBoxMinimum[axis], value);
    mesh.boundingBoxMaximum[axis] = Math.max(mesh.boundingBoxMaximum[axis], value);
  }
  const record = { meshes: [mesh], transformNodes: [], cameras: [], lights: [], materials: [clone(material)],
    geometries: { vertexData: [] }, metadata: clone(metadata), basePoseMatrix: [...IDENTITY] };
  return { record, binary, binaryHash, binaryPath, geometryHelper: helper.provenance };
}

/** Planning reads the live project only. The pinned Editor writer runs in an
 * isolated OS temporary directory; no project files are produced by planning. */
export async function planNativeEditorBspAppend(options) {
  const { projectRoot, snapshotPath, snapshotSha256, nextManifestPath, nextManifestSha256 } = options;
  if (!HASH.test(snapshotSha256) || !HASH.test(nextManifestSha256)) fail("explicit snapshot and manifest SHA-256 required.");
  const requested = resolve(projectRoot), stat = await fs.lstat(requested);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail("project root must be a real directory.");
  const root = await fs.realpath(requested), guards = new Map(), directories = [], writes = [];
  const readBytes = async input => {
    const path = await pathIn(root, input), bytes = await fs.readFile(path.absolute), prior = guards.get(path.path);
    if (prior && !prior.bytes.equals(bytes)) fail("input changed during planning.");
    const value = { ...path, bytes }; guards.set(path.path, value); return value;
  };
  const read = async input => { const value = await readBytes(input); return { ...value, data: JSON.parse(jsonText(value.bytes)) }; };
  const input = await read(snapshotPath), next = await read(nextManifestPath);
  if (hash(input.bytes) !== snapshotSha256 || hash(next.bytes) !== nextManifestSha256) fail("input hash mismatch.");
  const snapshot = validateSnapshot(input.data), bsp = snapshot.bspResource;
  if (!Array.isArray(next.data.bsp) || !next.data.bsp.length || !same(next.data.bsp.at(-1), bsp) ||
      next.data.bsp.some(entry => !object(entry) || typeof entry.id !== "string") ||
      new Set(next.data.bsp.map(entry => entry.id)).size !== next.data.bsp.length) fail("next manifest BSP resource differs from snapshot.");
  const base = clone(next.data); base.bsp.pop();
  if (!base.bsp.length) delete base.bsp;
  const config = await read(`${SCENE}/config.json`), channels = await read(`${SCENE}.native-editor-channels.json`);
  const records = [], allIds = new Set(), allUnique = new Set();
  const collectIdentity = value => {
    if (Array.isArray(value)) return value.forEach(collectIdentity);
    if (!object(value)) return;
    for (const [key, item] of Object.entries(value)) {
      if (["id", "geometryId", "materialId"].includes(key) && typeof item === "string") allIds.add(item);
      if (["uniqueId", "geometryUniqueId", "materialUniqueId"].includes(key) && Number.isSafeInteger(item)) allUnique.add(item);
      if (key !== "metadata") collectIdentity(item);
    }
  };
  for (const kind of ["nodes", "meshes", "cameras", "lights"]) {
    const directory = await pathIn(root, `${SCENE}/${kind}`);
    let entries;
    try { entries = await fs.readdir(directory.absolute, { withFileTypes: true }); }
    catch (error) { if (error.code === "ENOENT" && ["cameras", "lights"].includes(kind)) { directories.push({ ...directory, entries: null }); continue; } throw error; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    if (entries.some(entry => !entry.isFile() || !entry.name.endsWith(".json"))) fail("unsupported saved scene entry.");
    directories.push({ ...directory, entries: entries.map(entry => entry.name) });
    for (const entry of entries) {
      const doc = await read(`${SCENE}/${kind}/${entry.name}`); collectIdentity(doc.data);
      const nodes = kind === "meshes" ? doc.data.meshes : [doc.data];
      if (!Array.isArray(nodes) || nodes.length !== 1) fail("unsupported saved mesh record.");
      records.push({ kind, doc, node: nodes[0] });
    }
  }
  const roots = records.filter(record => record.node.metadata?.nativeWorldRoot !== undefined);
  if (roots.length !== 1 || roots[0].kind !== "nodes") fail("missing or ambiguous native world root.");
  const world = roots[0], marker = world.node.metadata.nativeWorldRoot;
  if (!object(marker) || marker.schemaVersion !== 1 || ![snapshot.baseManifestSha256, nextManifestSha256].includes(marker.manifestSha256) ||
      config.data.metadata?.nativeEditorImport?.manifestSha256 !== marker.manifestSha256 || config.data.metadata.nativeEditorImport.targetScene !== SCENE ||
      channels.data.schemaVersion !== 1 || channels.data.kind !== "native-editor-channels" || channels.data.manifestSha256 !== marker.manifestSha256) fail("saved manifest/config/channel-proof identities differ.");
  const repeated = marker.manifestSha256 === nextManifestSha256;
  // Editor JSON serialization canonicalizes signed zero in placement matrices;
  // compare that JSON representation for metadata, never for geometry channels.
  if (!same(clone(marker.manifest), repeated ? clone(next.data) : base)) fail("unrelated source manifest change.");
  const meshIdentity = stableIdentity(snapshotSha256, "mesh"), geometryIdentity = stableIdentity(snapshotSha256, "geometry");
  // Scope conflict and repeat checks to this source fragment; other BSP meshes
  // may already contain subsequent Editor geometry, transform and material edits.
  const added = records.filter(record => record.node.metadata?.nativeBsp?.id === bsp.id);
  const summary = { schemaVersion: 1, kind: "native-editor-bsp-append", status: repeated ? "preserved" : "planned", sourceSnapshotSha256: snapshotSha256,
    beforeManifestSha256: marker.manifestSha256, nextManifestSha256, nativeBsp: bsp, newRecords: [], changes: [],
    scope: "Bounded source BSP geometry; native visible-pixel and collision parity remain unverified." };
  const finish = () => {
    summary.changes = writes.map(write => ({ path: write.path, beforeSha256: write.before === null ? null : hash(write.before), afterSha256: hash(write.bytes), bytes: write.bytes.length }));
    const plan = { root, summary: clone(summary), writes: writes.map(write => ({ ...write, bytes: Buffer.from(write.bytes), before: write.before === null ? null : Buffer.from(write.before) })) };
    plans.set(plan, { root, guards: [...guards.values()], directories, writes, summary: clone(summary) }); return plan;
  };
  if (repeated) {
    if (added.length !== 1 || added[0].kind !== "meshes" || added[0].node.id !== meshIdentity.id ||
        !same(added[0].node.metadata.nativeBsp, bsp) || added[0].node.metadata.nativeBspAppend?.snapshotSha256 !== snapshotSha256) fail("missing or conflicting prior BSP append.");
    // Preserve later authored geometry, transform and material edits. Repeating
    // this source append is not authorization to restore the generated snapshot.
    summary.newRecords.push({ path: added[0].doc.path, meshId: meshIdentity.id }); return finish();
  }
  if (added.length) fail("unexpected existing BSP source geometry.");
  if (world.node.parentId !== undefined || world.node.metadata?.parentId !== undefined || !same(world.node.position, [0, 0, 0]) ||
      !same(world.node.scaling, [1, 1, -1]) || world.node.rotation && !same(world.node.rotation, [0, 0, 0]) ||
      world.node.rotationQuaternion && !same(world.node.rotationQuaternion, [0, 0, 0, 1]) || world.node.freezeWorldMatrix) fail("saved world wrapper is not the expected LH authoring adapter.");
  for (const identity of [meshIdentity, geometryIdentity]) if (allIds.has(identity.id) || allUnique.has(identity.uniqueId)) fail("new BSP identity collides with authored data.");
  const materialDoc = await read(snapshot.material.meshPath);
  if (hash(materialDoc.bytes) !== snapshot.material.meshSha256) fail("saved material source changed.");
  const materialCandidates = materialDoc.data.materials?.filter(value => value.id === snapshot.material.materialId) ?? [];
  if (materialCandidates.length !== 1 || !Number.isSafeInteger(materialCandidates[0].uniqueId) ||
      materialCandidates[0].metadata?.gltf?.extras?.nativeSourceReference !== snapshot.material.nativeSourceReference) fail("saved source material provenance differs.");
  const material = materialCandidates[0];
  for (const record of records) for (const other of record.doc.data.materials ?? []) {
    if (other.id === material.id && !same(other, material)) fail("saved material definitions conflict.");
  }
  const packed = await packGeometry(snapshot, snapshotSha256, world.node, material, options);
  summary.geometryHelper = packed.geometryHelper;
  summary.newRecords.push({ path: `${SCENE}/meshes/${meshIdentity.id}.json`, meshId: meshIdentity.id, geometryId: geometryIdentity.id,
    geometryPath: packed.binaryPath, geometrySha256: packed.binaryHash, vertices: snapshot.geometry.positions.length / 3, triangles: snapshot.geometry.indices.length / 3,
    materialId: material.id, materialSourcePath: materialDoc.path, materialSourceSha256: hash(materialDoc.bytes) });
  const addNew = async (path, bytes, allowIdentical = false) => {
    const target = await pathIn(root, path);
    try {
      const previous = await readBytes(path);
      if (!allowIdentical || !previous.bytes.equals(bytes)) fail("new output conflicts with existing bytes.");
    } catch (error) { if (error.code !== "ENOENT") throw error; writes.push({ ...target, before: null, bytes }); }
  };
  await addNew(packed.binaryPath, packed.binary, true);
  await addNew(`${SCENE}/meshes/${meshIdentity.id}.json`, encode(packed.record));
  let rootBytes = appendBsp(world.doc.bytes, base, next.data.bsp);
  rootBytes = replaceHash(rootBytes, ["metadata", "nativeWorldRoot", "manifestSha256"], marker.manifestSha256, nextManifestSha256);
  for (const [doc, bytes] of [[world.doc, rootBytes],
    [config, replaceHash(config.bytes, ["metadata", "nativeEditorImport", "manifestSha256"], marker.manifestSha256, nextManifestSha256)],
    [channels, replaceHash(channels.bytes, ["manifestSha256"], marker.manifestSha256, nextManifestSha256)]]) writes.push({ path: doc.path, absolute: doc.absolute, before: doc.bytes, bytes });
  return finish();
}

/** Commit a fresh plan only after rechecking every read and identity directory.
 * On failure, roll back only this operation's bytes, preserving concurrent edits. */
export async function applyNativeEditorBspAppend(plan, { receiptPath } = {}) {
  const owned = plans.get(plan);
  if (!owned) fail("apply requires a fresh plan from this process.");
  plans.delete(plan);
  const { root, guards, directories, writes, summary } = owned;
  let receipt;
  if (receiptPath) {
    receipt = await pathIn(root, receiptPath);
    try { await fs.lstat(receipt.absolute); fail("receipt already exists."); } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  for (const directory of directories) {
    let entries;
    try { entries = (await fs.readdir((await pathIn(root, directory.path)).absolute)).sort((a, b) => a.localeCompare(b)); }
    catch (error) { if (error.code !== "ENOENT") throw error; entries = null; }
    if (!same(entries, directory.entries)) fail("authored identity directory changed after planning.");
  }
  for (const guard of guards) if (!(await fs.readFile((await pathIn(root, guard.path)).absolute)).equals(guard.bytes)) fail(`input changed after planning: ${guard.path}.`);
  for (const write of writes) if (write.before === null) {
    try { await fs.lstat((await pathIn(root, write.path)).absolute); fail("new output appeared after planning."); } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  const applied = [];
  try {
    for (const write of writes) {
      const destination = (await pathIn(root, write.path)).absolute;
      if (write.before === null) await fs.writeFile(destination, write.bytes, { flag: "wx" });
      else {
        if (!(await fs.readFile(destination)).equals(write.before)) fail("authored file changed during commit.");
        const temporary = `${destination}.${randomUUID()}.tmp`;
        try { await fs.writeFile(temporary, write.bytes, { flag: "wx" }); await fs.rename(temporary, destination); }
        finally { await fs.unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error; }); }
      }
      applied.push(write);
    }
    const result = { ...summary, status: writes.length ? "applied" : "preserved" };
    if (receipt) {
      await fs.mkdir(dirname((await pathIn(root, receipt.path)).absolute), { recursive: true });
      await fs.writeFile((await pathIn(root, receipt.path)).absolute, encode(result), { flag: "wx" });
    }
    return result;
  } catch (error) {
    const limits = [];
    for (const write of applied.reverse()) {
      try {
        const destination = (await pathIn(root, write.path)).absolute;
        if (!(await fs.readFile(destination)).equals(write.bytes)) { limits.push(`concurrent edit retained: ${write.path}`); continue; }
        if (write.before === null) await fs.unlink(destination); else await fs.writeFile(destination, write.before);
      } catch (failure) { limits.push(`${write.path}: ${failure.message}`); }
    }
    if (limits.length) error.message += ` Rollback limits: ${limits.join("; ")}`;
    throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), values = {}, allowed = new Set(["--snapshot", "--snapshot-sha256", "--manifest", "--sha256", "--project", "--receipt"]);
  let apply = false;
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (key === "--apply" && !apply) apply = true;
    else if (allowed.has(key) && values[key] === undefined && args[index + 1] && !args[index + 1].startsWith("--")) values[key] = args[++index];
    else fail("Usage: --snapshot <path> --snapshot-sha256 <hash> --manifest <path> --sha256 <hash> [--project <root>] [--apply] [--receipt <new path>]");
  }
  if (!["--snapshot", "--snapshot-sha256", "--manifest", "--sha256"].every(key => values[key])) fail("snapshot/manifest paths and SHA-256 values are required.");
  const plan = await planNativeEditorBspAppend({ projectRoot: values["--project"] ?? process.cwd(), snapshotPath: values["--snapshot"], snapshotSha256: values["--snapshot-sha256"], nextManifestPath: values["--manifest"], nextManifestSha256: values["--sha256"] });
  if (apply) console.log(JSON.stringify(await applyNativeEditorBspAppend(plan, { receiptPath: values["--receipt"] }), null, 2));
  else {
    if (values["--receipt"]) {
      const out = await pathIn(plan.root, values["--receipt"]); await fs.mkdir(dirname(out.absolute), { recursive: true });
      await fs.writeFile((await pathIn(plan.root, out.path)).absolute, encode(plan.summary), { flag: "wx" });
    }
    console.log(JSON.stringify(plan.summary, null, 2));
  }
}
