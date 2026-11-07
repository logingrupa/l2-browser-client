import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { homedir } from "node:os";
import { Script } from "node:vm";
import { createNativeEditorChannels, nativeEditorChannelsPath } from "./preserve-native-editor-uv2.mjs";

const io = fs.promises;
const HASH = /^[a-f0-9]{64}$/;
const HELPER_HASH = "1b86dac8db1685491e703a1984b60b923478d551df47ec2a36cd39c648aa5a06";
const HELPER_MEMBER = "build/src/project/tools/geometry.js";
const SCENE_DIRS = ["animationGroups", "cameras", "geometries", "gui", "lights", "lods", "meshes", "morphTargetManagers",
  "morphTargets", "nodeParticleSystemSets", "nodes", "particleSystems", "sceneLinks", "shadowGenerators", "skeletons",
  "soundNodes", "sounds", "splats", "sprite-managers", "sprite-maps"];
const digest = value => createHash("sha256").update(value).digest("hex");
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const object = value => value && typeof value === "object" && !Array.isArray(value);

function localPath(value) {
  if (typeof value !== "string" || !value || isAbsolute(value) || /[\\:\x00-\x1f]/.test(value) ||
      value.split("/").some(part => !part || part === "." || part === ".." || /[. ]$/.test(part))) {
    throw Error(`Unsafe project-relative path: ${String(value)}`);
  }
  return value;
}

function fileId(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._ -]{0,179}$/.test(value) || /[. ]$/.test(value) ||
      /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(value)) throw Error(`Unsafe Editor file identity: ${String(value)}`);
  return value;
}

async function exists(path) {
  try { return await io.lstat(path); } catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

/** Check every existing component, including junctions, before reading or writing. */
async function checked(root, value) {
  const parts = localPath(value).split("/");
  let current = root;
  for (let index = 0; index < parts.length; index++) {
    current = join(current, parts[index]);
    const stat = await exists(current);
    if (!stat) break;
    if (stat.isSymbolicLink()) throw Error(`Symlink/junction is not allowed in import paths: ${current}`);
    if (index < parts.length - 1 && !stat.isDirectory()) throw Error(`Import path parent is not a directory: ${current}`);
    const real = await io.realpath(current), within = relative(root, real);
    if (isAbsolute(within) || within === ".." || within.startsWith(`..${sep}`)) throw Error(`Import path escapes project: ${current}`);
  }
  return resolve(root, ...parts);
}

async function ensureDirectory(root, value) {
  let prefix = "";
  for (const part of localPath(value).split("/")) {
    prefix = prefix ? `${prefix}/${part}` : part;
    const target = await checked(root, prefix);
    try { await io.mkdir(target); } catch (error) { if (error.code !== "EEXIST") throw error; }
    if (!(await io.lstat(await checked(root, prefix))).isDirectory()) throw Error(`Expected import directory: ${prefix}`);
  }
}

async function readAsarMember(path, member) {
  const handle = await io.open(path, "r");
  try {
    const read = async (offset, length) => {
      if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 0 || length > 32 * 1024 * 1024) throw Error("Invalid ASAR member bounds.");
      const bytes = Buffer.alloc(length);
      if ((await handle.read(bytes, 0, length, offset)).bytesRead !== length) throw Error("Incomplete installed Editor ASAR.");
      return bytes;
    };
    const prefix = await read(0, 16), header = JSON.parse(await read(16, prefix.readUInt32LE(12)));
    let entry = header;
    for (const part of member.split("/")) entry = entry?.files?.[part];
    if (!entry || entry.unpacked || entry.link) throw Error(`Missing packed Editor helper: ${member}`);
    return await read(8 + prefix.readUInt32LE(4) + Number(entry.offset), entry.size);
  } finally { await handle.close(); }
}

