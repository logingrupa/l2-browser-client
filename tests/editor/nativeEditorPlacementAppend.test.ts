import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
// Offline filesystem migration; no browser or Editor process is started.
const { applyNativeEditorPlacementAppend, planNativeEditorPlacementAppend } = await import(pathToFileURL(resolve("scripts/append-native-editor-placements.mjs")).href);

const directories: string[] = [];
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const json = (value: unknown) => Buffer.from(JSON.stringify(value, null, 2) + "\n");
const scene = "assets/native-world.scene";
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

async function fixture() {
  const root = await fs.mkdtemp(join(tmpdir(), "native-editor-append-")); directories.push(root);
  const write = async (path: string, bytes: Buffer) => { await fs.mkdir(dirname(join(root, path)), { recursive: true }); await fs.writeFile(join(root, path), bytes); };
  const oldSource = { id: "interlude:20_20.StaticMeshActor1", modelId: "interlude:tree", sourceMesh: "Trees.Tree", materialOverrides: [],
    matrix: [...identity.slice(0, 12), 10, -35, 920, 1], sourceLocation: { X: 1000, Y: 92000, Z: -3500 } };
  const addition = { ...copy(oldSource), id: "interlude:20_20.StaticMeshActor2", matrix: [...identity.slice(0, 12), 12.123456789, -35, 921.6, 1],
    sourceLocation: { X: 1212.3456789, Y: 92160, Z: -3500 } };
  const manifest = { schemaVersion: 1, kind: "native-map-section-runtime", models: [{ id: "interlude:tree" }], placements: [oldSource],
    resourceRoots: { terrain: "../map-section", models: "../map-section-models" }, support: "section-products-ready-for-runtime-validation", errors: [],
    terrain: { sha256: "a".repeat(64), bytes: 123, file: "terrain.glb" }, gaps: [] };
  const oldHash = sha(json(manifest));
  const world = { id: "world", uniqueId: 2 ** 48 + 1, name: "Native world", type: "TransformNode", position: [0, 0, 0], scaling: [1, 1, -1],
    metadata: { nativeWorldRoot: { schemaVersion: 1, manifestSha256: oldHash, manifest } } };
  const sourceRoot = { id: "tree-root", uniqueId: 2 ** 48 + 2, name: oldSource.id, type: "TransformNode", position: [0, 0, 0], rotation: [0, 0, 0], scaling: [1, 1, 1],
    localMatrix: oldSource.matrix.map(Math.fround), animations: [], ranges: [],
    metadata: { nativePlacement: oldSource, parentId: world.uniqueId, nativeEditorSource: { originalId: oldSource.id, originalName: oldSource.id } }, parentId: world.uniqueId };
  const positions = [0, 0, 0, 1, 0, 0, 0, 1, 0], normals = [0, 0, 1, 0, 0, 1, 0, 0, 1], uvs = [0, 0, 1, 0, 0, 1], indices = [0, 1, 2];
  const binary = Buffer.concat([Buffer.from(new Float32Array(positions).buffer), Buffer.from(new Float32Array(normals).buffer),
    Buffer.from(new Float32Array(uvs).buffer), Buffer.from(new Int32Array(indices).buffer), Buffer.from(new Int32Array([0, 0, 3, 0, 3]).buffer)]);
  const geometryFile = `${scene}/geometries/tree.babylonbinarymeshdata`;
  const material = { id: "mat", uniqueId: 2 ** 48 + 4, name: "Tree source material", authoredRoughness: .73 };
  const sourceMesh = { id: "tree-mesh", uniqueId: 2 ** 48 + 3, name: "tree_primitive", type: "Mesh", position: [0, 0, 0], rotation: [0, 0, 0], scaling: [1, 1, 1],
    localMatrix: identity, metadata: { parentId: sourceRoot.uniqueId }, parentId: sourceRoot.uniqueId, instances: [], animations: [], ranges: [], sideOrientation: 0,
    geometryId: "tree-geometry", geometryUniqueId: 2 ** 48 + 5, materialId: material.id, materialUniqueId: material.uniqueId,
    subMeshes: [{ materialIndex: 0, verticesStart: 0, verticesCount: 3, indexStart: 0, indexCount: 3 }] };
  const sourceMeshDoc = { meshes: [sourceMesh], geometries: { vertexData: [{ id: sourceMesh.geometryId, uniqueId: sourceMesh.geometryUniqueId, positions, normals, uvs, indices }] },
    materials: [{ ...material, authoredRoughness: .5 }], metadata: { parentId: sourceRoot.uniqueId }, transformNodes: [], basePoseMatrix: identity };
  const snapshot = { schemaVersion: 1, kind: "native-editor-world-snapshot", manifestSha256: oldHash, manifest,
    nodes: [world, sourceRoot], meshes: [sourceMeshDoc] };
  const snapshotBytes = json(snapshot), snapshotPath = "artifacts/source-snapshot.json";
  await write(snapshotPath, snapshotBytes);
  const savedRoot = copy(sourceRoot); delete (savedRoot as { parentId?: number }).parentId; savedRoot.position = [.75, 0, 0];
  const savedMesh = { ...copy(sourceMesh), parentId: undefined, scaling: [2, 2, 2], subMeshes: null, delayLoadingFile: geometryFile,
    positions: null, normals: null, uvs: null, indices: null, hasUVs: true,
    boundingBoxMinimum: [0, 0, 0], boundingBoxMaximum: [1, 1, 0],
    _binaryInfo: {
      positionsAttrDesc: { count: 9, stride: 3, offset: 0, dataType: 1 },
      normalsAttrDesc: { count: 9, stride: 3, offset: 36, dataType: 1 },
      uvsAttrDesc: { count: 6, stride: 2, offset: 72, dataType: 1 },
      indicesAttrDesc: { count: 3, stride: 1, offset: 96, dataType: 0 },
      subMeshesAttrDesc: { count: 1, stride: 5, offset: 108, dataType: 0 },
    } };
  await write(`${scene}/nodes/world.json`, json(world));
  await write(`${scene}/nodes/tree-root.json`, json(savedRoot));
  await write(`${scene}/meshes/tree-mesh.json`, json({ ...copy(sourceMeshDoc), meshes: [savedMesh], materials: [material], geometries: { vertexData: [] } }));
  await write(geometryFile, binary);
  await write(`${scene}/config.json`, json({ authoredCamera: { radius: 12.75 }, metadata: { nativeEditorImport: { schemaVersion: 1, manifestSha256: oldHash, targetScene: scene } } }));
  // Keep a deliberately differently formatted proof: only the hash token may change.
  await write(`${scene}.native-editor-channels.json`, Buffer.from(`{ "schemaVersion": 1, "kind": "native-editor-channels", "manifestSha256": "${oldHash}", "meshes": [{"meshId":"terrain","uv2":"preserve-exactly"}] }\r\n`));
  const next = { ...copy(manifest), placements: [copy(oldSource), addition], derivation: { reason: "source-overlap" } };
  const nextManifestPath = "artifacts/next-manifest.json", nextBytes = json(next); await write(nextManifestPath, nextBytes);
  const options = { projectRoot: root, nextManifestPath, nextManifestSha256: sha(nextBytes), snapshotPath, snapshotSha256: sha(snapshotBytes) };
  return { root, options, write, addition, oldSource, oldHash, next, geometryFile, binary, world, sourceRoot, sourceMesh };
}

