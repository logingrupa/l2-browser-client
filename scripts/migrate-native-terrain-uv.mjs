import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

// A one-time migration for the captured 20_20 section, not a general UV repair.
// Native qualification and independent byte oracle:
// artifacts/native-parity/research/terrain-mask-native-rea-followup/
// continuation-20261106-ongoing/uv-draw-handoff-20261106/qualified-correction/BROWSER_FIX_HANDOFF.md
const SCENE = "assets/native-world.scene";
const MESH = "native-34fc990641dc04014d49e47c";
const MANIFEST = "062218e6dc1c887e5018489f69b1faaed571b519d937cc0d7c7c9b8c1474e2c2";
const BEFORE = "bc541071acd0ed8dd7306e8a476b7c0bc1ca92c8134dff4dc08da44626843a4e";
const AFTER = "549a7fef8316ed66b718f907ad2837a78e818d1e6740d9690200d1d5cd15ab05";
const BEFORE_UV = "957f2061e9b83e8e4fdb6e1504ee66fb2100a0c0b6cf4e70f686e97e98814695";
const AFTER_UV = "d549356ff531e4271099c2097807eec899cc45eb96d512be04b03855d558963d";
const UV2 = "4c6a9644e0f1f71293741b8bf835576efa68808548c63613e7ce9ec80efc7ab2";
const meshFile = `${SCENE}/meshes/${MESH}.json`;
const proofFile = `${SCENE}.native-editor-channels.json`;
const rootFile = `${SCENE}/nodes/native-e5a08bcebe4f528ff1b05bfa.json`;
const binaryFile = hash => `${SCENE}/geometries/${hash}.babylonbinarymeshdata`;
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const fail = message => { throw new Error(`Native terrain UV migration: ${message}`); };
const same = isDeepStrictEqual;
const descriptors = {
  positionsAttrDesc: { count: 7056, stride: 3, offset: 0, dataType: 1 },
  normalsAttrDesc: { count: 7056, stride: 3, offset: 28224, dataType: 1 },
  uvsAttrDesc: { count: 4704, stride: 2, offset: 56448, dataType: 1 },
  indicesAttrDesc: { count: 13536, stride: 1, offset: 75264, dataType: 0 },
  subMeshesAttrDesc: { count: 1, stride: 5, offset: 129408, dataType: 0 },
  uvs2AttrDesc: { count: 4704, stride: 2, offset: 129428, dataType: 1 },
};

async function checked(root, path) {
  if (!path || isAbsolute(path) || /[\\:\x00-\x1f]/.test(path) || path.split("/").some(p => !p || p === "." || p === ".." || /[. ]$/.test(p))) fail("unsafe resource path.");
  let current = root;
  for (const part of path.split("/")) {
    current = join(current, part);
    let stat;
    try { stat = await fs.lstat(current); } catch (error) { if (error.code === "ENOENT") continue; throw error; }
    if (stat.isSymbolicLink()) fail(`symlink/junction resource: ${path}.`);
    const rel = relative(root, await fs.realpath(current));
    if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) fail("resource escapes project.");
  }
  return current;
}

async function document(root, path) {
  const absolute = await checked(root, path), bytes = await fs.readFile(absolute);
  return { path, absolute, bytes, data: JSON.parse(bytes.toString("utf8")) };
}

function replaceString(doc, before, after, expected) {
  const text = doc.bytes.toString("utf8"), needle = JSON.stringify(before);
  if (!Buffer.from(text).equals(doc.bytes) || text.split(needle).length !== 2) fail(`ambiguous string replacement in ${doc.path}.`);
  const next = Buffer.from(text.replace(needle, JSON.stringify(after)));
  if (!same(JSON.parse(next.toString("utf8")), expected)) fail(`replacement changes unrelated JSON in ${doc.path}.`);
  return next;
}

