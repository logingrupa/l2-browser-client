import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const nativeEditorChannelsFile = "native-editor-channels.json";
// Editor deletes unrecognized files recursively inside *.scene on each save.
// A sibling receipt survives that cleanup without changing installed code.
export function nativeEditorChannelsPath(scenePath) {
  if (typeof scenePath !== "string" || !/^assets\/[A-Za-z0-9][A-Za-z0-9._-]*\.scene$/.test(scenePath)) {
    throw new Error("Native Editor UV2: scene must be a direct assets/*.scene directory.");
  }
  return `${scenePath}.${nativeEditorChannelsFile}`;
}
const HASH = /^[a-f0-9]{64}$/;
const MAX_SCALARS = 32 * 1024 * 1024;
const channelKinds = {
  positions: { descriptor: "positionsAttrDesc", stride: 3, dataType: 1 },
  normals: { descriptor: "normalsAttrDesc", stride: 3, dataType: 1 },
  uvs: { descriptor: "uvsAttrDesc", stride: 2, dataType: 1 },
  indices: { descriptor: "indicesAttrDesc", stride: 1, dataType: 0 },
};
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const fail = message => { throw new Error(`Native Editor UV2: ${message}`); };
function integer(value, minimum = 0, maximum = MAX_SCALARS) {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}
function identity(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 512 && !/[\x00-\x1f]/.test(value);
}
function exactKeys(value, expected) {
  return object(value) && Object.keys(value).sort().join("|") === [...expected].sort().join("|");
}
function arrayBytes(values, kind, vertices) {
  const { stride, dataType } = kind;
  if (!Array.isArray(values) || !integer(values.length, 1) || values.length % stride) fail("invalid captured channel array.");
  const bytes = Buffer.alloc(values.length * 4);
  values.forEach((value, index) => {
    if (dataType === 0) {
      if (!integer(value, 0, vertices - 1)) fail("captured index is outside its vertex range.");
      bytes.writeInt32LE(value, index * 4);
    } else {
      if (typeof value !== "number" || !Number.isFinite(value) || !Number.isFinite(Math.fround(value))) fail("captured channel contains a nonfinite float32 value.");
      bytes.writeFloatLE(value, index * 4);
    }
  });
  return bytes;
}
function channelSignature(values, kind, vertices) {
  return { count: values.length, stride: kind.stride, dataType: kind.dataType, sha256: digest(arrayBytes(values, kind, vertices)) };
}

/** Capture a recovery receipt once during import, before any Editor save.
 * This contains UV2 plus comparison hashes, never replacement geometry. */
export function createNativeEditorChannels(snapshot) {
  if (!object(snapshot) || snapshot.schemaVersion !== 1 || snapshot.kind !== "native-editor-world-snapshot" ||
      !HASH.test(snapshot.manifestSha256) || !Array.isArray(snapshot.meshes)) fail("invalid capture snapshot identity.");
  const meshes = [], seen = new Set();
  for (const document of snapshot.meshes) {
    if (!object(document) || !Array.isArray(document.meshes)) fail("invalid captured mesh document.");
    const geometries = document.geometries?.vertexData ?? [];
    if (!Array.isArray(geometries)) fail("invalid captured geometry list.");
    for (const mesh of document.meshes) {
      if (!object(mesh) || !identity(mesh.id) || seen.has(mesh.id)) fail("missing or duplicate captured mesh identity.");
      seen.add(mesh.id);
      const found = geometries.filter(geometry => geometry?.id === mesh.geometryId);
      if (found.length > 1) fail(`ambiguous captured geometry for ${mesh.id}.`);
      const geometry = found[0];
      if (!geometry || geometry.uvs2 === undefined) continue;
      if (!Array.isArray(geometry.positions) || geometry.positions.length % 3) fail(`invalid captured positions for ${mesh.id}.`);
      const vertexCount = geometry.positions.length / 3;
      if (!integer(vertexCount, 1) || !Array.isArray(geometry.indices) || geometry.indices.length % 3) fail(`invalid captured topology for ${mesh.id}.`);
      const channels = {};
      for (const [name, kind] of Object.entries(channelKinds)) {
        const values = geometry[name];
        if (values === undefined && name !== "positions" && name !== "indices") { channels[name] = null; continue; }
        if (!Array.isArray(values) || name !== "indices" && values.length !== vertexCount * kind.stride) fail(`captured ${name} vertex count differs for ${mesh.id}.`);
        channels[name] = channelSignature(values, kind, vertexCount);
      }
      if (!Array.isArray(geometry.uvs2) || geometry.uvs2.length !== vertexCount * 2) fail(`captured UV2 vertex count differs for ${mesh.id}.`);
      const uv2Bytes = arrayBytes(geometry.uvs2, { stride: 2, dataType: 1 }, vertexCount);
      meshes.push({ meshId: mesh.id, vertexCount, channels,
        uv2: { count: geometry.uvs2.length, stride: 2, dataType: 1, sha256: digest(uv2Bytes), base64: uv2Bytes.toString("base64") } });
    }
  }
  return { schemaVersion: 1, kind: "native-editor-channels", manifestSha256: snapshot.manifestSha256, meshes };
}

