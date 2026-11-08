import { createHash } from "node:crypto";
import { existsSync, promises as fs } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

const { planNativeEditorTerrainAppend, applyNativeEditorTerrainAppend } = await import(pathToFileURL(resolve("scripts/append-native-editor-terrain.mjs")).href);
const { createNativeEditorChannels, preserveNativeEditorUv2 } = await import(pathToFileURL(resolve("scripts/preserve-native-editor-uv2.mjs")).href);
const SCENE = "assets/native-world.scene", BASE = "native-34fc990641dc04014d49e47c", roots: string[] = [];
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const json = (value: unknown) => Buffer.from(JSON.stringify(value, null, 2) + "\n");
const channels = { positions: ["positionsAttrDesc", 3], normals: ["normalsAttrDesc", 3], uvs: ["uvsAttrDesc", 2], indices: ["indicesAttrDesc", 1], uvs2: ["uvs2AttrDesc", 2] } as const;
const fixtureHelper = `const fs=require('fs'); exports.writeBinaryGeometry=async({mesh,geometry,path})=>{
 const chunks=[];let offset=0;
 for(const [key,desc,stride,Type] of [['positions','positionsAttrDesc',3,Float32Array],['normals','normalsAttrDesc',3,Float32Array],['uvs','uvsAttrDesc',2,Float32Array],['indices','indicesAttrDesc',1,Int32Array],['uv2s','uvs2AttrDesc',2,Float32Array]]){
 const bytes=Buffer.from(new Type(geometry[key]).buffer);chunks.push(bytes);mesh._binaryInfo[desc]={count:geometry[key].length,stride,offset,dataType:Type===Float32Array?1:0};offset+=bytes.length;}
 const sub=mesh.subMeshes.flatMap(s=>[s.materialIndex,s.verticesStart,s.verticesCount,s.indexStart,s.indexCount]);
 mesh._binaryInfo.subMeshesAttrDesc={count:mesh.subMeshes.length,stride:5,offset,dataType:0};mesh.subMeshes=null;
 chunks.push(Buffer.from(new Int32Array(sub).buffer));fs.writeFileSync(path,Buffer.concat(chunks));};`;
const helper = existsSync(join(homedir(), "AppData/Local/Programs/BabylonJS Editor/resources/app.asar")) ? {} : { geometryHelperSource: fixtureHelper };

async function files(root: string) {
  const output: Record<string, Buffer> = {};
  async function visit(path: string, prefix: string) {
    for (const entry of await fs.readdir(path, { withFileTypes: true })) {
      if (entry.isDirectory()) await visit(join(path, entry.name), `${prefix}${entry.name}/`);
      else output[prefix + entry.name] = await fs.readFile(join(path, entry.name));
    }
  }
  await visit(root, ""); return output;
}

