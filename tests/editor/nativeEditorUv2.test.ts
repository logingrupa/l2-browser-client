import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const { createNativeEditorChannels, preserveNativeEditorUv2, nativeEditorChannelsPath } = await import(pathToFileURL(resolve("scripts/preserve-native-editor-uv2.mjs")).href);
const hash = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
const scenePath = "assets/native-world.scene", manifestSha256 = "a".repeat(64);
type Descriptor = { count: number; stride: number; offset: number; dataType: number };

describe("Editor UV2 preservation", () => {
  let root: string;
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "l2-editor-uv2-")); });
  afterEach(async () => {
    const target = await realpath(root), parent = await realpath(tmpdir());
    if (!target.startsWith(join(parent, "l2-editor-uv2-"))) throw new Error("Unexpected temporary test directory.");
    await rm(target, { recursive: true, force: true });
  });
  async function tree(directory = root): Promise<Record<string, string>> {
    const result: Record<string, string> = {};
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = join(directory, entry.name);
      if (entry.isDirectory()) Object.assign(result, await tree(file)); else result[file] = hash(await readFile(file));
    }
    return result;
  }
  async function fixture() {
    for (const folder of ["nodes", "meshes", "geometries"]) await mkdir(join(root, scenePath, folder), { recursive: true });
    const geometry = { id: "source-geometry", positions: [121.17, 0, 950.34, 122.17, 0, 950.34, 121.17, 0, 951.34],
      normals: [0, 1, 0, 0, 1, 0, 0, 1, 0], uvs: [0, 0, 1, 0, 0, 1], uvs2: [.125, .25, .375, .5, .625, .75], indices: [0, 2, 1] };
    const snapshot = { schemaVersion: 1, kind: "native-editor-world-snapshot", manifestSha256,
      meshes: [{ meshes: [{ id: "terrain-identity", geometryId: geometry.id }], geometries: { vertexData: [geometry] } }] };
    const sidecar = createNativeEditorChannels(snapshot);
    const parts = [Buffer.from(new Float32Array(geometry.positions).buffer), Buffer.from(new Float32Array(geometry.normals).buffer),
      Buffer.from(new Float32Array(geometry.uvs).buffer), Buffer.from(new Int32Array(geometry.indices).buffer), Buffer.from(new Int32Array([0, 0, 3, 0, 3]).buffer)];
    const binary = Buffer.concat(parts), binaryPath = `${scenePath}/geometries/editor-authored-name.babylonbinarymeshdata`;
    const descriptor: Record<string, Descriptor> = {
      positionsAttrDesc: { count: 9, stride: 3, offset: 0, dataType: 1 }, normalsAttrDesc: { count: 9, stride: 3, offset: 36, dataType: 1 },
      uvsAttrDesc: { count: 6, stride: 2, offset: 72, dataType: 1 }, indicesAttrDesc: { count: 3, stride: 1, offset: 96, dataType: 0 },
      subMeshesAttrDesc: { count: 1, stride: 5, offset: 108, dataType: 0 },
    };
    const mesh = { id: "terrain-identity", geometryId: geometry.id, delayLoadingFile: binaryPath, _binaryInfo: descriptor,
      position: [.75, 0, 0], sideOrientation: 0, materialId: "authored-material", metadata: { worldTerrain: true, userNote: "keep" } };
    const document = { meshes: [mesh], materials: [{ id: "authored-material", roughness: .23, backFaceCulling: true }], geometries: { vertexData: [] as unknown[] } };
    const config = { metadata: { nativeEditorImport: { schemaVersion: 1, manifestSha256, targetScene: scenePath }, scripts: [{ saved: true }] } };
    const rootNode = { metadata: { nativeWorldRoot: { schemaVersion: 1, manifestSha256 } } };
    const meshPath = join(root, scenePath, "meshes", "Editor may rename this file.json");
    const sidecarPath = join(root, nativeEditorChannelsPath(scenePath));
    await Promise.all([
      writeFile(join(root, binaryPath), binary), writeFile(meshPath, JSON.stringify(document)), writeFile(sidecarPath, JSON.stringify(sidecar)),
      writeFile(join(root, scenePath, "config.json"), JSON.stringify(config)), writeFile(join(root, scenePath, "nodes", "root.json"), JSON.stringify(rootNode)),
    ]);
    return { snapshot, sidecar, sidecarPath, geometry, binary, binaryPath, mesh, meshPath, document, config, rootNode };
  }
  const preserve = () => preserveNativeEditorUv2({ projectRoot: root, scenePath });

  it("captures exact float32 UV2 bytes and topology signatures without changing the snapshot", async () => {
    const value = await fixture(), before = structuredClone(value.snapshot), result = createNativeEditorChannels(value.snapshot);
    expect(value.snapshot).toEqual(before); expect(result.kind).toBe("native-editor-channels");
    expect(result.meshes).toHaveLength(1); expect(result.meshes[0].meshId).toBe("terrain-identity");
    const uv = Buffer.from(result.meshes[0].uv2.base64, "base64");
    expect(uv).toEqual(Buffer.from(new Float32Array(value.geometry.uvs2).buffer)); expect(hash(uv)).toBe(result.meshes[0].uv2.sha256);
    expect(result.meshes[0].channels.positions.sha256).toBe(hash(value.binary.subarray(0, 36)));
    expect(result.meshes[0].channels.indices.sha256).toBe(hash(value.binary.subarray(96, 108)));
    value.geometry.uvs2[1] = NaN;
    expect(() => createNativeEditorChannels(value.snapshot)).toThrow("nonfinite");
  });

  it("keeps the recovery receipt outside the Editor's recursive scene cleanup scope", async () => {
    const value = await fixture();
    expect(nativeEditorChannelsPath(scenePath)).toBe("assets/native-world.scene.native-editor-channels.json");
    expect(value.sidecarPath).toBe(join(root, "assets", "native-world.scene.native-editor-channels.json"));
    expect(() => nativeEditorChannelsPath("assets/../outside.scene")).toThrow("direct assets/*.scene");
  });

  it("appends only lost UV2 to a new addressed binary, retains authored state and the original file, then is byte-idempotent", async () => {
    const value = await fixture(), before = await tree(), report = await preserve();
    expect(report.preserved).toEqual([]); expect(report.restored).toHaveLength(1);
    const saved = JSON.parse(await readFile(value.meshPath, "utf8")), mesh = saved.meshes[0], next = await readFile(join(root, mesh.delayLoadingFile));
    expect(next.subarray(0, value.binary.length)).toEqual(value.binary);
    expect(next.subarray(value.binary.length)).toEqual(Buffer.from(new Float32Array(value.geometry.uvs2).buffer));
    expect(mesh.delayLoadingFile).toBe(`${scenePath}/geometries/${hash(next)}.babylonbinarymeshdata`);
    expect(mesh._binaryInfo.uvs2AttrDesc).toEqual({ count: 6, stride: 2, offset: value.binary.length, dataType: 1 });
    const unchangedMesh = structuredClone(mesh); delete unchangedMesh._binaryInfo.uvs2AttrDesc; delete unchangedMesh.hasUVs2; unchangedMesh.delayLoadingFile = value.binaryPath;
    expect(unchangedMesh).toEqual(value.mesh); expect(saved.materials).toEqual(value.document.materials);
    expect(await readFile(join(root, value.binaryPath))).toEqual(value.binary);
    const after = await tree();
    for (const [file, sha256] of Object.entries(before)) if (file !== value.meshPath) expect(after[file]).toBe(sha256);
    expect(Object.keys(after)).toHaveLength(Object.keys(before).length + 1);
    expect(await preserve()).toMatchObject({ preserved: ["terrain-identity"], restored: [] });
    expect(await tree()).toEqual(after);
  });

  it("preserves valid authored UV2 even when its values and other geometry changed", async () => {
    const value = await fixture(), edited = Buffer.from(value.binary);
    edited.writeFloatLE(432.5, 0);
    const uv = Buffer.from(new Float32Array([9, 8, 7, 6, 5, 4]).buffer);
    value.mesh._binaryInfo.uvs2AttrDesc = { count: 6, stride: 2, offset: edited.length, dataType: 1 };
    await writeFile(join(root, value.binaryPath), Buffer.concat([edited, uv])); await writeFile(value.meshPath, JSON.stringify(value.document));
    const before = await tree();
    expect(await preserve()).toMatchObject({ preserved: ["terrain-identity"], restored: [] }); expect(await tree()).toEqual(before);
  });

  it("refuses inline geometry that the official packer would discard, leaving authored bytes untouched", async () => {
    const value = await fixture();
    value.document.geometries.vertexData = [{ ...value.geometry, positions: [5, 2, 8, 6, 2, 8, 5, 2, 9], uvs2: [2, 3, 4, 5, 6, 7] }];
    await writeFile(value.meshPath, JSON.stringify(value.document)); const before = await tree();
    await expect(preserve()).rejects.toThrow("inline geometry is not supported by the Editor packer"); expect(await tree()).toEqual(before);
  });

  it.each([["positions", 0], ["normals", 36], ["uvs", 72], ["indices", 96]] as const)("refuses recovery after authored %s changes without writing any file", async (channel, offset) => {
    const value = await fixture(), edited = Buffer.from(value.binary);
    if (channel === "indices") edited.writeInt32LE(1, offset); else edited.writeFloatLE(44.5, offset);
    await writeFile(join(root, value.binaryPath), edited); const before = await tree();
    await expect(preserve()).rejects.toThrow(`authored geometry changed (${channel})`); expect(await tree()).toEqual(before);
  });

  it.each(["hash", "base64", "count", "duplicate", "nonfinite"])("rejects corrupt %s sidecar data before modifying authored resources", async fault => {
    const value = await fixture(), uv = value.sidecar.meshes[0].uv2;
    if (fault === "hash") uv.sha256 = "b".repeat(64);
    if (fault === "base64") uv.base64 += "!";
    if (fault === "count") uv.count += 2;
    if (fault === "duplicate") value.sidecar.meshes.push(structuredClone(value.sidecar.meshes[0]));
    if (fault === "nonfinite") { const bytes = Buffer.from(uv.base64, "base64"); bytes.writeFloatLE(Infinity, 0); uv.base64 = bytes.toString("base64"); uv.sha256 = hash(bytes); }
    await writeFile(value.sidecarPath, JSON.stringify(value.sidecar)); const before = await tree();
    await expect(preserve()).rejects.toThrow(/recovery|nonfinite/); expect(await tree()).toEqual(before);
  });

  it.each(["stride", "count", "offset", "nonfinite"])("fails on invalid existing UV2 %s instead of replacing authored data", async fault => {
    const value = await fixture(), uv = Buffer.from(new Float32Array(value.geometry.uvs2).buffer);
    const descriptor = { count: 6, stride: 2, offset: value.binary.length, dataType: 1 };
    if (fault === "stride") descriptor.stride = 3;
    if (fault === "count") descriptor.count = 4;
    if (fault === "offset") descriptor.offset = 9999;
    if (fault === "nonfinite") uv.writeFloatLE(NaN, 0);
    value.mesh._binaryInfo.uvs2AttrDesc = descriptor;
    await writeFile(join(root, value.binaryPath), Buffer.concat([value.binary, uv])); await writeFile(value.meshPath, JSON.stringify(value.document));
    const before = await tree(); await expect(preserve()).rejects.toThrow(/UV2/); expect(await tree()).toEqual(before);
  });

  it.each(["config", "root", "missing-mesh", "duplicate-mesh", "path"])("rejects mismatched %s identity or path without edits", async fault => {
    const value = await fixture();
    if (fault === "config") { value.config.metadata.nativeEditorImport.manifestSha256 = "b".repeat(64); await writeFile(join(root, scenePath, "config.json"), JSON.stringify(value.config)); }
    if (fault === "root") { value.rootNode.metadata.nativeWorldRoot.manifestSha256 = "b".repeat(64); await writeFile(join(root, scenePath, "nodes", "root.json"), JSON.stringify(value.rootNode)); }
    if (fault === "missing-mesh") value.mesh.id = "another-mesh";
    if (fault === "duplicate-mesh") value.document.meshes.push(structuredClone(value.mesh));
    if (fault === "path") value.mesh.delayLoadingFile = `${scenePath}/geometries/../../outside.bin`;
    await writeFile(value.meshPath, JSON.stringify(value.document)); const before = await tree();
    await expect(preserve()).rejects.toThrow(/identity|missing or duplicate|path/); expect(await tree()).toEqual(before);
  });

  it("validates all recoveries before writing when a later mesh has authored geometry changes", async () => {
    const value = await fixture(), extra = structuredClone(value.sidecar.meshes[0]); extra.meshId = "second-mesh";
    value.sidecar.meshes.push(extra); await writeFile(value.sidecarPath, JSON.stringify(value.sidecar));
    const second = structuredClone(value.document); second.meshes[0]!.id = "second-mesh";
    second.meshes[0]!.delayLoadingFile = `${scenePath}/geometries/second.bin`;
    const edited = Buffer.from(value.binary); edited.writeFloatLE(3, 0);
    await writeFile(join(root, second.meshes[0]!.delayLoadingFile), edited); await writeFile(join(root, scenePath, "meshes", "second.json"), JSON.stringify(second));
    const before = await tree(); await expect(preserve()).rejects.toThrow("authored geometry changed"); expect(await tree()).toEqual(before);
  });
});
