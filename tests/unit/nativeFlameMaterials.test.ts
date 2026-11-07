import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Constants } from "@babylonjs/core/Engines/constants";
import { Scene } from "@babylonjs/core/scene";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { AlphaState } from "@babylonjs/core/States/alphaCullingState";
import { crc32, readAssetPackage, sha256, type AssetPackageFile } from "../../src/assets/package/readAssetPackage";
import { prepareNativeFlameGraph, type NativeFlamePlan, type NativeFlameTexture } from "../../src/scene/world/nativeMaterialGraph";
import * as pngDecoder from "../../src/scene/world/nativeTerrainPreview";
import { createNativeFlameMaterials, evaluateNativeFlameFade, selectNativeFlameFrame } from "../../src/scene/world/nativeFlameMaterials";

const prefix = "FX_E_T.Flameset.", signal = () => new AbortController().signal;
const fade: NativeFlamePlan["fade"] = {
  object: `${prefix}FadeColor0`, color1: { bgraHex: "151b3100", rgbaBytes: [49, 27, 21, 0] }, color2: { bgraHex: "2e437c00", rgbaBytes: [124, 67, 46, 0] },
  colorFadeType: 1, fadePeriod: Math.fround(0.4), fadePhase: 1,
};
const animation = { maxFrameRate: 30, totalFrameNum: 16 };
function png(pixel: number[]): Uint8Array<ArrayBuffer> {
  const header = new Uint8Array(13), view = new DataView(header.buffer);
  view.setUint32(0, 1); view.setUint32(4, 1); header[8] = 8; header[9] = 6;
  const chunks = [["IHDR", header], ["IDAT", new Uint8Array(deflateSync(Uint8Array.from([0, ...pixel])))], ["IEND", new Uint8Array()]] as const;
  const bytes = new Uint8Array(8 + chunks.reduce((total, [, data]) => total + data.length + 12, 0));
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]); const data = new DataView(bytes.buffer); let offset = 8;
  for (const [type, payload] of chunks) {
    data.setUint32(offset, payload.length); bytes.set(new TextEncoder().encode(type), offset + 4); bytes.set(payload, offset + 8);
    data.setUint32(offset + payload.length + 8, crc32(bytes.subarray(offset + 4, offset + payload.length + 8))); offset += payload.length + 12;
  }
  return bytes;
}
async function planFixture(): Promise<NativeFlamePlan> {
  const resources = new Map<string, Uint8Array>();
  const file = (path: string): AssetPackageFile => ({ path, bytes: 1, sha256: "a".repeat(64), mime: "application/octet-stream" });
  const texture = async (name: string, isGlow = false): Promise<NativeFlameTexture> => {
    const bytes = png([191, 23, isGlow ? 54 : Number(name.slice(-4)) + 1, isGlow ? 0 : 3]);
    const image = { path: `${name}.png`, bytes: bytes.length, sha256: await sha256(bytes), mime: "image/png" };
    resources.set(image.path, bytes);
    return { object: prefix + name, width: 1, height: 1, format: isGlow ? 8 : 3, uClampMode: 0, vClampMode: 1, image, rawExport: file(`${name}.bin`), dds: null, mips: [] };
  };
  const frames = await Promise.all(Array.from({ length: 16 }, (_, index) => texture(`de_fire_${String(index).padStart(4, "0")}`)));
  return {
    modelId: "interlude:FX_E_S.Flameset.Default_Flame01", sourceMesh: "FX_E_S.Flameset.Default_Flame01", graph: file("native-materials/graph.json"), billboard: true,
    shaders: [
      { slot: 0, object: `${prefix}Default_Flame_Final`, diffuse: frames[0]!.object, outputBlending: 5, twoSided: true, zWrite: false, alphaTest: false, alphaRef: 0 },
      { slot: 1, object: `${prefix}de_fire_glow_shader`, diffuse: `${prefix}de_fire_glow_s`, outputBlending: 3, twoSided: false, zWrite: false, alphaTest: false, alphaRef: 0 },
    ],
    animation: { ...animation, minFrameRate: 25, frames }, glow: await texture("de_fire_glow", true), fade: structuredClone(fade),
    combiner: { object: `${prefix}de_fire_glow_s`, material1: `${prefix}de_fire_glow`, material2: fade.object, mask: null, combineOperation: 2, alphaOperation: 0, modulate2X: true, modulate4X: false, invertMask: false },
    resources, provenance: { graph: { runtimeImplemented: false }, classes: new Map(), nodes: new Map() },
  };
}
const cleanups: (() => void)[] = [];
async function fixture() {
  const engine = new NullEngine(), scene = new Scene(engine), plan = await planFixture();
  const original = new StandardMaterial("source diagnostic", scene);
  const meshes = Array.from({ length: 3 }, (_, index) => MeshBuilder.CreatePlane(`section${index}`, {}, scene));
  for (const mesh of meshes) { mesh.material = original; mesh.metadata = { source: "unchanged" }; }
  const bindings = meshes.map((mesh, index) => ({ mesh, slot: (index === 1 ? 1 : 0) as 0 | 1, expectedMaterial: original }));
  cleanups.push(() => { scene.dispose(); engine.dispose(); });
  return { engine, scene, plan, original, meshes, bindings };
}
beforeEach(() => vi.spyOn(ShaderMaterial.prototype, "isReady").mockReturnValue(true));
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("retained flame numerical models", () => {
  // These source-research probes use independent Python Fraction arithmetic,
  // explicit binary rounding and math.cos. They are not native process traces.
  const probePath = "artifacts/native-parity/research/flame-runtime/formula-probes.json";
  it.skipIf(!existsSync(probePath))("matches all independent float-store fade and precision53 texture seam probes", () => {
    const probes = JSON.parse(readFileSync(probePath, "utf8")) as {
      fade: ({ time: number } & ReturnType<typeof evaluateNativeFlameFade>)[];
      textureSeams: { time: number; naiveFloorModuloIndex: number; x87Precision53Model: { index: number; initialPhase: number; remainingPhase: number } }[];
    };
    expect(probes.fade).toHaveLength(8); expect(probes.textureSeams).toHaveLength(27);
    for (const row of probes.fade) {
      const actual = evaluateNativeFlameFade(row.time, fade);
      for (const key of Object.keys(actual) as (keyof typeof actual)[]) expect(actual[key], `${row.time}:${key}`).toEqual(row[key]);
    }
    let shortcutDifferences = 0;
    for (const row of probes.textureSeams) {
      const result = selectNativeFlameFrame(row.time, animation);
      expect(result).toMatchObject(row.x87Precision53Model);
      if (result.index !== row.naiveFloorModuloIndex) shortcutDifferences++;
    }
    expect(shortcutDifferences).toBeGreaterThan(0);
  });

  it("retains the quarter-frequency cycle and floors float32 channel products", () => {
    expect([0, 0.2, 0.6, 1, 1.4, 1.8].map(time => evaluateNativeFlameFade(time, fade).rgbaBytes)).toEqual([
      [113, 61, 42, 0], [86, 47, 33, 0], [49, 27, 21, 0], [86, 47, 33, 0], [124, 67, 46, 0], [86, 47, 33, 0],
    ]);
    expect(evaluateNativeFlameFade(0.2, fade).scaledFloat32).toEqual([86.5, 47, 33.5, 0]);
    expect(selectNativeFlameFrame(16 / 30, animation).index).toBe(0);
    expect(selectNativeFlameFrame(0, { ...animation, maxFrameRate: 1000 }).stepSeconds).toBe(0.01);
  });

  it("retains independent precision53 seam expectations without local source artifacts", () => {
    // Copied results of the independent Fraction/binary-rounding source probe.
    // Several values intentionally differ from floor((time % cycle) * 30).
    const seams = [
      [0.033333333333333326, 0], [0.03333333333333333, 1], [0.03333333333333334, 1],
      [0.06666666666666665, 1], [0.06666666666666667, 2], [0.06666666666666668, 2],
      [0.09999999999999999, 2], [0.1, 3], [0.10000000000000002, 3],
      [0.2666666666666666, 7], [0.26666666666666666, 8], [0.2666666666666667, 8],
      [0.49999999999999994, 15], [0.5, 15], [0.5000000000000001, 15],
      [0.5333333333333332, 15], [0.5333333333333333, 0], [0.5333333333333334, 0],
      [0.5666666666666665, 0], [0.5666666666666667, 0], [0.5666666666666668, 1],
      [1.0333333333333332, 14], [1.0333333333333334, 15], [1.0333333333333337, 15],
      [1.0666666666666664, 15], [1.0666666666666667, 0], [1.0666666666666669, 0],
    ] as const;
    for (const [time, index] of seams) expect(selectNativeFlameFrame(time, animation).index, String(time)).toBe(index);
  });

  it("rejects unsupported/nonfinite clock inputs instead of inventing a frame", () => {
    for (const time of [-1, NaN, Infinity, 1e100]) expect(() => selectNativeFlameFrame(time, animation)).toThrow();
    for (const time of [NaN, Infinity, 1e100]) expect(() => evaluateNativeFlameFade(time, fade)).toThrow();
    expect(() => selectNativeFlameFrame(0, { ...animation, maxFrameRate: 0 })).toThrow();
    expect(() => evaluateNativeFlameFade(0, { ...fade, fadePeriod: 0 })).toThrow();
  });
});