async function fixture() {
  const root = await fs.mkdtemp(join(tmpdir(), "native-editor-terrain-test-")); roots.push(root);
  const write = async (path: string, bytes: Buffer) => { await fs.mkdir(dirname(join(root, path)), { recursive: true }); await fs.writeFile(join(root, path), bytes); };
  const base = { schemaVersion: 1, kind: "native-map-section-runtime", terrain: { file: "terrain.glb", sha256: "a".repeat(64), bytes: 100 },
    models: [{ id: "interlude:old" }], placements: [{ id: "old-placement" }], bsp: [{ id: "floor" }],
    derivation: { uvMigration: "closed" }, coverage: { existing: 1 }, gaps: ["native pixels unverified"] };
  const oldManifestSha256 = hash(json(base));
  const patch = { id: "interlude:20_20.TerrainInfo0.TerrainSector247", sourceTerrain: "20_20.TerrainInfo0", sourceSector: "20_20.TerrainInfo0.TerrainSector247",
    sourceMapSha256: "1beddad24c10a35a1b2e9151727a85158e3e01992299a6671de876645eb1f1e4", gridBounds: [112, 240, 128, 255],
    model: { file: "terrain247.glb", sha256: "b".repeat(64), bytes: 1234 }, source: { file: "terrain247.json", sha256: "c".repeat(64), bytes: 456 } };
  const next = { ...structuredClone(base), terrainPatches: [patch], derivation: { ...base.derivation, terrain247: { source: "retained" } },
    coverage: { ...base.coverage, terrainPatches: 1 }, gaps: [...base.gaps, "source topology only"] };
  const layers = Array.from({ length: 9 }, (_, index) => ({ index, texture: `Native.Diffuse${index}`, alphaMap: `Native.Mask${index}`,
    worldToTextureRowMajor: [[.0078125, 0, 0, 0], [0, .0078125, 0, 0], [0, 0, 1, 0], [0, -.03125, 0, 1]], maskUV: "old captured prose" }));
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jH1sAAAAASUVORK5CYII=", "base64");
  const texturePath = `assets/native-generated/${"d".repeat(64)}/${hash(png)}.png`, samplers = [...Array.from({ length: 9 }, (_, i) => `layer${i}`), "mask0", "mask1", "mask2"];
  const material = { id: "authored-terrain-material", uniqueId: 2 ** 48 + 9, customType: "BABYLON.ShaderMaterial", authored: { value: 73 },
    options: { attributes: ["position", "uv"], uniforms: ["worldViewProjection"], samplers },
    shaderPath: { vertexSource: "void main(){vNativePosition=position.xzy*100.0;vMaskUV=uv;}", fragmentSource: "authored source remains exact" },
    textures: Object.fromEntries(samplers.map(name => [name, { name: texturePath, url: texturePath, samplingMode: 2, gammaSpace: false }])) };
  const baseGeometry = { id: "base-geometry", uniqueId: 2 ** 48 + 4, positions: [0, 0, 0, 1, 0, 0, 0, 0, 1],
    normals: [0, 1, 0, 0, 1, 0, 0, 1, 0], uvs: [0, 0, 1, 0, 0, 1], uvs2: [2, 3, 4, 5, 6, 7], indices: [0, 2, 1] };
  const descriptors: Record<string, { count: number; stride: number; offset: number; dataType: number }> = {}, parts: Buffer[] = []; let offset = 0;
  for (const [key, [name, stride]] of Object.entries(channels) as [keyof typeof channels, readonly [string, number]][]) {
    const values = baseGeometry[key], bytes = Buffer.from(key === "indices" ? new Int32Array(values).buffer : new Float32Array(values).buffer);
    descriptors[name] = { count: values.length, stride, offset, dataType: key === "indices" ? 0 : 1 }; parts.push(bytes); offset += bytes.length;
  }
  const baseBinary = Buffer.concat(parts), binaryPath = `${SCENE}/geometries/${hash(baseBinary)}.babylonbinarymeshdata`;
  const baseMesh = { id: BASE, uniqueId: 2 ** 48 + 3, type: "Mesh", materialId: material.id, materialUniqueId: material.uniqueId,
    geometryId: baseGeometry.id, geometryUniqueId: baseGeometry.uniqueId, position: [0, 0, 0], scaling: [1, 1, 1], delayLoadingFile: binaryPath, _binaryInfo: descriptors,
    metadata: { worldTerrain: true, parentId: 2 ** 48 + 1, nativeEditorSource: { originalId: patch.sourceTerrain }, gltf: { extras: { nativeLayers: layers } } } };
  const baseDoc = { meshes: [baseMesh], materials: [material], geometries: { vertexData: [] } };
  const proof = createNativeEditorChannels({ schemaVersion: 1, kind: "native-editor-world-snapshot", manifestSha256: oldManifestSha256,
    meshes: [{ meshes: [baseMesh], geometries: { vertexData: [baseGeometry] } }] });
  const world = { id: "world", uniqueId: 2 ** 48 + 1, type: "TransformNode", position: [0, 0, 0], scaling: [1, 1, -1],
    metadata: { nativeWorldRoot: { schemaVersion: 1, manifestSha256: oldManifestSha256, manifest: base }, authoredValue: 99 } };
  await write(`${SCENE}/nodes/world.json`, json(world)); await write(`${SCENE}/meshes/${BASE}.json`, json(baseDoc)); await write(binaryPath, baseBinary); await write(texturePath, png);
  await write(`${SCENE}/config.json`, Buffer.from(`{ "editorCamera":{"radius":14.8}, "metadata":{"nativeEditorImport":{"schemaVersion":1,"targetScene":"${SCENE}","manifestSha256":"${oldManifestSha256}"}} }\r\n`));
  await write(`${SCENE}.native-editor-channels.json`, json(proof));
  const positions: number[] = [], normals: number[] = [], uvs: number[] = [], uvs2: number[] = [], indices: number[] = [];
  for (let y = 240; y <= 255; y++) for (let x = 112; x <= 128; x++) {
    positions.push(Math.fround(x * 1.28), -30, Math.fround((65536 + y * 128) * .01)); normals.push(-0, 1, 0);
    uvs.push(Math.fround((x + .5) / 256), Math.fround((y + .5) / 256 - Math.max(y - 240, 0) / 4096));
    uvs2.push(Math.fround(x / 3), Math.fround(y / 3));
  }
  for (let y = 0; y < 15; y++) for (let x = 0; x < 16; x++) { const a = y * 17 + x; indices.push(a, a + 17, a + 1, a + 1, a + 17, a + 18); }
  const geometry = { id: "captured-geometry", uniqueId: 23, positions, normals, uvs, uvs2, indices,
    channelBytes: Object.fromEntries(Object.entries({ positions, normals, uvs, uvs2, indices }).map(([key, values]) =>
      [key, Buffer.from(key === "indices" ? new Int32Array(values).buffer : new Float32Array(values).buffer).toString("base64")])) };
  const mesh = { id: patch.sourceSector, uniqueId: 22, name: patch.sourceSector, type: "Mesh", position: [0, 0, 0], rotation: [0, 0, 0], scaling: [1, 1, 1], localMatrix: identity,
    geometryId: geometry.id, geometryUniqueId: geometry.uniqueId, sideOrientation: 1,
    metadata: { gltf: { extras: { nativeObject: patch.sourceSector, nativeLayers: layers.map(layer => ({ ...structuredClone(layer), maskUV: "new qualified prose" })) } } },
    subMeshes: [{ materialIndex: 0, verticesStart: 0, verticesCount: 272, indexStart: 0, indexCount: indices.length }] };
  const snapshot = { schemaVersion: 1, kind: "native-editor-terrain-snapshot", baseManifestSha256: oldManifestSha256, nativeTerrainPatch: patch,
    mesh: { meshes: [mesh], geometries: { vertexData: [geometry] }, basePoseMatrix: identity } };
  const oldManifestPath = "artifacts/old.json", nextManifestPath = "artifacts/next.json", snapshotPath = "artifacts/snapshot.json";
  await write(oldManifestPath, json(base)); await write(nextManifestPath, json(next)); await write(snapshotPath, json(snapshot));
  const options = { projectRoot: root, oldManifestPath, oldManifestSha256, nextManifestPath, nextManifestSha256: hash(json(next)), snapshotPath,
    snapshotSha256: hash(json(snapshot)), baseTerrainMeshSha256: hash(json(baseDoc)), baseTerrainGeometrySha256: hash(baseBinary), baseChannelsSha256: hash(json(proof)), ...helper };
  const refreshSnapshot = async () => { await write(snapshotPath, json(snapshot)); options.snapshotSha256 = hash(json(snapshot)); };
  const refreshManifest = async () => { await write(nextManifestPath, json(next)); options.nextManifestSha256 = hash(json(next)); };
  return { root, write, options, snapshot, next, base, baseDoc, baseBinary, binaryPath, proof, world, material, geometry, texturePath, refreshSnapshot, refreshManifest };
}

