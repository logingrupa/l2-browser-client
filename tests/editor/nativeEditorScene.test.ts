import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { Matrix } from "@babylonjs/core/Maths/math.vector";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { SceneSerializer } from "@babylonjs/core/Misc/sceneSerializer";

const moduleUrl = pathToFileURL(resolve("scripts/native_editor_scene.mjs")).href;
const { writeNativeEditorScene } = await import(moduleUrl);
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

// Dependency-injection fixture for hosts without the optional installed Editor.
// On DATABASE-PC the tests exercise the real audited helper from app.asar.
const fixtureHelper = `const fs = require('fs');
exports.writeBinaryGeometry = async ({mesh,geometry,path}) => {
 const chunks=[]; let offset=0;
 for(const [key,desc,stride,Type] of [['positions','positionsAttrDesc',3,Float32Array],['normals','normalsAttrDesc',3,Float32Array],['uvs','uvsAttrDesc',2,Float32Array],['uv2s','uvs2AttrDesc',2,Float32Array],['indices','indicesAttrDesc',1,Int32Array]]) {
  if(!geometry[key])continue; const bytes=Buffer.from(new Type(geometry[key]).buffer); chunks.push(bytes);
  mesh._binaryInfo[desc]={count:geometry[key].length,stride,offset,dataType:Type===Float32Array?1:0};offset+=bytes.length;
 }
 const rows=mesh.subMeshes.flatMap(s=>[s.materialIndex,s.verticesStart,s.verticesCount,s.indexStart,s.indexCount]);
 mesh._binaryInfo.subMeshesAttrDesc={count:mesh.subMeshes.length,stride:5,offset,dataType:0};mesh.subMeshes=null;
 chunks.push(Buffer.from(new Int32Array(rows).buffer));fs.writeFileSync(path,Buffer.concat(chunks));
};`;
const installed = existsSync(join(homedir(), "AppData/Local/Programs/BabylonJS Editor/resources/app.asar"));
const helper = installed ? {} : { geometryHelperSource: fixtureHelper };

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "native-editor-scene-")); directories.push(root);
  const template = join(root, "assets/native-parity.scene");
  for (const directory of ["cameras", "lights", "meshes"]) mkdirSync(join(template, directory), { recursive: true });
  const config = { clearColor: [0, 0, 0, 1], ambientColor: [0, 0, 0], environment: {}, physics: { gravity: [0, -9.81, 0] }, editorCamera: { position: [0, 0, 0], speed: .3 },
    fog: { fogEnabled: false, fogMode: 0 }, metadata: { scripts: [{ key: "scripts/nativeParity.ts", values: { saved: 17 } }] } };
  writeFileSync(join(template, "config.json"), JSON.stringify(config));
  writeFileSync(join(template, "cameras/camera.json"), JSON.stringify({ id: "camera", uniqueId: 1800000000100, name: "World camera", type: "FreeCamera", position: [0, 1, -5], rotation: [0, 0, 0] }));
  writeFileSync(join(template, "lights/light.json"), JSON.stringify({ id: "light", uniqueId: 1800000000101, name: "Light", type: 3, direction: [0, 1, 0], diffuse: [1, 1, 1], specular: [1, 1, 1], groundColor: [0, 0, 0] }));
  writeFileSync(join(template, "meshes/inspection.json"), "must not be copied");
  const engine = new NullEngine(), scene = new Scene(engine);
  const parent = new TransformNode("Placement", scene); parent.id = "placement"; parent.uniqueId = 7000000000000;
  parent.setPreTransformMatrix(Matrix.Translation(131.680234375, -33.78, 960.47));
  parent.metadata = { nativeWorldRoot: true, sourceObject: "interlude:20_20.StaticMeshActor915", untouched: { values: [1, 2, 3] } };
  const mesh = new Mesh("Native geometry", scene); mesh.id = "native-mesh"; mesh.uniqueId = 7000000000001; mesh.parent = parent;
  const geometry = new VertexData(); geometry.positions = [0, 0, 0, 1.23456789, 0, 0, 0, 0, 2];
  geometry.normals = [0, 1, 0, 0, 1, 0, 0, 1, 0]; geometry.uvs = [0, 0, 1, 0, 0, 1];
  geometry.uvs2 = [.125, .25, .375, .5, .625, .75]; geometry.indices = [0, 2, 1]; geometry.applyToMesh(mesh);
  mesh.geometry!.id = "geometry";
  const material = new StandardMaterial("Source material", scene); material.id = "material"; material.uniqueId = 7000000000002; mesh.material = material;
  mesh.metadata = { nativePlacement: { id: "interlude:20_20.StaticMeshActor915", sourceMatrix: [...parent.getPivotMatrix().asArray()] }, parentId: parent.uniqueId };
  const serialized = SceneSerializer.SerializeMesh(mesh, false, false); delete serialized.meshes[0].parentId;
  const node = parent.serialize();
  const manifest = { source: "retained", models: [{ id: "source-model" }], placements: [{ id: "source-placement" }] }, manifestSha256 = hash(JSON.stringify(manifest));
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"), textureSha = hash(png);
  const snapshot = { schemaVersion: 1, kind: "native-editor-world-snapshot", manifestSha256, manifest, nodes: [node], meshes: [serialized],
    textures: [{ path: `assets/native-generated/${manifestSha256}/${textureSha}.png`, base64: png.toString("base64"), sha256: textureSha, bytes: png.length }], inspection: { verifiedFixture: true } };
  scene.dispose(); engine.dispose();
  return { root, snapshot, png };
}