function validateProof(entry, binary, corrected) {
  if (entry.vertexCount !== 2352 || !entry.channels || Object.keys(entry.channels).sort().join() !== "indices,normals,positions,uvs") fail("channel proof identity differs.");
  for (const name of ["positions", "normals", "uvs", "indices"]) {
    const d = descriptors[`${name}AttrDesc`], bytes = binary.subarray(d.offset, d.offset + d.count * 4);
    const expected = { count: d.count, stride: d.stride, dataType: d.dataType, sha256: hash(bytes) };
    if (!same(entry.channels[name], expected)) fail(`current ${name} channel proof differs from geometry.`);
  }
  if (entry.channels.uvs.sha256 !== (corrected ? AFTER_UV : BEFORE_UV)) fail("unexpected primary UV proof.");
  const d = descriptors.uvs2AttrDesc, bytes = binary.subarray(d.offset, d.offset + d.count * 4);
  const expected = { count: d.count, stride: d.stride, dataType: d.dataType, sha256: UV2, base64: bytes.toString("base64") };
  if (!same(entry.uv2, expected) || hash(bytes) !== UV2) fail("UV2 proof/bytes differ; authored data is preserved.");
}

function correctedGeometry(binary, alreadyCorrected) {
  const original = Buffer.from(binary), next = Buffer.from(binary), selected = new Set();
  let vertex = 0;
  for (let y = 208; y <= 255; y++) for (let x = 64; x <= 112; x++, vertex++) {
    const uOffset = 56448 + vertex * 8, vOffset = uOffset + 4;
    const ordinaryU = (x + .5) / 256, ordinaryV = (y + .5) / 256;
    const correctedV = ordinaryV - Math.max(y - 240, 0) / 4096;
    if (binary.readFloatLE(uOffset) !== ordinaryU || binary.readFloatLE(vOffset) !== (alreadyCorrected ? correctedV : ordinaryV)) fail(`unexpected UV at grid ${x}/${y}.`);
    original.writeFloatLE(ordinaryV, vOffset);
    next.writeFloatLE(correctedV, vOffset);
    if (y > 240) selected.add(vOffset);
  }
  const changedByteOffsets = [];
  for (let offset = 0; offset < next.length; offset++) if (original[offset] !== next[offset]) {
    if (![0, 1, 2, 3].some(delta => selected.has(offset - delta))) fail("correction changed a nonselected byte.");
    changedByteOffsets.push(offset);
  }
  if (selected.size !== 735 || changedByteOffsets.length !== 1078 || hash(original) !== BEFORE || hash(next) !== AFTER ||
      hash(next.subarray(56448, 75264)) !== AFTER_UV) fail("independent corrected geometry oracle differs.");
  return { original, next, changedByteOffsets, changedVertexCount: selected.size };
}

async function unchanged(records) {
  for (const record of records) if (!(await fs.readFile(record.absolute)).equals(record.bytes)) fail(`authored resource changed during migration: ${record.path}.`);
}

/** Inspect by default. Writes only the qualified saved binary, its reference and
 * primary-UV proof; public export and source conversion remain separate stages. */
