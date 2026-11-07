/** Add the exact retained 20_20 sky snapshot. This is source authoring, not
 * native-time/pixel parity. Existing authored files are never overwritten. */
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual as same } from "node:util";
import { geometryWriter } from "./native_editor_scene.mjs";

export const SKY_MANIFEST_SHA256 = "f7a0b5ef1463d0b5fe47b210585e00d6011be3c3e3bddfec76df0eb08042f80b";
const SOURCE_ID = "interlude:20_20.Model798.SkyZoneInfo0";
const MAP_SHA256 = "1beddad24c10a35a1b2e9151727a85158e3e01992299a6671de876645eb1f1e4";
const SCENE = "assets/native-world.scene", STAGED = `public/l2/skies/${SKY_MANIFEST_SHA256}`;
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const plans = new WeakMap(), hash = value => createHash("sha256").update(value).digest("hex");
const encode = value => Buffer.from(JSON.stringify(value, null, 2) + "\n");
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const fail = message => { throw Error(`Native sky stage: ${message}`); };
const identities = kind => {
  const digest = hash(`native-editor-sky-v1:${SKY_MANIFEST_SHA256}:${kind}`);
  return { id: `native-sky-${digest.slice(0, 24)}`, uniqueId: 2 ** 48 + Number.parseInt(digest.slice(0, 12), 16) };
};
const rootMarker = () => ({ schemaVersion: 1, manifestSha256: SKY_MANIFEST_SHA256, sourceId: SOURCE_ID,
  sourceMapSha256: MAP_SHA256, sourceSnapshot: true });

async function pathIn(root, input) {
  if (typeof input !== "string" || !input) fail("invalid path.");
  const absolute = resolve(root, input), rel = relative(root, absolute);
  if (!rel || isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) fail("path escapes project.");
  let current = root;
  for (const [index, part] of rel.split(sep).entries()) {
    if (!part || /[:\x00-\x1f]/.test(part) || /[. ]$/.test(part) || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(part)) fail("unsafe path component.");
    current = join(current, part);
    try {
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink()) fail(`symlink/junction refused: ${rel}.`);
      if (index < rel.split(sep).length - 1 && !stat.isDirectory()) fail("path parent is not a directory.");
    } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  return { absolute, path: rel.split(sep).join("/") };
}

async function realDirectory(path) {
  const requested = resolve(path), stat = await fs.lstat(requested);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail("root must be a real directory.");
  // Check ancestors too; a real leaf inside a junction is not a safe root.
  for (let current = requested; dirname(current) !== current; current = dirname(current)) {
    if ((await fs.lstat(current)).isSymbolicLink()) fail("symlink/junction refused in root path.");
  }
  return fs.realpath(requested);
}

function markerForPart(part, partIndex) {
  return { schemaVersion: 1, manifestSha256: SKY_MANIFEST_SHA256, partIndex,
    sourceMaterial: part.sourceMaterial, sourceSnapshot: true };
}

function nodeRecord(kind, name, position, scaling, metadata) {
  return { ...identities(kind), name, type: "TransformNode", position, rotation: [0, 0, 0], scaling,
    billboardMode: 0, infiniteDistance: false, localMatrix: [...IDENTITY], isEnabled: true,
    animations: [], ranges: [], metadata };
}