afterEach(async () => {
  const parent = await fs.realpath(tmpdir());
  await Promise.all(directories.splice(0).map(async path => {
    const target = await fs.realpath(path);
    if (!target.startsWith(join(parent, "native-editor-append-"))) throw Error("Unexpected temporary fixture directory.");
    await fs.rm(target, { recursive: true, force: true });
  }));
});

describe("additive native Editor placement migration", () => {
  it("preserves the saved transient default binding only on an empty loader root", async () => {
    const f = await fixture();
    const snapshotPath = join(f.root, f.options.snapshotPath);
    const snapshot = JSON.parse(await fs.readFile(snapshotPath, "utf8"));
    const empty = { id: "empty-loader-root", uniqueId: 2 ** 48 + 99, name: "__root__", type: "Mesh",
      metadata: { parentId: f.sourceRoot.uniqueId }, materialId: "transient-source-default", materialUniqueId: 2 ** 48 + 98,
      position: [0, 0, 0], rotation: [0, 0, 0], scaling: [1, 1, 1], animations: [], ranges: [], instances: [] };
    snapshot.meshes.push({ meshes: [empty], materials: [], geometries: { vertexData: [] } });
    const snapshotBytes = json(snapshot); await f.write(f.options.snapshotPath, snapshotBytes);
    const saved = { ...empty, materialId: "default material", materialUniqueId: undefined };
    await f.write(`${scene}/meshes/empty-loader-root.json`, json({ meshes: [saved], materials: [], geometries: { vertexData: [] } }));
    const plan = await planNativeEditorPlacementAppend({ ...f.options, snapshotSha256: sha(snapshotBytes) });
    const newRecord = plan.writes.find((w: { bytes: Buffer }) => w.bytes.toString().includes('"name": "__root__"'));
    expect(JSON.parse(newRecord.bytes.toString()).meshes[0].materialId).toBe("default material");
    expect(JSON.parse(newRecord.bytes.toString()).meshes[0].materialUniqueId).toBeUndefined();
  });

  it("accepts source JSON signed zero without changing the source file or geometry", async () => {
    const f = await fixture();
    const bytes = Buffer.from(json(f.next).toString().replace(/("matrix":\s*\[\s*1,\s*)0,/, "$1-0,"));
    expect(bytes.toString()).toContain("-0,");
    await f.write(f.options.nextManifestPath, bytes);
    const options = { ...f.options, nextManifestSha256: sha(bytes) };
    await applyNativeEditorPlacementAppend(await planNativeEditorPlacementAppend(options));
    expect((await planNativeEditorPlacementAppend(options)).summary.status).toBe("preserved");
    expect(await fs.readFile(join(f.root, f.options.nextManifestPath))).toEqual(bytes);
    expect(await fs.readFile(join(f.root, f.geometryFile))).toEqual(f.binary);
  });

  it("appends source transforms and remapped parentage while retaining all existing authored records and geometry", async () => {
    const f = await fixture();
    const preserved = [`${scene}/nodes/tree-root.json`, `${scene}/meshes/tree-mesh.json`, f.geometryFile];
    const before = await Promise.all(preserved.map(path => fs.readFile(join(f.root, path))));
    const proofBefore = await fs.readFile(join(f.root, `${scene}.native-editor-channels.json`), "utf8");
    const plan = await planNativeEditorPlacementAppend(f.options);
    expect(plan.summary.status).toBe("planned"); expect(plan.summary.newRecords).toHaveLength(2);
    // Dry-run planning itself has not written new files or changed metadata.
    expect(JSON.parse(await fs.readFile(join(f.root, `${scene}/nodes/world.json`), "utf8")).metadata.nativeWorldRoot.manifestSha256).toBe(f.oldHash);
    const receipt = await applyNativeEditorPlacementAppend(plan, { receiptPath: "artifacts/applied.json" });
    expect(receipt.status).toBe("applied"); expect(receipt.changes).toHaveLength(5);
    for (const [index, path] of preserved.entries()) expect(await fs.readFile(join(f.root, path))).toEqual(before[index]);
    const created = await Promise.all(receipt.newRecords.map(async (row: { path: string }) => JSON.parse(await fs.readFile(join(f.root, row.path), "utf8"))));
    const root = created.find(row => row.type === "TransformNode"), meshDoc = created.find(row => row.meshes), mesh = meshDoc.meshes[0];
    expect(root.metadata.nativePlacement).toEqual(f.addition);
    expect(root.localMatrix).toEqual(f.addition.matrix.map(Math.fround));
    expect(root.position).toEqual([0, 0, 0]); expect(mesh.scaling).toEqual([1, 1, 1]);
    expect(root.metadata.parentId).toBe(f.world.uniqueId); expect(mesh.metadata.parentId).toBe(root.uniqueId);
    expect(meshDoc.metadata.parentId).toBe(root.uniqueId); expect(root.parentId).toBeUndefined(); expect(mesh.parentId).toBeUndefined();
    expect(mesh.geometryId).toBe(f.sourceMesh.geometryId); expect(mesh.delayLoadingFile).toBe(f.geometryFile);
    expect(mesh.sideOrientation).toBe(0); expect(meshDoc.materials[0].authoredRoughness).toBe(.73);
    expect(await fs.readFile(join(f.root, `${scene}.native-editor-channels.json`), "utf8")).toBe(proofBefore.replace(f.oldHash, f.options.nextManifestSha256));
    const config = JSON.parse(await fs.readFile(join(f.root, `${scene}/config.json`), "utf8"));
    expect(config.authoredCamera).toEqual({ radius: 12.75 }); expect(config.metadata.nativeEditorImport.manifestSha256).toBe(f.options.nextManifestSha256);
  });

  it("is idempotent after authoring an appended placement", async () => {
    const f = await fixture(), first = await applyNativeEditorPlacementAppend(await planNativeEditorPlacementAppend(f.options));
    const rootPath = first.newRecords.find((row: { path: string }) => row.path.includes("/nodes/"))!.path;
    const edited = JSON.parse(await fs.readFile(join(f.root, rootPath), "utf8")); edited.position = [9, 8, 7];
    await f.write(rootPath, json(edited));
    const repeat = await planNativeEditorPlacementAppend(f.options);
    expect(repeat.summary.status).toBe("preserved"); expect(repeat.writes).toEqual([]);
    await applyNativeEditorPlacementAppend(repeat);
    expect(JSON.parse(await fs.readFile(join(f.root, rootPath), "utf8")).position).toEqual([9, 8, 7]);
  });

  it("rejects mutated geometry instead of copying a mismatched source template", async () => {
    const f = await fixture(), bytes = Buffer.from(f.binary); bytes.writeFloatLE(.25, 0); await f.write(f.geometryFile, bytes);
    await expect(planNativeEditorPlacementAppend(f.options)).rejects.toThrow("saved template geometry differs from source");
    expect((await fs.readdir(join(f.root, scene, "nodes"))).sort()).toEqual(["tree-root.json", "world.json"]);
  });

  it("rejects a modified original source placement and newly introduced model", async () => {
    const f = await fixture(); f.next.placements[0]!.matrix[12] = 99;
    let bytes = json(f.next); await f.write(f.options.nextManifestPath, bytes);
    await expect(planNativeEditorPlacementAppend({ ...f.options, nextManifestSha256: sha(bytes) })).rejects.toThrow("existing source placements changed");
    f.next.placements[0] = f.oldSource; f.next.placements[1]!.modelId = "interlude:unknown";
    bytes = json(f.next); await f.write(f.options.nextManifestPath, bytes);
    await expect(planNativeEditorPlacementAppend({ ...f.options, nextManifestSha256: sha(bytes) })).rejects.toThrow("newly introduced model");
  });

  it("checks all read dependencies before writes and refuses a new-identity collision", async () => {
    const f = await fixture(), plan = await planNativeEditorPlacementAppend(f.options);
    const configPath = `${scene}/config.json`, bytes = await fs.readFile(join(f.root, configPath));
    await f.write(configPath, Buffer.concat([bytes, Buffer.from("\n")]));
    await expect(applyNativeEditorPlacementAppend(plan)).rejects.toThrow("input changed after planning");
    await f.write(configPath, bytes);
    const collision = plan.summary.newRecords.find((row: { path: string }) => row.path.includes("/nodes/"));
    const candidate = JSON.parse(plan.writes.find((row: { path: string }) => row.path === collision.path).bytes.toString("utf8"));
    delete candidate.metadata.nativePlacement;
    await f.write(collision.path, json(candidate));
    await expect(planNativeEditorPlacementAppend(f.options)).rejects.toThrow("identity collision");
  });

  it("rejects mismatched proof identity without changing any authored files", async () => {
    const f = await fixture();
    const p = `${scene}.native-editor-channels.json`, bytes = await fs.readFile(join(f.root, p));
    await f.write(p, Buffer.from(bytes.toString("utf8").replace(f.oldHash, "c".repeat(64))));
    await expect(planNativeEditorPlacementAppend(f.options)).rejects.toThrow("identities differ");
    expect((await fs.readdir(join(f.root, scene, "nodes"))).sort()).toEqual(["tree-root.json", "world.json"]);
  });
});