function tree(path: string): Record<string, string> {
  const result: Record<string, string> = {};
  function walk(current: string, prefix = "") {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const key = `${prefix}${entry.name}`;
      if (entry.isDirectory()) walk(join(current, entry.name), `${key}/`);
      else result[key] = hash(readFileSync(join(current, entry.name)));
    }
  }
  walk(path); return result;
}

it("writes real serialized meshes with exact geometry and packs them through the pinned CLI", async () => {
  const { root, snapshot, png } = fixture(), before = JSON.stringify(snapshot);
  const result = await writeNativeEditorScene({ projectRoot: root, snapshot, ...helper });
  expect(result.status).toBe("created"); expect(result.geometryCount).toBe(1); expect(JSON.stringify(snapshot)).toBe(before);
  const scenePath = join(root, "assets/native-world.scene"), data = JSON.parse(readFileSync(join(scenePath, "meshes/native-mesh.json"), "utf8"));
  const source = snapshot.meshes[0].geometries.vertexData[0], originalMesh = snapshot.meshes[0].meshes[0];
  const expected = Buffer.concat([Buffer.from(new Float32Array(source.positions).buffer), Buffer.from(new Float32Array(source.normals).buffer),
    Buffer.from(new Float32Array(source.uvs).buffer), Buffer.from(new Float32Array(source.uvs2).buffer), Buffer.from(new Int32Array(source.indices).buffer),
    Buffer.from(new Int32Array(originalMesh.subMeshes.flatMap((sub: Record<string, number>) => [sub.materialIndex!, sub.verticesStart!, sub.verticesCount!, sub.indexStart!, sub.indexCount!])).buffer)]);
  expect(readFileSync(join(root, data.meshes[0].delayLoadingFile))).toEqual(expected);
  const uv2 = data.meshes[0]._binaryInfo.uvs2AttrDesc;
  expect(uv2).toEqual({ count: 6, stride: 2, offset: 96, dataType: 1 });
  expect([...new Float32Array(expected.buffer.slice(expected.byteOffset + uv2.offset, expected.byteOffset + uv2.offset + uv2.count * 4))]).toEqual(source.uvs2);
  expect(data.meshes[0].metadata).toEqual(originalMesh.metadata);
  expect(data.geometries.vertexData).toEqual([]);
  expect(JSON.parse(readFileSync(join(scenePath, "nodes/placement.json"), "utf8"))).toEqual({ ...snapshot.nodes[0], localMatrix: Array.from(snapshot.nodes[0].localMatrix) });
  expect(readFileSync(join(root, snapshot.textures[0]!.path))).toEqual(png);
  expect(readdirSync(join(scenePath, "meshes"))).toEqual(["native-mesh.json"]);
  expect(JSON.parse(readFileSync(join(root, result.receiptPath), "utf8")).initialAuthoredFiles).toHaveLength(6);
  const channels = JSON.parse(readFileSync(`${scenePath}.native-editor-channels.json`, "utf8"));
  expect(channels.manifestSha256).toBe(snapshot.manifestSha256);
  expect(channels.meshes[0].meshId).toBe(originalMesh.id);
  expect(channels.meshes[0].uv2.sha256).toBe(hash(Buffer.from(new Float32Array(source.uvs2).buffer)));
  expect(JSON.parse(readFileSync(join(root, result.receiptPath), "utf8")).channelRecovery.sha256)
    .toBe(hash(readFileSync(`${scenePath}.native-editor-channels.json`)));
  const command = `const fs=await import('node:fs/promises');
    const {createBabylonScene}=await import(${JSON.stringify(pathToFileURL(resolve("node_modules/babylonjs-editor-cli/build/src/pack/scene.mjs")).href)});
    const sceneFile=${JSON.stringify(scenePath.replaceAll("\\", "/"))},publicDir=${JSON.stringify(join(root, "packed").replaceAll("\\", "/"))};
    await fs.mkdir(publicDir);const directories=Object.fromEntries(${JSON.stringify(["nodesFiles", "meshesFiles", "lodsFiles", "lightsFiles", "cameraFiles", "skeletonFiles", "shadowGeneratorFiles", "sceneLinkFiles", "guiFiles", "soundFiles", "soundNodeFiles", "particleSystemFiles", "morphTargetManagerFiles", "morphTargetFiles", "animationGroupFiles", "spriteMapFiles", "spriteManagerFiles", "geometryFiles", "nodeParticleSystemSetFiles", "gaussianSplattingFiles"])}.map(k=>[k,[]]));
    directories.nodesFiles=['placement.json'];directories.meshesFiles=['native-mesh.json'];directories.cameraFiles=['camera.json'];directories.lightsFiles=['light.json'];
    await createBabylonScene({sceneFile,publicDir,sceneName:'fixture',buildTime:0,babylonjsEditorToolsVersion:'5.5.3',exportedAssets:[],directories,mergeGeometries:true,optimize:false,compressedTexturesEnabled:false,config:JSON.parse(await fs.readFile(sceneFile+'/config.json','utf8'))});`;
  execFileSync(process.execPath, ["--input-type=module", "-e", command], { stdio: "pipe" });
  const packed = JSON.parse(readFileSync(join(root, "packed/fixture.babylon"), "utf8"));
  expect(packed.meshes).toHaveLength(1); expect(packed.meshes[0].parentId).toBe(snapshot.nodes[0].uniqueId);
  expect(packed.transformNodes[0].localMatrix).toEqual(Array.from(snapshot.nodes[0].localMatrix));
  expect(packed.materials[0].id).toBe("material");
  expect(packed.meshes[0]._binaryInfo.uvs2AttrDesc).toEqual(uv2);
  expect(readFileSync(join(root, "packed", packed.meshes[0].delayLoadingFile))).toEqual(expected);
});