export async function geometryWriter(options) {
  let source, provenance;
  if (options.geometryHelperSource !== undefined || options.geometryHelperPath !== undefined) {
    source = options.geometryHelperSource ?? await io.readFile(options.geometryHelperPath, "utf8");
    if (typeof source !== "string" || source.length > 128 * 1024) throw Error("Invalid geometry helper source.");
    provenance = { kind: "explicit-helper", sha256: digest(source) };
  } else {
    const asar = join(homedir(), "AppData/Local/Programs/BabylonJS Editor/resources/app.asar");
    const installed = JSON.parse(await readAsarMember(asar, "package.json"));
    if (installed.version !== "5.5.3") throw Error(`Native authoring import requires Editor 5.5.3, found ${installed.version}.`);
    source = (await readAsarMember(asar, HELPER_MEMBER)).toString("utf8");
    if (digest(source) !== HELPER_HASH) throw Error("Installed Editor geometry helper differs from the audited 5.5.3 helper.");
    provenance = { kind: "installed-editor", version: installed.version, member: HELPER_MEMBER, sha256: HELPER_HASH };
  }
  const exports = {};
  new Script(source, { filename: HELPER_MEMBER }).runInNewContext({ exports, Buffer, require(name) {
    if (name !== "fs") throw Error(`Unexpected geometry helper dependency: ${name}`);
    return fs;
  } }, { timeout: 1000 });
  if (typeof exports.writeBinaryGeometry !== "function") throw Error("Geometry helper does not export writeBinaryGeometry.");
  return { write: exports.writeBinaryGeometry, provenance };
}

function validateGeometry(geometry, mesh) {
  const allowed = new Set(["id", "uniqueId", "updatable", "positions", "normals", "uvs", "uvs2", "indices", "colors", "hasVertexAlpha"]);
  for (const key of Object.keys(geometry)) if (!allowed.has(key)) throw Error(`Unsupported native world vertex data: ${key}`);
  const array = (key, stride, required = false) => {
    const values = geometry[key];
    if (values === undefined && !required) return;
    if (!Array.isArray(values) || !values.length || values.length > 32 * 1024 * 1024 || values.length % stride ||
        values.some(value => typeof value !== "number" || !Number.isFinite(value) || !Number.isFinite(Math.fround(value)))) {
      throw Error(`Invalid native world geometry ${key}: ${mesh.id}`);
    }
  };
  array("positions", 3, true); array("normals", 3); array("uvs", 2); array("uvs2", 2); array("colors", 4); array("indices", 3, true);
  const count = geometry.positions.length / 3;
  for (const [key, stride] of [["normals", 3], ["uvs", 2], ["uvs2", 2], ["colors", 4]]) {
    if (geometry[key] && geometry[key].length !== count * stride) throw Error(`Vertex count differs for ${key}: ${mesh.id}`);
  }
  if (geometry.indices.some(value => !Number.isSafeInteger(value) || value < 0 || value >= count || value > 2147483647)) throw Error(`Invalid geometry indices: ${mesh.id}`);
  if (!Array.isArray(mesh.subMeshes) || !mesh.subMeshes.length) throw Error(`Missing native world submeshes: ${mesh.id}`);
  for (const sub of mesh.subMeshes) {
    if (["materialIndex", "verticesStart", "verticesCount", "indexStart", "indexCount"].some(key => !Number.isSafeInteger(sub[key]) || sub[key] < 0 || sub[key] > 2147483647) ||
        sub.verticesStart + sub.verticesCount > count || sub.indexStart + sub.indexCount > geometry.indices.length) throw Error(`Invalid native world submesh: ${mesh.id}`);
  }
}

