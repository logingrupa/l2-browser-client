import { createHash } from "node:crypto";
import * as fs from "node:fs";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { runInNewContext } from "node:vm";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Coordinates = number[] | Float32Array;
interface GeometryData {
  positions?: Coordinates;
  normals?: Coordinates;
  uvs?: Coordinates;
  uvs2?: Coordinates;
  uv2s?: Coordinates;
  colors?: Coordinates;
  indices?: number[] | Int32Array;
  [key: string]: unknown;
}
interface Descriptor { count: number; stride: number; offset: number; dataType: number; }
interface SubMesh { materialIndex: number; verticesStart: number; verticesCount: number; indexStart: number; indexCount: number; }
interface MeshData {
  _binaryInfo: Record<string, Descriptor>;
  subMeshes: SubMesh[] | null;
  [key: string]: unknown;
}
interface WriterOptions { geometry: GeometryData; mesh: MeshData; write: boolean; path: string; [key: string]: unknown; }
type Writer = (options: WriterOptions) => Promise<void>;
interface WriterModule { writeBinaryGeometry: Writer; }
interface Installation { close(): void; }
const { installGeometryCompatibility } = createRequire(import.meta.url)("../../tools/editor-webgpu-compat/geometry.cjs") as {
  installGeometryCompatibility(module: WriterModule, versions: { editorVersion: string; babylonVersion: string; writerSha256: string }): Installation;
};

// Exact 4,597-byte installed Editor module, not a rewritten imitation of its
// packing. Captured from app.asar/build/src/project/tools/geometry.js in
// artifacts/native-parity/editor/uv2-export-20261107/installed-geometry.json.
const source = await readFile(new URL("../fixtures/editor-5.5.3-geometry.cjs", import.meta.url));
const writerSha256 = "1b86dac8db1685491e703a1984b60b923478d551df47ec2a36cd39c648aa5a06";
if (createHash("sha256").update(source).digest("hex") !== writerSha256) throw new Error("Installed Editor writer fixture changed.");
const versions = { editorVersion: "5.5.3", babylonVersion: "9.27.1", writerSha256 };
const installations: Installation[] = [];
function install(module: WriterModule): Installation {
  const installation = installGeometryCompatibility(module, versions);
  installations.push(installation);
  return installation;
}
function installedWriter(): WriterModule {
  const exports: Partial<WriterModule> = {};
  runInNewContext(source.toString("utf8"), {
    exports, Buffer,
    require: (name: string) => { if (name !== "fs") throw new Error(`Unexpected writer dependency: ${name}`); return fs; },
  }, { filename: "Editor-5.5.3/project/tools/geometry.js" });
  if (typeof exports.writeBinaryGeometry !== "function") throw new Error("Installed writer export is missing.");
  return exports as WriterModule;
}
function serializedGeometry(): GeometryData {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  try {
    const mesh = new Mesh("UV2 serialization fixture", scene), vertices = new VertexData();
    vertices.positions = [0, 0, 0, 1, 0, 0, 0, 1, 0];
    vertices.normals = [0, 0, 1, 0, 0, 1, 0, 0, 1];
    vertices.uvs = [0, 0, 1, 0, 0, 1];
    vertices.uvs2 = [-0, .25, .375, .5, .625, .75];
    vertices.colors = [.125, .25, .5, 1, .25, .5, .75, 1, .5, .75, 1, 1];
    vertices.indices = [0, 2, 1];
    vertices.applyToMesh(mesh);
    return structuredClone(mesh.geometry!.serializeVerticeData()) as GeometryData;
  } finally { scene.dispose(); engine.dispose(); }
}
const floatBytes = (values: ArrayLike<number>) => Buffer.from(new Float32Array(values).buffer);
const integerBytes = (values: ArrayLike<number>) => Buffer.from(new Int32Array(values).buffer);
function expectedBytes(geometry: GeometryData, withUv2: boolean): Buffer {
  return Buffer.concat([
    floatBytes(geometry.positions!), floatBytes(geometry.normals!), floatBytes(geometry.uvs!),
    ...(withUv2 ? [floatBytes(geometry.uvs2 ?? geometry.uv2s!)] : []),
    floatBytes(geometry.colors!), integerBytes(geometry.indices!), integerBytes([0, 0, 3, 0, 3]),
  ]);
}