it("preserves authored edits byte-for-byte on repeat import and refuses changed source", async () => {
  const { root, snapshot } = fixture(); await writeNativeEditorScene({ projectRoot: root, snapshot, ...helper });
  const path = join(root, "assets/native-world.scene/nodes/placement.json"), node = JSON.parse(readFileSync(path, "utf8"));
  node.position = [9, 8, 7]; node.metadata.authored = "kept"; writeFileSync(path, JSON.stringify(node));
  const before = tree(root);
  expect(await writeNativeEditorScene({ projectRoot: root, snapshot })).toMatchObject({ status: "preserved" });
  expect(tree(root)).toEqual(before);
  await expect(writeNativeEditorScene({ projectRoot: root, snapshot: { ...snapshot, manifestSha256: "e".repeat(64) } })).rejects.toThrow("conflict");
  expect(tree(root)).toEqual(before);
});

it("deduplicates identical binary layouts but preserves distinct submesh layouts", async () => {
  const { root, snapshot } = fixture();
  const copy = structuredClone(snapshot.meshes[0]); copy.meshes[0].id = "native-copy"; copy.meshes[0].uniqueId += 5;
  snapshot.meshes.push(copy);
  const changed = structuredClone(copy); changed.meshes[0].id = "native-other-layout"; changed.meshes[0].uniqueId += 5; changed.meshes[0].subMeshes[0].materialIndex = 1;
  snapshot.meshes.push(changed);
  expect(await writeNativeEditorScene({ projectRoot: root, snapshot, ...helper })).toMatchObject({ geometryCount: 2, meshCount: 3 });
});

