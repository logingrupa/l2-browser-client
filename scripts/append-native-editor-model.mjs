/** Append one captured source model/placement without regenerating authored work. */
import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual as same } from "node:util";
import { geometryWriter } from "./native_editor_scene.mjs";

const SCENE = "assets/native-world.scene";
export const BASE_MANIFEST_SHA256 = "93139ab0f6751ef3ea5f639876e862900d3767c711754ef2af9e2a0907e97a66";
const HASH = /^[a-f0-9]{64}$/, ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,179}$/;
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const CHANNELS = { positions: [3, "positionsAttrDesc", 1], normals: [3, "normalsAttrDesc", 1],
  uvs: [2, "uvsAttrDesc", 1], uvs2: [2, "uvs2AttrDesc", 1], colors: [4, "colorsAttrDesc", 1], indices: [1, "indicesAttrDesc", 0] };
const plans = new WeakMap(), hash = bytes => createHash("sha256").update(bytes).digest("hex");
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const jsonClone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const equivalent = (a, b) => same(jsonClone(a), jsonClone(b));
const encode = value => Buffer.from(JSON.stringify(value, null, 2) + "\n");
const fail = message => { throw Error(`Native Editor model append: ${message}`); };
const finite = (values, length) => Array.isArray(values) && values.length === length && values.every(value => typeof value === "number" && Number.isFinite(value));