export async function migrateNativeTerrainUv({ projectRoot, apply = false }) {
  if (typeof projectRoot !== "string" || typeof apply !== "boolean") fail("projectRoot and boolean apply required.");
  const requested = resolve(projectRoot), stat = await fs.lstat(requested);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail("project root must be a real directory.");
  const root = await fs.realpath(requested);
  const [meshDoc, proofDoc, configDoc, rootDoc] = await Promise.all([
    document(root, meshFile), document(root, proofFile), document(root, `${SCENE}/config.json`), document(root, rootFile),
  ]);
  const proof = proofDoc.data;
  if (proof.schemaVersion !== 1 || proof.kind !== "native-editor-channels" || proof.manifestSha256 !== MANIFEST || !Array.isArray(proof.meshes)) fail("unexpected channel proof manifest.");
  const entries = proof.meshes.filter(entry => entry.meshId === MESH);
  const meshes = meshDoc.data.meshes;
  if (entries.length !== 1 || !Array.isArray(meshes) || meshes.length !== 1 || meshes[0].id !== MESH) fail("missing/duplicate terrain mesh identity.");
  const entry = entries[0], mesh = meshes[0], config = configDoc.data.metadata?.nativeEditorImport, marker = rootDoc.data.metadata?.nativeWorldRoot;
  if (config?.schemaVersion !== 1 || config.manifestSha256 !== MANIFEST || config.targetScene !== SCENE || marker?.schemaVersion !== 1 || marker.manifestSha256 !== MANIFEST) fail("config/root manifest identity differs.");
  if (mesh.geometryId !== "native-10fc886ae4b2ca0875acdaea" || mesh.materialId !== "native-0bb65c1200d37a186ca6fdc0" ||
      mesh.metadata?.worldTerrain !== true || mesh.metadata?.nativeEditorSource?.originalId !== "20_20.TerrainInfo0") fail("terrain source/geometry/material identity differs.");
  if (!same(mesh._binaryInfo, descriptors) || mesh.positions != null || mesh.uvs != null || mesh.uvs2 != null ||
      meshDoc.data.geometries?.vertexData?.length) fail("saved geometry layout differs; newer authored data is preserved.");
  const corrected = mesh.delayLoadingFile === binaryFile(AFTER);
  if (!corrected && mesh.delayLoadingFile !== binaryFile(BEFORE)) fail("unknown/newer geometry reference; authored data is preserved.");
  const absolute = await checked(root, mesh.delayLoadingFile), bytes = await fs.readFile(absolute);
  if (bytes.length !== 148244 || hash(bytes) !== (corrected ? AFTER : BEFORE)) fail("pinned geometry hash differs; authored data is preserved.");
  validateProof(entry, bytes, corrected);
  const candidate = correctedGeometry(bytes, corrected);
  const binaryRecord = { path: mesh.delayLoadingFile, absolute, bytes };
  const originalPath = await checked(root, binaryFile(BEFORE));
  if (corrected && !(await fs.readFile(originalPath)).equals(candidate.original)) fail("original geometry missing or changed.");
  const nextMesh = structuredClone(meshDoc.data), nextProof = structuredClone(proof);
  nextMesh.meshes[0].delayLoadingFile = binaryFile(AFTER);
  nextProof.meshes.find(value => value.meshId === MESH).channels.uvs.sha256 = AFTER_UV;
  const meshBytes = corrected ? meshDoc.bytes : replaceString(meshDoc, binaryFile(BEFORE), binaryFile(AFTER), nextMesh);
  const proofBytes = corrected ? proofDoc.bytes : replaceString(proofDoc, BEFORE_UV, AFTER_UV, nextProof);
  const nextPath = await checked(root, binaryFile(AFTER));
  let nextExists = false;
  try {
    const existing = await fs.readFile(nextPath);
    if (!existing.equals(candidate.next)) fail("corrected content-addressed path contains different bytes.");
    nextExists = true;
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  const receipt = {
    schemaVersion: 1, kind: "native-terrain-uv-migration", status: corrected ? "already-corrected" : apply ? "applied" : "dry-run",
    scope: "20_20.TerrainInfo0; X64..112/Y208..255; qualified captured route", manifestSha256: MANIFEST,
    traceSha256: "d391b2a28db6a752cf24ee0bdcdb54ec74ace3446b55c917f88e1a170d1daada",
    nativeDraw: 142131, nativeUpload: 142108, formula: "(grid + 0.5)/256 - max(grid - 240,0)/4096",
    files: [
      { path: meshFile, before: hash(meshDoc.bytes), after: hash(meshBytes), field: `meshes[0].delayLoadingFile` },
      { path: proofFile, before: hash(proofDoc.bytes), after: hash(proofBytes), field: `meshes[meshId=${MESH}].channels.uvs.sha256` },
    ],
    binary: { before: BEFORE, after: AFTER, beforePath: binaryFile(BEFORE), afterPath: binaryFile(AFTER), bytes: 148244, originalRetained: true },
    primaryUv: { before: BEFORE_UV, after: AFTER_UV, offset: 56448, bytes: 18816 },
    correction: { changedVertexCount: 735, changedScalarCount: 735, changedByteCount: 1078, changedByteOffsets: candidate.changedByteOffsets },
    appliedChanges: corrected || !apply ? { files: 0, scalars: 0, bytes: 0 } : { files: 2, scalars: 735, bytes: 1078 },
    preservation: { allNonSelectedBytesIdentical: true, allUUnchanged: true, vAtOrBelow240Unchanged: true,
      positionsNormalsIndicesSubmeshesUnchanged: true, uv2Sha256: UV2, uv2Base64Unchanged: true,
      importManifestUnchanged: true, unrelatedJsonBytesUnchanged: true, materialAndGeometryIdentityUnchanged: true },
    limitations: ["Offscreen native submission proves coordinates, not final visible pixel parity.", "Does not export public assets or change source geometry/shaders."],
  };
  if (corrected || !apply) return receipt;

  // Recheck every read input before committing. The paired JSON updates use
  // temporary siblings; on failure restore only bytes still owned by this run.
  const inputs = [meshDoc, proofDoc, configDoc, rootDoc, binaryRecord];
  const changes = [{ ...meshDoc, next: meshBytes }, { ...proofDoc, next: proofBytes }];
  const temporaries = new Map(), committed = [];
  let createdBinary = false;
  async function temporary(path, content) {
    const name = `${path}.${randomUUID()}.terrain-uv.tmp`;
    await fs.writeFile(name, content, { flag: "wx" });
    temporaries.set(name, content);
    return name;
  }
  async function removeOwned(path, content) {
    try { if ((await fs.readFile(path)).equals(content)) await fs.unlink(path); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  try {
    await unchanged(inputs);
    for (const change of changes) change.temporary = await temporary(change.absolute, change.next);
    await unchanged(inputs);
    if (!nextExists) {
      try { await fs.writeFile(nextPath, candidate.next, { flag: "wx" }); createdBinary = true; }
      catch (error) { if (error.code !== "EEXIST" || !(await fs.readFile(nextPath)).equals(candidate.next)) throw error; }
    }
    for (const change of changes) {
      await unchanged(inputs.map(record => {
        const earlier = committed.find(value => value.absolute === record.absolute);
        return earlier ? { ...record, bytes: earlier.next } : record;
      }));
      if (!(await fs.readFile(nextPath)).equals(candidate.next)) fail("corrected geometry changed before commit.");
      await fs.rename(change.temporary, change.absolute);
      temporaries.delete(change.temporary);
      committed.push(change);
    }
    await unchanged(inputs.map(record => {
      const change = committed.find(value => value.absolute === record.absolute);
      return change ? { ...record, bytes: change.next } : record;
    }));
    if (!(await fs.readFile(nextPath)).equals(candidate.next)) fail("corrected geometry changed after commit.");
    return receipt;
  } catch (error) {
    const rollback = { restored: [], preservedConcurrentEdits: [], failures: [], binaryRemoved: false };
    for (const change of [...committed].reverse()) {
      try {
        if (!(await fs.readFile(change.absolute)).equals(change.next)) { rollback.preservedConcurrentEdits.push(change.path); continue; }
        const path = await temporary(change.absolute, change.bytes);
        if (!(await fs.readFile(change.absolute)).equals(change.next)) { rollback.preservedConcurrentEdits.push(change.path); continue; }
        await fs.rename(path, change.absolute); temporaries.delete(path); rollback.restored.push(change.path);
      } catch (failure) { rollback.failures.push({ path: change.path, message: String(failure) }); }
    }
    // Also inspect uncommitted targets: an author may have edited one after our
    // preflight, including before the first rename failed.
    for (const change of changes) {
      try {
        if (!(await fs.readFile(change.absolute)).equals(change.bytes) && !rollback.preservedConcurrentEdits.includes(change.path)) rollback.preservedConcurrentEdits.push(change.path);
      } catch (failure) { rollback.failures.push({ path: change.path, message: String(failure) }); }
    }
    // Retain the immutable derivative if concurrent authoring might reference it.
    if (createdBinary && !rollback.preservedConcurrentEdits.length && !rollback.failures.length) {
      try { await removeOwned(nextPath, candidate.next); rollback.binaryRemoved = true; }
      catch (failure) { rollback.failures.push({ path: binaryFile(AFTER), message: String(failure) }); }
    }
    error.rollback = rollback;
    throw error;
  } finally {
    for (const [path, content] of temporaries) await removeOwned(path, content);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length > 1 || args.length === 1 && args[0] !== "--apply") fail("usage: node scripts/migrate-native-terrain-uv.mjs [--apply]");
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  try { console.log(JSON.stringify(await migrateNativeTerrainUv({ projectRoot, apply: args[0] === "--apply" }), null, 2)); }
  catch (error) { console.error(JSON.stringify({ error: error.message, rollback: error.rollback ?? null }, null, 2)); process.exitCode = 1; }
}