function validateSidecar(sidecar) {
  if (!exactKeys(sidecar, ["schemaVersion", "kind", "manifestSha256", "meshes"]) || sidecar.schemaVersion !== 1 ||
      sidecar.kind !== "native-editor-channels" || !HASH.test(sidecar.manifestSha256) || !Array.isArray(sidecar.meshes)) fail("invalid recovery sidecar.");
  const seen = new Set();
  for (const entry of sidecar.meshes) {
    if (!exactKeys(entry, ["meshId", "vertexCount", "channels", "uv2"]) || !identity(entry.meshId) || seen.has(entry.meshId) || !integer(entry.vertexCount, 1) ||
        !exactKeys(entry.channels, Object.keys(channelKinds))) fail("invalid or duplicate recovery mesh identity.");
    seen.add(entry.meshId);
    for (const [name, kind] of Object.entries(channelKinds)) {
      const value = entry.channels[name];
      if (value === null && name !== "positions" && name !== "indices") continue;
      if (!exactKeys(value, ["count", "stride", "dataType", "sha256"]) || !integer(value.count, 1) || value.stride !== kind.stride ||
          value.dataType !== kind.dataType || !HASH.test(value.sha256) || (name === "indices" ? value.count % 3 !== 0 : value.count !== entry.vertexCount * kind.stride)) {
        fail(`invalid ${name} recovery signature for ${entry.meshId}.`);
      }
    }
    const uv = entry.uv2;
    if (!exactKeys(uv, ["count", "stride", "dataType", "sha256", "base64"]) || uv.count !== entry.vertexCount * 2 || !integer(uv.count, 1) ||
        uv.stride !== 2 || uv.dataType !== 1 || !HASH.test(uv.sha256) || typeof uv.base64 !== "string" || uv.base64.length > MAX_SCALARS * 6) fail(`invalid UV2 recovery data for ${entry.meshId}.`);
    const bytes = Buffer.from(uv.base64, "base64");
    if (bytes.toString("base64") !== uv.base64 || bytes.length !== uv.count * 4 || digest(bytes) !== uv.sha256) fail(`UV2 recovery hash/length mismatch for ${entry.meshId}.`);
    for (let offset = 0; offset < bytes.length; offset += 4) if (!Number.isFinite(bytes.readFloatLE(offset))) fail(`nonfinite recovery UV2 for ${entry.meshId}.`);
  }
  return sidecar;
}