afterEach(async () => {
  vi.restoreAllMocks(); const parent = await fs.realpath(tmpdir());
  for (const path of roots.splice(0)) { const actual = await fs.realpath(path); if (dirname(actual) !== parent || !basename(actual).startsWith("native-editor-terrain-test-")) throw Error("Unexpected fixture cleanup path."); await fs.rm(actual, { recursive: true, force: true }); }
});

async function removePatchUv2(f: Awaited<ReturnType<typeof fixture>>, receipt: any, changePrimary = false) {
  const record = receipt.newRecords[0], doc = JSON.parse(await fs.readFile(join(f.root, record.path), "utf8")), mesh = doc.meshes[0];
  const before = await fs.readFile(join(f.root, mesh.delayLoadingFile)), uv = mesh._binaryInfo.uvs2AttrDesc;
  const lost = Buffer.concat([before.subarray(0, uv.offset), before.subarray(uv.offset + uv.count * 4)]);
  delete mesh._binaryInfo.uvs2AttrDesc; mesh.hasUVs2 = false;
  for (const desc of Object.values(mesh._binaryInfo) as { offset: number }[]) if (desc.offset > uv.offset) desc.offset -= uv.count * 4;
  if (changePrimary) lost.writeFloatLE(.875, mesh._binaryInfo.uvsAttrDesc.offset);
  mesh.delayLoadingFile = `${SCENE}/geometries/editor-saved-patch.babylonbinarymeshdata`;
  await f.write(mesh.delayLoadingFile, lost); await f.write(record.path, json(doc));
  return { doc, mesh, record };
}

