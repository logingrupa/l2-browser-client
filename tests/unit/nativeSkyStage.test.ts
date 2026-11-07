import { createHash } from "node:crypto";
import { existsSync, promises as fs } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

const { planNativeSkyStage, applyNativeSkyStage, SKY_MANIFEST_SHA256 } = await import(pathToFileURL(resolve("scripts/stage-native-sky.mjs")).href);
const SOURCE = resolve("artifacts/native-parity/research/native-sky-20261106/source-snapshot-pinned");
const SCENE = "assets/native-world.scene", STAGED = `public/l2/skies/${SKY_MANIFEST_SHA256}`, roots: string[] = [];
const json = (value: unknown) => Buffer.from(JSON.stringify(value, null, 2) + "\n");
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
// Real frozen local snapshot, never fabricated source hashes. On machines without
// the private source evidence these tests explicitly skip instead of claiming it.
const fixtureHelper = `const fs=require('fs');exports.writeBinaryGeometry=async({mesh,geometry,path})=>{
const chunks=[];let offset=0;
for(const [key,desc,stride,Type] of [['positions','positionsAttrDesc',3,Float32Array],['normals','normalsAttrDesc',3,Float32Array],['uvs','uvsAttrDesc',2,Float32Array],['indices','indicesAttrDesc',1,Int32Array]]){
const bytes=Buffer.from(new Type(geometry[key]).buffer);chunks.push(bytes);mesh._binaryInfo[desc]={count:geometry[key].length,stride,offset,dataType:Type===Float32Array?1:0};offset+=bytes.length;}
const sub=mesh.subMeshes.flatMap(s=>[s.materialIndex,s.verticesStart,s.verticesCount,s.indexStart,s.indexCount]);
mesh._binaryInfo.subMeshesAttrDesc={count:mesh.subMeshes.length,stride:5,offset,dataType:0};mesh.subMeshes=null;
chunks.push(Buffer.from(new Int32Array(sub).buffer));fs.writeFileSync(path,Buffer.concat(chunks));};`;
const helper = existsSync(join(homedir(), "AppData/Local/Programs/BabylonJS Editor/resources/app.asar")) ? {} : { geometryHelperSource: fixtureHelper };

async function files(root: string) {
  const result: Record<string, Buffer> = {};
  async function visit(path: string, prefix: string) {
    for (const entry of await fs.readdir(path, { withFileTypes: true })) {
      if (entry.isDirectory()) await visit(join(path, entry.name), `${prefix}${entry.name}/`);
      else result[prefix + entry.name] = await fs.readFile(join(path, entry.name));
    }
  }
  await visit(root, ""); return result;
}

async function fixture() {
  const root = await fs.mkdtemp(join(tmpdir(), "native-sky-stage-test-")); roots.push(root);
  const write = async (path: string, bytes: Buffer) => { await fs.mkdir(dirname(join(root, path)), { recursive: true }); await fs.writeFile(join(root, path), bytes); };
  await fs.mkdir(join(root, "artifacts/source"), { recursive: true });
  for (const file of await fs.readdir(SOURCE)) await fs.copyFile(join(SOURCE, file), join(root, "artifacts/source", file));
  const snapshot = JSON.parse(await fs.readFile(join(root, "artifacts/source/sky.json"), "utf8"));
  await write(`${SCENE}/nodes/world.json`, json({ id: "world", uniqueId: 2 ** 48 + 1, type: "TransformNode", position: [0, 0, 0], scaling: [1, 1, -1],
    metadata: { nativeWorldRoot: { schemaVersion: 1, manifestSha256: "a".repeat(64), authored: "retain" } } }));
  await write(`${SCENE}/meshes/terrain.json`, json({ meshes: [{ id: "terrain", uniqueId: 2 ** 48 + 2, geometryId: "terrain-geometry", geometryUniqueId: 2 ** 48 + 3,
    materialId: "terrain-material", materialUniqueId: 2 ** 48 + 4, position: [10, 20, 30] }], materials: [{ id: "terrain-material", uniqueId: 2 ** 48 + 4, albedo: [.2, .3, .4] }] }));
  await write(`${SCENE}/geometries/original.babylonbinarymeshdata`, Buffer.from("retain corrected UV and UV2 and every original byte"));
  await write(`${SCENE}/config.json`, Buffer.from('{ "camera": {"radius":14.8}, "authored": true }\r\n'));
  await write(`${SCENE}.native-editor-channels.json`, Buffer.from('{ "primary": "d549356f", "uv2": "4c6a9644" }\r\n'));
  return { root, write, snapshot, options: { projectRoot: root, sourcePath: "artifacts/source", ...helper } };
}

afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) {
    const actual = await fs.realpath(root);
    if (dirname(actual) !== await fs.realpath(tmpdir()) || !basename(actual).startsWith("native-sky-stage-test-")) throw Error("Unexpected test cleanup path");
    await fs.rm(actual, { recursive: true, force: true });
  }
});

describe.skipIf(!existsSync(SOURCE))("native sky immutable stage and additive Editor append (local frozen evidence)", () => {
  it("plans without writes, stages all 21 verified files, and preserves every existing authored byte", async () => {
    const f = await fixture(), before = await files(f.root), plan = await planNativeSkyStage(f.options);
    expect(await files(f.root)).toEqual(before); expect(plan.summary.sourceFiles).toBe(21);
    expect(plan.summary.counts).toEqual({ materialRoots: 3, nodes: 53, textures: 3, triangles: 76, vertices: 182 });
    const receipt = await applyNativeSkyStage(plan, { receiptPath: "artifacts/receipt.json" });
    expect(receipt.status).toBe("applied"); expect(receipt.newRecords).toHaveLength(3); expect(receipt.additions).toHaveLength(32);
    const after = await files(f.root);
    for (const [path, bytes] of Object.entries(before)) expect(after[path], path).toEqual(bytes);
    for (const file of await fs.readdir(SOURCE)) expect(after[`${STAGED}/${file}`]).toEqual(before[`artifacts/source/${file}`]);
    for (const addition of receipt.additions) expect(hash(after[addition.path]!)).toBe(addition.sha256);
    expect(JSON.parse(after["artifacts/receipt.json"]!.toString())).toEqual(receipt);
  });

  it("keeps exact signed-zero channel bits, one origin translation and a separate LH authoring wrapper", async () => {
    const f = await fixture(), receipt = await applyNativeSkyStage(await planNativeSkyStage(f.options), { receiptPath: "artifacts/initial-receipt.json" });
    const root = JSON.parse(await fs.readFile(join(f.root, SCENE, `nodes/${receipt.rootId}.json`), "utf8"));
    const origin = JSON.parse(await fs.readFile(join(f.root, SCENE, `nodes/${receipt.originId}.json`), "utf8"));
    expect(root.scaling).toEqual([1, 1, -1]); expect(root.position).toEqual([0, 0, 0]);
    expect(root.metadata.parentId).toBeUndefined(); expect(root.parentId).toBeUndefined();
    expect(root.metadata.nativeSkyRoot.sourceId).toBe(f.snapshot.id);
    expect(origin.metadata.parentId).toBe(root.uniqueId); expect(origin.position).toEqual(f.snapshot.rootTranslationMetres);
    expect(origin.scaling).toEqual([1, 1, 1]);
    let negativeZeroCount = 0;
    for (const [index, row] of receipt.newRecords.entries()) {
      const doc = JSON.parse(await fs.readFile(join(f.root, row.path), "utf8")), mesh = doc.meshes[0], part = f.snapshot.parts[index];
      const binary = await fs.readFile(join(f.root, row.geometryPath));
      expect(mesh.metadata.parentId).toBe(origin.uniqueId); expect(mesh.position).toEqual([0, 0, 0]);
      expect(mesh.scaling).toEqual([1, 1, 1]); expect(mesh.sideOrientation).toBe(0);
      expect(mesh.metadata.nativeEditorSource.sideOrientation).toBe(1); expect(hash(binary)).toBe(row.geometrySha256);
      for (const [key, desc, Type] of [["positions", "positionsAttrDesc", Float32Array], ["normals", "normalsAttrDesc", Float32Array],
        ["uvs", "uvsAttrDesc", Float32Array], ["indices", "indicesAttrDesc", Int32Array]] as const) {
        const info = mesh._binaryInfo[desc], expected = Buffer.from(new Type(part[key]).buffer);
        expect(binary.subarray(info.offset, info.offset + expected.length)).toEqual(expected);
        negativeZeroCount += part[key].filter((value: number) => Object.is(value, -0)).length;
      }
      const mat = doc.materials[0]; expect(mat.customType).toBe("BABYLON.PBRMaterial"); expect(mat.unlit).toBe(true);
      expect(mat.albedo).toEqual(part.authoredColorRGBA.slice(0, 3).map((value: number) => value / 255));
      expect(mat.alpha).toBe(part.authoredColorRGBA[3] / 255); expect(mat.transparencyMode).toBe(part.alphaBlend ? 2 : 0);
      expect(mat.albedoTexture.invertY).toBe(false); expect(mat.albedoTexture.noMipmap).toBe(false);
      expect(mat.albedoTexture._useSRGBBuffer).toBe(true);
      expect(hash(await fs.readFile(join(f.root, mat.albedoTexture.url)))).toBe(part.texture.png.sha256);
      expect(doc.geometries.vertexData).toEqual([]);
    }
    expect(negativeZeroCount).toBeGreaterThan(0);
    expect(receipt.geometryHelper.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("matches the actual glTF loader defaults of the frozen source sampler", async () => {
    const { GLTFLoader } = await import("@babylonjs/loaders/glTF/2.0/glTFLoader.js");
    const f = await fixture(), plan = await planNativeSkyStage(f.options);
    const glb = await fs.readFile(join(SOURCE, "sky.glb"));
    const gltf = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString("utf8"));
    expect(gltf.samplers).toEqual([{ wrapS: 10497, wrapT: 10497 }]);
    const prototype = GLTFLoader.prototype as unknown as { _loadSampler(context: string, sampler: object): { noMipMaps: boolean; samplingMode: number; wrapU: number; wrapV: number } };
    const actual = prototype._loadSampler.call({}, "/samplers/0", gltf.samplers[0]);
    for (const row of plan.summary.newRecords) {
      const mat = JSON.parse(plan.writes.find((write: { path: string }) => write.path === row.path).bytes).materials[0];
      expect(mat.albedoTexture.noMipmap).toBe(actual.noMipMaps);
      expect(mat.albedoTexture.samplingMode).toBe(actual.samplingMode);
      expect(mat.albedoTexture.wrapU).toBe(actual.wrapU); expect(mat.albedoTexture.wrapV).toBe(actual.wrapV);
    }
    expect(plan.summary.previewPresentation.nativeSamplingVerified).toBe(false);
  });

  it("is idempotent while retaining later authored transforms, materials and geometry", async () => {
    const f = await fixture(), receipt = await applyNativeSkyStage(await planNativeSkyStage(f.options), { receiptPath: "artifacts/initial-receipt.json" });
    const row = receipt.newRecords[0], doc = JSON.parse(await fs.readFile(join(f.root, row.path), "utf8"));
    doc.meshes[0].position = [1, 2, 3]; doc.materials[0].albedo = [.1, .2, .3];
    await f.write(row.path, json(doc)); await f.write(row.geometryPath, Buffer.from("newer authored geometry"));
    const rootPath = `${SCENE}/nodes/${receipt.rootId}.json`, root = JSON.parse(await fs.readFile(join(f.root, rootPath), "utf8"));
    root.position = [5, 6, 7]; await f.write(rootPath, json(root));
    const before = await files(f.root), plan = await planNativeSkyStage(f.options);
    expect(plan.summary.status).toBe("preserved"); expect(plan.writes).toEqual([]);
    expect((await applyNativeSkyStage(plan, { receiptPath: "artifacts/no-new-receipt.json" })).status).toBe("preserved");
    expect((await applyNativeSkyStage(await planNativeSkyStage(f.options), { receiptPath: "artifacts/initial-receipt.json" })).status).toBe("preserved");
    expect(await files(f.root)).toEqual(before);
  });

  it("rejects changed source manifest, payload and file census before any additions", async () => {
    const f = await fixture(); await f.write("artifacts/source/WhiteChip.png", Buffer.from("corrupt source"));
    await expect(planNativeSkyStage(f.options)).rejects.toThrow("payload hash/size mismatch");
    await f.write("artifacts/source/WhiteChip.png", await fs.readFile(join(SOURCE, "WhiteChip.png")));
    await f.write("artifacts/source/extra.txt", Buffer.from("unexpected source"));
    await expect(planNativeSkyStage(f.options)).rejects.toThrow("file set differs");
    await fs.unlink(join(f.root, "artifacts/source/extra.txt"));
    await f.write("artifacts/source/manifest.json", Buffer.from((await fs.readFile(join(SOURCE, "manifest.json"), "utf8")) + " "));
    await expect(planNativeSkyStage(f.options)).rejects.toThrow("manifest differs");
    expect(await fs.readdir(join(f.root, SCENE, "meshes"))).toEqual(["terrain.json"]);
  });

  it("refuses partial staging and partial hierarchy rather than restoring snapshots", async () => {
    const f = await fixture(); await f.write(`${STAGED}/manifest.json`, await fs.readFile(join(SOURCE, "manifest.json")));
    await expect(planNativeSkyStage(f.options)).rejects.toThrow("staged snapshot is partial");
    const g = await fixture(), receipt = await applyNativeSkyStage(await planNativeSkyStage(g.options));
    await fs.unlink(join(g.root, receipt.newRecords[1].path));
    const before = await files(g.root);
    await expect(planNativeSkyStage(g.options)).rejects.toThrow("partial, conflicting or ambiguous");
    expect(await files(g.root)).toEqual(before);
  });

  it("refuses changed staged bytes and conflicting source markers on repeat", async () => {
    const f = await fixture(), receipt = await applyNativeSkyStage(await planNativeSkyStage(f.options));
    await f.write(`${STAGED}/WhiteChip.png`, Buffer.from("changed immutable payload"));
    await expect(planNativeSkyStage(f.options)).rejects.toThrow("immutable staged snapshot differs");
    await f.write(`${STAGED}/WhiteChip.png`, await fs.readFile(join(SOURCE, "WhiteChip.png")));
    const path = `${SCENE}/nodes/${receipt.rootId}.json`, root = JSON.parse(await fs.readFile(join(f.root, path), "utf8"));
    root.metadata.nativeSkyRoot.manifestSha256 = "f".repeat(64); await f.write(path, json(root));
    await expect(planNativeSkyStage(f.options)).rejects.toThrow("partial, conflicting or ambiguous");
  });

  it("rejects string/numeric identity collisions and conflicting generated binary paths", async () => {
    const f = await fixture(), plan = await planNativeSkyStage(f.options), row = plan.summary.newRecords[0];
    await f.write(`${SCENE}/nodes/collision.json`, json({ id: row.meshId, uniqueId: 33 }));
    await expect(planNativeSkyStage(f.options)).rejects.toThrow("identity collides");
    await fs.unlink(join(f.root, SCENE, "nodes/collision.json"));
    const mesh = JSON.parse(plan.writes.find((write: { path: string }) => write.path === row.path).bytes).meshes[0];
    await f.write(`${SCENE}/nodes/collision.json`, json({ id: "different-string", uniqueId: mesh.uniqueId }));
    await expect(planNativeSkyStage(f.options)).rejects.toThrow("identity collides");
    await fs.unlink(join(f.root, SCENE, "nodes/collision.json"));
    await f.write(row.geometryPath, Buffer.from("newer conflicting data"));
    await expect(planNativeSkyStage(f.options)).rejects.toThrow("conflicts with existing bytes");
  });

  it("refuses concurrent source/authored edits, new identities and changed output paths", async () => {
    const f = await fixture(), plan = await planNativeSkyStage(f.options);
    await f.write(`${SCENE}/config.json`, Buffer.from("another author saved"));
    await expect(applyNativeSkyStage(plan)).rejects.toThrow("input changed after planning");
    const g = await fixture(), next = await planNativeSkyStage(g.options);
    await g.write(`${SCENE}/nodes/concurrent.json`, json({ id: "concurrent", uniqueId: 91 }));
    await expect(applyNativeSkyStage(next)).rejects.toThrow("directory changed after planning");
    const h = await fixture(), last = await planNativeSkyStage(h.options);
    await h.write(last.summary.newRecords[0].geometryPath, Buffer.from("concurrent output"));
    await expect(applyNativeSkyStage(last)).rejects.toThrow("new output appeared after planning");
  });

  it("rolls back only its additions when a later exclusive write fails", async () => {
    const f = await fixture(), before = await files(f.root), plan = await planNativeSkyStage(f.options), originalWrite = fs.writeFile;
    vi.spyOn(fs, "writeFile").mockImplementation(async (path, data, options) => {
      if (String(path) === join(f.root, plan.summary.newRecords[1].path)) throw Error("simulated write failure");
      return originalWrite(path, data, options);
    });
    await expect(applyNativeSkyStage(plan)).rejects.toThrow("simulated write failure");
    expect(await files(f.root)).toEqual(before);
  });

  it("retains concurrent edits to its additions if rollback cannot safely remove them", async () => {
    const f = await fixture(), plan = await planNativeSkyStage(f.options), first = plan.summary.newRecords[0], originalWrite = fs.writeFile;
    vi.spyOn(fs, "writeFile").mockImplementation(async (path, data, options) => {
      if (String(path) === join(f.root, plan.summary.newRecords[1].path)) {
        await originalWrite(join(f.root, first.path), Buffer.from("concurrent authored bytes"));
        throw Error("simulated write failure");
      }
      return originalWrite(path, data, options);
    });
    await expect(applyNativeSkyStage(plan)).rejects.toThrow("concurrent edit retained");
    expect(await fs.readFile(join(f.root, first.path), "utf8")).toBe("concurrent authored bytes");
    expect(await fs.readFile(join(f.root, SCENE, "config.json"), "utf8")).toContain('"authored": true');
  });

  it("rejects escaped inputs, source junctions, and output junctions", async () => {
    const f = await fixture();
    await expect(planNativeSkyStage({ ...f.options, sourcePath: "../outside" })).rejects.toThrow("escapes project");
    await fs.symlink(join(f.root, "artifacts/source"), join(f.root, "linked-source"), "junction");
    await expect(planNativeSkyStage({ ...f.options, sourcePath: "linked-source" })).rejects.toThrow("symlink/junction refused");
    await fs.symlink(join(f.root, "artifacts"), join(f.root, "public"), "junction");
    await expect(planNativeSkyStage(f.options)).rejects.toThrow("symlink/junction refused");
  });

  it("does not trust tampered plans and consumes apply authority only once", async () => {
    const f = await fixture(), plan = await planNativeSkyStage(f.options), expected = plan.writes[0].bytes;
    plan.writes[0].bytes = Buffer.from("caller changed preview"); plan.summary.sourceId = "invented";
    const result = await applyNativeSkyStage(plan); expect(result.sourceId).toBe(f.snapshot.id);
    expect(await fs.readFile(join(f.root, STAGED, "manifest.json"))).toEqual(expected);
    await expect(applyNativeSkyStage(plan)).rejects.toThrow("fresh plan");
    await expect(applyNativeSkyStage({ ...plan })).rejects.toThrow("fresh plan");
  });
});
