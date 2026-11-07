import { createHash } from "node:crypto";
import { existsSync, promises as fs } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const { planNativeEffectStage, applyNativeEffectStage, stageNativeEffect } =
  await import(pathToFileURL(resolve("scripts/stage-native-effect.mjs")).href);
const roots: string[] = [], hash = (value: Buffer) => createHash("sha256").update(value).digest("hex");
const encode = (value: unknown) => Buffer.from(JSON.stringify(value) + "\n");
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jL1sAAAAASUVORK5CYII=", "base64");
type Json = Record<string, any>;
async function tree(root: string): Promise<Record<string, { sha256: string; mtimeMs: number }>> {
  const result: Record<string, { sha256: string; mtimeMs: number }> = {};
  async function walk(path: string, prefix: string) {
    for (const row of await fs.readdir(path, { withFileTypes: true })) {
      if (row.isDirectory()) await walk(join(path, row.name), prefix + row.name + "/");
      else result[prefix + row.name] = { sha256: hash(await fs.readFile(join(path, row.name))), mtimeMs: (await fs.stat(join(path, row.name))).mtimeMs };
    }
  }
  await walk(root, ""); return result;
}
function model() {
  const doc = { asset: { version: "2.0" }, buffers: [{ byteLength: png.length }], bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: png.length }],
    images: [{ bufferView: 0, mimeType: "image/png" }], textures: [{ source: 0 }],
    materials: [{ extras: { nativeSourceReference: "Fixture.TextureA" }, pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
    meshes: [{ primitives: [{ material: 0, attributes: {} }] }] };
  const raw = Buffer.from(JSON.stringify(doc)), json = Buffer.concat([raw, Buffer.alloc((4 - raw.length % 4) % 4, 32)]);
  const bin = Buffer.concat([png, Buffer.alloc((4 - png.length % 4) % 4)]), header = Buffer.alloc(12), a = Buffer.alloc(8), b = Buffer.alloc(8);
  header.writeUInt32LE(0x46546c67); header.writeUInt32LE(2, 4); header.writeUInt32LE(28 + json.length + bin.length, 8);
  a.writeUInt32LE(json.length); a.writeUInt32LE(0x4e4f534a, 4); b.writeUInt32LE(bin.length); b.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, a, json, b, bin]);
}
async function fixture() {
  const root = await fs.mkdtemp(join(tmpdir(), "native-effect-stage-test-")); roots.push(root);
  const bundleDir = join(root, "bundle"), outputDir = join(root, "runtime"), products = new Map<string, Buffer>();
  const assets: Json[] = [];
  function asset(kind: string, object: string, primary: Buffer) {
    const archive = Buffer.from(`retained fixture archive: ${object}`), prefix = `assets/${hash(archive)}`;
    const file = kind === "texture" ? "texture.png" : kind === "model" ? "model.glb" : "audio.wav", id = `interlude:${object}`;
    const metadata = { schemaVersion: 1, id, kind, source: { object, sha256: "a".repeat(64) },
      files: [{ path: file, bytes: primary.length, sha256: hash(primary) }], [kind === "texture" ? "image" : kind]: { file } };
    products.set(`${prefix}/${file}`, primary); products.set(`${prefix}/asset.json`, encode(metadata)); products.set(`${prefix}/asset.l2asset`, archive);
    assets.push({ id, object, kind, primary: `${prefix}/${file}`, manifest: `${prefix}/asset.json`, archive: `${prefix}/asset.l2asset`, archiveSha256: hash(archive) });
  }
  asset("texture", "Fixture.TextureA", png); asset("texture", "Fixture.TextureB", png);
  asset("model", "Fixture.Mesh", model()); asset("audio", "Fixture.Sound", Buffer.from("not staged audio"));
  const meshProperties = { Name: "MeshA", StaticMesh: { object: "Fixture.Mesh" }, Texture: { object: "Engine.S_Emitter" }, DrawStyle: 3, ZTest: true };
  const spriteProperties = { Name: "SpriteB", Texture: { object: "Fixture.TextureA" }, TextureUSubdivisions: 2, TextureVSubdivisions: 2, SubdivisionStart: 2, SubdivisionEnd: 3 };
  const order = [{ symbol: "MeshA" }, { symbol: "SpriteB" }];
  const graph: Json = { skillRow: { skill_id: 3, skill_level: 1 }, soundRow: { sound: "Fixture.Sound" }, classDefaults: [],
    associations: [{ effectObject: "fixture.actor", dispatchStages: ["init"] }], stages: [],
    sourceDispatch: { bindings: [{ stage: "init", effectObject: "Fixture.Actor" }] },
    effects: [{ object: "fixture.actor", properties: { Emitters: order }, effectiveProperties: { Emitters: order, DrawScale: 2 },
      children: [{ name: "SpriteB", object: "fixture.actor.SpriteB", class: "Engine.SpriteEmitter", properties: spriteProperties, effectiveProperties: spriteProperties },
        { name: "MeshA", object: "fixture.actor.MeshA", class: "Engine.MeshEmitter", properties: meshProperties, effectiveProperties: meshProperties }] }],
    nativeObjects: [{ source: { object: "Fixture.TextureA", class: "Texture" }, properties: { AnimNext: { object: "Fixture.TextureB" }, MinFrameRate: 18, MaxFrameRate: 18, TotalFrameNum: 2 }, effectiveProperties: {} },
      { source: { object: "Fixture.TextureB", class: "Texture" }, properties: {}, effectiveProperties: {} }], unresolvedDependencies: [] };
  const manifest: Json = { schemaVersion: 1, kind: "native-effect-bundle", id: "fixture:skill3", skillId: 3, level: 1,
    sourceGraph: "effect-source.json", sourceFiles: [], associations: graph.associations, assets, files: [] };
  async function save() {
    products.set("effect-source.json", encode(graph));
    manifest.files = [...products].map(([file, bytes]) => ({ file, bytes: bytes.length, sha256: hash(bytes) }));
    for (const [file, bytes] of [...products, ["manifest.json", encode(manifest)] as [string, Buffer]]) {
      await fs.mkdir(dirname(join(bundleDir, file)), { recursive: true }); await fs.writeFile(join(bundleDir, file), bytes);
    }
  }
  await save(); return { root, bundleDir, outputDir, options: { bundleDir, outputDir }, graph, manifest, products, save };
}
afterEach(async () => {
  for (const root of roots.splice(0)) {
    const real = await fs.realpath(root);
    if (dirname(real) !== await fs.realpath(tmpdir()) || !basename(real).startsWith("native-effect-stage-test-")) throw Error("Unexpected cleanup root");
    await fs.rm(real, { recursive: true, force: true });
  }
});