describe("Editor Save/Play UV2 writer compatibility", () => {
  let root: string;
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "l2-editor-writer-")); });
  afterEach(async () => {
    installations.splice(0).reverse().forEach(installation => installation.close());
    const target = await realpath(root), parent = await realpath(tmpdir());
    if (dirname(target) !== parent || !basename(target).startsWith("l2-editor-writer-")) throw new Error("Unexpected test output directory.");
    await rm(target, { recursive: true, force: true });
  });
  function options(geometry = serializedGeometry(), name = "geometry.bin"): WriterOptions {
    return {
      geometry, path: join(root, name), write: true,
      mesh: { _binaryInfo: {}, subMeshes: [{ materialIndex: 0, verticesStart: 0, verticesCount: 3, indexStart: 0, indexCount: 3 }], authoredNote: "retain" },
    };
  }

  it("reproduces real Babylon serialization and the installed writer's silent channel loss", async () => {
    const writer = installedWriter(), request = options(), before = structuredClone(request.geometry);
    expect(request.geometry.uvs2).toEqual([-0, .25, .375, .5, .625, .75]);
    expect(request.geometry).not.toHaveProperty("uv2s");
    await writer.writeBinaryGeometry(request);
    expect(request.mesh._binaryInfo).not.toHaveProperty("uvs2AttrDesc");
    expect(request.mesh).not.toHaveProperty("hasUVs2");
    expect(await readFile(request.path)).toEqual(expectedBytes(before, false));
    expect(request.geometry).toEqual(before);
  });

  it("preserves canonical UV2 and every other channel byte using the installed binary writer", async () => {
    const writer = installedWriter(), request = options(), before = structuredClone(request.geometry), mesh = request.mesh;
    install(writer);
    await writer.writeBinaryGeometry(request);
    const bytes = await readFile(request.path);
    expect(bytes).toEqual(expectedBytes(before, true));
    expect(request.mesh).toBe(mesh);
    expect(mesh._binaryInfo).toEqual({
      positionsAttrDesc: { count: 9, stride: 3, offset: 0, dataType: 1 },
      normalsAttrDesc: { count: 9, stride: 3, offset: 36, dataType: 1 },
      uvsAttrDesc: { count: 6, stride: 2, offset: 72, dataType: 1 },
      uvs2AttrDesc: { count: 6, stride: 2, offset: 96, dataType: 1 },
      colorsAttrDesc: { count: 12, stride: 4, offset: 120, dataType: 1 },
      indicesAttrDesc: { count: 3, stride: 1, offset: 168, dataType: 0 },
      subMeshesAttrDesc: { count: 1, stride: 5, offset: 180, dataType: 0 },
    });
    expect(mesh.hasUVs2).toBe(true); expect(mesh.subMeshes).toBeNull(); expect(mesh.authoredNote).toBe("retain");
    expect(request.geometry).toEqual(before); expect(request.geometry).not.toHaveProperty("uv2s");
    expect(Object.is(bytes.readFloatLE(96), -0)).toBe(true);
  });

  it("computes matching UV2 descriptors in the writer's nonwriting mode without making a file", async () => {
    const writer = installedWriter(), request = options(); request.write = false;
    install(writer); await writer.writeBinaryGeometry(request);
    expect(request.mesh._binaryInfo.uvs2AttrDesc).toEqual({ count: 6, stride: 2, offset: 96, dataType: 1 });
    expect(request.mesh._binaryInfo.indicesAttrDesc?.offset).toBe(168);
    await expect(readFile(request.path)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each(["legacy", "both"] as const)("accepts %s aliases without changing authored inputs", async mode => {
    const writer = installedWriter(), request = options();
    request.geometry.uv2s = new Float32Array(request.geometry.uvs2!);
    if (mode === "legacy") delete request.geometry.uvs2;
    const before = structuredClone(request.geometry);
    install(writer); await writer.writeBinaryGeometry(request);
    expect(await readFile(request.path)).toEqual(expectedBytes(before, true));
    expect(request.geometry).toEqual(before);
  });

  it.each(["different-value", "different-zero-sign"] as const)("rejects conflicting %s aliases before any output or descriptor mutation", fault => {
    const original = vi.fn<Writer>(), writer = { writeBinaryGeometry: original }, request = options();
    request.geometry.uv2s = [...request.geometry.uvs2!];
    request.geometry.uv2s[fault === "different-value" ? 1 : 0] = fault === "different-value" ? .5 : 0;
    const before = structuredClone(request);
    install(writer);
    expect(() => writer.writeBinaryGeometry(request)).toThrow(/Conflicting/);
    expect(original).not.toHaveBeenCalled(); expect(request).toEqual(before); expect(fs.existsSync(request.path)).toBe(false);
  });

  it.each(["odd", "short", "nonfinite", "sparse", "not-array", "missing-positions"] as const)("rejects malformed %s canonical UV2 before the installed writer runs", fault => {
    const original = vi.fn<Writer>(), writer = { writeBinaryGeometry: original }, request = options();
    if (fault === "odd") request.geometry.uvs2 = [0, 0, 1, 0, 1];
    if (fault === "short") request.geometry.uvs2 = [0, 0, 1, 0];
    if (fault === "nonfinite") request.geometry.uvs2![2] = Infinity;
    if (fault === "sparse") request.geometry.uvs2 = new Array<number>(6);
    if (fault === "not-array") request.geometry.uvs2 = { length: 6 } as unknown as Coordinates;
    if (fault === "missing-positions") delete request.geometry.positions;
    const before = structuredClone(request);
    install(writer);
    expect(() => writer.writeBinaryGeometry(request)).toThrow(/finite coordinate pair/);
    expect(original).not.toHaveBeenCalled(); expect(request).toEqual(before); expect(fs.existsSync(request.path)).toBe(false);
  });

  it("passes unrelated geometries through unchanged, including options identity, receiver and return promise", async () => {
    const promise = Promise.resolve(), receiver = { marker: "writer caller" };
    let seenThis: unknown;
    const original = vi.fn(function (this: unknown, _options: WriterOptions) { seenThis = this; return promise; });
    const writer = { writeBinaryGeometry: original }, request = options(); delete request.geometry.uvs2;
    install(writer);
    expect(writer.writeBinaryGeometry.call(receiver, request)).toBe(promise);
    expect(original).toHaveBeenCalledExactlyOnceWith(request); expect(original.mock.calls[0]![0]).toBe(request); expect(seenThis).toBe(receiver);
    await promise;
  });

  it("forwards the writer's rejection without swallowing or replacing it", async () => {
    const failure = new Error("Retained writer failure"), promise = Promise.reject(failure);
    const writer: WriterModule = { writeBinaryGeometry: vi.fn(() => promise) };
    install(writer);
    expect(writer.writeBinaryGeometry(options())).toBe(promise);
    await expect(promise).rejects.toBe(failure);
  });

  it.each(["editorVersion", "babylonVersion", "writerSha256"] as const)("refuses a mismatched %s before changing the shared module", key => {
    const writer = installedWriter(), original = writer.writeBinaryGeometry;
    expect(() => installGeometryCompatibility(writer, { ...versions, [key]: "unreviewed" })).toThrow(/requires Editor 5.5.3/);
    expect(writer.writeBinaryGeometry).toBe(original);
  });

  it("restores its own wrapper on close and does not overwrite a later replacement", () => {
    const writer = installedWriter(), original = writer.writeBinaryGeometry, installation = install(writer);
    expect(writer.writeBinaryGeometry).not.toBe(original);
    installation.close(); installation.close(); expect(writer.writeBinaryGeometry).toBe(original);
    const another = install(writer), replacement = vi.fn<Writer>(); writer.writeBinaryGeometry = replacement;
    another.close(); expect(writer.writeBinaryGeometry).toBe(replacement);
  });
});