async function pathIn(root, input) {
  if (typeof input !== "string" || !input) fail("invalid path.");
  const absolute = resolve(root, input), rel = relative(root, absolute);
  if (!rel || isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) fail("path escapes project.");
  let current = root;
  for (const [index, part] of rel.split(sep).entries()) {
    if (!part || /[:\x00-\x1f<>"|?*]/.test(part) || /[. ]$/.test(part) || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(part)) fail("unsafe path component.");
    current = join(current, part);
    try {
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink() || index < rel.split(sep).length - 1 && !stat.isDirectory()) fail("linked or non-directory path parent.");
    } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  return { absolute, path: rel.split(sep).join("/") };
}

// Parse once with duplicate-key checks and return exact token spans for edits.
function valueSpan(text, wanted) {
  let offset = 0, found;
  const space = () => { while (offset < text.length && /\s/.test(text[offset])) offset++; };
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
    space(); const start = offset;
    if (text[offset] === "{") {
      offset++; space(); const seen = new Set();
      while (text[offset] !== "}") {
        if (text[offset] !== '"') fail("invalid JSON object.");
        const key = string(); if (seen.has(key)) fail("duplicate JSON key."); seen.add(key); space();
        if (text[offset++] !== ":") fail("invalid JSON property.");
        visit([...keys, key]); space(); if (text[offset] !== ",") break; offset++; space();
      }
      if (text[offset++] !== "}") fail("invalid JSON object end.");
    } else if (text[offset] === "[") {
      offset++; space(); let index = 0;
      while (text[offset] !== "]") { visit([...keys, index++]); space(); if (text[offset] !== ",") break; offset++; space(); }
      if (text[offset++] !== "]") fail("invalid JSON array end.");
    } else if (text[offset] === '"') string();
    else while (offset < text.length && !/[\s,}\]]/.test(text[offset])) offset++;
    if (same(keys, wanted)) { if (found) fail("ambiguous JSON path."); found = [start, offset]; }
  };
  visit([]); space(); if (offset !== text.length || !found) fail("missing JSON path."); return found;
}
function jsonText(bytes) {
  const text = bytes.toString("utf8"); if (!Buffer.from(text).equals(bytes)) fail("invalid UTF8 JSON.");
  JSON.parse(text); valueSpan(text, []); return text;
}
function replaceValue(bytes, keys, before, after) {
  const text = jsonText(bytes), [start, end] = valueSpan(text, keys);
  if (!equivalent(JSON.parse(text.slice(start, end)), before)) fail("JSON value changed.");
  const output = Buffer.from(text.slice(0, start) + JSON.stringify(after) + text.slice(end)); jsonText(output); return output;
}
function decoded64(value) {
  if (typeof value !== "string" || value.length > 48 * 1024 * 1024 || value.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) fail("invalid bounded base64.");
  const bytes = Buffer.from(value, "base64"); if (bytes.toString("base64") !== value) fail("noncanonical base64."); return bytes;
}
function identity(value) {
  if (!object(value) || !ID.test(value.id) || !Number.isSafeInteger(value.uniqueId) || value.uniqueId < 2 ** 48) fail("invalid reserved resource identity.");
}
function validatePlacement(value) {
  if (!object(value) || typeof value.id !== "string" || typeof value.sourceMesh !== "string" || !value.sourceMesh ||
      typeof value.modelId !== "string" || !Array.isArray(value.materialOverrides) || value.materialOverrides.length ||
      !finite(value.matrix, 16) || [3, 7, 11].some(i => value.matrix[i] !== 0) || value.matrix[15] !== 1) fail("invalid source placement.");
  const m = value.matrix;
  if (Math.abs(m[0] * (m[5] * m[10] - m[9] * m[6]) - m[4] * (m[1] * m[10] - m[9] * m[2]) + m[8] * (m[1] * m[6] - m[5] * m[2])) < 1e-12) fail("singular source placement.");
}
function validateExtension(base, next, snapshot) {
  for (const key of new Set([...Object.keys(base), ...Object.keys(next)])) {
    if (["models", "placements", "derivation", "coverage", "gaps"].includes(key)) continue;
    if (!Object.hasOwn(base, key) || !Object.hasOwn(next, key) || !equivalent(base[key], next[key])) fail(`unrelated manifest change: ${key}.`);
  }
  for (const [key, addition] of [["models", snapshot.model], ["placements", snapshot.placement]]) {
    if (!Array.isArray(base[key]) || !Array.isArray(next[key]) || next[key].length !== base[key].length + 1 ||
        !equivalent(base[key], next[key].slice(0, -1)) || !equivalent(next[key].at(-1), addition) || base[key].some(item => item.id === addition.id)) fail(`invalid additive ${key} extension.`);
  }
  for (const key of ["derivation", "coverage"]) {
    if (!object(base[key] ?? {}) || !object(next[key] ?? {})) fail(`invalid ${key}.`);
    for (const name of Object.keys(base[key] ?? {})) if (!Object.hasOwn(next[key] ?? {}, name) || !equivalent(base[key][name], next[key][name])) fail(`existing ${key} changed.`);
  }
  if (!Array.isArray(base.gaps) || !Array.isArray(next.gaps) || !next.gaps.every(value => typeof value === "string") ||
      next.gaps.length < base.gaps.length || !equivalent(base.gaps, next.gaps.slice(0, base.gaps.length))) fail("existing manifest gaps changed.");
  const model = snapshot.model;
  if (!object(model) || typeof model.sourceObject !== "string" || !model.sourceObject || model.id !== `interlude:${model.sourceObject}` || snapshot.placement.modelId !== model.id ||
      model.sourceObject.toLowerCase() !== snapshot.placement.sourceMesh.toLowerCase()) fail("model/placement identities differ.");
  for (const [key, file] of [["archive", "asset.l2asset"], ["model", "model.glb"]]) {
    const resource = model[key];
    if (!object(resource) || !HASH.test(resource.sha256) || !Number.isSafeInteger(resource.bytes) || resource.bytes < 1 || resource.bytes > 128 * 1024 * 1024 ||
        resource.file !== `${model.archive.sha256}/${file}`) fail("invalid model resource identity.");
  }
}

