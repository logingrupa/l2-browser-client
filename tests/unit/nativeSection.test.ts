import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { AssetContainer } from "@babylonjs/core/assetContainer";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import { loadNativeSection, parseNativeSection, validateSectionGlb, type NativeSection } from "../../src/scene/world/loadNativeSection";
import { sha256 } from "../../src/assets/package/readAssetPackage";

vi.mock("@babylonjs/core/Loading/sceneLoader", () => ({ LoadAssetContainerAsync: vi.fn() }));

function glb(document: object) {
  const text = new TextEncoder().encode(JSON.stringify(document));
  const size = (text.byteLength+3)&~3, bytes = new Uint8Array(20+size), view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, bytes.length, true);
  view.setUint32(12, size, true); view.setUint32(16, 0x4e4f534a, true);
  bytes.fill(32, 20); bytes.set(text, 20); return bytes;
}
const matrix = (x: number, y: number, z: number) => [0, 0, 2, 0, 0, 3, 0, 0, -4, 0, 0, 0, x, y, z, 1];

describe("bounded native map section loading", () => {
  let engine: NullEngine, scene: Scene, loaded: NativeSection[], released: (() => void)[];
  beforeEach(() => { engine = new NullEngine(); scene = new Scene(engine); scene.useRightHandedSystem = true; loaded = []; released = []; vi.mocked(LoadAssetContainerAsync).mockReset(); });
  afterEach(() => { for (const release of released) release(); for (const section of loaded) section.dispose(); scene.dispose(); engine.dispose(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
  function container(name: string) {
    const value = new AssetContainer(scene), mesh = MeshBuilder.CreateBox(name, { size: 1 }, scene), material = new StandardMaterial(`${name}:native-material`, scene);
    mesh.material = material; mesh.metadata = { gltf: { extras: { source: name } } };
    value.meshes.push(mesh); value.materials.push(material); value.removeAllFromScene(); return value;
  }
  async function fixture() {
    const terrainBytes = glb({ asset: { version: "2.0" }, extras: { fixture: "terrain" } });
    const modelBytes = glb({ asset: { version: "2.0" }, extras: { fixture: "model" } });
    const archiveHash = "a".repeat(64);
    const manifest = {
      schemaVersion: 1, kind: "native-map-section-runtime", support: "section-products-ready-for-runtime-validation", errors: [], gaps: ["Native terrain blending unverified."],
      resourceRoots: { terrain: "../map-section", models: "../map-section-models" },
      terrain: { file: "terrain.glb", sha256: await sha256(terrainBytes), bytes: terrainBytes.length, materialStatus: "neutral-inspection-material" },
      models: [{ id: "interlude:Package.Mesh", sourceObject: "Package.Mesh", model: { file: `${archiveHash}/model.glb`, sha256: await sha256(modelBytes), bytes: modelBytes.length },
        archive: { file: `${archiveHash}/asset.l2asset`, sha256: archiveHash, bytes: 500 } }],
      placements: [{ id: "actor0", modelId: "interlude:Package.Mesh", sourceMesh: "Package.Mesh", matrix: matrix(213, -30, 791), materialOverrides: [] },
        { id: "actor1", modelId: "interlude:Package.Mesh", sourceMesh: "Package.Mesh", matrix: matrix(215, -31, 797), materialOverrides: [] }],
      surfaceSpawnCandidate: { sourcePosition: [21300, 79100, -3000], gltfGroundPosition: [213, -30, 791], nativeSpawnVerified: false, collisionVerified: false },
    };
    const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest)), hash = await sha256(manifestBytes), base = `/l2/maps/${hash}/`;
    const catalog = { schemaVersion: 1, models: [], sections: [{ id: "map-20-20-section", manifestSha256: hash, manifest: `${base}map-section-runtime/manifest.json` }] };
    const responses = new Map<string, Uint8Array<ArrayBuffer>>([
      ["/l2/catalog.json", new TextEncoder().encode(JSON.stringify(catalog))], [`${base}map-section-runtime/manifest.json`, manifestBytes],
      [`${base}map-section/terrain.glb`, terrainBytes], [`${base}map-section-models/${archiveHash}/model.glb`, modelBytes],
    ]);
    const fetcher = vi.fn(async (url: string) => {
      const value = responses.get(url);
      return new Response(value?.slice().buffer ?? "missing", { status: value ? 200 : 404 });
    });
    vi.stubGlobal("fetch", fetcher);
    vi.mocked(LoadAssetContainerAsync).mockImplementation(async (_bytes, _scene, options) => container(options?.name === "terrain.glb" ? "terrain-native" : "static-native"));
    return { manifest, manifestBytes, base, catalog, responses, fetcher };
  }
  async function load() { const value = await loadNativeSection(scene, new AbortController().signal); if (!value) throw new Error("Fixture did not load."); loaded.push(value); return value; }
  const counts = () => [scene.meshes.length, scene.transformNodes.length, scene.materials.length];

  it("admits the qualified room fragments alongside the existing floor and rejects mixed identities", async () => {
    const { manifest } = await fixture();
    manifest.placements[0]!.id = "interlude:20_20.StaticMeshActor940";
    manifest.placements[1]!.id = "interlude:20_20.StaticMeshActor1913";
    const bsp = ["original", "walls", "floor", "ceiling"].map(part => ({
      id: part === "original" ? "interlude:20_20.Model798.Brush397" : `interlude:20_20.Model798.Brush610.${part}`,
      sourceModel: "20_20.Model798", sourceBrush: part === "original" ? "20_20.Brush397" : "20_20.Brush610",
      sourceMapSha256: "1beddad24c10a35a1b2e9151727a85158e3e01992299a6671de876645eb1f1e4",
      model: { file: part === "original" ? "bsp-floor.glb" : `bsp-command-${part}.glb`, sha256: "a".repeat(64), bytes: 100 },
      source: { file: part === "original" ? "bsp-floor.json" : `bsp-command-${part}.json`, sha256: "b".repeat(64), bytes: 100 },
      supportPlacementIds: [manifest.placements[part === "original" ? 0 : 1]!.id],
    }));
    expect(parseNativeSection({ ...manifest, bsp }).bsp).toHaveLength(4);
    for (const change of [
      (rows: typeof bsp) => { rows[1]!.id = rows[0]!.id; },
      (rows: typeof bsp) => { rows[1]!.model.file = "bsp-command-floor.glb"; },
      (rows: typeof bsp) => { rows[1]!.sourceBrush = "20_20.Brush397"; },
      (rows: typeof bsp) => { rows[1]!.supportPlacementIds = [manifest.placements[0]!.id]; },
      (rows: typeof bsp) => { rows[1]!.id = "__proto__"; },
    ]) {
      const rows = structuredClone(bsp); change(rows);
      expect(() => parseNativeSection({ ...manifest, bsp: rows })).toThrow(/BSP/);
    }
  });

  it("retains exact placement matrices, native mesh metadata and shared source materials", async () => {
    await fixture(); const before = counts(), section = await load();
    expect(LoadAssetContainerAsync).toHaveBeenCalledTimes(2);
    const details = section.inspection();
    expect(details).toMatchObject({ modelCount: 1, placementCount: 2, finiteBounds: true, terrainMaterial: "neutral-inspection", collisionVerified: false });
    expect(details.sectionWindow).toEqual({ basis: "hand-chosen-presentation-window", status: "unresolved" });
    for (const placement of details.placements) expect(placement.worldMatrix).toEqual(placement.sourceMatrix);
    const props = scene.meshes.filter(mesh => mesh.name === "static-native");
    expect(props).toHaveLength(2); expect(props[0]!.material).toBe(props[1]!.material);
    expect(props[0]!.metadata).toEqual({ gltf: { extras: { source: "static-native" } } });
    expect(props.every(mesh => mesh.scaling.asArray().every(value => value === 1))).toBe(true);
    expect(section.maximum.z).toBeGreaterThan(796);
    expect(section.spawnCandidate?.asArray()).toEqual([213, -30, 791]);
    expect(section.terrainMeshes[0]?.metadata.worldSupportsWalking).toBe(true);
    section.dispose(); section.dispose(); expect(counts()).toEqual(before);
  });

  it.each(["catalog", "manifest", "terrain", "model"] as const)("rejects a corrupt %s before committing a section and rolls back all ownership", async target => {
    const data = await fixture(), before = counts();
    const url = target === "catalog" ? "/l2/catalog.json" : target === "manifest" ? `${data.base}map-section-runtime/manifest.json`
      : [...data.responses.keys()].find(path => path.endsWith(target === "terrain" ? "/terrain.glb" : "/model.glb"))!;
    data.responses.set(url, new TextEncoder().encode(target === "catalog" ? '{"schemaVersion":1,"models":[],"sections":[{"id":"bad"}]}' : "corruption"));
    await expect(load()).rejects.toThrow(target === "catalog" ? "catalog identity/hash/path" : "hash/length mismatch");
    expect(counts()).toEqual(before);
  });

  it("rejects cross-root paths, duplicate models, missing references and unimplemented overrides", async () => {
    const { manifest } = await fixture();
    const variants = [
      () => { const value = structuredClone(manifest); value.resourceRoots.models = "../../elsewhere"; return value; },
      () => { const value = structuredClone(manifest); value.models.push(value.models[0]!); return value; },
      () => { const value = structuredClone(manifest); value.placements[0]!.modelId = "interlude:missing"; return value; },
      () => { const value = structuredClone(manifest); value.placements[0]!.matrix[15] = 0; return value; },
      () => ({ ...manifest, placements: [{ ...manifest.placements[0], materialOverrides: ["native override"] }] }),
      () => ({ ...manifest, surfaceSpawnCandidate: { ...manifest.surfaceSpawnCandidate, gltfGroundPosition: [21300, -3000, 79100] } }),
      () => ({ ...manifest, surfaceSpawnCandidate: { ...manifest.surfaceSpawnCandidate, nativeSpawnVerified: true } }),
    ];
    for (const make of variants) expect(() => parseNativeSection(make())).toThrow();
    expect(() => validateSectionGlb(glb({ asset: { version: "2.0" }, images: [{ uri: "https://elsewhere/texture.png" }] }))).toThrow("unpinned external dependency");
  });

  it.each(["abort", "scene"] as const)("disposes containers that finish after %s lifetime ends", async lifetime => {
    await fixture(); const controller = new AbortController();
    let release!: () => void, started!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const ready = new Promise<void>(resolve => { started = resolve; }); released.push(release);
    let late: AssetContainer | undefined;
    vi.mocked(LoadAssetContainerAsync).mockImplementationOnce(async () => { late = container("late-terrain"); started(); await gate; return late; });
    const pending = loadNativeSection(scene, controller.signal); await ready;
    const dispose = vi.spyOn(late!, "dispose");
    if (lifetime === "abort") controller.abort(); else scene.dispose();
    release(); await expect(pending).rejects.toThrow("disposed during loading");
    if (lifetime === "abort") expect(dispose).toHaveBeenCalledOnce(); else expect(dispose).toHaveBeenCalled();
    expect(late!.meshes).toHaveLength(0); expect(scene.meshes).toHaveLength(0); expect(scene.transformNodes).toHaveLength(0);
  });

  it("rolls back partial Babylon clones when instantiation throws before returning its handle", async () => {
    await fixture(); const before = counts();
    vi.mocked(LoadAssetContainerAsync).mockImplementation(async (_bytes, _scene, options) => {
      const value = container(options?.name === "terrain.glb" ? "terrain-native" : "static-native");
      if (options?.name !== "terrain.glb") vi.spyOn(value, "instantiateModelsToScene").mockImplementation(() => {
        MeshBuilder.CreateBox("partial clone", {}, scene); throw new Error("Clone failed after creating a mesh");
      });
      return value;
    });
    await expect(load()).rejects.toThrow("Clone failed"); expect(counts()).toEqual(before);
  });

  it("treats an unstaged catalog as absent and refuses left-handed adaptation", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("missing", { status: 404 })));
    expect(await loadNativeSection(scene, new AbortController().signal)).toBeNull(); expect(counts()).toEqual([0, 0, 0]);
    scene.useRightHandedSystem = false;
    await expect(loadNativeSection(scene, new AbortController().signal)).rejects.toThrow("right-handed");
    expect(LoadAssetContainerAsync).not.toHaveBeenCalled();
  });
});
