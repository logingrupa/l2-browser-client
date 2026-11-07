import { createHash } from "node:crypto";
import { existsSync, promises as fs } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

const { planNativeEditorModelAppend, applyNativeEditorModelAppend } = await import(pathToFileURL(resolve("scripts/append-native-editor-model.mjs")).href);
const SCENE = "assets/native-world.scene", roots: string[] = [];
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const json = (value: unknown) => Buffer.from(JSON.stringify(value, null, 2) + "\n");
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const fixtureHelper = `const fs=require('fs'); exports.writeBinaryGeometry=async({mesh,geometry,path})=>{
 const chunks=[];let offset=0;
 for(const [key,desc,stride,Type] of [['positions','positionsAttrDesc',3,Float32Array],['normals','normalsAttrDesc',3,Float32Array],['uvs','uvsAttrDesc',2,Float32Array],['indices','indicesAttrDesc',1,Int32Array]]){
  const bytes=Buffer.from(new Type(geometry[key]).buffer);chunks.push(bytes);mesh._binaryInfo[desc]={count:geometry[key].length,stride,offset,dataType:Type===Float32Array?1:0};offset+=bytes.length;
 }
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
  const root = await fs.mkdtemp(join(tmpdir(), "native-editor-model-test-")); roots.push(root);
  const write = async (path: string, bytes: Buffer) => { await fs.mkdir(dirname(join(root, path)), { recursive: true }); await fs.writeFile(join(root, path), bytes); };
  const base = { schemaVersion: 1, kind: "native-map-section-runtime", models: [{ id: "interlude:old" }], placements: [{ id: "interlude:20_20.old" }],
    terrain: { sha256: "a".repeat(64), uv2Proof: "preserve" }, bsp: [{ id: "floor" }], derivation: { uvCorrection: "closed" }, coverage: { old: 1 }, gaps: ["existing gap"] };
  const baseManifestSha256 = hash(json(base));
  const model = { id: "interlude:trees.test", sourceObject: "trees.test", model: { file: `${"b".repeat(64)}/model.glb`, bytes: 1234, sha256: "c".repeat(64) },
    archive: { file: `${"b".repeat(64)}/asset.l2asset`, bytes: 2234, sha256: "b".repeat(64) }, limitations: ["native lighting unresolved"] };
  const placement = { id: "interlude:20_20.StaticMeshActor3703", modelId: model.id, sourceMesh: "Trees.test", materialOverrides: [],
    matrix: [...identity.slice(0, 12), 146.17673828125, -26.24932373046875, 975.437265625, 1] };
  const next = { ...structuredClone(base), models: [...base.models, model], placements: [...base.placements, placement],
    derivation: { ...base.derivation, newModelOverlap: { verified: true } }, coverage: { ...base.coverage, added: 1 }, gaps: [...base.gaps, "native pixels unverified"] };
  const world = { id: "world", uniqueId: 2 ** 48 + 1, type: "TransformNode", position: [0, 0, 0], scaling: [1, 1, -1],
    metadata: { nativeWorldRoot: { schemaVersion: 1, manifestSha256: baseManifestSha256, manifest: base }, authoredSetting: 73 } };
  const oldMaterial = { id: "old-material", uniqueId: 2 ** 48 + 3, roughness: .73, metadata: { gltf: { extras: { nativeSourceReference: "Trees.Old" } } } };
  await write(`${SCENE}/nodes/world.json`, json(world));
  await write(`${SCENE}/meshes/old-mesh.json`, json({ meshes: [{ id: "old-mesh", uniqueId: 2 ** 48 + 2, position: [7, 8, 9] }], materials: [oldMaterial] }));
  await write(`${SCENE}/geometries/original.bin`, Buffer.from("authored originals remain"));
  await write(`${SCENE}/config.json`, Buffer.from(`{ "camera":{"radius":14.8}, "metadata":{"nativeEditorImport":{"targetScene":"${SCENE}","manifestSha256":"${baseManifestSha256}"}} }\r\n`));
  await write(`${SCENE}.native-editor-channels.json`, Buffer.from(`{ "schemaVersion":1, "kind":"native-editor-channels", "manifestSha256":"${baseManifestSha256}", "meshes":[{"primary":"unchanged","uv2":"unchanged"}] }\r\n`));
  await write(`public/l2/maps/${baseManifestSha256}/map-section-runtime/manifest.json`, json(base));
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jH1sAAAAASUVORK5CYII=", "base64");
  const texturePath = `assets/native-generated/${model.archive.sha256}/${hash(png)}.png`;
  const material = { id: "new-material", uniqueId: 2 ** 48 + 13, customType: "BABYLON.PBRMaterial", metallic: 0, roughness: 1,
    albedoTexture: { name: texturePath, url: texturePath, samplingMode: 3, invertY: false, gammaSpace: true },
    metadata: { gltf: { extras: { nativeSourceReference: "Trees.New" } } } };
  const node = { id: "new-root", uniqueId: 2 ** 48 + 11, name: placement.id, type: "TransformNode", position: [0, 0, 0], rotation: [0, 0, 0], scaling: [1, 1, 1],
    localMatrix: placement.matrix.map(Math.fround), metadata: { nativePlacement: placement } };
  const positions = [0, 0, 0, 1, 0, 0, 0, 0, 1], normals = [-0, 1, 0, 0, 1, -0, 0, 1, 0], uvs = [0, 0, 1, 0, 0, 1], indices = [0, 2, 1];
  const channelBytes = { positions: Buffer.from(new Float32Array(positions).buffer).toString("base64"), normals: Buffer.from(new Float32Array(normals).buffer).toString("base64"),
    uvs: Buffer.from(new Float32Array(uvs).buffer).toString("base64"), indices: Buffer.from(new Int32Array(indices).buffer).toString("base64") };
  const mesh = { id: "new-mesh", uniqueId: 2 ** 48 + 12, name: "new_primitive", type: "Mesh", position: [0, 0, 0], rotation: [0, 0, 0], scaling: [1, 1, 1],
    localMatrix: identity, geometryId: "new-geometry", geometryUniqueId: 2 ** 48 + 14, materialId: material.id, materialUniqueId: material.uniqueId,
    sideOrientation: 0, metadata: { parentId: node.uniqueId, nativeEditorSource: { sideOrientation: 1 } }, instances: [], animations: [], ranges: [],
    subMeshes: [{ materialIndex: 0, verticesStart: 0, verticesCount: 3, indexStart: 0, indexCount: 3 }] };
  const snapshot = { schemaVersion: 1, kind: "native-editor-model-snapshot", baseManifestSha256, model, placement, placementRootId: node.id,
    nodes: [node], meshes: [{ meshes: [mesh], materials: [material], transformNodes: [], basePoseMatrix: identity,
      geometries: { vertexData: [{ id: mesh.geometryId, uniqueId: mesh.geometryUniqueId, positions, normals, uvs, indices, channelBytes }] } }],
    textures: [{ path: texturePath, sha256: hash(png), bytes: png.length, base64: png.toString("base64") }] };
  const snapshotPath = "artifacts/model-snapshot.json", nextManifestPath = "artifacts/next-manifest.json";
  await write(snapshotPath, json(snapshot)); await write(nextManifestPath, json(next));
  const options = { projectRoot: root, snapshotPath, snapshotSha256: hash(json(snapshot)), nextManifestPath, nextManifestSha256: hash(json(next)),
    expectedBaseManifestSha256: baseManifestSha256, ...helper };
  const refreshSnapshot = async () => { const bytes = json(snapshot); await write(snapshotPath, bytes); options.snapshotSha256 = hash(bytes); };
  const refreshManifest = async () => { const bytes = json(next); await write(nextManifestPath, bytes); options.nextManifestSha256 = hash(bytes); };
  return { root, write, options, snapshot, next, world, base, refreshSnapshot, refreshManifest, png, texturePath };
}

afterEach(async () => {
  vi.restoreAllMocks(); const parent = await fs.realpath(tmpdir());
  for (const path of roots.splice(0)) { const actual = await fs.realpath(path); if (dirname(actual) !== parent || !basename(actual).startsWith("native-editor-model-test-")) throw Error("Unexpected fixture cleanup path."); await fs.rm(actual, { recursive: true, force: true }); }
});

describe("new-model additive Editor migration", () => {
  it("packs exact channels including signed zero and preserves existing authored bytes", async () => {
    const f = await fixture(), before = await files(f.root), plan = await planNativeEditorModelAppend(f.options);
    expect(await files(f.root)).toEqual(before); expect(plan.summary.status).toBe("planned");
    const receipt = await applyNativeEditorModelAppend(plan, { receiptPath: "artifacts/apply-receipt.json" });
    expect(receipt.status).toBe("applied"); expect(receipt.newRecords).toHaveLength(2);
    const packed = receipt.newRecords.find((row: { nodeId: string }) => row.nodeId === "new-mesh");
    const record = JSON.parse(await fs.readFile(join(f.root, packed.path), "utf8")), binary = await fs.readFile(join(f.root, packed.geometryPath));
    expect(hash(binary)).toBe(packed.geometrySha256);
    for (const [key, descriptor] of [["positions", "positionsAttrDesc"], ["normals", "normalsAttrDesc"], ["uvs", "uvsAttrDesc"], ["indices", "indicesAttrDesc"]] as const) {
      const desc = record.meshes[0]._binaryInfo[descriptor], expected = Buffer.from(f.snapshot.meshes[0]!.geometries.vertexData[0]!.channelBytes[key], "base64");
      expect(binary.subarray(desc.offset, desc.offset + expected.length)).toEqual(expected);
    }
    expect(binary.readUInt32LE(record.meshes[0]._binaryInfo.normalsAttrDesc.offset)).toBe(0x80000000);
    const after = await files(f.root);
    const changed = Object.keys(before).filter(path => !before[path]!.equals(after[path]!));
    expect(changed.sort()).toEqual([`${SCENE}/config.json`, `${SCENE}/nodes/world.json`, `${SCENE}.native-editor-channels.json`].sort());
    expect(after[f.texturePath]).toEqual(f.png);
    const proof = `${SCENE}.native-editor-channels.json`;
    expect(after[proof]!.toString()).toBe(before[proof]!.toString().replace(f.options.expectedBaseManifestSha256, f.options.nextManifestSha256));
    const root = JSON.parse(after[`${SCENE}/nodes/new-root.json`]!.toString());
    expect(root.metadata.parentId).toBe(f.world.uniqueId); expect(root.metadata.nativePlacement).toEqual(f.snapshot.placement);
  });

  it("preserves later authored transforms, materials and geometry on repeat", async () => {
    const f = await fixture(); await applyNativeEditorModelAppend(await planNativeEditorModelAppend(f.options));
    const rootPath = `${SCENE}/nodes/new-root.json`, meshPath = `${SCENE}/meshes/new-mesh.json`;
    const root = JSON.parse(await fs.readFile(join(f.root, rootPath), "utf8")), mesh = JSON.parse(await fs.readFile(join(f.root, meshPath), "utf8"));
    root.position = [4, 5, 6]; mesh.materials[0].roughness = .21; mesh.meshes[0].scaling = [2, 3, 4];
    await f.write(rootPath, json(root)); await f.write(meshPath, json(mesh));
    await f.write(mesh.meshes[0].delayLoadingFile, Buffer.from("later authored geometry remains"));
    const before = await files(f.root), repeated = await planNativeEditorModelAppend(f.options);
    expect(repeated.summary.status).toBe("preserved"); expect(repeated.writes).toEqual([]);
    await applyNativeEditorModelAppend(repeated); expect(await files(f.root)).toEqual(before);
  });

  it("rejects unrelated terrain/BSP and existing model changes before writes", async () => {
    const f = await fixture(); f.next.terrain.sha256 = "f".repeat(64); await f.refreshManifest(); const before = await files(f.root);
    await expect(planNativeEditorModelAppend(f.options)).rejects.toThrow("unrelated manifest change"); expect(await files(f.root)).toEqual(before);
    f.next.terrain.sha256 = f.base.terrain.sha256; f.next.models[0] = { id: "interlude:changed" }; await f.refreshManifest();
    await expect(planNativeEditorModelAppend(f.options)).rejects.toThrow("additive models");
  });

  it("rejects exact-channel mismatches instead of accepting JSON-rounded or guessed data", async () => {
    const f = await fixture(); const geometry = f.snapshot.meshes[0]!.geometries.vertexData[0]!;
    geometry.normals[1] = .5; await f.refreshSnapshot(); const before = await files(f.root);
    await expect(planNativeEditorModelAppend(f.options)).rejects.toThrow("bytes/numbers differ"); expect(await files(f.root)).toEqual(before);
  });

  it("requires a separate proof for any new UV2 channel", async () => {
    const f = await fixture(), geometry = f.snapshot.meshes[0]!.geometries.vertexData[0]!;
    Object.assign(geometry, { uvs2: [...geometry.uvs] });
    Object.assign(geometry.channelBytes, { uvs2: geometry.channelBytes.uvs }); await f.refreshSnapshot();
    const before = await files(f.root);
    await expect(planNativeEditorModelAppend(f.options)).rejects.toThrow("separate channel-proof migration");
    expect(await files(f.root)).toEqual(before);
  });

  it("rejects changed helper output and uncovered geometry bytes", async () => {
    const f = await fixture(); const corrupt = fixtureHelper.replace('fs.writeFileSync(path,Buffer.concat(chunks));', 'const result=Buffer.concat(chunks);result.writeFloatLE(0.5,36);fs.writeFileSync(path,result);');
    await expect(planNativeEditorModelAppend({ ...f.options, geometryHelperSource: corrupt })).rejects.toThrow("exact channel normals");
    const extra = fixtureHelper.replace('Buffer.concat(chunks)', 'Buffer.concat([...chunks,Buffer.from([0,0,0,0])])');
    await expect(planNativeEditorModelAppend({ ...f.options, geometryHelperSource: extra })).rejects.toThrow("uncovered/overlapping");
  });

  it("rejects disconnected graph and conflicting authored identity/material source", async () => {
    const f = await fixture(); f.snapshot.meshes[0]!.meshes[0]!.metadata.parentId = 2 ** 48 + 999; await f.refreshSnapshot();
    await expect(planNativeEditorModelAppend(f.options)).rejects.toThrow("outside new graph");
    f.snapshot.meshes[0]!.meshes[0]!.metadata.parentId = f.snapshot.nodes[0]!.uniqueId;
    f.snapshot.meshes[0]!.materials[0]!.metadata.gltf.extras.nativeSourceReference = "TREES.OLD"; await f.refreshSnapshot();
    await expect(planNativeEditorModelAppend(f.options)).rejects.toThrow("already has an authored binding");
    f.snapshot.meshes[0]!.materials[0]!.metadata.gltf.extras.nativeSourceReference = "Trees.New";
    f.snapshot.meshes[0]!.meshes[0]!.id = "old-mesh"; await f.refreshSnapshot();
    await expect(planNativeEditorModelAppend(f.options)).rejects.toThrow("collides with authored");
  });

  it("guards concurrent authored changes and scene identity additions before commit", async () => {
    const f = await fixture(), plan = await planNativeEditorModelAppend(f.options);
    await f.write(`${SCENE}/meshes/old-mesh.json`, Buffer.from("new author work")); const changed = await files(f.root);
    await expect(applyNativeEditorModelAppend(plan)).rejects.toThrow("input changed after planning"); expect(await files(f.root)).toEqual(changed);
    const g = await fixture(), other = await planNativeEditorModelAppend(g.options);
    await g.write(`${SCENE}/nodes/other.json`, json({ id: "other" })); const added = await files(g.root);
    await expect(applyNativeEditorModelAppend(other)).rejects.toThrow("directory changed"); expect(await files(g.root)).toEqual(added);
  });

  it("does not replace an earlier directory guard after a concurrent planning-time addition", async () => {
    const f = await fixture(), newPath = `${SCENE}/meshes/concurrent.json`, before = await files(f.root);
    const concurrentHelper = fixtureHelper.replace("const chunks=[]", `fs.writeFileSync(${JSON.stringify(join(f.root, newPath))}, '{}');const chunks=[]`);
    await expect(planNativeEditorModelAppend({ ...f.options, geometryHelperSource: concurrentHelper })).rejects.toThrow("directory changed during planning");
    expect(await files(f.root)).toEqual({ ...before, [newPath]: Buffer.from("{}") });
  });

  it("does not trust mutation of a returned plan", async () => {
    const f = await fixture(), plan = await planNativeEditorModelAppend(f.options);
    plan.writes[0].bytes.fill(0); plan.summary.modelId = "forged";
    const receipt = await applyNativeEditorModelAppend(plan);
    expect(receipt.modelId).toBe(f.snapshot.model.id); expect(await fs.readFile(join(f.root, f.texturePath))).toEqual(f.png);
    await expect(applyNativeEditorModelAppend(plan)).rejects.toThrow("fresh plan");
  });

  it("rolls back only owned writes on a failed commit", async () => {
    const f = await fixture(), before = await files(f.root), plan = await planNativeEditorModelAppend(f.options);
    const write = fs.writeFile.bind(fs); let injected = false;
    vi.spyOn(fs, "writeFile").mockImplementation(async (...args: Parameters<typeof fs.writeFile>) => {
      if (!injected && basename(String(args[0])) === "new-mesh.json") { injected = true; throw Error("injected output failure"); }
      return write(...args);
    });
    await expect(applyNativeEditorModelAppend(plan)).rejects.toThrow("injected output failure"); expect(injected).toBe(true);
    expect(await files(f.root)).toEqual(before);
  });

  it("accepts model-hash texture directories but rejects unrelated hashes", async () => {
    const f = await fixture(), path = `assets/native-generated/model-${f.snapshot.model.model.sha256}/${hash(f.png)}.png`;
    f.snapshot.textures[0]!.path = path;
    Object.assign(f.snapshot.meshes[0]!.materials[0]!.albedoTexture, { name: path, url: path }); await f.refreshSnapshot();
    const before = await files(f.root), plan = await planNativeEditorModelAppend(f.options);
    expect(plan.writes.some((write: { path: string }) => write.path === path)).toBe(true); expect(await files(f.root)).toEqual(before);
    const unrelated = path.replace(f.snapshot.model.model.sha256, "d".repeat(64));
    f.snapshot.textures[0]!.path = unrelated;
    Object.assign(f.snapshot.meshes[0]!.materials[0]!.albedoTexture, { name: unrelated, url: unrelated }); await f.refreshSnapshot();
    await expect(planNativeEditorModelAppend(f.options)).rejects.toThrow("texture descriptor");
  });

  it("rejects texture corruption, escaping output names and partial prior applies", async () => {
    const f = await fixture(); f.snapshot.textures[0]!.base64 = Buffer.from("bad PNG").toString("base64"); await f.refreshSnapshot();
    await expect(planNativeEditorModelAppend(f.options)).rejects.toThrow("texture identity differs");
    f.snapshot.textures[0]!.base64 = f.png.toString("base64"); f.snapshot.textures[0]!.path = "../outside.png"; await f.refreshSnapshot();
    await expect(planNativeEditorModelAppend(f.options)).rejects.toThrow("texture descriptor");
    const g = await fixture(); await applyNativeEditorModelAppend(await planNativeEditorModelAppend(g.options));
    await fs.unlink(join(g.root, `${SCENE}/meshes/new-mesh.json`));
    await expect(planNativeEditorModelAppend(g.options)).rejects.toThrow("partial prior model graph");
  });
});