function materialRecord(part, index) {
  const rgba = part.authoredColorRGBA.map(value => value / 255), texturePath = `assets/native-sky-textures/${part.texture.png.sha256}.png`;
  return { ...identities(`material:${index}`), name: part.sourceMaterial, customType: "BABYLON.PBRMaterial",
    albedo: rgba.slice(0, 3), alpha: rgba[3], metallic: 0, roughness: 1, unlit: true,
    backFaceCulling: !part.renderTwoSided, twoSidedLighting: part.renderTwoSided, alphaMode: 2,
    transparencyMode: part.alphaBlend ? 2 : 0, useAlphaFromAlbedoTexture: part.alphaBlend,
    disableDepthWrite: part.alphaBlend, fogEnabled: false,
    albedoTexture: { name: texturePath, url: texturePath, isBlocking: true, hasAlpha: part.alphaBlend,
      getAlphaFromRGB: false, coordinatesIndex: 0, coordinatesMode: 0, level: 1,
      uOffset: 0, vOffset: 0, uScale: 1, vScale: 1, wrapU: 1, wrapV: 1,
      // Match the source GLB's unspecified min/mag filters through Babylon's
      // glTF defaults. Generated GPU mips are preview policy, not native proof;
      // the retained one-mip source payloads remain byte-identical.
      invertY: false, gammaSpace: true, _useSRGBBuffer: true, noMipmap: false, samplingMode: 3, animations: [],
      metadata: { nativeSourceReference: part.texture.sourceReference, sourceSha256: part.texture.png.sha256 } },
    metadata: { nativeSkyPart: markerForPart(part, index), gltf: { extras: { nativeSourceReference: part.sourceMaterial,
      sourceSnapshot: true, authoredColorRGBA: [...part.authoredColorRGBA], alphaSource: part.alphaSource } } } };
}

async function packGeometry(part, index, origin, helper) {
  const meshId = identities(`mesh:${index}`), geometryId = identities(`geometry:${index}`), material = materialRecord(part, index);
  const metadata = { parentId: origin.uniqueId, nativeSkyPart: markerForPart(part, index),
    nativeEditorSource: { originalId: part.sourceMaterial, originalName: part.sourceMaterial, sideOrientation: 1 } };
  const mesh = { ...meshId, name: part.sourceMaterial, type: "Mesh", position: [0, 0, 0], rotation: [0, 0, 0], scaling: [1, 1, 1],
    localMatrix: [...IDENTITY], isEnabled: true, isVisible: true, visibility: 1, pickable: false, receiveShadows: false,
    infiniteDistance: false, billboardMode: 0, alwaysSelectAsActiveMesh: true, checkCollisions: false, sideOrientation: 0,
    geometryId: geometryId.id, geometryUniqueId: geometryId.uniqueId, materialId: material.id, materialUniqueId: material.uniqueId,
    instances: [], animations: [], ranges: [], layerMask: 268435455, hasVertexAlpha: false, metadata,
    subMeshes: [{ materialIndex: 0, verticesStart: 0, verticesCount: part.positions.length / 3, indexStart: 0, indexCount: part.indices.length }], _binaryInfo: {} };
  const channels = { positions: part.positions, normals: part.normals, uvs: part.uvs, indices: part.indices };
  const temporaryRoot = await fs.mkdtemp(join(tmpdir(), "native-editor-sky-pack-"));
  let binary;
  try {
    const temporary = join(temporaryRoot, "geometry.bin");
    // JSON round trips lose -0: retain exact float32 channel bits through packing.
    await helper.write({ mesh, geometry: { ...structuredClone(channels), ...geometryId }, path: temporary, write: true });
    binary = await fs.readFile(temporary);
  } finally {
    const parent = await fs.realpath(tmpdir()), actual = await fs.realpath(temporaryRoot);
    if (dirname(actual) !== parent || !basename(actual).startsWith("native-editor-sky-pack-")) fail("unexpected temporary packing path.");
    await fs.rm(actual, { recursive: true, force: true });
  }
  const binarySha256 = hash(binary), binaryPath = `${SCENE}/geometries/${binarySha256}.babylonbinarymeshdata`;
  mesh.delayLoadingFile = binaryPath;
  mesh.boundingBoxMinimum = [Infinity, Infinity, Infinity]; mesh.boundingBoxMaximum = [-Infinity, -Infinity, -Infinity];
  for (const [index, value] of part.positions.entries()) {
    mesh.boundingBoxMinimum[index % 3] = Math.min(mesh.boundingBoxMinimum[index % 3], Math.fround(value));
    mesh.boundingBoxMaximum[index % 3] = Math.max(mesh.boundingBoxMaximum[index % 3], Math.fround(value));
  }
  return { binary, binaryPath, binarySha256, record: { meshes: [mesh], transformNodes: [], cameras: [], lights: [], materials: [material],
    geometries: { vertexData: [] }, metadata: structuredClone(metadata), basePoseMatrix: [...IDENTITY] } };
}