function capturedGeometry(input, mesh) {
  identity(input);
  if (mesh.geometryId !== input.id || mesh.geometryUniqueId !== input.uniqueId) fail("geometry binding differs.");
  const allowed = new Set(["id", "uniqueId", "updatable", "hasVertexAlpha", "channelBytes", ...Object.keys(CHANNELS)]);
  if (Object.keys(input).some(key => !allowed.has(key)) || !object(input.channelBytes)) fail("unsupported geometry fields or missing exact channels.");
  const names = Object.keys(CHANNELS).filter(key => input[key] !== undefined);
  if (!["positions", "normals", "uvs", "indices"].every(key => names.includes(key)) ||
      !same(Object.keys(input.channelBytes).sort(), [...names].sort())) fail("missing or unbound geometry channels.");
  if (names.includes("uvs2")) fail("new UV2 requires a separate channel-proof migration.");
  const geometry = structuredClone(input), channels = new Map(); delete geometry.channelBytes;
  const vertices = input.positions.length / 3;
  for (const key of names) {
    const [stride, , dataType] = CHANNELS[key], values = input[key];
    if (!Array.isArray(values) || !values.length || values.length > 3000000 || values.length % stride ||
        key !== "indices" && values.length !== vertices * stride || key === "indices" && values.length % 3) fail(`invalid ${key} scalar count.`);
    const bytes = decoded64(input.channelBytes[key]);
    if (bytes.length !== values.length * 4) fail(`exact ${key} byte count differs.`);
    const exact = values.map((value, index) => {
      const decoded = dataType ? bytes.readFloatLE(index * 4) : bytes.readInt32LE(index * 4);
      if (!Number.isFinite(value) || !Number.isFinite(decoded) || decoded !== Math.fround(value) ||
          !dataType && (!Number.isSafeInteger(value) || value < 0 || value >= vertices || decoded !== value)) fail(`exact ${key} bytes/numbers differ.`);
      return decoded;
    });
    geometry[key] = exact; channels.set(key, bytes);
  }
  if (!Array.isArray(mesh.subMeshes) || !mesh.subMeshes.length) fail("missing source submeshes.");
  for (const sub of mesh.subMeshes) {
    if (["materialIndex", "verticesStart", "verticesCount", "indexStart", "indexCount"].some(key => !Number.isSafeInteger(sub[key]) || sub[key] < 0 || sub[key] > 0x7fffffff) ||
        sub.verticesStart + sub.verticesCount > vertices || sub.indexStart + sub.indexCount > input.indices.length) fail("invalid source submesh range.");
  }
  return { geometry, channels };
}