describe("scene-owned native flame materials", () => {
  it("binds the glow fade as one vec3 so WebGPU does not treat it as a uniform array", async () => {
    const value = await fixture();
    const owner = await createNativeFlameMaterials(value.scene, value.plan, value.bindings, signal());
    try {
      const glow = value.meshes[1]!.material as ShaderMaterial;
      const assertFade = (expected: number[]) => {
        const serialized = glow.serialize() as { colors3: Record<string, number[]>; vectors3Arrays: Record<string, number[]>; colors3Arrays: Record<string, number[]> };
        expect(serialized.colors3.quantizedFade).toEqual(expected);
        expect(serialized.vectors3Arrays).not.toHaveProperty("quantizedFade");
        expect(serialized.colors3Arrays).not.toHaveProperty("quantizedFade");
      };
      assertFade([113 / 255, 61 / 255, 42 / 255]);
      owner.update({ textureSeconds: 0.2, fadeSeconds: 1.4 });
      assertFade([124 / 255, 67 / 255, 46 / 255]);
    } finally { owner.dispose(); }
  });

  it("preserves bytes, UVs, winding, transforms and originals while sharing only inside this owner", async () => {
    const value = await fixture(), upload = vi.spyOn(RawTexture, "CreateRGBATexture");
    const before = value.meshes.map(mesh => ({ positions: mesh.getVerticesData("position")!.slice(), uv: mesh.getVerticesData("uv")!.slice(), matrix: mesh.getWorldMatrix().asArray().slice(), metadata: structuredClone(mesh.metadata), side: mesh.sideOrientation, billboard: mesh.billboardMode }));
    const originalDispose = vi.spyOn(value.original, "dispose");
    const owner = await createNativeFlameMaterials(value.scene, value.plan, value.bindings, signal());
    const flame = value.meshes[0]!.material as ShaderMaterial, glow = value.meshes[1]!.material as ShaderMaterial;
    expect(value.meshes[2]!.material).toBe(flame); expect(flame).not.toBe(glow);
    expect(owner.inspect()).toMatchObject({ bindingCounts: { requested: 3, active: 3, skipped: 0, released: 0 }, textureCount: 17, materialCount: 2, lighting: "unlit-encoded-color", nativeParity: "unverified", clocks: { synchronization: "unverified" } });
    const uploaded = upload.mock.calls[16]![0]!;
    expect([...new Uint8Array(uploaded.buffer, uploaded.byteOffset, uploaded.byteLength)]).toEqual([191, 23, 54, 0]);
    expect(upload.mock.calls.every(call => call[4] === false && call[5] === false && call[6] === Texture.BILINEAR_SAMPLINGMODE)).toBe(true);
    for (const texture of value.scene.textures) expect(texture).toMatchObject({ gammaSpace: false, wrapU: Texture.WRAP_ADDRESSMODE, wrapV: Texture.CLAMP_ADDRESSMODE, anisotropicFilteringLevel: 1 });
    owner.update({ textureSeconds: 0.2, fadeSeconds: 1.4 });
    expect(owner.inspect().current).toMatchObject({ frameIndex: 6, fadeRgbaBytes: [124, 67, 46, 0], textureSeconds: 0.2, fadeSeconds: 1.4 });
    expect(flame.getActiveTextures()[0]!.name).toBe(`${prefix}de_fire_0006`);
    const state = owner.inspect().current; expect(() => owner.update({ textureSeconds: 0.3, fadeSeconds: NaN })).toThrow(); expect(owner.inspect().current).toEqual(state);
    for (const [index, mesh] of value.meshes.entries()) {
      expect(mesh.getVerticesData("position")).toEqual(before[index]!.positions); expect(mesh.getVerticesData("uv")).toEqual(before[index]!.uv);
      expect(mesh.getWorldMatrix().asArray()).toEqual(before[index]!.matrix); expect(mesh.metadata).toEqual(before[index]!.metadata);
      expect(mesh.sideOrientation).toBe(before[index]!.side); expect(mesh.billboardMode).toBe(before[index]!.billboard);
    }
    owner.dispose(); owner.dispose(); expect(value.meshes.every(mesh => mesh.material === value.original)).toBe(true);
    expect(value.scene.materials).toEqual([value.original]); expect(value.scene.textures).toHaveLength(0); expect(originalDispose).not.toHaveBeenCalled();
    expect(value.meshes.every(mesh => !mesh.onMaterialChangedObservable.hasObservers())).toBe(true);
  });

  it("uses actual Babylon blend factors and source two-sided/depth flags without alpha-weighted RGB", async () => {
    const value = await fixture();
    value.original.sideOrientation = 0; value.original.cullBackFaces = false;
    const owner = await createNativeFlameMaterials(value.scene, value.plan, value.bindings, signal());
    for (const [index, expected] of [[0, [1, 769, 1, 771]], [1, [1, 1, 1, 1]]] as const) {
      const material = value.meshes[index]!.material as ShaderMaterial;
      expect(material.alphaMode).toBe(index === 0 ? Constants.ALPHA_SCREENMODE : Constants.ALPHA_ONEONE_ONEONE);
      expect(material.needAlphaBlending()).toBe(true); expect(material.needAlphaTesting()).toBe(false);
      expect(material.disableDepthWrite).toBe(true); expect(material.forceDepthWrite).toBe(false); expect(material.backFaceCulling).toBe(index === 1);
      expect(material.sideOrientation).toBe(0); expect(material.cullBackFaces).toBe(false);
      const state = new AlphaState(false), gl = { BLEND: 3042, enable: vi.fn(), disable: vi.fn(), blendFuncSeparate: vi.fn(), blendEquationSeparate: vi.fn() };
      state.setAlphaBlend(true); state.setAlphaMode(material.alphaMode, 0); state.apply(gl as unknown as WebGLRenderingContext);
      expect(gl.blendFuncSeparate).toHaveBeenCalledWith(...expected); expect(gl.blendEquationSeparate).toHaveBeenCalledWith(32774, 32774);
      expect(gl.enable).toHaveBeenCalledWith(3042);
      const source = material.shaderPath as { fragmentSource: string; vertexSource: string };
      expect(source.vertexSource).toContain("nativeUV=uv"); expect(source.fragmentSource).not.toMatch(/\.a\s*\*/);
      expect(source.fragmentSource).toContain(index === 0 ? "gl_FragColor=texture2D(sourceTexture,nativeUV)" : "clamp(2.0*texture2D(sourceTexture,nativeUV).rgb*quantizedFade,0.0,1.0)");
      if (index === 1) expect(source.fragmentSource).toContain("vec4(rgb,0.0)");
    }
    owner.dispose();
  });

  it.each(["blend", "depth", "alphaTest", "combiner", "mask", "modulate", "fade", "alpha"])("refuses unsupported %s before allocating or binding", async kind => {
    const value = await fixture(), plan = structuredClone(value.plan);
    if (kind === "blend") Object.assign(plan.shaders[0], { outputBlending: 1 });
    if (kind === "depth") Object.assign(plan.shaders[0], { zWrite: true });
    if (kind === "alphaTest") Object.assign(plan.shaders[0], { alphaTest: true });
    if (kind === "combiner") Object.assign(plan.combiner, { combineOperation: 1 });
    if (kind === "mask") Object.assign(plan.combiner, { mask: "Texture.Mask" });
    if (kind === "modulate") Object.assign(plan.combiner, { modulate2X: false });
    if (kind === "fade") Object.assign(plan.fade, { colorFadeType: 0 });
    if (kind === "alpha") Object.assign(plan.fade.color1, { rgbaBytes: [49, 27, 21, 1] });
    await expect(createNativeFlameMaterials(value.scene, plan, value.bindings, signal())).rejects.toThrow("unsupported");
    expect(value.scene.materials).toEqual([value.original]); expect(value.scene.textures).toHaveLength(0);
    expect(value.meshes.every(mesh => mesh.material === value.original)).toBe(true);
  });

  it("restores only owned assignments and permanently relinquishes authored changes", async () => {
    const value = await fixture(), authored = new StandardMaterial("authored", value.scene);
    const outside = MeshBuilder.CreatePlane("outside", {}, value.scene); outside.material = value.original;
    const owner = await createNativeFlameMaterials(value.scene, value.plan, value.bindings, signal());
    value.meshes[0]!.material = authored;
    owner.update({ textureSeconds: 1, fadeSeconds: 2 });
    expect(value.meshes[0]!.material).toBe(authored); expect(owner.inspect().bindingCounts).toMatchObject({ active: 2, released: 1 });
    expect(owner.inspect().errors).toContainEqual({ meshId: value.meshes[0]!.id, slot: 0, reason: "material-assignment-changed" });
    owner.dispose(); expect(value.meshes[0]!.material).toBe(authored); expect(value.meshes[1]!.material).toBe(value.original); expect(outside.material).toBe(value.original);
    expect(value.scene.materials).toEqual([value.original, authored]);
  });

  it("skips assignments changed before preparation and does not allocate for no matches", async () => {
    const value = await fixture(), authored = new StandardMaterial("authored", value.scene);
    for (const mesh of value.meshes) mesh.material = authored;
    const owner = await createNativeFlameMaterials(value.scene, value.plan, value.bindings, signal());
    expect(owner.inspect()).toMatchObject({ bindingCounts: { requested: 3, active: 0, skipped: 3 }, textureCount: 0, materialCount: 0 });
    owner.update({ textureSeconds: 1, fadeSeconds: 0 }); owner.dispose(); expect(value.meshes.every(mesh => mesh.material === authored)).toBe(true);
  });

  it("notices assignment changes during readiness even when the old assignment is put back", async () => {
    const value = await fixture(), authored = new StandardMaterial("authored", value.scene);
    let start!: () => void; const started = new Promise<void>(resolve => { start = resolve; });
    vi.mocked(ShaderMaterial.prototype.isReady).mockImplementationOnce(() => { vi.useFakeTimers(); start(); return false; });
    const pending = createNativeFlameMaterials(value.scene, value.plan, value.bindings, signal());
    await started;
    expect(value.meshes.every(mesh => mesh.material === value.original)).toBe(true);
    value.meshes[0]!.material = authored; value.meshes[0]!.material = value.original;
    await vi.advanceTimersByTimeAsync(16); const owner = await pending;
    expect(owner.inspect().bindingCounts).toMatchObject({ active: 2, skipped: 1 }); expect(value.meshes[0]!.material).toBe(value.original);
    owner.dispose(); await vi.advanceTimersByTimeAsync(0); expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["hash", "decode", "compile"])("rolls back all resources after a partial %s failure", async kind => {
    const value = await fixture(), second = value.plan.animation.frames[1]!;
    if (kind === "hash") { const bytes = value.plan.resources.get(second.image.path)!; bytes[0] = bytes[0]! ^ 1; }
    if (kind === "decode") {
      const bytes = value.plan.resources.get(second.image.path)!; bytes[24] = 16;
      Object.assign(second.image, { sha256: await sha256(bytes) });
    }
    if (kind === "compile") vi.mocked(ShaderMaterial.prototype.isReady).mockImplementationOnce(() => { throw new Error("compile failed"); });
    await expect(createNativeFlameMaterials(value.scene, value.plan, value.bindings, signal())).rejects.toThrow();
    expect(value.scene.textures).toHaveLength(0); expect(value.scene.materials).toEqual([value.original]);
    expect(value.meshes.every(mesh => mesh.material === value.original && !mesh.onMaterialChangedObservable.hasObservers())).toBe(true);
  });

  it("cancels a pending readiness timer immediately and never binds after abort", async () => {
    const value = await fixture(), controller = new AbortController();
    let start!: () => void; const started = new Promise<void>(resolve => { start = resolve; });
    vi.mocked(ShaderMaterial.prototype.isReady).mockImplementation(() => { vi.useFakeTimers(); start(); return false; });
    const pending = createNativeFlameMaterials(value.scene, value.plan, value.bindings, controller.signal);
    await started; expect(vi.getTimerCount()).toBe(1); controller.abort();
    await expect(pending).rejects.toHaveProperty("name", "AbortError");
    // Babylon Observable.remove defers seven observer removals with zero-delay
    // timers. Flush those only; the owner's 16ms readiness timer must be gone.
    await vi.advanceTimersByTimeAsync(0); expect(vi.getTimerCount()).toBe(0);
    expect(value.meshes.every(mesh => mesh.material === value.original)).toBe(true); expect(value.scene.textures).toHaveLength(0);
  });

  it.each(["abort", "scene"])("ends pending decode promptly on %s without late GPU allocation", async kind => {
    const value = await fixture(), controller = new AbortController();
    let start!: () => void, finish!: (value: pngDecoder.NativePreviewPixels) => void;
    const started = new Promise<void>(resolve => { start = resolve; });
    vi.spyOn(pngDecoder, "decodeNativePreviewPng").mockImplementationOnce(() => new Promise(resolve => { finish = resolve; start(); }));
    const pending = createNativeFlameMaterials(value.scene, value.plan, value.bindings, controller.signal);
    await started; if (kind === "abort") controller.abort(); else value.scene.dispose();
    await expect(pending).rejects.toHaveProperty("name", "AbortError");
    finish({ width: 1, height: 1, rgba: new Uint8Array([7, 8, 9, 0]) }); await Promise.resolve();
    expect(value.scene.textures).toHaveLength(0);
    if (kind === "abort") expect(value.meshes.every(mesh => mesh.material === value.original)).toBe(true);
  });

  it("keeps resources separate across scenes and handles mesh/scene teardown", async () => {
    const first = await fixture(), second = await fixture();
    const a = await createNativeFlameMaterials(first.scene, first.plan, first.bindings, signal());
    const b = await createNativeFlameMaterials(second.scene, first.plan, second.bindings, signal());
    expect(first.meshes[0]!.material).not.toBe(second.meshes[0]!.material);
    expect(first.scene.textures.every(texture => !second.scene.textures.includes(texture))).toBe(true);
    first.meshes[0]!.dispose(); a.update({ textureSeconds: 1, fadeSeconds: 1 }); expect(a.inspect().bindingCounts.active).toBe(2);
    first.scene.dispose(); expect(a.inspect()).toMatchObject({ disposed: true, textureCount: 0, materialCount: 0 });
    expect(b.inspect().bindingCounts.active).toBe(3); b.dispose();
    expect(second.meshes.every(mesh => mesh.material === second.original)).toBe(true);
  });

  it("restores active bindings immediately when the caller aborts", async () => {
    const value = await fixture(), controller = new AbortController();
    const owner = await createNativeFlameMaterials(value.scene, value.plan, value.bindings, controller.signal);
    controller.abort(); owner.update({ textureSeconds: 1, fadeSeconds: 1 });
    expect(owner.inspect()).toMatchObject({ disposed: true, bindingCounts: { active: 0, released: 3 }, textureCount: 0, materialCount: 0 });
    expect(value.meshes.every(mesh => mesh.material === value.original)).toBe(true); expect(value.scene.textures).toHaveLength(0);
  });

  it("rejects duplicate meshes, wrong scenes and pre-aborted initialization", async () => {
    const first = await fixture(), second = await fixture();
    await expect(createNativeFlameMaterials(first.scene, first.plan, [first.bindings[0]!, first.bindings[0]!], signal())).rejects.toThrow("duplicate");
    await expect(createNativeFlameMaterials(first.scene, first.plan, second.bindings, signal())).rejects.toThrow("same-scene");
    const controller = new AbortController(); controller.abort();
    await expect(createNativeFlameMaterials(first.scene, first.plan, first.bindings, controller.signal)).rejects.toHaveProperty("name", "AbortError");
    expect(first.scene.textures).toHaveLength(0);
  });
});

const retainedArchive = "public/l2/maps/062218e6dc1c887e5018489f69b1faaed571b519d937cc0d7c7c9b8c1474e2c2/map-section-models/2bcf55b30efff7acfd0ea351549f94cc40f7f404d5f86d0f97ac86831f1376ed/asset.l2asset";
it.skipIf(!existsSync(retainedArchive))("prepares all 17 real source PNGs from the validated retained graph", async () => {
  const bytes = new Uint8Array(readFileSync(retainedArchive)); expect(await sha256(bytes)).toBe("2bcf55b30efff7acfd0ea351549f94cc40f7f404d5f86d0f97ac86831f1376ed");
  const plan = await prepareNativeFlameGraph(await readAssetPackage(bytes)), value = await fixture();
  const owner = await createNativeFlameMaterials(value.scene, plan, value.bindings, signal());
  expect(owner.inspect()).toMatchObject({ bindingCounts: { active: 3 }, textureCount: 17, materialCount: 2 });
  owner.update({ textureSeconds: 1, fadeSeconds: 1.4 }); expect(owner.inspect().current.fadeRgbaBytes).toEqual([124, 67, 46, 0]);
  owner.dispose();
});
