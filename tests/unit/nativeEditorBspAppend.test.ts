import { createHash } from "node:crypto";
import { existsSync, promises as fs } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

const { planNativeEditorBspAppend, applyNativeEditorBspAppend } = await import(pathToFileURL(resolve("scripts/append-native-editor-bsp.mjs")).href);
const SCENE = "assets/native-world.scene", roots: string[] = [];
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const json = (value: unknown) => Buffer.from(JSON.stringify(value, null, 2) + "\n");
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
// DATABASE-PC uses the installed, hash-pinned Editor 5.5.3 implementation.
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
  const root = await fs.mkdtemp(join(tmpdir(), "native-editor-bsp-test-")); roots.push(root);
  const write = async (path: string, bytes: Buffer) => { await fs.mkdir(dirname(join(root, path)), { recursive: true }); await fs.writeFile(join(root, path), bytes); };
  const manifest = { schemaVersion: 1, kind: "native-map-section-runtime", models: [], placements: [{ id: "interlude:20_20.StaticMeshActor940" }],
    terrain: { sha256: "a".repeat(64) }, terrainPatches: [{ id: "terrain-extension", manifestSha256: "9".repeat(64) }],
    derivation: { primaryUVSha256: "b".repeat(64) }, authoredUnrelated: "preserve", previewOffset: 0 };
  const baseManifestSha256 = hash(json(manifest));
  const world = { id: "world", uniqueId: 2 ** 48 + 1, name: "Native world", type: "TransformNode", position: [0, 0, 0], scaling: [1, 1, -1],
    metadata: { nativeWorldRoot: { schemaVersion: 1, manifestSha256: baseManifestSha256, manifest }, authoredSetting: 4 } };
  const material = { id: "floor-material", uniqueId: 2 ** 48 + 4, name: "Authored floor", roughness: .73,
    albedoTexture: { name: "assets/authored-floor.png", url: "assets/authored-floor.png", authoredUVOffset: .125 },
    metadata: { gltf: { extras: { nativeSectionIndex: 11, nativeSourceReference: "L2fortress_01_T.Fort01_command_planw",
      nativeSlotProperties: { EnableCollision: true } } } } };
  const materialPath = `${SCENE}/meshes/existing-mesh.json`;
  const materialBytes = json({ meshes: [{ id: "existing-mesh", uniqueId: 2 ** 48 + 3, name: "Existing authored building", geometryId: "old-geometry",
    geometryUniqueId: 2 ** 48 + 5, materialId: material.id, materialUniqueId: material.uniqueId, position: [5, 6, 7], scaling: [2, 2, 2] }], materials: [material] });
  await write(`${SCENE}/nodes/world.json`, json(world));
  await write(materialPath, materialBytes);
  await write(`${SCENE}/geometries/original.babylonbinarymeshdata`, Buffer.from("authored source must survive"));
  await write(`${SCENE}/config.json`, Buffer.from(`{ "camera": {"radius":14.8}, "metadata": { "nativeEditorImport": { "targetScene": "${SCENE}", "manifestSha256": "${baseManifestSha256}" } } }\r\n`));
  await write(`${SCENE}.native-editor-channels.json`, Buffer.from(`{ "schemaVersion":1, "kind":"native-editor-channels", "manifestSha256":"${baseManifestSha256}", "meshes":[{"id":"terrain","primary":"preserved","uv2":"preserved"}] }\r\n`));
  const bsp = { id: "interlude:20_20.Model798.Brush397", sourceModel: "20_20.Model798", sourceBrush: "20_20.Brush397", sourceMapSha256: "c".repeat(64),
    model: { file: "bsp-floor.glb", sha256: "d".repeat(64), bytes: 1000 }, source: { file: "bsp-floor.json", sha256: "e".repeat(64), bytes: 900 },
    supportPlacementIds: ["interlude:20_20.StaticMeshActor940"] };
  const snapshot = { schemaVersion: 1, kind: "native-editor-bsp-snapshot", baseManifestSha256, bspResource: bsp, nativeBsp: clone(bsp),
    geometry: { positions: [100.123456789, -34.26, 950, 101, -34.26, 950, 100, -34.26, 951], normals: [0, 1, 0, 0, 1, 0, 0, 1, 0],
      uvs: [.125, .25, .75, .5, .25, .875], indices: [0, 2, 1] },
    material: { meshPath: materialPath, meshSha256: hash(materialBytes), materialId: material.id, nativeSourceReference: "L2fortress_01_T.Fort01_command_planw" } };
  const next = { ...clone(manifest), bsp: [bsp] }, snapshotPath = "artifacts/bsp-snapshot.json", nextManifestPath = "artifacts/next-manifest.json";
  await write(snapshotPath, json(snapshot)); await write(nextManifestPath, json(next));
  const options = { projectRoot: root, snapshotPath, snapshotSha256: hash(json(snapshot)), nextManifestPath, nextManifestSha256: hash(json(next)), ...helper };
  return { root, write, options, snapshot, next, manifest, world, material, materialPath };
}