function validateSnapshot(snapshot) {
  if (!object(snapshot) || snapshot.schemaVersion !== 1 || snapshot.kind !== "native-editor-model-snapshot" || !HASH.test(snapshot.baseManifestSha256) ||
      !ID.test(snapshot.placementRootId) || !Array.isArray(snapshot.nodes) || !snapshot.nodes.length || !Array.isArray(snapshot.meshes) || !snapshot.meshes.length ||
      snapshot.nodes.length + snapshot.meshes.length > 128 || !Array.isArray(snapshot.textures) || snapshot.textures.length > 32) fail("invalid bounded model snapshot.");
  validatePlacement(snapshot.placement);
  const records = snapshot.nodes.map(data => ({ kind: "nodes", data, node: data }));
  for (const data of snapshot.meshes) {
    if (!object(data) || !Array.isArray(data.meshes) || data.meshes.length !== 1 ||
        ["skeletons", "animationGroups", "transformNodes", "cameras", "lights", "particleSystems", "multiMaterials"].some(key => data[key]?.length)) fail("unsupported captured mesh document.");
    records.push({ kind: "meshes", data, node: data.meshes[0] });
  }
  const identities = new Map(), numeric = new Map(), nodes = new Map(), materials = new Map(), geometries = new Map();
  const reserve = (record, kind, shared = false) => {
    identity(record); const old = identities.get(record.id), number = numeric.get(record.uniqueId);
    if (old || number) { if (!shared || !old || old.kind !== kind || number !== record.id || !equivalent(old.record, record)) fail("duplicate/conflicting captured identity."); return; }
    identities.set(record.id, { kind, record }); numeric.set(record.uniqueId, record.id);
  };
  for (const record of records) {
    const node = record.node; reserve(node, record.kind); nodes.set(node.uniqueId, record);
    if (!object(node.metadata) || node.freezeWorldMatrix || node.instances?.length || node.animations?.length || node.ranges?.length || node.skeletonId != null || node.sourceMeshId != null ||
        ["nativeWorldRoot", "nativeBsp", "nativeSkyRoot", "nativeSkyPart"].some(key => Object.hasOwn(node.metadata, key))) fail("unsupported captured node behavior.");
    for (const [key, size] of [["position", 3], ["rotation", 3], ["scaling", 3], ["rotationQuaternion", 4], ["localMatrix", 16]]) if (node[key] !== undefined && !finite(node[key], size)) fail("invalid captured transform.");
    if (record.kind === "nodes" && node.type !== "TransformNode") fail("unsupported transform node type.");
    if (record.kind === "meshes") {
      const data = record.data;
      if (!Array.isArray(data.materials ?? [])) fail("invalid material list.");
      for (const material of data.materials ?? []) { reserve(material, "material", true); materials.set(material.id, material); }
      const geometry = data.geometries?.vertexData ?? [];
      if (!Array.isArray(geometry) || geometry.length > 1) fail("unsupported inline geometry graph.");
      if (geometry.length) {
        reserve(geometry[0], "geometry");
        if (![0, 1].includes(node.sideOrientation) || node.delayLoadingFile) fail("invalid captured geometry state.");
        geometries.set(node.id, capturedGeometry(geometry[0], node));
      } else if (node.geometryId != null || node.delayLoadingFile) fail("missing captured geometry.");
    }
  }
  const root = records.find(record => record.node.id === snapshot.placementRootId);
  if (!root || root.kind !== "nodes" || root.node.parentId !== undefined || root.node.metadata.parentId !== undefined ||
      !equivalent(root.node.metadata.nativePlacement, snapshot.placement) || !equivalent(root.node.position, [0, 0, 0]) ||
      !equivalent(root.node.rotation ?? [0, 0, 0], [0, 0, 0]) || !equivalent(root.node.scaling, [1, 1, 1]) ||
      !equivalent(root.node.localMatrix, snapshot.placement.matrix.map(Math.fround)) ||
      root.node.rotationQuaternion && !equivalent(root.node.rotationQuaternion, [0, 0, 0, 1])) fail("invalid source placement root.");
  for (const record of records) {
    if (record === root) continue;
    if (Object.hasOwn(record.node.metadata, "nativePlacement")) fail("nested source placement.");
    const seen = new Set(); let current = record;
    while (current !== root) {
      if (seen.has(current.node.id)) fail("cyclic captured graph."); seen.add(current.node.id);
      const parent = nodes.get(current.node.metadata.parentId);
      if (!parent || current.node.parentId !== undefined && ![parent.node.id, parent.node.uniqueId].includes(current.node.parentId)) fail("captured parent is outside new graph.");
      current = parent;
    }
  }
  const textures = new Map();
  for (const texture of snapshot.textures) {
    if (!object(texture) || typeof texture.path !== "string" || !/^assets\/native-generated\/(?:model-)?[a-f0-9]{64}\/[a-f0-9]{64}\.png$/.test(texture.path) ||
        ![snapshot.model?.archive?.sha256, `model-${snapshot.model?.model?.sha256}`].includes(texture.path.split("/")[2]) ||
        !HASH.test(texture.sha256) || !Number.isSafeInteger(texture.bytes) || texture.bytes < 1 || textures.has(texture.path)) fail("invalid new texture descriptor.");
    const bytes = decoded64(texture.base64);
    if (bytes.length !== texture.bytes || hash(bytes) !== texture.sha256 || basename(texture.path) !== `${texture.sha256}.png` ||
        !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) fail("captured texture identity differs.");
    textures.set(texture.path, bytes);
  }
  const usedTextures = new Set();
  const checkTextures = value => {
    if (Array.isArray(value)) { value.forEach(checkTextures); return; } if (!object(value)) return;
    if (Object.hasOwn(value, "base64String")) fail("embedded/unmapped material texture.");
    if (Object.hasOwn(value, "samplingMode")) {
      if (typeof value.name !== "string" || !textures.has(value.name) || value.url !== value.name) fail("material references an unpinned texture.");
      usedTextures.add(value.name);
    }
    Object.values(value).forEach(checkTextures);
  };
  for (const record of records.filter(value => value.kind === "meshes")) {
    if (geometries.has(record.node.id)) {
      const material = materials.get(record.node.materialId);
      if (!material || record.node.materialUniqueId !== material.uniqueId ||
          !record.data.materials?.some(value => value.id === material.id)) fail("missing captured material binding.");
    }
  }
  materials.forEach(checkTextures);
  if (usedTextures.size !== textures.size || !geometries.size) fail("unreferenced texture or missing model geometry.");
  return { records, root, identities, numeric, materials, geometries, textures };
}

