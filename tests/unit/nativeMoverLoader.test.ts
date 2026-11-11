import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { AssetContainer } from "@babylonjs/core/assetContainer";
import { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import { Matrix } from "@babylonjs/core/Maths/math.vector";
import { sha256 } from "../../src/assets/package/readAssetPackage";
import { nativeMoverMapSha256 } from "../../src/scene/world/nativeMoverManifest";
import { loadNativeMovers, type NativeMovers } from "../../src/scene/world/loadNativeMovers";
import { loadNativeTileMovers } from "../../src/scene/world/loadNativeTileMovers";
import { createNativeMoverTargets } from "../../src/scene/world/nativeMoverTargets";
import type { NativeMoverRecord } from "../../src/scene/world/nativeMoverManifest";

vi.mock("@babylonjs/core/Loading/sceneLoader", () => ({ LoadAssetContainerAsync: vi.fn() }));
const encode = (v: unknown): Uint8Array<ArrayBuffer> => new TextEncoder().encode(JSON.stringify(v));
function glb() {
  const json = encode({ asset: { version: "2.0" } }), length = (json.length + 3) & ~3;
  const bytes = new Uint8Array(20 + length), view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, bytes.length, true);
  view.setUint32(12, length, true); view.setUint32(16, 0x4e4f534a, true); bytes.fill(32, 20); bytes.set(json, 20); return bytes;
}
describe("additive native mover loading", () => {
  let engine: NullEngine, scene: Scene, owners: NativeMovers[];
  const terrainHash = "c".repeat(64);
  beforeEach(() => { engine = new NullEngine(); scene = new Scene(engine); scene.useRightHandedSystem = true; owners = []; vi.mocked(LoadAssetContainerAsync).mockReset(); });
  afterEach(() => { owners.forEach(owner => owner.dispose()); scene.dispose(); engine.dispose(); vi.unstubAllGlobals(); });
  function container(animated = false) {
    const value = new AssetContainer(scene), mesh = MeshBuilder.CreateBox("original door", { width: 1.5, height: 3, depth: .1 }, scene);
    mesh.position.set(.75, 1.5, 0); const material = new StandardMaterial("original opaque material", scene); mesh.material = material;
    value.meshes.push(mesh); value.materials.push(material);
    if (animated) value.animationGroups.push(new AnimationGroup("unexpected clip", scene));
    value.removeAllFromScene(); return value;
  }
  async function fixture() {
    const bytes = glb(), archive = "a".repeat(64), modelId = "interlude:l2fortress_02_s.Fort02_indoor";
    const manifest = { schemaVersion: 1, kind: "native-map-movers", sourceMap: { packageSha256: nativeMoverMapSha256 },
      models: [{ id: modelId, sourceObject: "l2fortress_02_s.Fort02_indoor", model: { file: `models/${archive}/model.glb`, sha256: await sha256(bytes), bytes: bytes.length },
        archive: { file: `models/${archive}/asset.l2asset`, sha256: archive, bytes: 500 } }],
      movers: [194, 195].map((id, i) => ({ id: `interlude:20_20.Mover${id}`, modelId, serverObject: { realId: 20200000 + id, id, type: 1 },
        closedMatrix: Array.from(Matrix.Translation(i * 4, 0, 0).asArray()), openMatrix: Array.from(Matrix.Translation(i * 4, 1.36, 0).asArray()),
        moveTimeSeconds: 1, initialKey: 0, initiallyClosed: true })) };
    const manifestBytes = encode(manifest), identity = await sha256(manifestBytes), base = `/l2/movers/${identity}/`;
    const catalog = { schemaVersion: 1, models: [], movers: [{ id: "map-20-20-movers", manifest: base + "movers.json", manifestSha256: identity, terrainSha256: terrainHash, sourceMapSha256: nativeMoverMapSha256 }] };
    const responses = new Map<string, Uint8Array<ArrayBuffer>>([["/l2/catalog.json", encode(catalog)], [base + "movers.json", manifestBytes], [base + manifest.models[0]!.model.file, bytes]]);
    const fetcher = vi.fn(async (path: string) => new Response(responses.get(path)?.slice().buffer ?? "missing", { status: responses.has(path) ? 200 : 404 }));
    vi.stubGlobal("fetch", fetcher); vi.mocked(LoadAssetContainerAsync).mockImplementation(async () => container());
    return { manifest, catalog, responses, base, fetcher };
  }
  async function load(signal = new AbortController().signal) { const result = await loadNativeMovers(scene, terrainHash, signal); if (result) owners.push(result); return result; }
  it("loads two independent mutable leaves from one verified model and excludes them from Editor serialization", async () => {
    await fixture(); const owner = (await load())!;
    expect(owner.targets).toHaveLength(2); expect(LoadAssetContainerAsync).toHaveBeenCalledTimes(1);
    const [a, b] = owner.targets; expect(a!.root.isWorldMatrixFrozen).toBe(false); expect(a!.root.doNotSerialize).toBe(true);
    expect(a!.meshes[0]!.material).toBe(b!.meshes[0]!.material); expect(a!.meshes[0]!.material!.backFaceCulling).toBe(true);
    a!.requestToggle(); a!.advance(.5); expect(a!.inspection().matrix[13]).toBeCloseTo(.68); expect(b!.inspection().matrix[13]).toBe(0);
    expect(owner.targets.flatMap(target => [...target.meshes]).every(mesh => mesh.metadata.worldSupportsWalking === false && mesh.isPickable)).toBe(true);
    owner.dispose(); expect(scene.meshes).toHaveLength(0); expect(scene.transformNodes).toHaveLength(0); expect(scene.materials).toHaveLength(0);
  });
  it("keeps a section without registered movers unchanged", async () => {
    const f = await fixture(); f.responses.set("/l2/catalog.json", encode({ schemaVersion: 1, models: [] }));
    expect(await load()).toBeNull(); expect(LoadAssetContainerAsync).not.toHaveBeenCalled(); expect(scene.meshes).toHaveLength(0);
  });
  it("does not attach a bundle belonging to a different terrain", async () => {
    const f = await fixture(); f.catalog.movers[0]!.terrainSha256 = "d".repeat(64); f.responses.set("/l2/catalog.json", encode(f.catalog));
    expect(await load()).toBeNull(); expect(f.fetcher).toHaveBeenCalledTimes(1);
  });
  it("rejects altered model bytes before invoking the loader", async () => {
    const f = await fixture(), key = f.base + f.manifest.models[0]!.model.file;
    const bad = f.responses.get(key)!.slice(); bad[bad.length - 1] = bad[bad.length - 1]! ^ 1; f.responses.set(key, bad);
    await expect(load()).rejects.toThrow(/identity/); expect(LoadAssetContainerAsync).not.toHaveBeenCalled(); expect(scene.meshes).toHaveLength(0);
  });
  it("rejects altered manifest bytes and duplicate terrain owners", async () => {
    const f = await fixture(); f.responses.set(f.base + "movers.json", encode({ ...f.manifest, movers: [] }));
    await expect(load()).rejects.toThrow(/identity/);
    f.catalog.movers.push({ ...f.catalog.movers[0]!, id: "other-movers" }); f.responses.set("/l2/catalog.json", encode(f.catalog));
    await expect(load()).rejects.toThrow(/ambiguous/);
  });
  it("rolls back unexpected animation resources", async () => {
    await fixture(); vi.mocked(LoadAssetContainerAsync).mockImplementation(async () => container(true));
    await expect(load()).rejects.toThrow(/rigid/); expect(scene.meshes).toHaveLength(0); expect(scene.materials).toHaveLength(0); expect(scene.animationGroups).toHaveLength(0);
  });
  it("disposes a model returned after cancellation and retains unrelated scene content", async () => {
    await fixture(); const retained = MeshBuilder.CreateBox("retained authored object", {}, scene), control = new AbortController();
    let resolve!: (value: AssetContainer) => void;
    vi.mocked(LoadAssetContainerAsync).mockImplementation(() => new Promise<AssetContainer>(done => { resolve = done; }));
    const loading = load(control.signal); const rejection = expect(loading).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(LoadAssetContainerAsync).toHaveBeenCalledOnce()); control.abort(); resolve(container()); await rejection;
    expect(scene.meshes).toEqual([retained]); expect(scene.materials).toHaveLength(0);
  });
  it("disposes every node it created when instancing a later mover throws", async () => {
    const retained = MeshBuilder.CreateBox("retained authored object", {}, scene), template = container();
    const mover = (id: number, modelId: string): NativeMoverRecord => ({ id: `interlude:20_20.Mover${id}`, modelId, serverObject: { realId: id, id, type: 1 },
      closedMatrix: Array.from(Matrix.Identity().asArray()), openMatrix: Array.from(Matrix.Translation(0, 1, 0).asArray()), moveTimeSeconds: 1,
      initialKey: 0, initiallyClosed: true });
    const broken = { instantiateModelsToScene: () => { MeshBuilder.CreateBox("half instanced", {}, scene); throw new Error("instancing failed"); } } as unknown as AssetContainer;
    const templates = new Map([["interlude:good", template], ["interlude:broken", broken]]);
    expect(() => createNativeMoverTargets(scene, templates, [mover(1, "interlude:good"), mover(2, "interlude:broken")], () => {})).toThrow(/instancing failed/);
    expect(scene.meshes).toEqual([retained]); expect(scene.transformNodes).toHaveLength(0);
    template.dispose();
  });
  it("loads tile movers closed from a pinned tile manifest without marking any mesh for collision", async () => {
    const bytes = glb(), archive = "a".repeat(64), modelId = "interlude:l2fortress_02_s.Fort02_indoor";
    const manifest = { kind: "native-tile-movers", schemaVersion: 1, tileId: "20_20", sourceMap: { path: "maps/20_20.unr", sha256: "c".repeat(64) },
      classEvidence: {}, gaps: [],
      models: [{ id: modelId, sourceObject: "l2fortress_02_s.Fort02_indoor", archive: { resource: `/l2/${archive}/asset.l2asset`, sha256: archive, bytes: 500 },
        model: { resource: `/l2/${archive}/model.glb`, sha256: await sha256(bytes), bytes: bytes.length } }],
      movers: [1, 24].map((id, i) => ({ id: `interlude:20_20.Mover${id}`, actorName: `Mover${id}`, exportIndex: id, modelId,
        serverObject: { realId: 20200000 + id, id, type: 1 }, closedMatrix: Array.from(Matrix.Translation(i * 4, 0, 0).asArray()),
        openMatrix: Array.from(Matrix.Translation(i * 4, 1.36, 0).asArray()), moveTimeSeconds: 1, initialKey: 0, initiallyClosed: true,
        keys: [], sounds: [], collision: { decision: "slots", slots: [0], evidence: [] } })) };
    const manifestBytes = encode(manifest), identity = await sha256(manifestBytes), path = `/l2/movers/${identity}/tile-movers.json`;
    const responses = new Map<string, Uint8Array<ArrayBuffer>>([[path, manifestBytes], [manifest.models[0]!.model.resource, bytes]]);
    vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(responses.get(url)?.slice().buffer ?? "missing", { status: responses.has(url) ? 200 : 404 })));
    vi.mocked(LoadAssetContainerAsync).mockImplementation(async () => container());
    const movers = await loadNativeTileMovers(scene, { kind: "movers", manifest: path, manifestSha256: identity, manifestBytes: manifestBytes.length },
      new AbortController().signal);
    expect(movers.targets.map(target => target.source.id)).toEqual(["interlude:20_20.Mover1", "interlude:20_20.Mover24"]);
    expect(movers.targets.map(target => target.inspection().matrix)).toEqual(manifest.movers.map(mover => mover.closedMatrix));
    const meshes = movers.targets.flatMap(target => [...target.meshes]);
    expect(meshes.length).toBeGreaterThan(0);
    expect(meshes.every(mesh => mesh.metadata.worldCollision === undefined && mesh.metadata.nativeMoverId)).toBe(true);
    movers.dispose(); expect(scene.meshes).toHaveLength(0); expect(scene.transformNodes).toHaveLength(0);
  });
});