async function commandInput(f: Awaited<ReturnType<typeof fixture>>, part: "walls" | "floor" | "ceiling") {
  const rootDoc = JSON.parse(await fs.readFile(join(f.root, SCENE, "nodes/world.json"), "utf8"));
  const marker = rootDoc.metadata.nativeWorldRoot;
  const references = { walls: "L2fortress_01_T.Fort01_deffense_wall01", floor: "L2fortress_01_T.Fort01_command_planw", ceiling: "L2fortress_01_T.fort_wsquare_bwall" };
  const material = clone(f.material);
  material.id = `command-${part}-material`; material.uniqueId += { walls: 10, floor: 20, ceiling: 30 }[part];
  material.metadata.gltf.extras.nativeSourceReference = references[part];
  const materialPath = `${SCENE}/meshes/command-${part}-material.json`;
  const materialBytes = json({ meshes: [{ id: `command-${part}-source`, uniqueId: material.uniqueId + 1 }], materials: [material] });
  await f.write(materialPath, materialBytes);
  const snapshot = clone(f.snapshot);
  snapshot.baseManifestSha256 = marker.manifestSha256;
  snapshot.bspResource = { ...snapshot.bspResource, id: `interlude:20_20.Model798.Brush610.${part}`, sourceBrush: "20_20.Brush610",
    model: { ...snapshot.bspResource.model, file: `bsp-command-${part}.glb` },
    source: { ...snapshot.bspResource.source, file: `bsp-command-${part}.json` }, supportPlacementIds: ["interlude:20_20.StaticMeshActor1913"] };
  snapshot.nativeBsp = clone(snapshot.bspResource);
  snapshot.material = { meshPath: materialPath, meshSha256: hash(materialBytes), materialId: material.id, nativeSourceReference: references[part] };
  snapshot.geometry.positions[0]! += { walls: 1, floor: 2, ceiling: 3 }[part];
  const next = { ...clone(marker.manifest), bsp: [...clone(marker.manifest.bsp), snapshot.bspResource] };
  const snapshotPath = `artifacts/command-${part}-snapshot.json`, nextManifestPath = `artifacts/command-${part}-manifest.json`;
  await f.write(snapshotPath, json(snapshot)); await f.write(nextManifestPath, json(next));
  const options = { ...f.options, snapshotPath, snapshotSha256: hash(json(snapshot)), nextManifestPath, nextManifestSha256: hash(json(next)) };
  return { options, snapshot, next };
}

afterEach(async () => {
  vi.restoreAllMocks();
  const parent = await fs.realpath(tmpdir());
  for (const path of roots.splice(0)) {
    const actual = await fs.realpath(path);
    if (dirname(actual) !== parent || !basename(actual).startsWith("native-editor-bsp-test-")) throw Error("Unexpected fixture cleanup path.");
    await fs.rm(actual, { recursive: true, force: true });
  }
});

