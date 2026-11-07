import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Matrix } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { NativeSection } from "../../src/scene/world/loadNativeSection";
import { prepareNativeFlameGraph, type NativeFlamePlan } from "../../src/scene/world/nativeMaterialGraph";
import { createNativeFlameMaterials, type NativeFlameMaterialBinding, type NativeFlameMaterials, type NativeFlameMaterialInspection, type NativeFlameReplayTime } from "../../src/scene/world/nativeFlameMaterials";
import { createNativeFlamePresentation, type NativeFlamePresentation } from "../../src/scene/world/nativeFlamePresentation";
import { sha256 } from "../../src/assets/package/readAssetPackage";
import { assetFixture } from "../fixtures/assetPackageFixture";

vi.mock("../../src/scene/world/nativeMaterialGraph", () => ({ prepareNativeFlameGraph: vi.fn() }));
vi.mock("../../src/scene/world/nativeFlameMaterials", async importOriginal => ({
  ...await importOriginal<typeof import("../../src/scene/world/nativeFlameMaterials")>(), createNativeFlameMaterials: vi.fn(),
}));

const SOURCE = "FX_E_S.Flameset.Default_Flame01", MODEL = `interlude:${SOURCE}`;
const roots = ["FX_E_T.Flameset.Default_Flame_Final", "FX_E_T.Flameset.de_fire_glow_shader"];
const coordinates = [
  [1922, 12118, 94874, -3343, .4], [1923, 12119, 94650, -3343, .4], [1924, 10957, 94875, -3343, .4], [1925, 10958, 94651, -3343, .4],
  [1926, 11236, 94406, -3343, .4], [1927, 11836, 94407, -3343, .4], [1928, 11795, 95098, -3257, .6], [1930, 11289, 95099, -3257, .6],
  [1932, 11796, 94873, -3257, .6], [1934, 11290, 94874, -3257, .6], [1936, 11796, 94649, -3257, .6], [1938, 11290, 94650, -3257, .6],
] as const;
const fixtureFile = { path: "fixture", bytes: 1, sha256: "b".repeat(64), mime: "application/octet-stream" };
const plan: NativeFlamePlan = { modelId: MODEL, sourceMesh: SOURCE, billboard: true, graph: { ...fixtureFile, path: "native-materials/graph.json", mime: "application/json" },
  animation: { frames: [], minFrameRate: 25, maxFrameRate: 30, totalFrameNum: 16 },
  fade: { object: "FX_E_T.Flameset.FadeColor0", color1: { bgraHex: "151b3100", rgbaBytes: [49, 27, 21, 0] }, color2: { bgraHex: "2e437c00", rgbaBytes: [124, 67, 46, 0] }, colorFadeType: 1, fadePeriod: Math.fround(.4), fadePhase: 1 },
  shaders: [
    { slot: 0, object: roots[0]!, diffuse: "FX_E_T.Flameset.de_fire_0000", outputBlending: 5, twoSided: true, zWrite: false, alphaTest: false, alphaRef: 0 },
    { slot: 1, object: roots[1]!, diffuse: "FX_E_T.Flameset.de_fire_glow_s", outputBlending: 3, twoSided: false, zWrite: false, alphaTest: false, alphaRef: 0 },
  ],
  glow: { object: "FX_E_T.Flameset.de_fire_glow", width: 64, height: 128, format: 8, uClampMode: 0, vClampMode: 0, image: fixtureFile, rawExport: fixtureFile, dds: null, mips: [] },
  combiner: { object: "FX_E_T.Flameset.de_fire_glow_s", material1: "FX_E_T.Flameset.de_fire_glow", material2: "FX_E_T.Flameset.FadeColor0", mask: null, combineOperation: 2, alphaOperation: 0, modulate2X: true, modulate4X: false, invertMask: false },
  resources: new Map(), provenance: { graph: {}, classes: new Map(), nodes: new Map() },
};
const owners: NativeFlamePresentation[] = [], scenes: Scene[] = [], engines: NullEngine[] = [];
const updates: NativeFlameReplayTime[] = [];
function materialOwner(scene: Scene, _plan: NativeFlamePlan, bindings: readonly NativeFlameMaterialBinding[], _signal: AbortSignal): NativeFlameMaterials {
  const replacements = [new StandardMaterial("temporary slot0", scene), new StandardMaterial("temporary slot1", scene)];
  const errors: NativeFlameMaterialInspection["errors"] = []; let disposed = false;
  const accepted = bindings.filter(binding => {
    if (binding.mesh.material !== binding.expectedMaterial) { errors.push({ meshId: binding.mesh.id, slot: binding.slot, reason: "expected-material-mismatch" }); return false; }
    binding.mesh.material = replacements[binding.slot]!; return true;
  });
  return {
    update(time) { updates.push({ ...time }); },
    dispose() { if (disposed) return; disposed = true; for (const binding of accepted) if (!binding.mesh.isDisposed() && binding.mesh.material === replacements[binding.slot]) binding.mesh.material = binding.expectedMaterial; for (const material of replacements) material.dispose(); },
    inspect() { return { status: "source-formulas-native-parity-unverified", disposed, graphSha256: plan.graph.sha256,
      bindingCounts: { requested: bindings.length, active: disposed ? 0 : accepted.filter(binding => binding.mesh.material === replacements[binding.slot]).length, skipped: errors.length, released: disposed ? accepted.length : 0 },
      textureCount: 0, materialCount: disposed ? 0 : 2, current: { textureSeconds: 0, fadeSeconds: 0, frameIndex: 0, frameObject: "fixture", fadeRgbaBytes: [0, 0, 0, 0] }, errors,
      numericalModel: "fixture", clocks: { texture: "explicit", fade: "explicit", synchronization: "unverified" }, lighting: "unlit-encoded-color", nativeParity: "unverified", limitations: [], }; },
  };
}
beforeEach(() => {
  vi.mocked(prepareNativeFlameGraph).mockReset().mockResolvedValue(plan);
  vi.mocked(createNativeFlameMaterials).mockReset().mockImplementation(async (...args) => materialOwner(...args)); updates.length = 0;
});
afterEach(() => {
  for (const owner of owners.splice(0)) owner.dispose();
  for (const scene of scenes.splice(0)) scene.dispose();
  for (const engine of engines.splice(0)) engine.dispose();
  vi.unstubAllGlobals(); vi.restoreAllMocks();
});
async function fixture(authored = false) {
  const engine = new NullEngine(), scene = new Scene(engine); engines.push(engine); scenes.push(scene); scene.useRightHandedSystem = true;
  const asset = await assetFixture("model", { id: MODEL, source: { edition: "interlude", package: "FX_E_S", object: SOURCE, sha256: "c".repeat(64) } });
  const archiveHash = await sha256(asset.bytes), geometry = asset.manifest.files[0]!;
  const model = { id: MODEL, sourceObject: SOURCE, archive: { file: `${archiveHash}/asset.l2asset`, bytes: asset.bytes.length, sha256: archiveHash }, model: { file: `${archiveHash}/model.glb`, bytes: geometry.bytes, sha256: geometry.sha256 } };
  const placements = coordinates.map(([index, x, y, z, scale]) => ({ id: `interlude:20_20.StaticMeshActor${index}`, modelId: MODEL, sourceMesh: SOURCE,
    matrix: [Math.fround(scale), 0, 0, 0, 0, Math.fround(scale), 0, 0, 0, 0, Math.fround(scale), 0, x * .01, z * .01, y * .01, 1], materialOverrides: [] }));
  const section = { manifestSha256: "a".repeat(64), manifest: { models: [model], placements }, dispose: vi.fn() } as unknown as NativeSection;
  const world = new TransformNode("authoring wrapper", scene), unrelated = new TransformNode("edited tree", scene); unrelated.position.x = .75;
  const materials = roots.map((root, slot) => {
    const material = new PBRMaterial(`renamed diagnostic ${slot}`, scene); material.metallic = 0; material.roughness = 1; material.albedoColor = new Color3(1, 0, 1);
    material.enableSpecularAntiAliasing = true; material.transparencyMode = PBRMaterial.PBRMATERIAL_OPAQUE; material.maxSimultaneousLights = authored ? 8 : 4;
    material.metadata = { gltf: { extras: { nativeMaterialGraph: "native-materials/graph.json", nativeMaterialRoot: root, nativeRuntimeStatus: "unsupported-diagnostic", nativeSectionIndex: slot, nativeSourceReference: root, nativeSlotProperties: { Material: { object: root } } } } };
    return material;
  });
  const entries = placements.map(source => {
    const root = new TransformNode("renamed placement", scene); root.metadata = { nativePlacement: structuredClone(source) }; root.parent = authored ? world : null; root.setPreTransformMatrix(Matrix.FromArray(source.matrix));
    if (!authored) root.freezeWorldMatrix();
    const inner = new TransformNode("imported glTF root", scene); inner.parent = root;
    const meshes = materials.map((material, slot) => { const mesh = MeshBuilder.CreatePlane("same imported clone name", {}, scene); mesh.id = `repeated-clone-slot-${slot}`; mesh.parent = inner; mesh.material = material; mesh.metadata = {}; return mesh; });
    return { root, inner, meshes };
  });
  const fetcher = vi.fn(async (_url: string, _options?: RequestInit) => new Response(asset.bytes.slice().buffer as ArrayBuffer)); vi.stubGlobal("fetch", fetcher);
  return { scene, section, asset, archiveHash, model, materials, entries, world, unrelated, fetcher };
}
async function load(data: Awaited<ReturnType<typeof fixture>>, controller = new AbortController()) {
  const owner = await createNativeFlamePresentation(data.scene, data.section, controller.signal); owners.push(owner); return owner;
}