async function checked(root, path) {
  if (typeof path !== "string" || !path || isAbsolute(path) || /[\\:\x00-\x1f]/.test(path) || path.split("/").some(part => !part || part === "." || part === ".." || /[. ]$/.test(part))) fail("unsafe project-relative resource path.");
  let current = root;
  for (const part of path.split("/")) {
    current = join(current, part);
    let stat;
    try { stat = await fs.lstat(current); } catch (error) { if (error.code === "ENOENT") continue; throw error; }
    if (stat.isSymbolicLink()) fail(`symlink/junction resource is not supported: ${path}.`);
    const within = relative(root, await fs.realpath(current));
    if (isAbsolute(within) || within === ".." || within.startsWith(`..${sep}`)) fail("resource escapes the project.");
  }
  return current;
}
async function jsonDocuments(root, directory) {
  const full = await checked(root, directory);
  return Promise.all((await fs.readdir(full)).filter(name => name.endsWith(".json")).sort().map(async name => {
    const path = await checked(root, `${directory}/${name}`), bytes = await fs.readFile(path);
    return { path, bytes, data: JSON.parse(bytes.toString("utf8")) };
  }));
}
function descriptorBytes(binary, descriptor, kind, label) {
  if (!object(descriptor) || descriptor.stride !== kind.stride || descriptor.dataType !== kind.dataType || !integer(descriptor.count, 1) ||
      descriptor.count % kind.stride || !integer(descriptor.offset, 0, binary.length) || descriptor.offset % 4 || descriptor.offset + descriptor.count * 4 > binary.length) fail(`invalid saved ${label} descriptor.`);
  return binary.subarray(descriptor.offset, descriptor.offset + descriptor.count * 4);
}
function validUv(bytes, vertices, label) {
  if (bytes.length !== vertices * 2 * 4) fail(`saved UV2 vertex count differs for ${label}.`);
  for (let offset = 0; offset < bytes.length; offset += 4) if (!Number.isFinite(bytes.readFloatLE(offset))) fail(`nonfinite saved UV2 for ${label}.`);
}

/** Restore only a channel demonstrably dropped by Editor 5.5.3's uvs2/uv2s
 * mismatch. Existing UV2 and all authored geometry edits remain authoritative. */