function validateSnapshot(input) {
  if (!object(input) || input.schemaVersion !== 1 || input.kind !== "native-editor-world-snapshot" || !HASH.test(input.manifestSha256) ||
      !object(input.manifest) || !Array.isArray(input.nodes) || !Array.isArray(input.meshes) || !input.meshes.length || !Array.isArray(input.textures) || !object(input.inspection)) {
    throw Error("Invalid native Editor world snapshot.");
  }
  const snapshot = JSON.parse(JSON.stringify(input, (_key, value) => {
    if (typeof value === "number" && !Number.isFinite(value)) throw Error("Snapshot contains a non-finite number.");
    return ArrayBuffer.isView(value) ? Array.from(value) : value;
  })), nodes = [], ids = new Set(), unique = new Map(), materials = new Map(), geometries = new Map();
  const identity = (record, kind, shared = false) => {
    fileId(record.id);
    if (!Number.isSafeInteger(record.uniqueId) || Math.abs(record.uniqueId) < 1e9) throw Error(`Native Editor ${kind} requires a reserved high uniqueId: ${record.id}`);
    const key = `${kind}:${record.id}`, previous = unique.get(record.uniqueId);
    if (previous && (!shared || previous !== key)) throw Error(`Colliding Editor uniqueId: ${record.uniqueId}`);
    unique.set(record.uniqueId, key);
    if (!shared && ids.has(record.id)) throw Error(`Duplicate native Editor node id: ${record.id}`);
    if (!shared) ids.add(record.id);
  };
  for (const node of snapshot.nodes) { identity(node, "node"); nodes.push(node); }
  for (const data of snapshot.meshes) {
    if (!Array.isArray(data.meshes) || data.meshes.length !== 1) throw Error("Each Editor mesh record must contain exactly one mesh.");
    const mesh = data.meshes[0]; identity(mesh, "mesh"); nodes.push(mesh);
    if (mesh.instances?.length || data.skeletons?.length || data.animationGroups?.length || data.transformNodes?.length || data.lods?.length || mesh.delayLoadingFile) {
      throw Error(`Snapshot must contain standalone static mesh records with inline geometry: ${mesh.id}`);
    }
    const vertexData = data.geometries?.vertexData ?? [];
    if (mesh.geometryId) {
      if (vertexData.length !== 1 || vertexData[0].id !== mesh.geometryId) throw Error(`Missing or ambiguous inline geometry: ${mesh.id}`);
      validateGeometry(vertexData[0], mesh);
      const geometry = vertexData[0], signature = digest(Buffer.concat(["positions", "normals", "uvs", "uvs2", "colors", "indices"].map(key => {
        const values = geometry[key] ?? [];
        return Buffer.concat([Buffer.from(`${key}:${values.length}:`), Buffer.from((key === "indices" ? new Int32Array(values) : new Float32Array(values)).buffer)]);
      })));
      if (geometries.has(geometry.id) && geometries.get(geometry.id) !== signature) throw Error(`Conflicting shared geometry: ${geometry.id}`);
      geometries.set(geometry.id, signature);
    } else if (vertexData.length) throw Error(`Unreferenced inline geometry: ${mesh.id}`);
    for (const material of [...(data.materials ?? []), ...(data.multiMaterials ?? [])]) {
      identity(material, "material", true);
      const old = materials.get(material.id), serialized = JSON.stringify(material);
      if (old && old !== serialized) throw Error(`Conflicting shared material: ${material.id}`);
      materials.set(material.id, serialized);
    }
  }
  for (const node of nodes) {
    if (node.parentId !== undefined) {
      const parent = nodes.find(parent => parent.uniqueId === node.metadata?.parentId);
      if (!parent || ![parent.id, parent.uniqueId].includes(node.parentId)) throw Error(`Inconsistent Editor metadata.parentId: ${node.id}`);
      delete node.parentId;
    }
    if (node.metadata?.parentId !== undefined && !nodes.some(parent => parent.uniqueId === node.metadata.parentId)) throw Error(`Missing Editor parent: ${node.id}`);
    if (node.freezeWorldMatrix) throw Error(`Authoring transform must not be frozen: ${node.id}`);
    const ancestors = new Set([node.uniqueId]);
    let parentId = node.metadata?.parentId;
    while (parentId !== undefined) {
      if (ancestors.has(parentId)) throw Error(`Cyclic native Editor parentage: ${node.id}`);
      ancestors.add(parentId); parentId = nodes.find(parent => parent.uniqueId === parentId)?.metadata?.parentId;
    }
  }
  const texturePaths = new Set();
  snapshot.textures = snapshot.textures.map(texture => {
    localPath(texture.path);
    if (!HASH.test(texture.sha256) || texture.path !== `assets/native-generated/${snapshot.manifestSha256}/${texture.sha256}.png` || texturePaths.has(texture.path)) throw Error("Invalid or duplicate generated texture identity/path.");
    texturePaths.add(texture.path);
    if (typeof texture.base64 !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(texture.base64)) throw Error(`Invalid texture base64: ${texture.path}`);
    const bytes = Buffer.from(texture.base64, "base64");
    if (bytes.length !== texture.bytes || bytes.length < 33 || bytes.length > 32 * 1024 * 1024 || digest(bytes) !== texture.sha256 ||
        !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || bytes.toString("ascii", 12, 16) !== "IHDR") throw Error(`Generated PNG hash/length/header mismatch: ${texture.path}`);
    return { ...texture, data: bytes };
  });
  for (const data of snapshot.meshes) {
    const mesh = data.meshes[0];
    // SerializeMesh supplies the host's transient default material ID even for empty roots.
    if (!mesh.geometryId && mesh.materialId === "default material" && !materials.has(mesh.materialId)) delete mesh.materialUniqueId;
    const inspectTextures = value => {
      if (Array.isArray(value)) return value.forEach(inspectTextures);
      if (!object(value)) return;
      if ("samplingMode" in value && ("invertY" in value || "url" in value)) {
        if (!texturePaths.has(value.name) || value.url !== value.name || value.base64String !== undefined) throw Error(`Unpinned serialized texture reference in ${mesh.id}`);
      }
      Object.values(value).forEach(inspectTextures);
    };
    [...(data.materials ?? []), ...(data.multiMaterials ?? [])].forEach(inspectTextures);
  }
  if (snapshot.authoringCamera !== undefined) {
    if (!object(snapshot.authoringCamera) || Object.keys(snapshot.authoringCamera).some(key => !["editor", "world"].includes(key))) throw Error("Invalid authoringCamera overrides.");
    for (const [kind, fields] of Object.entries(snapshot.authoringCamera)) {
      const allowed = kind === "editor" ? ["position", "rotation", "minZ", "maxZ"] : ["position", "target", "radius", "alpha", "beta", "minZ", "maxZ"];
      if (!object(fields)) throw Error(`Invalid authoring camera: ${kind}`);
      for (const [key, value] of Object.entries(fields)) {
        if (!allowed.includes(key) || (["position", "rotation", "target"].includes(key)
          ? !Array.isArray(value) || value.length !== 3 || value.some(value => typeof value !== "number" || !Number.isFinite(value))
          : typeof value !== "number" || !Number.isFinite(value) || ["minZ", "maxZ", "radius"].includes(key) && value <= 0)) throw Error(`Invalid authoring camera field: ${kind}.${key}`);
      }
    }
  }
  return snapshot;
}

