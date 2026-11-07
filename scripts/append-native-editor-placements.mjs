/** Add source-backed placements to the saved Editor world, never regenerate it.
 * New graphs use retained source transforms and verified existing geometry.
 * Existing authored placement/material records are not rewritten. */
import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual as same } from "node:util";

const SCENE = "assets/native-world.scene";
const SNAPSHOT = "artifacts/native-parity/editor/world-import/captured-world.json";
const SNAPSHOT_HASH = "230873f5a7f3955075010a3a15ec3ef4469a3136292dbf33774fcff09e6e53e5";
const OLD_TERRAIN = "dac7dd01181d1398d041fa574110f2212f5f2c232ed64af221378d97617cb43f";
const NEW_TERRAIN = "39417edb0294885ef6bd4107c85a917f6dcc4dc2985d11393bb41afa2e63a724";
const HASH = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,179}$/;
const plans = new WeakSet();
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const clone = value => JSON.parse(JSON.stringify(value));
const encode = value => Buffer.from(JSON.stringify(value, null, 2) + "\n");
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const fail = message => { throw Error(`Native Editor placement append: ${message}`); };

async function pathIn(root, input) {
  const path = isAbsolute(input) ? resolve(input) : resolve(root, input);
  const rel = relative(root, path);
  if (!rel || isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) fail("path escapes project.");
  let current = root;
  for (const part of rel.split(sep)) {
    if (!part || /[:\x00-\x1f]/.test(part) || /[. ]$/.test(part)) fail("unsafe path component.");
    current = resolve(current, part);
    try {
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink()) fail(`symlink/junction refused: ${rel}.`);
    } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  return { absolute: path, path: rel.split(sep).join("/") };
}

// Find a JSON value by its object path. Replacing only its token span preserves
// unrelated authored whitespace/fields, including the exact UV channel proof.
function valueSpan(text, wanted) {
  let offset = 0, found;
  const whitespace = () => { while (/\s/.test(text[offset] ?? "") && offset < text.length) offset++; };
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

function replaceValue(bytes, keys, expected, value) {
  const text = bytes.toString("utf8");
  if (!Buffer.from(text).equals(bytes)) fail("invalid UTF-8 document.");
  const [start, end] = valueSpan(text, keys);
  if (!same(JSON.parse(text.slice(start, end)), expected)) fail("JSON value changed before replacement.");
  const indent = text.slice(text.lastIndexOf("\n", start) + 1, start).match(/^\s*/)[0];
  const replacement = JSON.stringify(value, null, 2).replaceAll("\n", `\n${indent}`);
  const next = Buffer.from(text.slice(0, start) + replacement + text.slice(end));
  JSON.parse(next.toString("utf8"));
  return next;
}

function placement(value) {
  if (!object(value) || typeof value.id !== "string" || typeof value.modelId !== "string" || typeof value.sourceMesh !== "string" ||
      !Array.isArray(value.materialOverrides) || value.materialOverrides.length || !Array.isArray(value.matrix) || value.matrix.length !== 16 ||
      !value.matrix.every(Number.isFinite) || [3, 7, 11].some(i => value.matrix[i] !== 0) || value.matrix[15] !== 1) fail("invalid source placement.");
  const m = value.matrix;
  const det = m[0] * (m[5] * m[10] - m[9] * m[6]) - m[4] * (m[1] * m[10] - m[9] * m[2]) + m[8] * (m[1] * m[6] - m[5] * m[2]);
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) fail("singular source placement.");
}

function sourceNode(node) {
  if (!object(node) || !ID.test(node.id) || !Number.isSafeInteger(node.uniqueId) || node.uniqueId < 1e9 ||
      node.freezeWorldMatrix || node.instances?.length || node.sourceMeshId !== undefined || node.skeletonId !== undefined && node.skeletonId !== null ||
      node.animations?.length || node.ranges?.length) fail("unsupported source node/animation/instance graph.");
  for (const key of ["position", "rotation", "scaling", "rotationQuaternion", "localMatrix"]) {
    if (node[key] !== undefined && (!Array.isArray(node[key]) || !node[key].every(Number.isFinite))) fail("non-finite source transform.");
  }
}