/** Read/verify first. This never writes into the project or source snapshot. */
export async function planNativeSkyStage(options) {
  const root = await realDirectory(options.projectRoot ?? process.cwd());
  const sourcePath = await pathIn(root, options.sourcePath), sourceRoot = await realDirectory(sourcePath.absolute);
  if (sourcePath.path === STAGED || sourcePath.path.startsWith(`${STAGED}/`)) fail("source must be retained scratch, not the staged output.");
  const guards = new Map(), directories = [], writes = [], records = [], allIds = new Set(), allUnique = new Set();
  const read = async path => {
    const checked = await pathIn(root, path), bytes = await fs.readFile(checked.absolute), prior = guards.get(checked.path);
    if (prior && !prior.bytes.equals(bytes)) fail("input changed during planning.");
    guards.set(checked.path, { ...checked, bytes }); return bytes;
  };
  const readDirectory = async path => {
    const checked = await pathIn(root, path);
    let entries;
    try {
      const list = await fs.readdir(checked.absolute, { withFileTypes: true });
      if (list.some(entry => !entry.isFile() || entry.isSymbolicLink())) fail(`unexpected directory entry: ${path}.`);
      entries = list.map(entry => entry.name).sort();
    } catch (error) { if (error.code !== "ENOENT") throw error; entries = null; }
    directories.push({ ...checked, entries }); return entries;
  };
  const manifestBytes = await read(`${sourcePath.path}/manifest.json`);
  if (hash(manifestBytes) !== SKY_MANIFEST_SHA256) fail("source manifest differs from exact frozen snapshot.");
  const manifest = JSON.parse(manifestBytes), expectedFiles = ["manifest.json", ...Object.keys(manifest.files)].sort();
  if (manifest.kind !== "native-sky-source-bundle" || manifest.id !== SOURCE_ID || expectedFiles.length !== 21 ||
      manifest.source.mapSha256 !== MAP_SHA256) fail("unexpected source identity.");
  if (!same(await readDirectory(sourcePath.path), expectedFiles)) fail("source snapshot file set differs.");
  const payloads = new Map([["manifest.json", manifestBytes]]);
  for (const [file, descriptor] of Object.entries(manifest.files)) {
    if (basename(file) !== file || file.includes("\\")) fail("invalid source file name.");
    const bytes = await read(`${sourcePath.path}/${file}`);
    if (bytes.length !== descriptor.bytes || hash(bytes) !== descriptor.sha256) fail(`source payload hash/size mismatch: ${file}.`);
    payloads.set(file, bytes);
  }
  const snapshot = JSON.parse(payloads.get("sky.json").toString("utf8"));
  if (snapshot.kind !== "native-sky-source-snapshot" || snapshot.id !== SOURCE_ID || snapshot.parts.length !== 3 ||
      snapshot.source.mapSha256 !== MAP_SHA256) fail("unexpected source sky snapshot.");
  // Guard scene config and channel proof, but never modify either.
  await read(`${SCENE}/config.json`); await read(`${SCENE}.native-editor-channels.json`);
  const collect = value => {
    if (Array.isArray(value)) return value.forEach(collect);
    if (!object(value)) return;
    for (const [key, item] of Object.entries(value)) {
      if (["id", "geometryId", "materialId"].includes(key) && typeof item === "string") allIds.add(item);
      if (["uniqueId", "geometryUniqueId", "materialUniqueId"].includes(key) && Number.isSafeInteger(item)) allUnique.add(item);
      if (key !== "metadata") collect(item);
    }
  };
  for (const kind of ["nodes", "meshes", "cameras", "lights", "materials"]) {
    const entries = await readDirectory(`${SCENE}/${kind}`);
    if (!entries && ["nodes", "meshes"].includes(kind)) fail("missing authored scene records.");
    for (const name of entries ?? []) {
      if (!name.endsWith(".json")) fail("unsupported authored record file.");
      const path = `${SCENE}/${kind}/${name}`, data = JSON.parse(await read(path)); collect(data);
      if (kind === "materials") continue;
      const nodes = kind === "meshes" ? data.meshes : [data];
      if (!Array.isArray(nodes) || nodes.length !== 1) fail("unsupported authored mesh record.");
      records.push({ path, data, node: nodes[0], kind });
    }
  }
  const worldRoots = records.filter(record => record.node.metadata?.nativeWorldRoot !== undefined);
  if (worldRoots.length !== 1) fail("missing or ambiguous native world root.");
  const roots = records.filter(record => record.node.metadata?.nativeSkyRoot !== undefined);
  const origins = records.filter(record => record.node.metadata?.nativeSkyOrigin !== undefined);
  const parts = records.filter(record => record.node.metadata?.nativeSkyPart !== undefined);
  const stagedEntries = await readDirectory(STAGED), repeated = roots.length > 0;
  if (stagedEntries) {
    if (!same(stagedEntries, expectedFiles)) fail("staged snapshot is partial or changed.");
    for (const [file, bytes] of payloads) if (!(await read(`${STAGED}/${file}`)).equals(bytes)) fail(`immutable staged snapshot differs: ${file}.`);
  }
  const summary = { schemaVersion: 1, kind: "native-sky-stage", status: repeated ? "preserved" : "planned",
    manifestSha256: SKY_MANIFEST_SHA256, sourceId: SOURCE_ID, sourceMapSha256: MAP_SHA256,
    sourcePath: sourcePath.path, stagedPath: STAGED, sourceFiles: payloads.size, sourceSnapshot: true,
    counts: structuredClone(manifest.counts), rootId: identities("root").id, originId: identities("origin").id,
    newRecords: [], additions: [], previewPresentation: {
      textureSampling: "Babylon glTF defaults: linear magnification, trilinear minification and generated GPU mips; original one-mip source is unchanged.",
      noMipmap: false, samplingMode: 3, useSRGBBuffer: true, nativeSamplingVerified: false
    }, limitations: [...manifest.limitations] };
  const finish = () => {
    summary.additions = writes.map(write => ({ path: write.path, sha256: hash(write.bytes), bytes: write.bytes.length }));
    const plan = { root, summary: structuredClone(summary), writes: writes.map(write => ({ path: write.path, bytes: Buffer.from(write.bytes) })) };
    plans.set(plan, { root, sourceRoot, guards: [...guards.values()], directories, writes, summary: structuredClone(summary) }); return plan;
  };
  if (repeated) {
    const rootNode = roots[0]?.node, originNode = origins[0]?.node;
    if (!stagedEntries || roots.length !== 1 || origins.length !== 1 || parts.length !== 3 || roots[0].kind !== "nodes" || origins[0].kind !== "nodes" ||
        rootNode.id !== identities("root").id || rootNode.uniqueId !== identities("root").uniqueId || !same(rootNode.metadata.nativeSkyRoot, rootMarker()) ||
        rootNode.metadata.parentId !== undefined || rootNode.parentId !== undefined || originNode.id !== identities("origin").id ||
        originNode.uniqueId !== identities("origin").uniqueId || originNode.metadata.parentId !== rootNode.uniqueId ||
        !same(originNode.metadata.nativeSkyOrigin, { schemaVersion: 1, manifestSha256: SKY_MANIFEST_SHA256, sourceSkyZone: snapshot.sourceSkyZone })) fail("partial, conflicting or ambiguous prior sky append.");
    for (const [index, part] of snapshot.parts.entries()) {
      const match = parts.filter(row => row.node.id === identities(`mesh:${index}`).id);
      if (match.length !== 1 || match[0].kind !== "meshes" || match[0].node.uniqueId !== identities(`mesh:${index}`).uniqueId ||
          match[0].node.metadata.parentId !== originNode.uniqueId || !same(match[0].node.metadata.nativeSkyPart, markerForPart(part, index))) fail("partial or conflicting prior sky mesh.");
      // Authored transforms/materials/geometry may differ. Require the referenced
      // geometry to exist, but never regenerate it over newer authoring.
      await read(match[0].node.delayLoadingFile);
      summary.newRecords.push({ path: match[0].path, meshId: match[0].node.id, preservedAuthoredEdits: true });
    }
    return finish();
  }
  if (stagedEntries || origins.length || parts.length) fail("partial sky append exists; refusing to guess or overwrite it.");
  const expectedIds = [identities("root"), identities("origin"), ...snapshot.parts.flatMap((_part, index) =>
    [identities(`mesh:${index}`), identities(`geometry:${index}`), identities(`material:${index}`)])];
  const newIds = new Set(), newUnique = new Set();
  for (const identity of expectedIds) {
    if (allIds.has(identity.id) || allUnique.has(identity.uniqueId) || newIds.has(identity.id) || newUnique.has(identity.uniqueId)) fail("sky identity collides with authored data.");
    newIds.add(identity.id); newUnique.add(identity.uniqueId);
  }
  const add = async (path, bytes, shareIdentical = false) => {
    const target = await pathIn(root, path);
    try {
      const previous = await read(path);
      if (!shareIdentical || !previous.equals(bytes)) fail(`new output conflicts with existing bytes: ${path}.`);
    } catch (error) { if (error.code !== "ENOENT") throw error; writes.push({ ...target, bytes }); }
  };
  for (const [file, bytes] of payloads) await add(`${STAGED}/${file}`, bytes);
  const wrapper = nodeRecord("root", "Native sky source snapshot", [0, 0, 0], [1, 1, -1], { nativeSkyRoot: rootMarker() });
  const origin = nodeRecord("origin", snapshot.sourceSkyZone, [...snapshot.rootTranslationMetres], [1, 1, 1], {
    parentId: wrapper.uniqueId, nativeSkyOrigin: { schemaVersion: 1, manifestSha256: SKY_MANIFEST_SHA256, sourceSkyZone: snapshot.sourceSkyZone } });
  const helper = await geometryWriter(options); summary.geometryHelper = helper.provenance;
  for (const [index, part] of snapshot.parts.entries()) {
    const packed = await packGeometry(part, index, origin, helper), mesh = packed.record.meshes[0];
    await add(`assets/native-sky-textures/${part.texture.png.sha256}.png`, payloads.get(part.texture.png.file), true);
    await add(packed.binaryPath, packed.binary, true);
    const path = `${SCENE}/meshes/${mesh.id}.json`; await add(path, encode(packed.record));
    summary.newRecords.push({ path, meshId: mesh.id, geometryId: mesh.geometryId, materialId: mesh.materialId,
      geometryPath: packed.binaryPath, geometrySha256: packed.binarySha256,
      vertices: part.positions.length / 3, triangles: part.indices.length / 3, sourceMaterial: part.sourceMaterial });
  }
  // Append the root last so incomplete attempts cannot look complete to callers.
  await add(`${SCENE}/nodes/${origin.id}.json`, encode(origin));
  await add(`${SCENE}/nodes/${wrapper.id}.json`, encode(wrapper));
  return finish();
}

