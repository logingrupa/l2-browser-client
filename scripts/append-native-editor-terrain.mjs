/** Guarded offline addition of the qualified adjacent terrain resource. */
import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual as same } from "node:util";
import { geometryWriter } from "./native_editor_scene.mjs";

import { createNativeEditorChannels } from "./preserve-native-editor-uv2.mjs";
const SCENE = "assets/native-world.scene";
const BASE_TERRAIN = "native-34fc990641dc04014d49e47c";
const HASH = /^[a-f0-9]{64}$/, ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,179}$/;
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const CHANNELS = { positions: [3, "positionsAttrDesc", 1], normals: [3, "normalsAttrDesc", 1],
  uvs: [2, "uvsAttrDesc", 1], uvs2: [2, "uvs2AttrDesc", 1], colors: [4, "colorsAttrDesc", 1], indices: [1, "indicesAttrDesc", 0] };
const plans = new WeakMap(), hash = bytes => createHash("sha256").update(bytes).digest("hex");
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const jsonClone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const equivalent = (a, b) => same(jsonClone(a), jsonClone(b));
const encode = value => Buffer.from(JSON.stringify(value, null, 2) + "\n");
const fail = message => { throw Error(`Native Editor terrain append: ${message}`); };
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
function capturedGeometry(input, mesh) {
  if (!object(input) || typeof input.id !== "string" || !Number.isSafeInteger(input.uniqueId)) fail("invalid captured geometry identity.");
  if (mesh.geometryId !== input.id || mesh.geometryUniqueId !== input.uniqueId) fail("geometry binding differs.");
  const allowed = new Set(["id", "uniqueId", "updatable", "hasVertexAlpha", "channelBytes", ...Object.keys(CHANNELS)]);
  if (Object.keys(input).some(key => !allowed.has(key)) || !object(input.channelBytes)) fail("unsupported geometry fields or missing exact channels.");
  const names = Object.keys(CHANNELS).filter(key => input[key] !== undefined);
  if (!["positions", "normals", "uvs", "indices"].every(key => names.includes(key)) ||
      !same(Object.keys(input.channelBytes).sort(), [...names].sort())) fail("missing or unbound geometry channels.");
  if (!names.includes("uvs2") || names.includes("colors") || input.hasVertexAlpha === true) fail("terrain requires exact UV2 and no unqualified color channel.");
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


const PATCH_ID = "interlude:20_20.TerrainInfo0.TerrainSector247";
const MAP_HASH = "1beddad24c10a35a1b2e9151727a85158e3e01992299a6671de876645eb1f1e4";
function validatePatch(value) {
  if (!object(value) || !same(Object.keys(value).sort(), ["id", "sourceTerrain", "sourceSector", "sourceMapSha256", "gridBounds", "model", "source"].sort()) ||
      value.id !== PATCH_ID || value.sourceTerrain !== "20_20.TerrainInfo0" || value.sourceSector !== "20_20.TerrainInfo0.TerrainSector247" ||
      value.sourceMapSha256 !== MAP_HASH || !equivalent(value.gridBounds, [112, 240, 128, 255])) fail("unsupported terrain patch scope.");
  for (const [key, file] of [["model", "terrain247.glb"], ["source", "terrain247.json"]]) {
    const resource = value[key];
    if (!object(resource) || !same(Object.keys(resource).sort(), ["bytes", "file", "sha256"]) || resource.file !== file ||
        !HASH.test(resource.sha256) || !Number.isSafeInteger(resource.bytes) || resource.bytes < 1 || resource.bytes > 128 * 1024 * 1024) fail("invalid terrain patch resource.");
  }
}
function validateExtension(base, next, patch) {
  if (!object(base) || !object(next) || base.schemaVersion !== 1 || next.schemaVersion !== 1 ||
      base.kind !== "native-map-section-runtime" || next.kind !== base.kind) fail("invalid manifest identity.");
  const allowed = new Set(["terrainPatches", "derivation", "coverage", "gaps"]);
  for (const key of new Set([...Object.keys(base), ...Object.keys(next)])) {
    if (!allowed.has(key) && (!Object.hasOwn(base, key) || !Object.hasOwn(next, key) || !equivalent(base[key], next[key]))) fail(`unrelated manifest change: ${key}.`);
  }
  if (base.terrainPatches !== undefined && (!Array.isArray(base.terrainPatches) || base.terrainPatches.length) ||
      !Array.isArray(next.terrainPatches) || next.terrainPatches.length !== 1 || !equivalent(next.terrainPatches[0], patch)) fail("invalid additive terrainPatches extension.");
  for (const key of ["derivation", "coverage"]) {
    if (!object(base[key] ?? {}) || !object(next[key] ?? {})) fail(`invalid ${key}.`);
    for (const name of Object.keys(base[key] ?? {})) if (!Object.hasOwn(next[key] ?? {}, name) || !equivalent(base[key][name], next[key][name])) fail(`existing ${key} changed.`);
  }
  if (!Array.isArray(base.gaps) || !Array.isArray(next.gaps) || !next.gaps.every(value => typeof value === "string") ||
      next.gaps.length < base.gaps.length || !equivalent(base.gaps, next.gaps.slice(0, base.gaps.length))) fail("existing gaps changed.");
}
function layerBindings(node) {
  const layers = node.metadata?.gltf?.extras?.nativeLayers;
  if (!Array.isArray(layers) || layers.length !== 9) fail("missing nine retained terrain layers.");
  return layers.map((layer, index) => {
    if (!object(layer) || layer.index !== index || typeof layer.texture !== "string" || !layer.texture ||
        typeof layer.alphaMap !== "string" || !layer.alphaMap || !Array.isArray(layer.worldToTextureRowMajor) ||
        layer.worldToTextureRowMajor.length !== 4 || !layer.worldToTextureRowMajor.every(row => finite(row, 4))) fail("invalid terrain layer binding.");
    return { index, texture: layer.texture, alphaMap: layer.alphaMap, worldToTextureRowMajor: layer.worldToTextureRowMajor };
  });
}
function validateSnapshot(snapshot) {
  if (!object(snapshot) || snapshot.schemaVersion !== 1 || snapshot.kind !== "native-editor-terrain-snapshot" ||
      !HASH.test(snapshot.baseManifestSha256) || !object(snapshot.mesh)) fail("invalid terrain snapshot.");
  validatePatch(snapshot.nativeTerrainPatch);
  const data = snapshot.mesh;
  if (!Array.isArray(data.meshes) || data.meshes.length !== 1 ||
      ["skeletons", "animationGroups", "transformNodes", "cameras", "lights", "particleSystems", "multiMaterials"].some(key => data[key]?.length) ||
      !object(data.geometries) || !Array.isArray(data.geometries.vertexData) || data.geometries.vertexData.length !== 1 ||
      Object.entries(data.geometries).some(([key, value]) => key !== "vertexData" && (!Array.isArray(value) || value.length))) fail("unsupported terrain mesh document.");
  const node = data.meshes[0];
  if (!object(node) || !object(node.metadata) || typeof node.id !== "string" || !node.id || !Number.isSafeInteger(node.uniqueId) ||
      node.type !== undefined && node.type !== "Mesh" || node.isEnabled === false || node.isVisible === false || node.visibility !== undefined && node.visibility !== 1 ||
      node.parentId !== undefined || node.metadata.parentId !== undefined || node.freezeWorldMatrix || node.instances?.length || node.animations?.length || node.ranges?.length ||
      node.skeletonId != null || node.morphTargetManagerId != null || node.actions != null || node.sourceMeshId != null || node.delayLoadingFile || node.billboardMode || node.infiniteDistance ||
      ["nativeWorldRoot", "nativePlacement", "nativeBsp", "nativeSkyRoot", "nativeSkyPart", "nativeTerrainPatch", "nativeTerrainAppend"].some(key => Object.hasOwn(node.metadata, key)) ||
      !equivalent(node.position, [0, 0, 0]) || !equivalent(node.scaling, [1, 1, 1]) || !equivalent(node.rotation ?? [0, 0, 0], [0, 0, 0]) ||
      !equivalent(node.rotationQuaternion ?? [0, 0, 0, 1], [0, 0, 0, 1]) || !equivalent(node.localMatrix ?? IDENTITY, IDENTITY) ||
      !equivalent(data.basePoseMatrix ?? IDENTITY, IDENTITY) || ![0, 1].includes(node.sideOrientation)) fail("terrain capture must have identity transforms and no parent or animation.");
  const extras = node.metadata.gltf?.extras;
  if (!object(extras) || ![snapshot.nativeTerrainPatch.sourceTerrain, snapshot.nativeTerrainPatch.sourceSector].includes(extras.nativeObject) ||
      extras.nativeSectorObjects !== undefined && !equivalent(extras.nativeSectorObjects, [snapshot.nativeTerrainPatch.sourceSector])) fail("captured terrain source differs.");
  const bindings = layerBindings(node), source = capturedGeometry(data.geometries.vertexData[0], node);
  if (source.geometry.positions.length !== 272 * 3 || node.subMeshes.length !== 1 || node.subMeshes[0].materialIndex !== 0 ||
      node.subMeshes[0].verticesStart !== 0 || node.subMeshes[0].verticesCount !== 272 || node.subMeshes[0].indexStart !== 0 ||
      node.subMeshes[0].indexCount !== source.geometry.indices.length) fail("captured terrain vertex/submesh scope differs.");
  const expectedXZ = new Set();
  for (let y = 240; y <= 255; y++) for (let x = 112; x <= 128; x++) expectedXZ.add(`${Math.fround(x * 1.28)}:${Math.fround((65536 + y * 128) * .01)}`);
  for (let index = 0; index < source.geometry.positions.length; index += 3) {
    if (!expectedXZ.delete(`${source.geometry.positions[index]}:${source.geometry.positions[index + 2]}`)) fail("terrain positions are not the retained absolute source grid.");
  }
  if (expectedXZ.size) fail("terrain source grid is incomplete.");
  return { data, node, source, bindings };
}
function stableIdentity(snapshotSha256, role) {
  const digest = hash(`native-editor-terrain-append-v1:${PATCH_ID}:${snapshotSha256}:${role}`);
  return { id: `native-${digest.slice(0, 24)}`, uniqueId: 2 ** 48 + Number.parseInt(digest.slice(0, 12), 16) };
}
function verifyBaseProof(sidecar, mesh, binary) {
  const found = sidecar.meshes.filter(entry => entry?.meshId === mesh.id);
  if (found.length !== 1) fail("missing/duplicate base terrain channel proof.");
  const entry = found[0], vertices = mesh._binaryInfo?.positionsAttrDesc?.count / 3;
  if (!Number.isSafeInteger(vertices) || vertices !== entry.vertexCount || !object(entry.channels)) fail("base terrain proof vertex count differs.");
  for (const key of ["positions", "normals", "uvs", "indices", "uvs2"]) {
    const [stride, name, dataType] = CHANNELS[key], descriptor = mesh._binaryInfo?.[name], proof = key === "uvs2" ? entry.uv2 : entry.channels[key];
    if (!object(descriptor) || !object(proof) || descriptor.stride !== stride || descriptor.dataType !== dataType ||
        !Number.isSafeInteger(descriptor.count) || descriptor.count <= 0 || !Number.isSafeInteger(descriptor.offset) || descriptor.offset < 0 || descriptor.offset % 4 ||
        descriptor.offset + descriptor.count * 4 > binary.length || proof.count !== descriptor.count || proof.stride !== stride || proof.dataType !== dataType ||
        hash(binary.subarray(descriptor.offset, descriptor.offset + descriptor.count * 4)) !== proof.sha256) fail(`base terrain ${key} proof differs from saved bytes.`);
    if (key === "uvs2" && !decoded64(proof.base64).equals(binary.subarray(descriptor.offset, descriptor.offset + descriptor.count * 4))) fail("base terrain UV2 proof bytes differ.");
  }
}

function validateAuthoredMaterial(material) {
  const samplers = [...Array.from({ length: 9 }, (_, index) => `layer${index}`), "mask0", "mask1", "mask2"];
  if (!object(material) || material.customType !== "BABYLON.ShaderMaterial" || typeof material.id !== "string" || !Number.isSafeInteger(material.uniqueId) ||
      !equivalent(material.options?.attributes, ["position", "uv"]) || !equivalent(material.options?.samplers, samplers) ||
      !Array.isArray(material.options?.uniforms) || !material.options.uniforms.includes("worldViewProjection") ||
      typeof material.shaderPath?.vertexSource !== "string" || !/vNativePosition\s*=\s*position\.xzy\s*\*\s*100(?:\.0+)?\s*;/.test(material.shaderPath.vertexSource) ||
      !/vMaskUV\s*=\s*uv\s*;/.test(material.shaderPath.vertexSource) || !object(material.textures) ||
      !samplers.every(name => object(material.textures[name]) && typeof material.textures[name].name === "string")) fail("current authored terrain material has incompatible local-coordinate bindings.");
}

export async function planNativeEditorTerrainAppend(options) {
  const { projectRoot, snapshotPath, snapshotSha256, oldManifestPath, oldManifestSha256, nextManifestPath, nextManifestSha256,
    baseTerrainMeshSha256, baseTerrainGeometrySha256, baseChannelsSha256 } = options;
  if (![snapshotSha256, oldManifestSha256, nextManifestSha256, baseTerrainMeshSha256, baseTerrainGeometrySha256, baseChannelsSha256].every(value => HASH.test(value)) ||
      oldManifestSha256 === nextManifestSha256) fail("explicit distinct manifest and fresh baseline hashes required.");
  const requested = resolve(projectRoot);
  for (let current = requested; dirname(current) !== current; current = dirname(current)) if ((await fs.lstat(current)).isSymbolicLink()) fail("linked project root.");
  if (!(await fs.lstat(requested)).isDirectory()) fail("project root is not a directory.");
  const root = await fs.realpath(requested), guards = new Map(), directories = new Map(), writes = [];
  const readBytes = async input => {
    const path = await pathIn(root, input), bytes = await fs.readFile(path.absolute), prior = guards.get(path.path);
    if (prior && !prior.bytes.equals(bytes)) fail("input changed during planning.");
    const value = { ...path, bytes }; guards.set(path.path, value); return value;
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
  const capture = await read(snapshotPath), base = await read(oldManifestPath), next = await read(nextManifestPath);
  if (hash(capture.bytes) !== snapshotSha256 || hash(base.bytes) !== oldManifestSha256 || hash(next.bytes) !== nextManifestSha256 ||
      capture.data.baseManifestSha256 !== oldManifestSha256) fail("input identity mismatch.");
  const snapshot = capture.data, graph = validateSnapshot(snapshot), patch = snapshot.nativeTerrainPatch;
  validateExtension(base.data, next.data, patch);
  const config = await read(`${SCENE}/config.json`), sidecar = await read(`${SCENE}.native-editor-channels.json`);
  const records = [], allIds = new Set(), allUnique = new Set();
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
      if (!entry.isFile() || !entry.name.endsWith(".json")) fail("unsupported saved scene entry.");
      const doc = await read(`${SCENE}/${kind}/${entry.name}`); collect(doc.data);
      const nodes = kind === "meshes" ? doc.data.meshes : [doc.data];
      if (!Array.isArray(nodes) || nodes.length !== 1) fail("ambiguous saved node record.");
      records.push({ kind, doc, node: nodes[0] });
    }
  }
  await list(`${SCENE}/geometries`);
  const worlds = records.filter(record => record.node.metadata?.nativeWorldRoot !== undefined);
  if (worlds.length !== 1 || worlds[0].kind !== "nodes") fail("missing/ambiguous saved world root.");
  const world = worlds[0], marker = world.node.metadata.nativeWorldRoot, repeated = marker.manifestSha256 === nextManifestSha256;
  if (marker.schemaVersion !== 1 || ![oldManifestSha256, nextManifestSha256].includes(marker.manifestSha256) ||
      !equivalent(marker.manifest, repeated ? next.data : base.data) || config.data.metadata?.nativeEditorImport?.manifestSha256 !== marker.manifestSha256 ||
      config.data.metadata.nativeEditorImport.targetScene !== SCENE || sidecar.data.schemaVersion !== 1 || sidecar.data.kind !== "native-editor-channels" ||
      sidecar.data.manifestSha256 !== marker.manifestSha256 || !Array.isArray(sidecar.data.meshes) ||
      new Set(sidecar.data.meshes.map(entry => entry?.meshId)).size !== sidecar.data.meshes.length) fail("saved manifest/config/channel proof differs.");
  const meshIdentity = stableIdentity(snapshotSha256, "mesh"), geometryIdentity = stableIdentity(snapshotSha256, "geometry");
  const added = records.filter(record => record.node.metadata?.nativeTerrainPatch !== undefined);
  const summary = { schemaVersion: 1, kind: "native-editor-terrain-append", status: repeated ? "preserved" : "planned",
    sourceSnapshotSha256: snapshotSha256, beforeManifestSha256: marker.manifestSha256, nextManifestSha256,
    patchId: patch.id, meshId: meshIdentity.id, newRecords: [], changes: [] };
  const finish = () => {
    summary.changes = writes.map(write => ({ path: write.path, beforeSha256: write.before === null ? null : hash(write.before), afterSha256: hash(write.bytes), bytes: write.bytes.length }));
    const plan = { root, summary: structuredClone(summary), writes: writes.map(write => ({ ...write, bytes: Buffer.from(write.bytes), before: write.before === null ? null : Buffer.from(write.before) })) };
    plans.set(plan, { root, guards: [...guards.values()], directories: [...directories.values()], writes, summary: structuredClone(summary) }); return plan;
  };
  if (repeated) {
    if (added.length !== 1 || added[0].kind !== "meshes" || added[0].node.id !== meshIdentity.id ||
        !equivalent(added[0].node.metadata.nativeTerrainPatch, patch) || added[0].node.metadata.nativeTerrainAppend?.snapshotSha256 !== snapshotSha256 ||
        sidecar.data.meshes.filter(entry => entry?.meshId === meshIdentity.id).length !== 1 ||
        sidecar.data.meshes.filter(entry => entry?.meshId === BASE_TERRAIN).length !== 1) fail("partial/conflicting prior terrain append.");
    summary.newRecords.push({ path: added[0].doc.path, meshId: meshIdentity.id });
    return finish(); // Later authored geometry, materials, transforms and proof remain authoritative.
  }
  if (added.length || world.node.parentId !== undefined || world.node.metadata.parentId !== undefined || world.node.freezeWorldMatrix ||
      !equivalent(world.node.position, [0, 0, 0]) || !equivalent(world.node.scaling, [1, 1, -1]) ||
      !equivalent(world.node.rotation ?? [0, 0, 0], [0, 0, 0]) || !equivalent(world.node.rotationQuaternion ?? [0, 0, 0, 1], [0, 0, 0, 1])) fail("invalid current world/patch state.");
  for (const value of [meshIdentity, geometryIdentity]) if (allIds.has(value.id) || allUnique.has(value.uniqueId)) fail("new terrain identity collides with authored data.");
  if (meshIdentity.id === geometryIdentity.id || meshIdentity.uniqueId === geometryIdentity.uniqueId) fail("new terrain identity collision.");
  const saved = records.filter(record => record.kind === "meshes" && record.node.id === BASE_TERRAIN);
  if (saved.length !== 1 || saved[0].doc.path !== `${SCENE}/meshes/${BASE_TERRAIN}.json` || hash(saved[0].doc.bytes) !== baseTerrainMeshSha256 ||
      hash(sidecar.bytes) !== baseChannelsSha256) fail("fresh base terrain/proof guards differ; newer authored work is preserved.");
  const original = saved[0], oldMesh = original.node;
  if (oldMesh.metadata?.worldTerrain !== true || oldMesh.metadata?.nativeEditorSource?.originalId !== patch.sourceTerrain ||
      !equivalent(layerBindings(oldMesh), graph.bindings) || original.doc.data.geometries?.vertexData?.length ||
      typeof oldMesh.delayLoadingFile !== "string" || !oldMesh.delayLoadingFile.startsWith(`${SCENE}/geometries/`) ||
      oldMesh.delayLoadingFile.slice(`${SCENE}/geometries/`.length).includes("/")) fail("base terrain geometry/source/binding differs.");
  const originalBinary = await readBytes(oldMesh.delayLoadingFile);
  if (hash(originalBinary.bytes) !== baseTerrainGeometrySha256) fail("base terrain geometry hash differs; newer authored work is preserved.");
  verifyBaseProof(sidecar.data, oldMesh, originalBinary.bytes);
  const definitions = records.flatMap(record => record.doc.data.materials ?? []).filter(material => material.id === oldMesh.materialId || material.uniqueId === oldMesh.materialUniqueId);
  if (!definitions.length || definitions.some(material => material.id !== oldMesh.materialId || material.uniqueId !== oldMesh.materialUniqueId || !equivalent(material, definitions[0]))) fail("missing/conflicting current authored terrain material.");
  const material = definitions[0]; validateAuthoredMaterial(material);
  const textureInputs = [];
  for (const texture of Object.values(material.textures)) {
    if (!object(texture) || typeof texture.name !== "string" || !/^assets\/native-generated\/[a-f0-9]{64}\/[a-f0-9]{64}\.png$/.test(texture.name) ||
        texture.url !== undefined && texture.url !== texture.name) fail("authored terrain texture path differs.");
    const resource = await readBytes(texture.name);
    textureInputs.push({ path: resource.path, sha256: hash(resource.bytes), bytes: resource.bytes.length });
  }
  const sourceData = structuredClone(graph.data), node = sourceData.meshes[0], geometry = structuredClone(graph.source.geometry);
  Object.assign(node, meshIdentity); Object.assign(geometry, geometryIdentity);
  node.geometryId = geometryIdentity.id; node.geometryUniqueId = geometryIdentity.uniqueId;
  node.materialId = material.id; node.materialUniqueId = material.uniqueId;
  node.localMatrix = [...IDENTITY]; node.sideOrientation = 1 - graph.node.sideOrientation;
  node.hasUVs = true; node.hasUVs2 = true;
  node.isEnabled = true; node.isVisible = true; node.visibility = 1; node.pickable = true;
  node.metadata = { ...node.metadata, worldTerrain: true, worldSupportsWalking: true, nativeTerrainPatch: structuredClone(patch),
    nativeTerrainAppend: { schemaVersion: 1, snapshotSha256, baseManifestSha256: oldManifestSha256 }, parentId: world.node.uniqueId,
    nativeEditorSource: { originalId: graph.node.id, originalName: graph.node.name, sideOrientation: graph.node.sideOrientation } };
  sourceData.materials = [structuredClone(material)]; sourceData.geometries.vertexData = [geometry];
  const recovery = createNativeEditorChannels({ schemaVersion: 1, kind: "native-editor-world-snapshot", manifestSha256: nextManifestSha256, meshes: [sourceData] });
  if (recovery.meshes.length !== 1 || recovery.meshes[0].meshId !== meshIdentity.id || sidecar.data.meshes.some(entry => entry.meshId === meshIdentity.id)) fail("new terrain UV2 recovery identity differs.");
  const helper = await geometryWriter(options), packed = await packRecord({ data: sourceData }, { ...graph.source, geometry }, helper);
  verifyBaseProof({ meshes: recovery.meshes }, packed.data.meshes[0], packed.binary);
  const addNew = async (name, bytes) => {
    const target = await pathIn(root, name); await list(dirname(target.path));
    try { await fs.lstat(target.absolute); fail("new terrain output already exists."); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    writes.push({ ...target, bytes, before: null });
  };
  const meshPath = `${SCENE}/meshes/${meshIdentity.id}.json`;
  await addNew(packed.binaryPath, packed.binary); await addNew(meshPath, encode(packed.data));
  let worldBytes = replaceValue(world.doc.bytes, ["metadata", "nativeWorldRoot", "manifest"], marker.manifest, next.data);
  worldBytes = replaceValue(worldBytes, ["metadata", "nativeWorldRoot", "manifestSha256"], marker.manifestSha256, nextManifestSha256);
  let proofBytes = appendProofEntry(sidecar.bytes, sidecar.data.meshes, recovery.meshes[0]);
  proofBytes = replaceValue(proofBytes, ["manifestSha256"], marker.manifestSha256, nextManifestSha256);
  for (const [doc, bytes] of [[world.doc, worldBytes], [config, replaceValue(config.bytes, ["metadata", "nativeEditorImport", "manifestSha256"], marker.manifestSha256, nextManifestSha256)],
    [sidecar, proofBytes]]) writes.push({ path: doc.path, absolute: doc.absolute, before: doc.bytes, bytes });
  summary.newRecords.push({ path: meshPath, meshId: meshIdentity.id, geometryPath: packed.binaryPath, geometrySha256: packed.binarySha256 });
  summary.geometryHelper = helper.provenance; summary.recoveryEntry = recovery.meshes[0];
  summary.material = { id: material.id, uniqueId: material.uniqueId, sourceMesh: original.doc.path, sourceMeshSha256: hash(original.doc.bytes),
    recordSha256: hash(Buffer.from(JSON.stringify(material))), textures: textureInputs };
  return finish();
}

function appendProofEntry(bytes, entries, addition) {
  const text = jsonText(bytes), [start, end] = valueSpan(text, ["meshes"]);
  if (!equivalent(JSON.parse(text.slice(start, end)), entries) || text[end - 1] !== "]") fail("channel proof changed.");
  // Insert at the final bracket. All existing entry/token bytes remain intact.
  const output = Buffer.from(text.slice(0, end - 1) + (entries.length ? "," : "") + JSON.stringify(addition) + text.slice(end - 1));
  const parsed = JSON.parse(jsonText(output));
  if (!equivalent(parsed.meshes, [...entries, addition])) fail("channel proof append differs.");
  return output;
}

export async function applyNativeEditorTerrainAppend(plan, { receiptPath } = {}) {
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
  const args = process.argv.slice(2), values = {}, names = {
    "--snapshot": "snapshotPath", "--snapshot-sha256": "snapshotSha256", "--old-manifest": "oldManifestPath", "--old-sha256": "oldManifestSha256",
    "--manifest": "nextManifestPath", "--sha256": "nextManifestSha256", "--base-terrain-mesh-sha256": "baseTerrainMeshSha256",
    "--base-terrain-geometry-sha256": "baseTerrainGeometrySha256", "--base-channels-sha256": "baseChannelsSha256",
    "--project": "projectRoot", "--receipt": "receiptPath",
  }; let apply = false;
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (key === "--apply" && !apply) apply = true;
    else if (Object.hasOwn(names, key) && args[index + 1] && !Object.hasOwn(values, names[key])) values[names[key]] = args[++index];
    else fail("invalid CLI arguments.");
  }
  const plan = await planNativeEditorTerrainAppend({ ...values, projectRoot: values.projectRoot ?? resolve(dirname(fileURLToPath(import.meta.url)), "..") });
  console.log(JSON.stringify(apply ? await applyNativeEditorTerrainAppend(plan, { receiptPath: values.receiptPath }) : plan.summary, null, 2));
}