describe("bounded additive native Editor BSP migration", () => {
  it("appends command walls, floor and ceiling after an authored BSP floor without changing prior resources or terrain patches", async () => {
    const f = await fixture(), floor = await applyNativeEditorBspAppend(await planNativeEditorBspAppend(f.options));
    const floorRow = floor.newRecords[0];
    const floorDoc = JSON.parse(await fs.readFile(join(f.root, floorRow.path), "utf8"));
    floorDoc.meshes[0].position = [4, 5, 6]; floorDoc.materials[0].roughness = .23;
    await f.write(floorRow.path, json(floorDoc)); await f.write(floorRow.geometryPath, Buffer.from("authored BSP floor geometry"));
    const ids = [f.snapshot.bspResource.id];
    for (const part of ["walls", "floor", "ceiling"] as const) {
      const command = await commandInput(f, part), before = await files(f.root);
      const receipt = await applyNativeEditorBspAppend(await planNativeEditorBspAppend(command.options));
      expect(receipt.status).toBe("applied"); ids.push(command.snapshot.bspResource.id);
      const after = await files(f.root);
      const changed = Object.keys(before).filter(path => !before[path]!.equals(after[path]!));
      expect(changed.sort()).toEqual([`${SCENE}/nodes/world.json`, `${SCENE}/config.json`, `${SCENE}.native-editor-channels.json`].sort());
      const marker = JSON.parse(after[`${SCENE}/nodes/world.json`]!.toString()).metadata.nativeWorldRoot;
      expect(marker.manifest.bsp.map((entry: { id: string }) => entry.id)).toEqual(ids);
      expect(marker.manifest.terrainPatches).toEqual(f.manifest.terrainPatches);
      const restoredRoot = after[`${SCENE}/nodes/world.json`]!.toString()
        .replace(`,${JSON.stringify(command.snapshot.bspResource)}`, "")
        .replace(command.options.nextManifestSha256, command.snapshot.baseManifestSha256);
      expect(restoredRoot).toBe(before[`${SCENE}/nodes/world.json`]!.toString());
      expect(after[floorRow.path]).toEqual(before[floorRow.path]); expect(after[floorRow.geometryPath]).toEqual(before[floorRow.geometryPath]);
      const row = receipt.newRecords[0], doc = JSON.parse(after[row.path]!.toString());
      expect(doc.meshes[0].metadata.nativeBsp).toEqual(command.snapshot.bspResource);
      expect(doc.materials[0].metadata.gltf.extras.nativeSourceReference).toBe(command.snapshot.material.nativeSourceReference);
      doc.meshes[0].visibility = .7; doc.materials[0].roughness = .19; await f.write(row.path, json(doc));
      const authored = await files(f.root), repeated = await planNativeEditorBspAppend(command.options);
      expect(repeated.writes).toEqual([]); expect((await applyNativeEditorBspAppend(repeated)).status).toBe("preserved");
      expect(await files(f.root)).toEqual(authored);
    }
  });

  it("rejects command append attempts that alter an existing BSP resource or reuse a source identity", async () => {
    const f = await fixture(); await applyNativeEditorBspAppend(await planNativeEditorBspAppend(f.options));
    const command = await commandInput(f, "walls");
    command.next.bsp[0].model.sha256 = "1".repeat(64);
    await f.write(command.options.nextManifestPath, json(command.next));
    await expect(planNativeEditorBspAppend({ ...command.options, nextManifestSha256: hash(json(command.next)) })).rejects.toThrow("unrelated source manifest change");
    command.next.bsp[0] = clone(f.snapshot.bspResource);
    command.next.bsp.unshift(clone(command.snapshot.bspResource));
    await f.write(command.options.nextManifestPath, json(command.next));
    await expect(planNativeEditorBspAppend({ ...command.options, nextManifestSha256: hash(json(command.next)) })).rejects.toThrow("next manifest BSP resource differs");
    const before = await files(f.root);
    await f.write(`${SCENE}/meshes/conflicting-command-walls.json`, json({ meshes: [{ id: "conflicting-mesh", uniqueId: 23,
      metadata: { nativeBsp: clone(command.snapshot.nativeBsp) } }] }));
    command.next.bsp.shift(); await f.write(command.options.nextManifestPath, json(command.next));
    await expect(planNativeEditorBspAppend(command.options)).rejects.toThrow("unexpected existing BSP source geometry");
    expect(await fs.readFile(join(f.root, SCENE, "nodes/world.json"))).toEqual(before[`${SCENE}/nodes/world.json`]);
  });

  it("preserves signed-zero geometry bytes while accepting Editor JSON's canonical zero metadata", async () => {
    const f = await fixture();
    const snapshotBytes = Buffer.from(json(f.snapshot).toString().replace('"normals": [\n      0,', '"normals": [\n      -0.0,'));
    expect(Object.is(JSON.parse(snapshotBytes.toString()).geometry.normals[0], -0)).toBe(true);
    const nextBytes = Buffer.from(json(f.next).toString().replace('"previewOffset": 0', '"previewOffset": -0.0'));
    await f.write(f.options.snapshotPath, snapshotBytes); await f.write(f.options.nextManifestPath, nextBytes);
    const options = { ...f.options, snapshotSha256: hash(snapshotBytes), nextManifestSha256: hash(nextBytes) };
    const applied = await applyNativeEditorBspAppend(await planNativeEditorBspAppend(options));
    const row = applied.newRecords[0], doc = JSON.parse(await fs.readFile(join(f.root, row.path), "utf8"));
    const bytes = await fs.readFile(join(f.root, row.geometryPath));
    expect(bytes.readUInt32LE(doc.meshes[0]._binaryInfo.normalsAttrDesc.offset)).toBe(0x80000000);
    expect((await planNativeEditorBspAppend(options)).writes).toEqual([]);
  });
  it("packs exact source channels, adds one mesh and preserves authored records and UV proofs", async () => {
    const f = await fixture(), before = await files(f.root), plan = await planNativeEditorBspAppend(f.options);
    expect(await files(f.root)).toEqual(before);
    expect(plan.summary.status).toBe("planned"); expect(plan.writes).toHaveLength(5);
    const receipt = await applyNativeEditorBspAppend(plan, { receiptPath: "artifacts/receipt.json" });
    const row = receipt.newRecords[0], doc = JSON.parse(await fs.readFile(join(f.root, row.path), "utf8")), mesh = doc.meshes[0];
    const binary = await fs.readFile(join(f.root, row.geometryPath));
    expect(hash(binary)).toBe(row.geometrySha256);
    for (const [key, desc, Type] of [["positions", "positionsAttrDesc", Float32Array], ["normals", "normalsAttrDesc", Float32Array],
      ["uvs", "uvsAttrDesc", Float32Array], ["indices", "indicesAttrDesc", Int32Array]] as const) {
      const info = mesh._binaryInfo[desc], expected = Buffer.from(new Type(f.snapshot.geometry[key]).buffer);
      expect(binary.subarray(info.offset, info.offset + expected.length)).toEqual(expected);
    }
    expect(mesh.metadata.nativeBsp).toEqual(f.snapshot.bspResource); expect(mesh.metadata.parentId).toBe(f.world.uniqueId);
    expect(mesh.sideOrientation).toBe(0); expect(mesh.position).toEqual([0, 0, 0]); expect(mesh.scaling).toEqual([1, 1, 1]);
    expect(doc.materials).toEqual([f.material]); expect(mesh.materialUniqueId).toBe(f.material.uniqueId);
    expect(doc.geometries.vertexData).toEqual([]);
    const after = await files(f.root), changed = Object.keys(before).filter(path => !before[path]!.equals(after[path]!));
    expect(changed.sort()).toEqual([`${SCENE}/nodes/world.json`, `${SCENE}/config.json`, `${SCENE}.native-editor-channels.json`].sort());
    for (const path of [`${SCENE}/config.json`, `${SCENE}.native-editor-channels.json`]) {
      expect(after[path]!.toString()).toBe(before[path]!.toString().replace(f.snapshot.baseManifestSha256, f.options.nextManifestSha256));
    }
    expect(JSON.parse(after[`${SCENE}/nodes/world.json`]!.toString()).metadata.nativeWorldRoot.manifest).toEqual(f.next);
    expect(after[`${SCENE}/nodes/world.json`]!.toString().replace(`,"bsp":${JSON.stringify(f.next.bsp)}`, "").replace(f.options.nextManifestSha256, f.snapshot.baseManifestSha256)).toBe(before[`${SCENE}/nodes/world.json`]!.toString());
    expect(receipt.geometryHelper.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("repeats without overwriting later mesh, geometry or material authoring", async () => {
    const f = await fixture(), receipt = await applyNativeEditorBspAppend(await planNativeEditorBspAppend(f.options));
    const row = receipt.newRecords[0], path = row.path;
    const doc = JSON.parse(await fs.readFile(join(f.root, path), "utf8")); doc.meshes[0].position = [7, 8, 9]; doc.materials[0].roughness = .12;
    await f.write(path, json(doc)); await f.write(row.geometryPath, Buffer.from("new authored geometry"));
    await f.write(f.materialPath, Buffer.from((await fs.readFile(join(f.root, f.materialPath), "utf8")).replace('"roughness": 0.73', '"roughness": 0.91')));
    const before = await files(f.root), plan = await planNativeEditorBspAppend(f.options);
    expect(plan.summary.status).toBe("preserved"); expect(plan.writes).toEqual([]);
    expect((await applyNativeEditorBspAppend(plan)).status).toBe("preserved"); expect(await files(f.root)).toEqual(before);
  });

  it("rejects unrelated manifest edits and source/material mismatch before writing", async () => {
    const f = await fixture(); f.next.terrain.sha256 = "f".repeat(64);
    await f.write(f.options.nextManifestPath, json(f.next));
    await expect(planNativeEditorBspAppend({ ...f.options, nextManifestSha256: hash(json(f.next)) })).rejects.toThrow("unrelated source manifest change");
    f.next.terrain = clone(f.manifest.terrain); await f.write(f.options.nextManifestPath, json(f.next));
    await f.write(f.materialPath, Buffer.from((await fs.readFile(join(f.root, f.materialPath), "utf8")) + " "));
    await expect(planNativeEditorBspAppend(f.options)).rejects.toThrow("saved material source changed");
    expect(await fs.readdir(join(f.root, SCENE, "meshes"))).toEqual(["existing-mesh.json"]);
  });

  it("rejects invalid channel/index data and accidental second coordinate adaptation", async () => {
    const f = await fixture(); f.snapshot.geometry.indices[1] = 99;
    await f.write(f.options.snapshotPath, json(f.snapshot));
    await expect(planNativeEditorBspAppend({ ...f.options, snapshotSha256: hash(json(f.snapshot)) })).rejects.toThrow("vertex/index relationships");
    f.snapshot.geometry.indices[1] = 2; await f.write(f.options.snapshotPath, json(f.snapshot));
    f.world.scaling = [1, 1, 1]; await f.write(`${SCENE}/nodes/world.json`, json(f.world));
    await expect(planNativeEditorBspAppend(f.options)).rejects.toThrow("LH authoring adapter");
  });

  it("refuses concurrent input edits and newly introduced identities", async () => {
    const f = await fixture(), plan = await planNativeEditorBspAppend(f.options);
    await f.write(f.materialPath, Buffer.from((await fs.readFile(join(f.root, f.materialPath), "utf8")) + " "));
    await expect(applyNativeEditorBspAppend(plan)).rejects.toThrow("input changed after planning");
    const g = await fixture(), other = await planNativeEditorBspAppend(g.options);
    await g.write(`${SCENE}/nodes/another-author.json`, json({ id: "other", uniqueId: 2 ** 48 + 99 }));
    await expect(applyNativeEditorBspAppend(other)).rejects.toThrow("identity directory changed");
    expect(await fs.readdir(join(g.root, SCENE, "meshes"))).toEqual(["existing-mesh.json"]);
  });

  it("detects ID collisions and conflicting generated geometry", async () => {
    const f = await fixture(), plan = await planNativeEditorBspAppend(f.options), row = plan.summary.newRecords[0];
    await f.write(`${SCENE}/nodes/collision.json`, json({ id: row.meshId, uniqueId: 2 ** 48 + 99 }));
    await expect(planNativeEditorBspAppend(f.options)).rejects.toThrow("identity collides");
    await fs.unlink(join(f.root, SCENE, "nodes/collision.json")); await f.write(row.geometryPath, Buffer.from("different bytes"));
    await expect(planNativeEditorBspAppend(f.options)).rejects.toThrow("conflicts with existing bytes");
  });

  it("rolls back its additions and metadata if a later commit fails", async () => {
    const f = await fixture(), before = await files(f.root), plan = await planNativeEditorBspAppend(f.options), originalRename = fs.rename;
    vi.spyOn(fs, "rename").mockImplementation(async (from, to) => {
      if (String(to) === join(f.root, SCENE, "config.json")) throw Error("simulated config write failure");
      return originalRename(from, to);
    });
    await expect(applyNativeEditorBspAppend(plan)).rejects.toThrow("simulated config write failure");
    expect(await files(f.root)).toEqual(before);
  });

  it("does not roll back someone else's bytes after a concurrent edit", async () => {
    const f = await fixture(), plan = await planNativeEditorBspAppend(f.options), originalRename = fs.rename;
    vi.spyOn(fs, "rename").mockImplementation(async (from, to) => {
      if (String(to) === join(f.root, SCENE, "config.json")) {
        await f.write(`${SCENE}/nodes/world.json`, Buffer.from("concurrent owner edit"));
        throw Error("simulated config write failure");
      }
      return originalRename(from, to);
    });
    await expect(applyNativeEditorBspAppend(plan)).rejects.toThrow("concurrent edit retained");
    expect(await fs.readFile(join(f.root, SCENE, "nodes/world.json"), "utf8")).toBe("concurrent owner edit");
    expect(await fs.readdir(join(f.root, SCENE, "meshes"))).toEqual(["existing-mesh.json"]);
  });

  it("rejects escaped paths and symlinked source inputs", async () => {
    const f = await fixture();
    await expect(planNativeEditorBspAppend({ ...f.options, snapshotPath: "../outside.json" })).rejects.toThrow("escapes project");
    await fs.symlink(join(f.root, "artifacts"), join(f.root, "linked-inputs"), "junction");
    await expect(planNativeEditorBspAppend({ ...f.options, snapshotPath: "linked-inputs/bsp-snapshot.json" })).rejects.toThrow("symlink/junction refused");
  });
});