async function packRecord(record, source, helper) {
  const data = structuredClone(record.data), mesh = data.meshes[0], submeshes = structuredClone(mesh.subMeshes);
  const geometry = structuredClone(source.geometry), { uvs2, ...input } = geometry;
  if (uvs2 !== undefined) input.uv2s = uvs2;
  mesh._binaryInfo = {};
  const temporaryRoot = await fs.mkdtemp(join(tmpdir(), "native-editor-model-pack-"));
  let binary;
  try { const path = join(temporaryRoot, "geometry.bin"); await helper.write({ mesh, geometry: input, path, write: true }); binary = await fs.readFile(path); }
  finally {
    const actual = await fs.realpath(temporaryRoot), parent = await fs.realpath(tmpdir());
    if (dirname(actual) !== parent || !basename(actual).startsWith("native-editor-model-pack-")) fail("unexpected temporary packing path.");
    await fs.rm(actual, { recursive: true, force: true });
  }
  const expected = new Map([...source.channels].map(([key, bytes]) => {
    const [stride, descriptor, dataType] = CHANNELS[key]; return [descriptor, { bytes, count: bytes.length / 4, stride, dataType }];
  }));
  const subvalues = submeshes.flatMap(sub => [sub.materialIndex, sub.verticesStart, sub.verticesCount, sub.indexStart, sub.indexCount]);
  const subbytes = Buffer.alloc(subvalues.length * 4); subvalues.forEach((value, index) => subbytes.writeInt32LE(value, index * 4));
  expected.set("subMeshesAttrDesc", { bytes: subbytes, count: submeshes.length, stride: 5, dataType: 0 });
  if (!same(Object.keys(mesh._binaryInfo).sort(), [...expected.keys()].sort())) fail("packed geometry descriptors differ.");
  const ranges = [];
  for (const [name, item] of expected) {
    const desc = mesh._binaryInfo[name];
    if (!object(desc) || desc.count !== item.count || desc.stride !== item.stride || desc.dataType !== item.dataType ||
        !Number.isSafeInteger(desc.offset) || desc.offset < 0 || desc.offset % 4 || desc.offset + item.bytes.length > binary.length ||
        !binary.subarray(desc.offset, desc.offset + item.bytes.length).equals(item.bytes)) fail(`packed geometry changed exact channel ${name}.`);
    ranges.push([desc.offset, desc.offset + item.bytes.length]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  if (ranges[0][0] !== 0 || ranges.at(-1)[1] !== binary.length || ranges.some((range, index) => index && range[0] !== ranges[index - 1][1])) fail("packed geometry has uncovered/overlapping bytes.");
  const binarySha256 = hash(binary), binaryPath = `${SCENE}/geometries/${binarySha256}.babylonbinarymeshdata`;
  mesh.delayLoadingFile = binaryPath; mesh.boundingBoxMinimum = [Infinity, Infinity, Infinity]; mesh.boundingBoxMaximum = [-Infinity, -Infinity, -Infinity];
  geometry.positions.forEach((value, index) => { const axis = index % 3; mesh.boundingBoxMinimum[axis] = Math.min(mesh.boundingBoxMinimum[axis], value); mesh.boundingBoxMaximum[axis] = Math.max(mesh.boundingBoxMaximum[axis], value); });
  for (const key of Object.keys(CHANNELS)) if (Object.hasOwn(mesh, key)) mesh[key] = null;
  data.geometries.vertexData = [];
  return { data, binary, binaryPath, binarySha256 };
}

export async function planNativeEditorModelAppend(options) {
  const { projectRoot, snapshotPath, snapshotSha256, nextManifestPath, nextManifestSha256, expectedBaseManifestSha256 = BASE_MANIFEST_SHA256 } = options;
  if (![snapshotSha256, nextManifestSha256, expectedBaseManifestSha256].every(value => HASH.test(value))) fail("explicit snapshot/manifest hashes required.");
  const requested = resolve(projectRoot);
  for (let current = requested; dirname(current) !== current; current = dirname(current)) if ((await fs.lstat(current)).isSymbolicLink()) fail("linked project root.");
  if (!(await fs.lstat(requested)).isDirectory()) fail("project root is not a directory.");
  const root = await fs.realpath(requested), guards = new Map(), directories = new Map(), writes = [];
  const readBytes = async input => {
    const path = await pathIn(root, input), bytes = await fs.readFile(path.absolute), prior = guards.get(path.path);
    if (prior && !prior.bytes.equals(bytes)) fail("input changed during planning."); const value = { ...path, bytes }; guards.set(path.path, value); return value;
  };
  const read = async input => { const value = await readBytes(input); return { ...value, data: JSON.parse(jsonText(value.bytes)) }; };
  const list = async input => {
    const path = await pathIn(root, input); let entries;
    try { entries = await fs.readdir(path.absolute, { withFileTypes: true }); }
    catch (error) { if (error.code !== "ENOENT") throw error; entries = null; }
    const names = entries?.map(entry => entry.name).sort() ?? null, prior = directories.get(path.path);
    if (prior && !same(prior.entries, names)) fail("authored directory changed during planning.");
    directories.set(path.path, { ...path, entries: names }); return entries;
  };
  const capture = await read(snapshotPath), next = await read(nextManifestPath);
  if (hash(capture.bytes) !== snapshotSha256 || hash(next.bytes) !== nextManifestSha256 || capture.data.baseManifestSha256 !== expectedBaseManifestSha256) fail("input identity mismatch.");
  const snapshot = capture.data, graph = validateSnapshot(snapshot);
  const base = await read(`public/l2/maps/${expectedBaseManifestSha256}/map-section-runtime/manifest.json`);
  if (hash(base.bytes) !== expectedBaseManifestSha256) fail("base manifest hash differs."); validateExtension(base.data, next.data, snapshot);
  const config = await read(`${SCENE}/config.json`), sidecar = await read(`${SCENE}.native-editor-channels.json`);
  const records = [], allIds = new Set(), allUnique = new Set(), materialReferences = new Set();
  const collect = value => {
    if (Array.isArray(value)) { value.forEach(collect); return; } if (!object(value)) return;
    for (const [key, item] of Object.entries(value)) {
      if (["id", "geometryId", "materialId"].includes(key) && typeof item === "string") allIds.add(item);
      if (["uniqueId", "geometryUniqueId", "materialUniqueId"].includes(key) && Number.isSafeInteger(item)) allUnique.add(item);
      if (key !== "metadata") collect(item);
    }
  };
  for (const kind of ["nodes", "meshes", "cameras", "lights"]) {
    const entries = await list(`${SCENE}/${kind}`);
    if (!entries && ["nodes", "meshes"].includes(kind)) fail("missing scene graph directory.");
    for (const entry of entries ?? []) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) fail("unsupported scene graph entry.");
      const doc = await read(`${SCENE}/${kind}/${entry.name}`); collect(doc.data);
      const nodes = kind === "meshes" ? doc.data.meshes : [doc.data]; if (!Array.isArray(nodes) || nodes.length !== 1) fail("ambiguous saved node record.");
      records.push({ kind, doc, node: nodes[0] });
      for (const material of doc.data.materials ?? []) {
        const reference = material.metadata?.gltf?.extras?.nativeSourceReference;
        if (typeof reference === "string") materialReferences.add(reference.toLowerCase());
      }
    }
  }
  await list(`${SCENE}/geometries`);
  const roots = records.filter(record => record.node.metadata?.nativeWorldRoot !== undefined);
  if (roots.length !== 1 || roots[0].kind !== "nodes") fail("missing/ambiguous saved world root.");
  const world = roots[0], marker = world.node.metadata.nativeWorldRoot, repeated = marker.manifestSha256 === nextManifestSha256;
  if (marker.schemaVersion !== 1 || ![expectedBaseManifestSha256, nextManifestSha256].includes(marker.manifestSha256) ||
      !equivalent(marker.manifest, repeated ? next.data : base.data) || config.data.metadata?.nativeEditorImport?.manifestSha256 !== marker.manifestSha256 ||
      config.data.metadata.nativeEditorImport.targetScene !== SCENE || sidecar.data.schemaVersion !== 1 || sidecar.data.kind !== "native-editor-channels" ||
      sidecar.data.manifestSha256 !== marker.manifestSha256) fail("saved manifest/config/channel proof differs.");
  const added = records.filter(record => record.node.metadata?.nativePlacement?.id === snapshot.placement.id);
  const summary = { schemaVersion: 1, kind: "native-editor-model-append", status: repeated ? "preserved" : "planned", sourceSnapshotSha256: snapshotSha256,
    beforeManifestSha256: marker.manifestSha256, nextManifestSha256, modelId: snapshot.model.id, placementId: snapshot.placement.id, newRecords: [], changes: [] };
  const finish = () => {
    summary.changes = writes.map(write => ({ path: write.path, beforeSha256: write.before === null ? null : hash(write.before), afterSha256: hash(write.bytes), bytes: write.bytes.length }));
    const plan = { root, summary: structuredClone(summary), writes: writes.map(write => ({ ...write, bytes: Buffer.from(write.bytes), before: write.before === null ? null : Buffer.from(write.before) })) };
    plans.set(plan, { root, guards: [...guards.values()], directories: [...directories.values()], writes, summary: structuredClone(summary) }); return plan;
  };
  if (repeated) {
    if (added.length !== 1 || added[0].node.id !== snapshot.placementRootId || !equivalent(added[0].node.metadata.nativePlacement, snapshot.placement) ||
        added[0].node.metadata.nativeModelAppend?.snapshotSha256 !== snapshotSha256) fail("missing/conflicting prior model append.");
    for (const record of graph.records) {
      const saved = records.filter(value => value.kind === record.kind && value.node.id === record.node.id);
      if (saved.length !== 1 || saved[0].node.metadata?.nativeModelAppend?.snapshotSha256 !== snapshotSha256) fail("partial prior model graph.");
      summary.newRecords.push({ path: saved[0].doc.path, nodeId: saved[0].node.id });
    }
    return finish(); // Later authored geometry/material/transform edits remain authoritative.
  }
  if (added.length || world.node.parentId !== undefined || world.node.metadata?.parentId !== undefined || !equivalent(world.node.position, [0, 0, 0]) ||
      !equivalent(world.node.scaling, [1, 1, -1]) || !equivalent(world.node.rotation ?? [0, 0, 0], [0, 0, 0]) ||
      !equivalent(world.node.rotationQuaternion ?? [0, 0, 0, 1], [0, 0, 0, 1]) || world.node.freezeWorldMatrix) fail("invalid current world/placement state.");
  for (const [id, value] of graph.identities) if (allIds.has(id) || allUnique.has(value.record.uniqueId)) fail("new identity collides with authored data.");
  for (const material of graph.materials.values()) {
    const reference = material.metadata?.gltf?.extras?.nativeSourceReference;
    if (typeof reference === "string" && materialReferences.has(reference.toLowerCase())) fail("new material source already has an authored binding.");
  }
  const addNew = async (name, bytes, identical = false) => {
    const target = await pathIn(root, name); await list(dirname(target.path));
    const priorWrite = writes.find(write => write.path === target.path);
    if (priorWrite) { if (identical && priorWrite.bytes.equals(bytes)) return; fail("duplicate new output."); }
    try { const previous = await readBytes(name); if (!identical || !previous.bytes.equals(bytes)) fail("new output conflicts with authored bytes."); }
    catch (error) { if (error.code !== "ENOENT") throw error; writes.push({ ...target, bytes, before: null }); }
  };
  for (const [name, bytes] of graph.textures) await addNew(name, bytes, true);
  const helper = await geometryWriter(options); summary.geometryHelper = helper.provenance;
  for (const record of graph.records) {
    let data = structuredClone(record.data), packed;
    if (graph.geometries.has(record.node.id)) { packed = await packRecord(record, graph.geometries.get(record.node.id), helper); data = packed.data; await addNew(packed.binaryPath, packed.binary, true); }
    const node = record.kind === "nodes" ? data : data.meshes[0]; delete node.parentId;
    node.metadata.nativeModelAppend = { schemaVersion: 1, snapshotSha256, modelId: snapshot.model.id, placementId: snapshot.placement.id };
    if (node.id === snapshot.placementRootId) node.metadata.parentId = world.node.uniqueId;
    const path = `${SCENE}/${record.kind}/${node.id}.json`; await addNew(path, encode(data));
    summary.newRecords.push({ path, nodeId: node.id, ...(packed ? { geometryPath: packed.binaryPath, geometrySha256: packed.binarySha256 } : {}) });
  }
  let worldBytes = replaceValue(world.doc.bytes, ["metadata", "nativeWorldRoot", "manifest"], marker.manifest, next.data);
  worldBytes = replaceValue(worldBytes, ["metadata", "nativeWorldRoot", "manifestSha256"], marker.manifestSha256, nextManifestSha256);
  for (const [doc, bytes] of [[world.doc, worldBytes],
    [config, replaceValue(config.bytes, ["metadata", "nativeEditorImport", "manifestSha256"], marker.manifestSha256, nextManifestSha256)],
    [sidecar, replaceValue(sidecar.bytes, ["manifestSha256"], marker.manifestSha256, nextManifestSha256)]]) writes.push({ path: doc.path, absolute: doc.absolute, before: doc.bytes, bytes });
  return finish();
}