function validateTerrain(old, next) {
  if (same(old, next)) return;
  const expected = { ...old, sha256: NEW_TERRAIN, bytes: 376928 };
  if (old?.sha256 !== OLD_TERRAIN || old.bytes !== 374904 || !same(next, expected)) fail("unrelated terrain change; existing UV migration must stay closed.");
}

function validateExtension(old, next) {
  for (const key of ["schemaVersion", "kind", "models", "resourceRoots", "support", "errors", "surfaceSpawnCandidate", "unsupportedRuntimeMaterials"]) {
    if (!same(old[key], next[key])) fail(`source relationship changed: ${key}.`);
  }
  validateTerrain(old.terrain, next.terrain);
  if (!Array.isArray(next.placements) || next.placements.length < old.placements.length || next.placements.length > old.placements.length + 256 ||
      !same(old.placements, next.placements.slice(0, old.placements.length))) fail("existing source placements changed or extension is unbounded.");
  const ids = new Set(); const models = new Map(old.models.map(model => [model.id, model]));
  for (const entry of next.placements) {
    placement(entry);
    if (ids.has(entry.id) || !models.has(entry.modelId)) fail("duplicate placement or newly introduced model.");
    ids.add(entry.id);
  }
  for (const entry of next.placements.slice(old.placements.length)) {
    const original = old.placements.find(source => source.modelId === entry.modelId && source.sourceMesh.toLowerCase() === entry.sourceMesh.toLowerCase());
    if (!original) fail("addition has no source-backed existing model template.");
  }
}

function graph(snapshot, root) {
  const records = [...snapshot.nodes.map(node => ({ kind: "nodes", data: node, node })),
    ...snapshot.meshes.map(data => {
      if (!Array.isArray(data.meshes) || data.meshes.length !== 1 || data.animationGroups?.length || data.skeletons?.length || data.transformNodes?.length) fail("unsupported snapshot mesh record.");
      return { kind: "meshes", data, node: data.meshes[0] };
    })];
  const selected = new Set([root.uniqueId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const record of records) if (selected.has(record.node.metadata?.parentId) && !selected.has(record.node.uniqueId)) {
      selected.add(record.node.uniqueId); changed = true;
    }
  }
  const result = records.filter(record => selected.has(record.node.uniqueId));
  if (result.length !== selected.size || result.length > 128 || !result.some(record => record.node.geometryId)) fail("missing or ambiguous source template graph.");
  result.forEach(record => sourceNode(record.node));
  return result;
}

function remap(value, identities) {
  if (Array.isArray(value)) return value.map(item => remap(item, identities));
  if (!object(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key,
    ["id", "uniqueId", "parentId", "sourceMeshId", "sourceMeshUniqueId"].includes(key) && identities.has(child) ? identities.get(child) : remap(child, identities)]));
}

function geometryMatches(source, saved, bytes) {
  const mesh = source.meshes[0], original = source.geometries?.vertexData;
  if (!Array.isArray(original) || original.length !== 1 || original[0].id !== mesh.geometryId ||
      saved.geometryId !== mesh.geometryId || saved.geometryUniqueId !== mesh.geometryUniqueId || !object(saved._binaryInfo) ||
      saved.positions != null || saved.indices != null || saved.subMeshes != null) fail("changed or unsupported saved template geometry.");
  const geometry = original[0];
  const channels = { positions: [3, 1], normals: [3, 1], uvs: [2, 1], uvs2: [2, 1], colors: [4, 1], indices: [1, 0] };
  const expectedDescriptors = new Set(["subMeshesAttrDesc"]), intervals = [];
  const compare = (name, values, stride, type) => {
    const desc = saved._binaryInfo[name]; expectedDescriptors.add(name);
    const expectedCount = name === "subMeshesAttrDesc" ? values.length / 5 : values.length;
    if (!Array.isArray(values) || !values.every(Number.isFinite) || !object(desc) || desc.count !== expectedCount || desc.stride !== stride || desc.dataType !== type ||
        !Number.isSafeInteger(desc.offset) || desc.offset < 0 || desc.offset % 4 || desc.offset + values.length * 4 > bytes.length) fail(`invalid saved geometry descriptor: ${name}.`);
    if (type === 0 && values.some(value => !Number.isSafeInteger(value) || value < 0 || value > 2147483647)) fail("invalid source integer geometry.");
    const expected = Buffer.from((type === 0 ? new Int32Array(values) : new Float32Array(values)).buffer);
    if (!bytes.subarray(desc.offset, desc.offset + expected.length).equals(expected)) fail(`saved template geometry differs from source: ${name}.`);
    intervals.push([desc.offset, desc.offset + expected.length]);
  };
  for (const [key, [stride, type]] of Object.entries(channels)) {
    if (geometry[key] !== undefined && geometry[key] !== null) compare(`${key}AttrDesc`, geometry[key], stride, type);
  }
  const submeshes = mesh.subMeshes;
  if (!Array.isArray(submeshes) || !submeshes.length) fail("missing source submeshes.");
  compare("subMeshesAttrDesc", submeshes.flatMap(value => [value.materialIndex, value.verticesStart, value.verticesCount, value.indexStart, value.indexCount]), 5, 0);
  if (!same(Object.keys(saved._binaryInfo).sort(), [...expectedDescriptors].sort())) fail("extra saved geometry channel.");
  intervals.sort((a, b) => a[0] - b[0]);
  if (intervals[0][0] !== 0 || intervals.at(-1)[1] !== bytes.length || intervals.some((v, i) => i && v[0] !== intervals[i - 1][1])) fail("geometry descriptor gap/overlap.");
}