describe("dedicated retained native effect staging", () => {
  it("plans without writes and retains ordered components, stage spelling, material routes, atlas and texture links", async () => {
    const f = await fixture(), before = await tree(f.bundleDir), plan = await planNativeEffectStage(f.options), m = plan.manifest;
    expect(await tree(f.bundleDir)).toEqual(before); expect(existsSync(f.outputDir)).toBe(false);
    expect(m.actors[0].dispatchStages).toEqual(["init"]);
    expect(m.actors[0].stageBindings[0].identityJoin).toEqual({ actorObject: "fixture.actor", bindingEffectObject: "Fixture.Actor", comparison: "case-insensitive-full-object" });
    expect(m.actors[0].effectiveProperties.DrawScale).toBe(2);
    expect(m.components.map((c: Json) => c.object)).toEqual(["fixture.actor.MeshA", "fixture.actor.SpriteB"]);
    expect(m.components.map((c: Json) => c.sourcePointer)).toEqual(["/effects/0/children/1", "/effects/0/children/0"]);
    expect(m.components[0].bindings.texture).toBeNull(); expect(m.components[0].bindings.mesh.object).toBe("Fixture.Mesh");
    expect(m.components[0].bindings.primitiveMaterials[0]).toMatchObject({ meshIndex: 0, primitiveIndex: 0, materialIndex: 0, textureResourceKey: "interlude:Fixture.TextureA" });
    expect(m.components[1].effectiveProperties).toMatchObject({ TextureUSubdivisions: 2, SubdivisionStart: 2, SubdivisionEnd: 3 });
    expect(m.textureGraph[0]).toMatchObject({ resourceKey: "interlude:Fixture.TextureA", nextResourceKey: "interlude:Fixture.TextureB", loopInferred: false });
    expect(Object.keys(m.resources)).toHaveLength(3); expect(m.unresolved.excludedAudioAssets).toHaveLength(1);
  });
  it("stages only exact GLB/PNG plus manifest; repeated and verify runs preserve output/source bytes and mtimes", async () => {
    const f = await fixture(), input = await tree(f.bundleDir), plan = await planNativeEffectStage(f.options);
    const made = await applyNativeEffectStage(plan), staged = await tree(made.outputDirectory);
    expect(made.status).toBe("produced"); expect(Object.keys(staged)).toHaveLength(3);
    expect(Object.keys(staged).every(name => name === "manifest.json" || /^resources\/[a-f0-9]{64}\.(glb|png)$/.test(name))).toBe(true);
    expect((await stageNativeEffect(f.options)).status).toBe("preserved");
    expect((await stageNativeEffect({ ...f.options, verifyOnly: true })).status).toBe("verified");
    expect(await tree(made.outputDirectory)).toEqual(staged); expect(await tree(f.bundleDir)).toEqual(input);
  });
  it("produces identical content identities in independent output directories", async () => {
    const f = await fixture(), a = await stageNativeEffect(f.options), b = await stageNativeEffect({ ...f.options, outputDir: join(f.root, "other") });
    expect(a.manifestSha256).toBe(b.manifestSha256);
    expect(await fs.readFile(a.manifestFile)).toEqual(await fs.readFile(b.manifestFile));
  });
  it("refuses stale expected source manifest and missing verify outputs without writes", async () => {
    const f = await fixture();
    await expect(planNativeEffectStage({ ...f.options, expectedManifestSha256: "0".repeat(64) })).rejects.toThrow(/expected identity/);
    await expect(stageNativeEffect({ ...f.options, verifyOnly: true })).rejects.toThrow(/existing output/);
    expect(existsSync(f.outputDir)).toBe(false);
  });
  it("refuses source changes between plan and apply", async () => {
    const f = await fixture(), plan = await planNativeEffectStage(f.options), file = f.manifest.assets[0].primary;
    await fs.writeFile(join(f.bundleDir, file), Buffer.from("changed"));
    await expect(applyNativeEffectStage(plan)).rejects.toThrow(/changed/); expect(existsSync(f.outputDir)).toBe(false);
  });
  it("preserves and rejects altered or foreign existing outputs", async () => {
    const f = await fixture(), staged = await stageNativeEffect(f.options);
    await fs.writeFile(join(staged.outputDirectory, "foreign.txt"), "retained");
    await expect(stageNativeEffect(f.options)).rejects.toThrow(/file set differs/);
    expect(await fs.readFile(join(staged.outputDirectory, "foreign.txt"), "utf8")).toBe("retained");
  });
  it("rejects a mutated existing payload without repairing it", async () => {
    const f = await fixture(), plan = await planNativeEffectStage(f.options); await applyNativeEffectStage(plan);
    const resource = Object.values(plan.manifest.resources)[0] as Json, file = join(plan.outputDirectory, resource.file);
    await fs.writeFile(file, Buffer.alloc(resource.bytes));
    await expect(stageNativeEffect({ ...f.options, verifyOnly: true })).rejects.toThrow(/identity changed/);
    expect(await fs.readFile(file)).toEqual(Buffer.alloc(resource.bytes));
  });
  it.each(["../outside", "assets\\outside", "C:/outside", "assets/CON.txt"])("rejects declared traversal/device path %s", async file => {
    const f = await fixture(); f.manifest.files.push({ file, bytes: 1, sha256: "a".repeat(64) });
    await fs.writeFile(join(f.bundleDir, "manifest.json"), encode(f.manifest));
    await expect(planNativeEffectStage(f.options)).rejects.toThrow(/inspection failed/); expect(existsSync(f.outputDir)).toBe(false);
  });
  it("rejects duplicate asset identities and unresolved emitter ordering", async () => {
    const f = await fixture(); f.manifest.assets.push({ ...f.manifest.assets[0] }); await f.save();
    await expect(planNativeEffectStage(f.options)).rejects.toThrow(/Duplicate/);
    f.manifest.assets.pop(); f.graph.effects[0].properties.Emitters[0].symbol = "Missing"; await f.save();
    await expect(planNativeEffectStage(f.options)).rejects.toThrow(/emitter symbol/);
  });
  it("rejects input/output overlap and output junction ancestors", async () => {
    const f = await fixture();
    await expect(planNativeEffectStage({ ...f.options, outputDir: join(f.bundleDir, "runtime") })).rejects.toThrow(/overlap/);
    const actual = join(f.root, "actual"), link = join(f.root, "link"); await fs.mkdir(actual); await fs.symlink(actual, link, "junction");
    await expect(planNativeEffectStage({ ...f.options, outputDir: join(link, "runtime") })).rejects.toThrow(/symlink\/junction/);
    expect(await fs.readdir(actual)).toEqual([]);
  });
});