it("rejects path escapes, junctions, material collisions and corrupt textures before creating a scene", async () => {
  const { root, snapshot } = fixture(), before = tree(root);
  await expect(writeNativeEditorScene({ projectRoot: root, snapshot, targetScene: "../escape.scene", ...helper })).rejects.toThrow("Unsafe");
  const corrupt = structuredClone(snapshot); corrupt.textures[0]!.bytes++;
  await expect(writeNativeEditorScene({ projectRoot: root, snapshot: corrupt, ...helper })).rejects.toThrow("PNG hash");
  const collision = structuredClone(snapshot); collision.meshes[0].materials[0].uniqueId = collision.nodes[0].uniqueId;
  await expect(writeNativeEditorScene({ projectRoot: root, snapshot: collision, ...helper })).rejects.toThrow("Colliding");
  expect(tree(root)).toEqual(before);
  const outside = mkdtempSync(join(tmpdir(), "native-editor-outside-")); directories.push(outside);
  symlinkSync(outside, join(root, "assets/native-generated"), process.platform === "win32" ? "junction" : "dir");
  await expect(writeNativeEditorScene({ projectRoot: root, snapshot, ...helper })).rejects.toThrow("Symlink/junction");
  expect(readdirSync(outside)).toEqual([]); expect(existsSync(join(root, "assets/native-world.scene"))).toBe(false);
});

it("accepts explicit helper source and cleans staging if serialization fails", async () => {
  const { root, snapshot } = fixture(), before = tree(root);
  await expect(writeNativeEditorScene({ projectRoot: root, snapshot, geometryHelperSource: "exports.writeBinaryGeometry=async()=>{throw Error('fixture failure')};" })).rejects.toThrow("fixture failure");
  expect(tree(root)).toEqual(before); expect(readdirSync(join(root, "assets"))).toEqual(["native-parity.scene"]);
});

it("retains empty GLB roots and applies explicit authoring camera values without changing the template", async () => {
  const { root, snapshot } = fixture(), templateBefore = tree(join(root, "assets/native-parity.scene"));
  const empty = { meshes: [{ id: "gltf-root", uniqueId: 7000000000020, name: "__root__", type: "Mesh", parentId: snapshot.nodes[0].uniqueId,
    metadata: { parentId: snapshot.nodes[0].uniqueId, retained: true }, materialId: "default material", materialUniqueId: 8 }], materials: [] };
  snapshot.meshes.push(empty);
  const authoringCamera = { editor: { position: [1, 2, -3], rotation: [.2, .4, 0], minZ: .01, maxZ: 3000 },
    world: { position: [4, 5, -6], target: [1, 1, -2], alpha: 1.2, beta: 1, radius: 12, minZ: .01, maxZ: 3000 } };
  await writeNativeEditorScene({ projectRoot: root, snapshot: { ...snapshot, authoringCamera, tools: { retained: "9.27.1" } }, ...helper });
  expect(tree(join(root, "assets/native-parity.scene"))).toEqual(templateBefore);
  const target = join(root, "assets/native-world.scene"), data = JSON.parse(readFileSync(join(target, "meshes/gltf-root.json"), "utf8"));
  expect(data.meshes[0].metadata).toEqual(empty.meshes[0]!.metadata);
  expect(data.meshes[0].parentId).toBeUndefined(); expect(data.meshes[0].materialUniqueId).toBeUndefined();
  expect(JSON.parse(readFileSync(join(target, "config.json"), "utf8")).editorCamera).toEqual({ ...authoringCamera.editor, speed: .3 });
  expect(JSON.parse(readFileSync(join(target, "cameras/camera.json"), "utf8"))).toMatchObject(authoringCamera.world);
});