export async function applyNativeEditorModelAppend(plan, { receiptPath } = {}) {
  const owned = plans.get(plan); if (!owned) fail("apply requires a fresh plan from this process."); plans.delete(plan);
  const { root, guards, directories, writes, summary } = owned; let receipt;
  if (receiptPath) { receipt = await pathIn(root, receiptPath); try { await fs.lstat(receipt.absolute); fail("receipt exists."); } catch (error) { if (error.code !== "ENOENT") throw error; } }
  for (const directory of directories) {
    let entries; try { entries = (await fs.readdir((await pathIn(root, directory.path)).absolute)).sort(); } catch (error) { if (error.code !== "ENOENT") throw error; entries = null; }
    if (!same(entries, directory.entries)) fail("authored directory changed after planning.");
  }
  for (const guard of guards) if (!(await fs.readFile((await pathIn(root, guard.path)).absolute)).equals(guard.bytes)) fail(`input changed after planning: ${guard.path}.`);
  for (const write of writes.filter(value => value.before === null)) { try { await fs.lstat((await pathIn(root, write.path)).absolute); fail("new output appeared after planning."); } catch (error) { if (error.code !== "ENOENT") throw error; } }
  const applied = [], createdDirectories = [];
  const ensureParents = async path => {
    let current = root;
    for (const part of relative(root, dirname(path)).split(sep).filter(Boolean)) {
      current = join(current, part); await pathIn(root, current);
      try { await fs.mkdir(current); createdDirectories.push(current); } catch (error) { if (error.code !== "EEXIST") throw error; }
      if (!(await fs.lstat((await pathIn(root, current)).absolute)).isDirectory()) fail("output parent changed.");
    }
  };
  try {
    for (const write of writes) {
      const destination = (await pathIn(root, write.path)).absolute; await ensureParents(destination);
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
    if (receipt) { await ensureParents(receipt.absolute); await fs.writeFile((await pathIn(root, receipt.path)).absolute, encode(result), { flag: "wx" }); }
    return result;
  } catch (error) {
    const limits = [];
    for (const write of applied.reverse()) {
      try { const path = (await pathIn(root, write.path)).absolute; if (!(await fs.readFile(path)).equals(write.bytes)) { limits.push(`concurrent edit retained: ${write.path}`); continue; }
        if (write.before === null) await fs.unlink(path); else await fs.writeFile(path, write.before);
      } catch (failure) { limits.push(`${write.path}: ${failure.message}`); }
    }
    for (const path of createdDirectories.reverse()) { try { await fs.rmdir((await pathIn(root, path)).absolute); } catch (failure) { if (!["ENOTEMPTY", "ENOENT"].includes(failure.code)) limits.push(failure.message); } }
    if (limits.length) error.message += ` Rollback limits: ${limits.join("; ")}`; throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), values = {}, allowed = new Set(["--snapshot", "--snapshot-sha256", "--manifest", "--sha256", "--project", "--receipt"]); let apply = false;
  for (let index = 0; index < args.length; index++) { const key = args[index]; if (key === "--apply") apply = true; else if (allowed.has(key) && args[index + 1] && !Object.hasOwn(values, key)) values[key] = args[++index]; else fail("invalid CLI arguments."); }
  const plan = await planNativeEditorModelAppend({ projectRoot: values["--project"] ?? resolve(dirname(fileURLToPath(import.meta.url)), ".."),
    snapshotPath: values["--snapshot"], snapshotSha256: values["--snapshot-sha256"], nextManifestPath: values["--manifest"], nextManifestSha256: values["--sha256"] });
  console.log(JSON.stringify(apply ? await applyNativeEditorModelAppend(plan, { receiptPath: values["--receipt"] }) : plan.summary, null, 2));
}