async function ensureParents(root, file, created) {
  const rel = relative(root, dirname(file)), parts = rel.split(sep); let current = root;
  for (const part of parts) {
    if (!part) continue;
    current = join(current, part); await pathIn(root, current);
    try { await fs.mkdir(current); created.push(current); }
    catch (error) { if (error.code !== "EEXIST") throw error; }
    const stat = await fs.lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail("commit parent is not a real directory.");
  }
}

/** Recheck every input/directory before an additive, exclusive-create commit.
 * Rollback removes only our identical bytes and empty directories. */
export async function applyNativeSkyStage(plan, { receiptPath } = {}) {
  const owned = plans.get(plan);
  if (!owned) fail("apply requires a fresh plan from this process.");
  plans.delete(plan);
  const { root, guards, directories, writes, summary } = owned;
  let receipt;
  if (receiptPath && writes.length) {
    receipt = await pathIn(root, receiptPath);
    if (!receipt.path.startsWith("artifacts/") || writes.some(write => write.path === receipt.path)) fail("receipt must be a new artifacts path.");
    try { await fs.lstat(receipt.absolute); fail("receipt already exists."); } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  for (const directory of directories) {
    let entries;
    try { entries = (await fs.readdir((await pathIn(root, directory.path)).absolute)).sort(); }
    catch (error) { if (error.code !== "ENOENT") throw error; entries = null; }
    if (!same(entries, directory.entries)) fail(`identity/source directory changed after planning: ${directory.path}.`);
  }
  for (const guard of guards) if (!(await fs.readFile((await pathIn(root, guard.path)).absolute)).equals(guard.bytes)) fail(`input changed after planning: ${guard.path}.`);
  for (const write of writes) {
    try { await fs.lstat((await pathIn(root, write.path)).absolute); fail("new output appeared after planning."); } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  const applied = [], created = [];
  try {
    for (const write of writes) {
      const destination = (await pathIn(root, write.path)).absolute;
      await ensureParents(root, destination, created);
      await fs.writeFile((await pathIn(root, write.path)).absolute, write.bytes, { flag: "wx" }); applied.push(write);
    }
    const result = { ...summary, status: writes.length ? "applied" : "preserved" };
    // A repeated append has no writes, including no optional receipt. The caller
    // can retain stdout separately without changing authored/staged state.
    if (receipt && writes.length) {
      await ensureParents(root, receipt.absolute, created);
      const bytes = encode(result);
      await fs.writeFile((await pathIn(root, receipt.path)).absolute, bytes, { flag: "wx" }); applied.push({ ...receipt, bytes });
    }
    return result;
  } catch (error) {
    const limits = [];
    for (const write of applied.reverse()) {
      try {
        const destination = (await pathIn(root, write.path)).absolute;
        if (!(await fs.readFile(destination)).equals(write.bytes)) { limits.push(`concurrent edit retained: ${write.path}`); continue; }
        await fs.unlink(destination);
      } catch (failure) { limits.push(`${write.path}: ${failure.message}`); }
    }
    for (const directory of created.reverse()) {
      try { await pathIn(root, directory); await fs.rmdir(directory); }
      catch (failure) { if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(failure.code)) limits.push(`${directory}: ${failure.message}`); }
    }
    if (limits.length) error.message += ` Rollback limits: ${limits.join("; ")}`;
    throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), values = {}, allowed = new Set(["--source", "--project", "--receipt"]); let apply = false;
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (key === "--apply" && !apply) apply = true;
    else if (allowed.has(key) && values[key] === undefined && args[index + 1] && !args[index + 1].startsWith("--")) values[key] = args[++index];
    else fail("Usage: --source <retained snapshot> [--project <root>] [--apply] [--receipt <new artifacts path>]");
  }
  if (!values["--source"]) fail("--source is required.");
  if (values["--receipt"] && !apply) fail("--receipt requires --apply; dry-run writes nothing.");
  const plan = await planNativeSkyStage({ projectRoot: values["--project"] ?? process.cwd(), sourcePath: values["--source"] });
  console.log(JSON.stringify(apply ? await applyNativeSkyStage(plan, { receiptPath: values["--receipt"] }) : plan.summary, null, 2));
}