/** Read and plan only. Paths are project-local; the original snapshot is pinned.
 * snapshotPath/snapshotSha256 support isolated fixtures and future retained imports. */
export async function planNativeEditorPlacementAppend({ projectRoot, nextManifestPath, nextManifestSha256, snapshotPath = SNAPSHOT, snapshotSha256 = SNAPSHOT_HASH }) {
  if (!HASH.test(nextManifestSha256) || !HASH.test(snapshotSha256)) fail("explicit manifest/snapshot SHA-256 required.");
  const requested = resolve(projectRoot), stat = await fs.lstat(requested);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail("project root must be a real directory.");
  const root = await fs.realpath(requested), guards = new Map(), writes = [], dependencies = [];
  const read = async input => {
    const path = await pathIn(root, input), bytes = await fs.readFile(path.absolute);
    const prior = guards.get(path.path);
    if (prior && !prior.bytes.equals(bytes)) fail("input changed during planning.");
    const doc = { ...path, bytes, data: JSON.parse(bytes.toString("utf8")) };
    guards.set(path.path, { ...path, bytes }); return doc;
  };
  const snap = await read(snapshotPath), next = await read(nextManifestPath);
  if (hash(snap.bytes) !== snapshotSha256 || hash(next.bytes) !== nextManifestSha256) fail("input hash mismatch.");
  const snapshot = snap.data;
  // Editor serializes JSON through JSON.stringify, where -0 becomes 0. Compare
  // source metadata in that same representation; the hashed source bytes and
  // every binary geometry channel remain untouched.
  next.data = clone(next.data);
  if (snapshot.schemaVersion !== 1 || snapshot.kind !== "native-editor-world-snapshot" || !HASH.test(snapshot.manifestSha256) || !Array.isArray(snapshot.nodes) || !Array.isArray(snapshot.meshes)) fail("invalid source snapshot.");
  validateExtension(snapshot.manifest, next.data);
  const config = await read(`${SCENE}/config.json`), sidecar = await read(`${SCENE}.native-editor-channels.json`);
  const records = [], allIds = new Set(), allUnique = new Set();
  for (const kind of ["nodes", "meshes"]) {
    const dir = await pathIn(root, `${SCENE}/${kind}`);
    for (const entry of (await fs.readdir(dir.absolute, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) fail("unsupported saved scene entry.");
      const doc = await read(`${SCENE}/${kind}/${entry.name}`);
      const nodes = kind === "nodes" ? [doc.data] : doc.data.meshes;
      if (!Array.isArray(nodes) || nodes.length !== 1) fail("unsupported saved mesh records.");
      const node = nodes[0];
      if (!ID.test(node.id) || !Number.isSafeInteger(node.uniqueId) || allIds.has(node.id) || allUnique.has(node.uniqueId)) fail("duplicate saved node identity.");
      allIds.add(node.id); allUnique.add(node.uniqueId); records.push({ kind, doc, node });
    }
  }
  const roots = records.filter(record => record.node.metadata?.nativeWorldRoot !== undefined);
  if (roots.length !== 1 || roots[0].kind !== "nodes") fail("missing or ambiguous native world root.");
  const world = roots[0], marker = world.node.metadata.nativeWorldRoot;
  if (marker.schemaVersion !== 1 || ![snapshot.manifestSha256, nextManifestSha256].includes(marker.manifestSha256) ||
      config.data.metadata?.nativeEditorImport?.manifestSha256 !== marker.manifestSha256 || config.data.metadata.nativeEditorImport.targetScene !== SCENE ||
      sidecar.data.schemaVersion !== 1 || sidecar.data.kind !== "native-editor-channels" || sidecar.data.manifestSha256 !== marker.manifestSha256) fail("saved manifest/config/channel-proof identities differ.");
  const currentExpected = marker.manifestSha256 === nextManifestSha256 ? next.data : snapshot.manifest;
  if (!same(marker.manifest, currentExpected)) fail("saved embedded source manifest changed.");
  const savedPlacements = records.filter(record => record.node.metadata?.nativePlacement !== undefined);
  if (savedPlacements.length !== currentExpected.placements.length) fail("missing or extra authored source placements.");
  for (const source of currentExpected.placements) {
    const candidates = savedPlacements.filter(record => record.node.metadata.nativePlacement.id === source.id);
    if (candidates.length !== 1 || candidates[0].kind !== "nodes" || !same(candidates[0].node.metadata.nativePlacement, source)) fail("authored placement metadata changed.");
  }
  const additions = next.data.placements.slice(snapshot.manifest.placements.length);
  const summary = { schemaVersion: 1, kind: "native-editor-placement-append", status: marker.manifestSha256 === nextManifestSha256 ? "preserved" : "planned",
    sourceSnapshotSha256: snapshotSha256, beforeManifestSha256: marker.manifestSha256, nextManifestSha256,
    addedPlacementIds: additions.map(value => value.id), newRecords: [], dependencies,
    preservation: "Existing placement/mesh/material/geometry bytes remain untouched; only world manifest and config/sidecar manifest identities change." };
  const finish = () => {
    summary.changes = writes.map(write => ({ path: write.path, beforeSha256: write.before ? hash(write.before) : null, afterSha256: hash(write.bytes), bytes: write.bytes.length }));
    const plan = { root, summary, guards: [...guards.values()], writes }; plans.add(plan); return plan;
  };
  if (summary.status === "preserved") return finish();
  if (!additions.length) fail("manifest changes without additive placements are outside this migration.");
  const sourceRoots = snapshot.nodes.filter(node => node.metadata?.nativePlacement);
  const byId = new Map(records.map(record => [record.node.id, record]));
  // IDs of shared geometry/material resources are reserved too.
  for (const record of records) if (record.kind === "meshes") {
    for (const resource of [...(record.doc.data.materials ?? []), ...(record.doc.data.multiMaterials ?? [])]) { allIds.add(resource.id); allUnique.add(resource.uniqueId); }
    if (record.node.geometryId) allIds.add(record.node.geometryId);
    if (record.node.geometryUniqueId) allUnique.add(record.node.geometryUniqueId);
  }
  for (const addition of additions) {
    const template = sourceRoots.find(node => node.metadata.nativePlacement.modelId === addition.modelId &&
      node.metadata.nativePlacement.sourceMesh.toLowerCase() === addition.sourceMesh.toLowerCase());
    if (!template) fail("no source template for addition.");
    const entries = graph(snapshot, template), identities = new Map();
    for (const entry of entries) {
      const digest = hash(Buffer.from(`native-editor-placement-append-v1:${nextManifestSha256}:${addition.id}:${entry.node.id}`));
      const id = `native-${digest.slice(0, 24)}`, uniqueId = 2 ** 48 + Number.parseInt(digest.slice(0, 12), 16);
      if (allIds.has(id) || allUnique.has(uniqueId)) fail("new node identity collision or partial prior apply.");
      allIds.add(id); allUnique.add(uniqueId); identities.set(entry.node.id, id); identities.set(entry.node.uniqueId, uniqueId);
    }
    for (const entry of entries) {
      const saved = byId.get(entry.node.id);
      if (!saved || saved.kind !== entry.kind) fail("source template missing from saved scene.");
      const data = clone(entry.data), node = entry.kind === "nodes" ? data : data.meshes[0];
      if (entry.kind === "meshes") {
        // Editor save replaces the transient default material on empty GLB
        // loader roots. They submit no geometry and carry no material resource.
        // Preserve that saved representation, never a rendered mesh binding.
        if (!node.geometryId && !saved.node.geometryId && !saved.node.delayLoadingFile &&
            !(data.materials?.length || data.multiMaterials?.length || saved.doc.data.materials?.length || saved.doc.data.multiMaterials?.length) &&
            saved.node.materialId === "default material" && saved.node.materialUniqueId == null) {
          node.materialId = saved.node.materialId;
          if (saved.node.materialUniqueId === undefined) delete node.materialUniqueId;
          else node.materialUniqueId = saved.node.materialUniqueId;
        }
        if (saved.node.materialId !== node.materialId || saved.node.materialUniqueId !== node.materialUniqueId) fail("source template material binding changed.");
        for (const kind of ["materials", "multiMaterials"]) if (data[kind] !== undefined || saved.doc.data[kind] !== undefined) data[kind] = clone(saved.doc.data[kind] ?? []);
        if (node.geometryId) {
          if (typeof saved.node.delayLoadingFile !== "string" || !saved.node.delayLoadingFile.startsWith(`${SCENE}/geometries/`) ||
              saved.node.delayLoadingFile.slice(`${SCENE}/geometries/`.length).includes("/")) fail("unsupported geometry path.");
          const file = await pathIn(root, saved.node.delayLoadingFile), bytes = await fs.readFile(file.absolute);
          guards.set(file.path, { ...file, bytes }); geometryMatches(entry.data, saved.node, bytes);
          if (!dependencies.some(dep => dep.path === file.path)) dependencies.push({ path: file.path, sha256: hash(bytes), bytes: bytes.length });
          for (const key of ["delayLoadingFile", "_binaryInfo", "boundingBoxMinimum", "boundingBoxMaximum", "positions", "normals", "uvs", "uvs2", "colors", "indices", "subMeshes", "hasUVs", "hasUVs2", "hasColors"]) {
            if (saved.node[key] !== undefined) node[key] = clone(saved.node[key]); else delete node[key];
          }
          data.geometries = clone(saved.doc.data.geometries);
          if (data.geometries?.vertexData?.length) fail("saved template has inline geometry.");
        } else if (saved.node.geometryId || saved.node.delayLoadingFile) fail("empty template root gained geometry.");
      }
      if (entry.node.id === template.id) {
        node.name = addition.id;
        node.metadata.nativePlacement = clone(addition);
        node.metadata.nativeEditorSource = { originalId: addition.id, originalName: addition.id };
        node.localMatrix = addition.matrix.map(Math.fround);
        node.position = [0, 0, 0]; node.rotation = [0, 0, 0]; node.scaling = [1, 1, 1];
        if (node.rotationQuaternion) node.rotationQuaternion = [0, 0, 0, 1];
        node.metadata.parentId = world.node.uniqueId;
      }
      delete node.parentId;
      const mapped = remap(data, identities), mappedNode = entry.kind === "nodes" ? mapped : mapped.meshes[0];
      const file = await pathIn(root, `${SCENE}/${entry.kind}/${mappedNode.id}.json`);
      try { await fs.lstat(file.absolute); fail("new graph path already exists."); } catch (error) { if (error.code !== "ENOENT") throw error; }
      writes.push({ ...file, before: null, bytes: encode(mapped) });
      summary.newRecords.push({ placementId: addition.id, templateId: template.metadata.nativePlacement.id, sourceNodeId: entry.node.id, nodeId: mappedNode.id, path: file.path });
    }
  }
  let rootBytes = replaceValue(world.doc.bytes, ["metadata", "nativeWorldRoot", "manifest"], marker.manifest, next.data);
  rootBytes = replaceValue(rootBytes, ["metadata", "nativeWorldRoot", "manifestSha256"], marker.manifestSha256, nextManifestSha256);
  for (const [doc, bytes] of [[world.doc, rootBytes],
    [config, replaceValue(config.bytes, ["metadata", "nativeEditorImport", "manifestSha256"], marker.manifestSha256, nextManifestSha256)],
    [sidecar, replaceValue(sidecar.bytes, ["manifestSha256"], marker.manifestSha256, nextManifestSha256)]]) {
    writes.push({ path: doc.path, absolute: doc.absolute, before: doc.bytes, bytes });
  }
  return finish();
}

/** Commit a fresh in-memory plan after checking every read dependency again.
 * Receipt output is exclusively created; a failed commit rolls back only bytes
 * still identical to this operation's writes. Never overwrites concurrent edits. */
export async function applyNativeEditorPlacementAppend(plan, { receiptPath } = {}) {
  if (!plans.has(plan)) fail("apply requires a fresh plan from this process.");
  plans.delete(plan);
  let receipt;
  if (receiptPath) {
    receipt = await pathIn(plan.root, receiptPath);
    try { await fs.lstat(receipt.absolute); fail("receipt already exists."); } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  for (const guard of plan.guards) if (!(await fs.readFile((await pathIn(plan.root, guard.path)).absolute)).equals(guard.bytes)) fail(`input changed after planning: ${guard.path}.`);
  for (const write of plan.writes) if (write.before === null) {
    try { await fs.lstat(write.absolute); fail("new output appeared after planning."); } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  const applied = [];
  try {
    for (const write of plan.writes) {
      if (write.before === null) await fs.writeFile(write.absolute, write.bytes, { flag: "wx" });
      else {
        if (!(await fs.readFile(write.absolute)).equals(write.before)) fail("authored file changed during commit.");
        const temporary = `${write.absolute}.${randomUUID()}.tmp`;
        try { await fs.writeFile(temporary, write.bytes, { flag: "wx" }); await fs.rename(temporary, write.absolute); }
        finally { await fs.unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error; }); }
      }
      applied.push(write);
    }
    const result = { ...plan.summary, status: plan.writes.length ? "applied" : "preserved" };
    if (receipt) { await fs.mkdir(dirname(receipt.absolute), { recursive: true }); await fs.writeFile(receipt.absolute, encode(result), { flag: "wx" }); }
    return result;
  } catch (error) {
    const rollback = [];
    for (const write of applied.reverse()) {
      try {
        if (!(await fs.readFile(write.absolute)).equals(write.bytes)) { rollback.push(`concurrent edit retained: ${write.path}`); continue; }
        if (write.before === null) await fs.unlink(write.absolute); else await fs.writeFile(write.absolute, write.before);
      } catch (failure) { rollback.push(`${write.path}: ${failure.message}`); }
    }
    if (rollback.length) error.message += ` Rollback limits: ${rollback.join("; ")}`;
    throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), values = {}, allowed = new Set(["--manifest", "--sha256", "--receipt", "--project"]);
  let apply = false;
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (key === "--apply") { if (apply) fail("duplicate --apply."); apply = true; }
    else if (allowed.has(key) && values[key] === undefined && args[index + 1] && !args[index + 1].startsWith("--")) values[key] = args[++index];
    else fail("Usage: node scripts/append-native-editor-placements.mjs --manifest <path> --sha256 <hash> [--project <root>] [--apply] [--receipt <new path>]");
  }
  if (!values["--manifest"] || !values["--sha256"]) fail("--manifest and --sha256 are required.");
  const plan = await planNativeEditorPlacementAppend({ projectRoot: values["--project"] ?? process.cwd(), nextManifestPath: values["--manifest"], nextManifestSha256: values["--sha256"] });
  if (apply) console.log(JSON.stringify(await applyNativeEditorPlacementAppend(plan, { receiptPath: values["--receipt"] }), null, 2));
  else {
    if (values["--receipt"]) {
      const out = await pathIn(plan.root, values["--receipt"]); await fs.mkdir(dirname(out.absolute), { recursive: true }); await fs.writeFile(out.absolute, encode(plan.summary), { flag: "wx" });
    }
    console.log(JSON.stringify(plan.summary, null, 2));
  }
}