describe("native flame presentation boundary", () => {
  it.each([false, true])("binds all source slots and preserves authored values (authored=%s)", async authored => {
    const data = await fixture(authored), before = data.entries.map(entry => ({ parent: entry.inner.parent, matrix: [...entry.root.getPivotMatrix().asArray()] }));
    const originalMaterials = data.scene.materials.length, owner = await load(data);
    expect(owner.inspect()).toMatchObject({ status: "ready", failure: null, archiveSha256: data.archiveHash, placementCounts: { declared: 12, eligible: 12, active: 12, skipped: 0 }, materials: { bindingCounts: { requested: 24, active: 24 } }, nativeParity: "unverified" });
    expect(owner.inspect().billboards).toHaveLength(12);
    expect(data.fetcher).toHaveBeenCalledWith(`/l2/maps/${data.section.manifestSha256}/map-section-models/${data.model.archive.file}`, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    owner.update({ textureSeconds: .25, fadeSeconds: 1.75 }, [11000, 96000, -3200]);
    expect(updates.at(-1)).toEqual({ textureSeconds: .25, fadeSeconds: 1.75 }); expect(data.unrelated.position.x).toBe(.75);
    owner.dispose(); owner.dispose();
    data.entries.forEach((entry, index) => { expect(entry.inner.parent).toBe(before[index]!.parent); expect([...entry.root.getPivotMatrix().asArray()]).toEqual(before[index]!.matrix); expect(entry.meshes.map(mesh => mesh.material)).toEqual(data.materials); });
    expect(data.scene.materials.length).toBe(originalMaterials); expect(data.section.dispose).not.toHaveBeenCalled();
  });

  it.each(["tint", "emissive", "roughness", "culling", "alpha", "plugin"])("retains an authored %s edit and leaves its entire placement unwrapped", async change => {
    const data = await fixture(true), mesh = data.entries[0]!.meshes[0]!, edited = data.materials[0]!.clone("authored override"); mesh.material = edited;
    if (change === "tint") edited.albedoColor.r = .2;
    if (change === "emissive") edited.emissiveColor.r = .1;
    if (change === "roughness") edited.roughness = .5;
    if (change === "culling") edited.backFaceCulling = false;
    if (change === "alpha") edited.alpha = .5;
    if (change === "plugin") edited.clearCoat.isEnabled = true;
    const owner = await load(data);
    expect(owner.inspect().placementCounts).toMatchObject({ active: 11, skipped: 1 }); expect(mesh.material).toBe(edited);
    expect(data.entries[0]!.inner.parent).toBe(data.entries[0]!.root); expect(data.entries[0]!.meshes[1]!.material).toBe(data.materials[1]);
  });

  it("refuses names without provenance and ambiguous slot assignments", async () => {
    const data = await fixture(), clone = data.materials[0]!.clone("UNSUPPORTED_NATIVE_GRAPH_SLOT_0"); clone.metadata = {}; data.entries[0]!.meshes[0]!.material = clone;
    data.entries[1]!.meshes[1]!.material = data.materials[0]!;
    const owner = await load(data); expect(owner.inspect().placementCounts).toMatchObject({ active: 10, skipped: 2 });
    expect(owner.inspect().placements.slice(0, 2).map(entry => entry.reason)).toEqual(["native-material-slot-provenance-missing", "native-material-slot-duplicated"]);
  });

  it("releases both slots and billboard immediately when a later authored assignment changes", async () => {
    const data = await fixture(true), owner = await load(data), entry = data.entries[0]!, replacement = new StandardMaterial("later authored choice", data.scene);
    entry.meshes[0]!.material = replacement;
    expect(entry.inner.parent).toBe(entry.root); expect(entry.meshes[1]!.material).toBe(data.materials[1]);
    owner.update({ textureSeconds: 1, fadeSeconds: 2 }, [11000, 96000, -3200]);
    expect(owner.inspect().placementCounts).toMatchObject({ active: 11, released: 1 }); expect(entry.meshes[0]!.material).toBe(replacement);
    owner.dispose(); expect(entry.meshes[0]!.material).toBe(replacement);
  });

  it("preserves reparented placements and releases presentation instead of reclaiming them", async () => {
    const data = await fixture(true), owner = await load(data), entry = data.entries[0]!, newParent = new TransformNode("authored grouping", data.scene);
    entry.root.parent = newParent; owner.update({ textureSeconds: 1, fadeSeconds: 2 }, [11000, 96000, -3200]);
    expect(entry.root.parent).toBe(newParent); expect(entry.inner.parent).toBe(entry.root); expect(entry.meshes.map(mesh => mesh.material)).toEqual(data.materials);
    expect(owner.inspect().placementCounts.released).toBe(1);
  });

  it.each(["http", "length", "hash", "geometry", "reader", "roots"])("keeps valid world and source assignments after a %s failure", async failure => {
    const data = await fixture(), count = data.scene.materials.length;
    if (failure === "http") data.fetcher.mockImplementation(async () => new Response("missing", { status: 404 }));
    if (failure === "length") data.model.archive.bytes++;
    if (failure === "hash") { const bytes = data.asset.bytes.slice(); bytes[0] = bytes[0]! ^ 1; data.fetcher.mockImplementation(async () => new Response(bytes.buffer as ArrayBuffer)); }
    if (failure === "geometry") data.model.model.sha256 = "e".repeat(64);
    if (failure === "reader") vi.mocked(prepareNativeFlameGraph).mockRejectedValueOnce(new Error("unverified graph dependency"));
    if (failure === "roots") data.entries[0]!.root.metadata.nativePlacement.id = "wrong";
    const owner = await load(data); expect(owner.inspect().status).toBe("failed"); expect(owner.inspect().failure).toBeTruthy();
    expect(data.scene.materials.length).toBe(count); expect(data.section.dispose).not.toHaveBeenCalled();
    for (const entry of data.entries) { expect(entry.inner.parent).toBe(entry.root); expect(entry.meshes.map(mesh => mesh.material)).toEqual(data.materials); }
  });

  it("adapts the verified URL for Editor file Play", async () => {
    const data = await fixture(); vi.stubGlobal("location", { protocol: "file:" }); await load(data);
    expect(data.fetcher.mock.calls[0]?.[0]).toBe(`l2/maps/${data.section.manifestSha256}/map-section-models/${data.model.archive.file}`);
  });

  it("aborts pending preparation promptly and restores all ownership on later abort", async () => {
    const data = await fixture(), controller = new AbortController();
    data.fetcher.mockImplementationOnce(() => new Promise<Response>(() => {}));
    const pending = load(data, controller); controller.abort(); const aborted = await pending;
    expect(aborted.inspect()).toMatchObject({ status: "aborted", disposed: true }); expect(createNativeFlameMaterials).not.toHaveBeenCalled();
    const secondController = new AbortController(), owner = await load(data, secondController); secondController.abort();
    expect(owner.inspect()).toMatchObject({ status: "aborted", disposed: true });
    for (const entry of data.entries) expect(entry.meshes.map(mesh => mesh.material)).toEqual(data.materials);
  });

  it("retains in-place authored edits made while material preparation waits", async () => {
    const data = await fixture(true); let release!: () => void, started!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; }), ready = new Promise<void>(resolve => { started = resolve; });
    vi.mocked(createNativeFlameMaterials).mockImplementationOnce(async (...args) => { started(); await gate; return materialOwner(...args); });
    const pending = load(data); await ready; data.materials[0]!.roughness = .25; release(); const owner = await pending;
    expect(data.materials[0]!.roughness).toBe(.25); expect(owner.inspect().placementCounts).toMatchObject({ active: 0, released: 12 });
    for (const entry of data.entries) expect(entry.meshes.map(mesh => mesh.material)).toEqual(data.materials);
  });

  it("contains invalid replay inputs within the effect and restores source assignments", async () => {
    const data = await fixture(), owner = await load(data);
    expect(() => owner.update({ textureSeconds: 0, fadeSeconds: 0 }, [NaN, 0, 0])).not.toThrow();
    expect(owner.inspect().status).toBe("failed"); expect(data.section.dispose).not.toHaveBeenCalled();
    for (const entry of data.entries) expect(entry.meshes.map(mesh => mesh.material)).toEqual(data.materials);
  });

  it("preflights finite out-of-range seeks without changing active materials, billboards or replay", async () => {
    const data = await fixture(), owner = await load(data);
    owner.update({ textureSeconds: .25, fadeSeconds: .75 }, [11000, 96000, -3200]);
    const before = owner.inspect(), bindings = data.entries.map(entry => ({ parent: entry.inner.parent, materials: entry.meshes.map(mesh => mesh.material) }));
    const previousUpdates = [...updates];
    expect(() => owner.validateReplayTime({ textureSeconds: 1e100, fadeSeconds: .75 })).toThrow("signed-int truncation");
    expect(() => owner.validateReplayTime({ textureSeconds: .25, fadeSeconds: 1e100 })).toThrow("finite binary32");
    expect(owner.inspect()).toEqual(before); expect(updates).toEqual(previousUpdates);
    data.entries.forEach((entry, index) => { expect(entry.inner.parent).toBe(bindings[index]!.parent); expect(entry.meshes.map(mesh => mesh.material)).toEqual(bindings[index]!.materials); });
    expect(() => owner.validateReplayTime({ textureSeconds: 1, fadeSeconds: 2 })).not.toThrow();
    owner.update({ textureSeconds: 1, fadeSeconds: 2 }, [11000, 96000, -3200]);
    expect(owner.inspect().placementCounts.active).toBe(12); expect(updates.at(-1)).toEqual({ textureSeconds: 1, fadeSeconds: 2 });
  });
});