export async function preserveNativeEditorUv2({ projectRoot, scenePath = "assets/native-world.scene" }) {
  const requested = resolve(projectRoot), stat = await fs.lstat(requested);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail("project root must be a real directory.");
  const root = await fs.realpath(requested);
  const sidecar = validateSidecar(JSON.parse(await fs.readFile(await checked(root, nativeEditorChannelsPath(scenePath)), "utf8")));
  const config = JSON.parse(await fs.readFile(await checked(root, `${scenePath}/config.json`), "utf8"));
  if (config.metadata?.nativeEditorImport?.schemaVersion !== 1 || config.metadata.nativeEditorImport.manifestSha256 !== sidecar.manifestSha256 ||
      config.metadata.nativeEditorImport.targetScene !== scenePath) fail("scene manifest identity differs from the recovery sidecar.");
  const [nodes, documents] = await Promise.all([jsonDocuments(root, `${scenePath}/nodes`), jsonDocuments(root, `${scenePath}/meshes`)]);
  const roots = nodes.filter(document => document.data.metadata?.nativeWorldRoot !== undefined);
  if (roots.length !== 1 || roots[0].data.metadata.nativeWorldRoot?.schemaVersion !== 1 || roots[0].data.metadata.nativeWorldRoot.manifestSha256 !== sidecar.manifestSha256) fail("world root manifest identity differs from the recovery sidecar.");
  const matches = documents.flatMap(document => {
    if (!Array.isArray(document.data.meshes)) fail("invalid saved mesh document.");
    return document.data.meshes.map(mesh => ({ document, mesh }));
  });
  const preserved = [], plans = [];
  for (const entry of sidecar.meshes) {
    const found = matches.filter(item => item.mesh.id === entry.meshId);
    if (found.length !== 1) fail(`missing or duplicate saved mesh ${entry.meshId}.`);
    const { document, mesh } = found[0];
    const inline = document.data.geometries?.vertexData?.filter(geometry => geometry.id === mesh.geometryId) ?? [];
    if (inline.length > 1) fail(`ambiguous saved inline geometry for ${entry.meshId}.`);
    if (inline.length || mesh.positions !== undefined && mesh.positions !== null || mesh.uvs2 !== undefined && mesh.uvs2 !== null) {
      fail(`inline geometry is not supported by the Editor packer for ${entry.meshId}; authored data was not changed.`);
    }
    if (!object(mesh._binaryInfo) || typeof mesh.delayLoadingFile !== "string" || !mesh.delayLoadingFile.startsWith(`${scenePath}/geometries/`) ||
        mesh.delayLoadingFile.slice(`${scenePath}/geometries/`.length).includes("/")) fail(`unsupported saved geometry path for ${entry.meshId}.`);
    const binaryPath = await checked(root, mesh.delayLoadingFile), binary = await fs.readFile(binaryPath);
    if (binary.length % 4) fail(`unaligned saved geometry for ${entry.meshId}.`);
    const position = descriptorBytes(binary, mesh._binaryInfo.positionsAttrDesc, channelKinds.positions, `${entry.meshId} positions`);
    const vertices = position.length / 12;
    if (mesh._binaryInfo.uvs2AttrDesc !== undefined) {
      validUv(descriptorBytes(binary, mesh._binaryInfo.uvs2AttrDesc, { stride: 2, dataType: 1 }, `${entry.meshId} UV2`), vertices, entry.meshId);
      preserved.push(entry.meshId); continue;
    }
    for (const [name, kind] of Object.entries(channelKinds)) {
      const expected = entry.channels[name], descriptor = mesh._binaryInfo[kind.descriptor];
      if (expected === null) { if (descriptor !== undefined) fail(`authored geometry changed (${name}) for ${entry.meshId}; missing UV2 was not restored.`); continue; }
      const bytes = descriptorBytes(binary, descriptor, kind, `${entry.meshId} ${name}`);
      if (descriptor.count !== expected.count || digest(bytes) !== expected.sha256) fail(`authored geometry changed (${name}) for ${entry.meshId}; missing UV2 was not restored.`);
    }
    const uv2 = Buffer.from(entry.uv2.base64, "base64"), nextBinary = Buffer.concat([binary, uv2]);
    const nextPath = `${scenePath}/geometries/${digest(nextBinary)}.babylonbinarymeshdata`, absolute = await checked(root, nextPath);
    try { if (!(await fs.readFile(absolute)).equals(nextBinary)) fail("content-addressed geometry collision."); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    plans.push({ document, mesh, entry, binaryPath, binary, nextBinary, nextPath, absolute });
  }
  // Validate every mesh before creating any derivative or editing a descriptor.
  for (const plan of plans) {
    if (!(await fs.readFile(plan.document.path)).equals(plan.document.bytes) || !(await fs.readFile(plan.binaryPath)).equals(plan.binary)) fail("authored resources changed during preservation; retry after saving finishes.");
  }
  for (const plan of plans) {
    try { await fs.writeFile(plan.absolute, plan.nextBinary, { flag: "wx" }); }
    catch (error) { if (error.code !== "EEXIST" || !(await fs.readFile(plan.absolute)).equals(plan.nextBinary)) throw error; }
    plan.mesh.delayLoadingFile = plan.nextPath;
    plan.mesh._binaryInfo.uvs2AttrDesc = { count: plan.entry.uv2.count, stride: 2, offset: plan.binary.length, dataType: 1 };
    plan.mesh.hasUVs2 = true;
  }
  for (const document of new Set(plans.map(plan => plan.document))) {
    const temporary = `${document.path}.${randomUUID()}.tmp`;
    try { await fs.writeFile(temporary, `${JSON.stringify(document.data, null, 2)}\n`, { flag: "wx" }); await fs.rename(temporary, document.path); }
    finally { await fs.unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error; }); }
  }
  return { scenePath, manifestSha256: sidecar.manifestSha256, preserved, restored: plans.map(plan => ({ meshId: plan.entry.meshId,
    uv2Sha256: plan.entry.uv2.sha256, binary: plan.nextPath, binarySha256: digest(plan.nextBinary) })) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length > 2) fail("this prepack command does not accept arguments.");
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  for (const entry of await fs.readdir(resolve(projectRoot, "assets"), { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.endsWith(".scene")) continue;
    const scenePath = `assets/${entry.name}`, root = await fs.realpath(projectRoot);
    const config = JSON.parse(await fs.readFile(await checked(root, `${scenePath}/config.json`), "utf8"));
    if (!config.metadata?.nativeEditorImport) continue;
    console.log(JSON.stringify(await preserveNativeEditorUv2({ projectRoot, scenePath })));
  }
}