async function authoredFiles(root, directory) {
  const result = [];
  const walk = async value => {
    const path = await checked(root, value);
    for (const entry of await io.readdir(path, { withFileTypes: true })) {
      const next = `${value}/${entry.name}`, full = await checked(root, next);
      if (entry.isDirectory()) await walk(next);
      else if (entry.isFile()) { const bytes = await io.readFile(full); result.push({ path: next.slice(directory.length + 1), bytes: bytes.length, sha256: digest(bytes) }); }
      else throw Error(`Unsupported authored file: ${next}`);
    }
  };
  await walk(directory);
  return result.sort((a, b) => a.path.localeCompare(b.path));
}

/** Create authoring data once. An existing scene is never regenerated or repaired. */
export async function writeNativeEditorScene(options) {
  const { projectRoot, targetScene = "assets/native-world.scene", templateScene = "assets/native-parity.scene" } = options;
  const requestedRoot = resolve(projectRoot), rootStat = await io.lstat(requestedRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw Error("Project root must be a real directory.");
  const root = await io.realpath(requestedRoot);
  for (const path of [targetScene, templateScene]) {
    localPath(path);
    if (!/^assets\/[A-Za-z0-9][A-Za-z0-9._-]*\.scene$/.test(path)) throw Error(`Scene must be a direct assets/*.scene directory: ${path}`);
  }
  if (targetScene === templateScene) throw Error("Native import target must differ from the template scene.");
  const target = await checked(root, targetScene);
  if (await exists(target)) {
    const config = JSON.parse(await io.readFile(await checked(root, `${targetScene}/config.json`), "utf8"));
    if (HASH.test(options.snapshot?.manifestSha256) && config.metadata?.nativeEditorImport?.manifestSha256 === options.snapshot.manifestSha256) {
      return { status: "preserved", targetScene, manifestSha256: options.snapshot.manifestSha256 };
    }
    throw Error(`Native Editor import conflict: ${targetScene} already exists with a different or unknown source manifest. Authored files were not changed.`);
  }
  const snapshot = validateSnapshot(options.snapshot);
  const channelsPath = await checked(root, nativeEditorChannelsPath(targetScene));
  const channelsBytes = Buffer.from(json(createNativeEditorChannels(snapshot)));
  if (await exists(channelsPath)) {
    if (!(await io.readFile(channelsPath)).equals(channelsBytes)) throw Error("Native Editor channel recovery record conflicts with the source snapshot.");
  }
  const config = JSON.parse(await io.readFile(await checked(root, `${templateScene}/config.json`), "utf8"));
  config.metadata = { ...config.metadata, nativeEditorImport: { schemaVersion: 1, manifestSha256: snapshot.manifestSha256, targetScene } };
  if (snapshot.authoringCamera?.editor) {
    if (!object(config.editorCamera)) throw Error("Template has no Editor camera for the requested override.");
    Object.assign(config.editorCamera, snapshot.authoringCamera.editor);
  }
  const templateFiles = [];
  const nodeIds = new Set([...snapshot.nodes, ...snapshot.meshes.map(data => data.meshes[0])].map(node => node.id));
  const uniqueIds = new Set([...snapshot.nodes, ...snapshot.meshes.flatMap(data => [data.meshes[0], ...(data.materials ?? []), ...(data.multiMaterials ?? [])])].map(node => node.uniqueId));
  let worldCameraCount = 0;
  for (const directory of ["cameras", "lights", "shadowGenerators"]) {
    const from = await checked(root, `${templateScene}/${directory}`);
    if (!(await exists(from))) continue;
    for (const entry of await io.readdir(from, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) throw Error(`Unsupported template setting: ${directory}/${entry.name}`);
      const bytes = await io.readFile(await checked(root, `${templateScene}/${directory}/${entry.name}`)), data = JSON.parse(bytes);
      if (directory !== "shadowGenerators" && (nodeIds.has(data.id) || uniqueIds.has(data.uniqueId))) throw Error(`Imported identity collides with template: ${data.id}`);
      if (directory === "cameras" && data.name === "World camera" && snapshot.authoringCamera?.world) {
        Object.assign(data, snapshot.authoringCamera.world); worldCameraCount++;
        templateFiles.push({ path: `${directory}/${entry.name}`, data: json(data) });
      } else templateFiles.push({ path: `${directory}/${entry.name}`, data: bytes });
    }
  }
  if (snapshot.authoringCamera?.world && worldCameraCount !== 1) throw Error("Expected exactly one template World camera for authoring override.");
  for (const texture of snapshot.textures) {
    const destination = await checked(root, texture.path);
    if (await exists(destination)) {
      if (!(await io.readFile(destination)).equals(texture.data)) throw Error(`Generated texture conflicts with existing bytes: ${texture.path}`);
    }
  }
  const helper = await geometryWriter(options);
  await ensureDirectory(root, "assets");
  const stagingName = `assets/.native-world-import-${randomUUID()}`, staging = await checked(root, stagingName);
  await io.mkdir(staging);
  let committed = false;
  try {
    for (const directory of SCENE_DIRS) await io.mkdir(join(staging, directory));
    await io.writeFile(join(staging, "config.json"), json(config), { flag: "wx" });
    for (const file of templateFiles) await io.writeFile(join(staging, file.path), file.data, { flag: "wx" });
    for (const node of snapshot.nodes) await io.writeFile(join(staging, "nodes", `${node.id}.json`), json(node), { flag: "wx" });
    const binaries = new Map();
    for (const data of snapshot.meshes) {
      const mesh = data.meshes[0], geometry = data.geometries?.vertexData?.[0];
      if (geometry) {
        const temporary = join(staging, "geometries", `${randomUUID()}.tmp`);
        mesh._binaryInfo = {};
        // Babylon serializes UV2 as `uvs2`; the audited Editor 5.5.3 writer
        // reads `uv2s`. Adapt only its input, retaining the captured source data.
        const { uvs2, ...helperGeometry } = geometry;
        if (uvs2 !== undefined) helperGeometry.uv2s = uvs2;
        await helper.write({ mesh, geometry: helperGeometry, path: temporary, write: true });
        const bytes = await io.readFile(temporary), hash = digest(bytes), filename = `${hash}.babylonbinarymeshdata`;
        if (binaries.has(hash)) {
          if (!bytes.equals(binaries.get(hash))) throw Error("Binary geometry digest collision.");
          await io.unlink(temporary);
        } else { await io.rename(temporary, join(staging, "geometries", filename)); binaries.set(hash, bytes); }
        mesh.delayLoadingFile = `${targetScene}/geometries/${filename}`;
        const minimum = [Infinity, Infinity, Infinity], maximum = [-Infinity, -Infinity, -Infinity];
        for (let index = 0; index < geometry.positions.length; index++) {
          const axis = index % 3, value = Math.fround(geometry.positions[index]);
          minimum[axis] = Math.min(minimum[axis], value); maximum[axis] = Math.max(maximum[axis], value);
        }
        mesh.boundingBoxMinimum = minimum; mesh.boundingBoxMaximum = maximum;
        data.geometries.vertexData = [];
      }
      await io.writeFile(join(staging, "meshes", `${mesh.id}.json`), json(data), { flag: "wx" });
    }
    const files = await authoredFiles(root, stagingName);
    const receiptFolder = `artifacts/native-parity/editor/world-import/${digest(targetScene).slice(0, 20)}`;
    await ensureDirectory(root, receiptFolder);
    const receiptPath = `${receiptFolder}/${snapshot.manifestSha256}-${randomUUID()}.json`;
    const capture = Object.fromEntries(Object.entries(snapshot).filter(([key]) => !["nodes", "meshes", "textures", "manifest", "inspection"].includes(key)));
    const receipt = { schemaVersion: 1, kind: "native-editor-world-import", targetScene, templateScene, manifestSha256: snapshot.manifestSha256,
      manifest: snapshot.manifest, inspection: snapshot.inspection, geometryHelper: helper.provenance,
      writerSha256: digest(await io.readFile(new URL(import.meta.url))),
      channelRecovery: { path: nativeEditorChannelsPath(targetScene), sha256: digest(channelsBytes), bytes: channelsBytes.length },
      capture, initialAuthoredFiles: files, textures: snapshot.textures.map(({ path, sha256, bytes }) => ({ path, sha256, bytes })) };
    // Texture identities are content-addressed; exclusive creation never replaces a derivative.
    for (const texture of snapshot.textures) {
      await ensureDirectory(root, texture.path.slice(0, texture.path.lastIndexOf("/")));
      const destination = await checked(root, texture.path);
      const temporary = await checked(root, `${texture.path}.${randomUUID()}.tmp`);
      await io.writeFile(temporary, texture.data, { flag: "wx" });
      try { await io.link(temporary, destination); }
      catch (error) { if (error.code !== "EEXIST" || !(await io.readFile(await checked(root, texture.path))).equals(texture.data)) throw error; }
      finally { await io.unlink(temporary); }
    }
    const receiptTemporary = `${receiptPath}.tmp`;
    await io.writeFile(await checked(root, receiptTemporary), json(receipt), { flag: "wx" });
    await io.rename(await checked(root, receiptTemporary), await checked(root, receiptPath));
    // Editor save deletes unknown files inside *.scene. Keep the recovery
    // record beside it, using exclusive creation and verified existing bytes.
    try { await io.writeFile(channelsPath, channelsBytes, { flag: "wx" }); }
    catch (error) { if (error.code !== "EEXIST" || !(await io.readFile(channelsPath)).equals(channelsBytes)) throw error; }
    // Recheck at commit. No existing scene, including an empty directory, is accepted.
    if (await exists(await checked(root, targetScene))) throw Error(`Native Editor import conflict: target appeared during import: ${targetScene}`);
    await io.rename(await checked(root, stagingName), target);
    committed = true;
    return { status: "created", targetScene, manifestSha256: snapshot.manifestSha256, receiptPath,
      meshCount: snapshot.meshes.length, nodeCount: snapshot.nodes.length, geometryCount: binaries.size, textureCount: snapshot.textures.length };
  } finally {
    if (!committed && await exists(staging)) await io.rm(await checked(root, stagingName), { recursive: true });
  }
}