describe("additive adjacent Editor terrain", () => {
  it("adds exact geometry and proof while retaining every old authored material/terrain byte", async () => {
    const f = await fixture(), before = await files(f.root), plan = await planNativeEditorTerrainAppend(f.options);
    expect(await files(f.root)).toEqual(before); expect(plan.writes).toHaveLength(5);
    const receipt = await applyNativeEditorTerrainAppend(plan, { receiptPath: "artifacts/applied.json" });
    const record = receipt.newRecords[0], doc = JSON.parse(await fs.readFile(join(f.root, record.path), "utf8")), mesh = doc.meshes[0];
    const binary = await fs.readFile(join(f.root, record.geometryPath));
    expect(hash(binary)).toBe(record.geometrySha256); expect(doc.materials).toEqual([f.material]);
    expect(mesh.metadata.parentId).toBe(f.world.uniqueId); expect(mesh.sideOrientation).toBe(0); expect(mesh.hasUVs2).toBe(true);
    for (const [key, [descriptor]] of Object.entries(channels)) {
      const desc = mesh._binaryInfo[descriptor], expected = Buffer.from(f.geometry.channelBytes[key]!, "base64");
      expect(binary.subarray(desc.offset, desc.offset + expected.length)).toEqual(expected);
    }
    expect(binary.readUInt32LE(mesh._binaryInfo.normalsAttrDesc.offset)).toBe(0x80000000);
    const after = await files(f.root), changed = Object.keys(before).filter(path => !before[path]!.equals(after[path]!));
    expect(changed.sort()).toEqual([`${SCENE}/nodes/world.json`, `${SCENE}/config.json`, `${SCENE}.native-editor-channels.json`].sort());
    const proofPath = `${SCENE}.native-editor-channels.json`, proofText = after[proofPath]!.toString();
    expect(proofText.replace(`,${JSON.stringify(receipt.recoveryEntry)}`, "").replace(f.options.nextManifestSha256, f.options.oldManifestSha256)).toBe(before[proofPath]!.toString());
    expect(JSON.parse(proofText).meshes[0]).toEqual(f.proof.meshes[0]);
  });

  it("repeats without touching later authored base/patch materials, transforms, geometry or proof", async () => {
    const f = await fixture(), receipt = await applyNativeEditorTerrainAppend(await planNativeEditorTerrainAppend(f.options));
    const path = receipt.newRecords[0].path, doc = JSON.parse(await fs.readFile(join(f.root, path), "utf8"));
    doc.meshes[0].position = [4, 5, 6]; doc.materials[0].shaderPath.fragmentSource = "later authored patch shader"; await f.write(path, json(doc));
    f.baseDoc.materials[0]!.shaderPath.vertexSource = "later authored base shader"; await f.write(`${SCENE}/meshes/${BASE}.json`, json(f.baseDoc));
    await f.write(f.binaryPath, Buffer.from("newer original geometry must remain"));
    await f.write(doc.meshes[0].delayLoadingFile, Buffer.from("later authored patch geometry"));
    const before = await files(f.root), repeated = await planNativeEditorTerrainAppend(f.options);
    expect(repeated.summary.status).toBe("preserved"); expect(repeated.writes).toEqual([]);
    await applyNativeEditorTerrainAppend(repeated); expect(await files(f.root)).toEqual(before);
  });

  it("rejects stale base mesh, base geometry and base proof guards before any writes", async () => {
    for (const target of ["mesh", "geometry", "proof"] as const) {
      const f = await fixture(), path = target === "mesh" ? `${SCENE}/meshes/${BASE}.json` : target === "geometry" ? f.binaryPath : `${SCENE}.native-editor-channels.json`;
      if (target === "geometry") await f.write(path, Buffer.from("newer geometry"));
      else { const doc = JSON.parse(await fs.readFile(join(f.root, path), "utf8")); doc.newerAuthorWork = 73; await f.write(path, json(doc)); }
      const before = await files(f.root);
      await expect(planNativeEditorTerrainAppend(f.options)).rejects.toThrow(/guards differ|geometry hash differs/);
      expect(await files(f.root)).toEqual(before);
    }
  });

  it("rejects unrelated manifest rewrites and incorrect patch scope", async () => {
    const f = await fixture(); f.next.terrain.sha256 = "f".repeat(64); await f.refreshManifest();
    await expect(planNativeEditorTerrainAppend(f.options)).rejects.toThrow("unrelated manifest change");
    const g = await fixture(); g.snapshot.nativeTerrainPatch.gridBounds[0] = 111; await g.refreshSnapshot();
    await expect(planNativeEditorTerrainAppend(g.options)).rejects.toThrow("unsupported terrain patch scope");
  });

  it("refuses mismatched diffuse bindings instead of rewriting the authored material", async () => {
    const f = await fixture(); f.snapshot.mesh.meshes[0]!.metadata.gltf.extras.nativeLayers[1]!.worldToTextureRowMajor[0]![0] = .5; await f.refreshSnapshot();
    const before = await files(f.root);
    await expect(planNativeEditorTerrainAppend(f.options)).rejects.toThrow("geometry/source/binding differs"); expect(await files(f.root)).toEqual(before);
  });

  it("rejects nonidentity transforms, hidden parenting and rebased source positions", async () => {
    const f = await fixture(); f.snapshot.mesh.meshes[0]!.position[0] = 1; await f.refreshSnapshot();
    await expect(planNativeEditorTerrainAppend(f.options)).rejects.toThrow("identity transforms");
    const g = await fixture(); Object.assign(g.snapshot.mesh.meshes[0]!, { parentId: "unverified-parent" }); await g.refreshSnapshot();
    await expect(planNativeEditorTerrainAppend(g.options)).rejects.toThrow("identity transforms");
    const h = await fixture(); h.geometry.positions[0] = 0; h.geometry.channelBytes.positions = Buffer.from(new Float32Array(h.geometry.positions).buffer).toString("base64"); await h.refreshSnapshot();
    await expect(planNativeEditorTerrainAppend(h.options)).rejects.toThrow("absolute source grid");
  });

  it("rejects missing/extraneous channels, byte mismatches, skeletons and animations", async () => {
    const f = await fixture(); f.geometry.normals[0] = .5; await f.refreshSnapshot();
    await expect(planNativeEditorTerrainAppend(f.options)).rejects.toThrow("bytes/numbers differ");
    const g = await fixture(); Object.assign(g.geometry, { tangents: [1, 0, 0, 1] }); await g.refreshSnapshot();
    await expect(planNativeEditorTerrainAppend(g.options)).rejects.toThrow("unsupported geometry");
    const h = await fixture(); Object.assign(h.snapshot.mesh, { skeletons: [{ id: 1 }] }); await h.refreshSnapshot();
    await expect(planNativeEditorTerrainAppend(h.options)).rejects.toThrow("mesh document");
    const j = await fixture(); Object.assign(j.snapshot.mesh.meshes[0]!, { animations: [{ name: "unexpected" }] }); await j.refreshSnapshot();
    await expect(planNativeEditorTerrainAppend(j.options)).rejects.toThrow("animation");
    const k = await fixture(); Reflect.deleteProperty(k.geometry, "uvs2"); Reflect.deleteProperty(k.geometry.channelBytes, "uvs2"); await k.refreshSnapshot();
    await expect(planNativeEditorTerrainAppend(k.options)).rejects.toThrow("requires exact UV2");
  });

  it("validates every packed byte instead of trusting the Editor helper", async () => {
    const f = await fixture(), corrupt = fixtureHelper.replace('fs.writeFileSync(path,Buffer.concat(chunks));', 'const result=Buffer.concat(chunks);result.writeFloatLE(0.5,3264);fs.writeFileSync(path,result);');
    const before = await files(f.root);
    await expect(planNativeEditorTerrainAppend({ ...f.options, geometryHelperSource: corrupt })).rejects.toThrow("exact channel normals"); expect(await files(f.root)).toEqual(before);
  });

  it("guards concurrent file/directory additions and private plan data", async () => {
    const f = await fixture(), plan = await planNativeEditorTerrainAppend(f.options);
    await f.write(`${SCENE}/meshes/concurrent.json`, json({ meshes: [{ id: "concurrent" }] })); const before = await files(f.root);
    await expect(applyNativeEditorTerrainAppend(plan)).rejects.toThrow("directory changed"); expect(await files(f.root)).toEqual(before);
    const g = await fixture(), changed = await planNativeEditorTerrainAppend(g.options);
    await g.write(g.texturePath, Buffer.from("new texture author work"));
    await expect(applyNativeEditorTerrainAppend(changed)).rejects.toThrow("input changed after planning");
    const h = await fixture(), privatePlan = await planNativeEditorTerrainAppend(h.options); privatePlan.writes[0].bytes.fill(0); privatePlan.summary.patchId = "forged";
    const receipt = await applyNativeEditorTerrainAppend(privatePlan);
    expect(receipt.patchId).toBe(h.snapshot.nativeTerrainPatch.id);
    expect(hash(await fs.readFile(join(h.root, receipt.newRecords[0].geometryPath)))).toBe(receipt.newRecords[0].geometrySha256);
  });

  it("rejects directory additions during planning instead of replacing the first guard", async () => {
    const f = await fixture(), path = `${SCENE}/geometries/concurrent.bin`, before = await files(f.root);
    const concurrent = fixtureHelper.replace("const chunks=[]", `fs.writeFileSync(${JSON.stringify(join(f.root, path))}, 'new author work');const chunks=[]`);
    await expect(planNativeEditorTerrainAppend({ ...f.options, geometryHelperSource: concurrent })).rejects.toThrow("directory changed during planning");
    expect(await files(f.root)).toEqual({ ...before, [path]: Buffer.from("new author work") });
  });

  it("rejects conflicting IDs and changed proof signatures even with freshly pinned files", async () => {
    const f = await fixture(), initial = await planNativeEditorTerrainAppend(f.options);
    await f.write(`${SCENE}/meshes/conflict.json`, json({ meshes: [{ id: initial.summary.meshId, uniqueId: 2 ** 48 + 55 }] }));
    const before = await files(f.root);
    await expect(planNativeEditorTerrainAppend(f.options)).rejects.toThrow("collides with authored"); expect(await files(f.root)).toEqual(before);
    const g = await fixture(); g.proof.meshes[0].channels.uvs.sha256 = "f".repeat(64); const proofBytes = json(g.proof);
    await g.write(`${SCENE}.native-editor-channels.json`, proofBytes); g.options.baseChannelsSha256 = hash(proofBytes);
    await expect(planNativeEditorTerrainAppend(g.options)).rejects.toThrow("uvs proof differs");
  });

  it("rolls back a failed append without leaving geometry or proof edits", async () => {
    const f = await fixture(), before = await files(f.root), plan = await planNativeEditorTerrainAppend(f.options), meshPath = plan.summary.newRecords[0].path;
    const write = fs.writeFile.bind(fs); let injected = false;
    vi.spyOn(fs, "writeFile").mockImplementation(async (...args: Parameters<typeof fs.writeFile>) => {
      if (!injected && basename(String(args[0])) === basename(meshPath)) { injected = true; throw Error("injected terrain write failure"); }
      return write(...args);
    });
    await expect(applyNativeEditorTerrainAppend(plan)).rejects.toThrow("injected terrain write failure"); expect(injected).toBe(true); expect(await files(f.root)).toEqual(before);
  });

  it("joins the added UV2 proof to the correct mesh and restores only demonstrably lost UV2", async () => {
    const f = await fixture(), receipt = await applyNativeEditorTerrainAppend(await planNativeEditorTerrainAppend(f.options));
    await removePatchUv2(f, receipt); const baseBefore = await fs.readFile(join(f.root, `${SCENE}/meshes/${BASE}.json`));
    const restored = await preserveNativeEditorUv2({ projectRoot: f.root });
    expect(restored.preserved).toContain(BASE); expect(restored.restored).toHaveLength(1); expect(restored.restored[0].meshId).toBe(receipt.meshId);
    expect(restored.restored[0].uv2Sha256).toBe(hash(Buffer.from(f.geometry.channelBytes.uvs2!, "base64")));
    expect(await fs.readFile(join(f.root, `${SCENE}/meshes/${BASE}.json`))).toEqual(baseBefore);
    const beforeRepeat = await files(f.root); await preserveNativeEditorUv2({ projectRoot: f.root });
    await applyNativeEditorTerrainAppend(await planNativeEditorTerrainAppend(f.options)); expect(await files(f.root)).toEqual(beforeRepeat);
  });

  it("does not restore UV2 over changed primary UV and rejects partial prior append", async () => {
    const f = await fixture(), receipt = await applyNativeEditorTerrainAppend(await planNativeEditorTerrainAppend(f.options));
    await removePatchUv2(f, receipt, true); const before = await files(f.root);
    await expect(preserveNativeEditorUv2({ projectRoot: f.root })).rejects.toThrow("authored geometry changed"); expect(await files(f.root)).toEqual(before);
    await fs.unlink(join(f.root, receipt.newRecords[0].path));
    await expect(planNativeEditorTerrainAppend(f.options)).rejects.toThrow("partial/conflicting prior terrain");
  });
});
