import { afterEach, describe, expect, it, vi } from "vitest";
import { deflateSync } from "node:zlib";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Constants } from "@babylonjs/core/Engines/constants";
import { Scene } from "@babylonjs/core/scene";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { SceneSerializer } from "@babylonjs/core/Misc/sceneSerializer";
import { crc32, sha256 } from "../../src/assets/package/readAssetPackage";
import { createNativeEffectMaterial, type NativeEffectMaterialInput } from "../../src/effects/nativeEffectMaterial";

function png(): Uint8Array<ArrayBuffer> {
  const header = new Uint8Array(13), view = new DataView(header.buffer);
  view.setUint32(0, 2); view.setUint32(4, 1); header[8] = 8; header[9] = 6;
  const chunks = [["IHDR", header], ["IDAT", new Uint8Array(deflateSync(Uint8Array.from([0, 255, 128, 64, 0, 64, 32, 16, 128])))], ["IEND", new Uint8Array()]] as const;
  const result = new Uint8Array(8 + chunks.reduce((total, [, data]) => total + data.length + 12, 0));
  result.set([137, 80, 78, 71, 13, 10, 26, 10]); const data = new DataView(result.buffer); let offset = 8;
  for (const [type, bytes] of chunks) {
    data.setUint32(offset, bytes.length); result.set(new TextEncoder().encode(type), offset + 4); result.set(bytes, offset + 8);
    data.setUint32(offset + bytes.length + 8, crc32(result.subarray(offset + 4, offset + bytes.length + 8))); offset += bytes.length + 12;
  }
  return result;
}
async function input(): Promise<NativeEffectMaterialInput> {
  const bytes = png();
  return { component: { object: "LineageEffect.s_u002_a.MeshEmitter2", class: "Engine.MeshEmitter", effectiveProperties: {
    DrawStyle: 3, UseMeshBlendMode: false, RenderTwoSided: true, AlphaTest: true, ZTest: true, Opacity: .72,
    ColorMultiplierRange: { X: { Min: .9, Max: .9 }, Y: { Min: .9, Max: .9 }, Z: { Min: 1, Max: 1 } },
    UseColorScale: true, ColorScale: [{ RelativeTime: 0, Color: { R: 255, G: 255, B: 255, A: 255 } },
      { RelativeTime: .357143, Color: { R: 255, G: 128, B: 64, A: 191 } }],
    ColorScaleRepeats: 15, FadeOut: true, FadeOutStartTime: .252, LifetimeRange: { Min: .45, Max: .45 },
    UnknownSourceField: { unparsedHex: "aabb" }, Texture: { object: "Engine.S_Emitter" },
  } }, texture: { object: "LineageEffectsTextures.Particles.fx_m_t0050", sha256: await sha256(bytes), bytes: bytes.length }, png: bytes };
}
const cleanups: (() => void)[] = [];
function fixture() {
  const engine = new NullEngine(), scene = new Scene(engine);
  cleanups.push(() => { scene.dispose(); engine.dispose(); });
  return { engine, scene, signal: new AbortController() };
}
afterEach(() => { for (const dispose of cleanups.splice(0).reverse()) dispose(); vi.restoreAllMocks(); });

describe("explicit modern source-component materials", () => {
  it("uploads exact RGBA including colored transparent texels and uses scalar WebGPU-compatible uniforms", async () => {
    const { scene, signal } = fixture(), source = await input(), snapshot = structuredClone(source);
    const upload = vi.spyOn(RawTexture, "CreateRGBATexture");
    const owner = await createNativeEffectMaterial(scene, source, signal.signal);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(Array.from(upload.mock.calls[0]![0] as Uint8Array)).toEqual([255, 128, 64, 0, 64, 32, 16, 128]);
    expect(upload.mock.calls[0]!.slice(1, 7)).toEqual([2, 1, scene, false, false, Texture.BILINEAR_SAMPLINGMODE]);
    const texture = owner.material.getActiveTextures()[0]!;
    expect(texture).toMatchObject({ gammaSpace: false, hasAlpha: true, wrapU: Texture.CLAMP_ADDRESSMODE, wrapV: Texture.CLAMP_ADDRESSMODE, anisotropicFilteringLevel: 1 });
    const uniforms = owner.material.serialize() as { colors3: Record<string, number[]>; colors4: Record<string, number[]>;
      vectors4: Record<string, number[]>; floats: Record<string, number>; colors3Arrays: Record<string, unknown> };
    expect(uniforms.colors3.sourceMultiplier).toEqual([.9, .9, 1]);
    expect(uniforms.colors3Arrays).not.toHaveProperty("sourceMultiplier");
    expect(uniforms.colors4.selectedColor).toEqual([1, 1, 1, 1]);
    expect(uniforms.vectors4.sourceUV).toEqual([1, 1, 0, 0]);
    expect(uniforms.floats.sourceOpacity).toBe(.72);
    expect(source).toEqual(snapshot);
    expect(owner.inspect()).toMatchObject({ policy: "modern-source-component-v1", status: "configured", sourceOpacity: .72,
      selectedColorKey: 0, nativeCompositionVerified: false, gpuExecutionVerified: false,
      texture: { object: source.texture.object, sha256: source.texture.sha256, width: 2, height: 1 } });
    owner.dispose();
  });

  it.each([3, 6] as const)("uses explicit preview blend/depth/cull policy for source DrawStyle %s", async drawStyle => {
    const { scene, signal } = fixture(), source = await input();
    const properties = source.component.effectiveProperties as Record<string, unknown>; properties.DrawStyle = drawStyle;
    const owner = await createNativeEffectMaterial(scene, source, signal.signal), material = owner.material;
    expect(material.alphaMode).toBe(drawStyle === 3 ? Constants.ALPHA_SCREENMODE : Constants.ALPHA_ONEONE);
    expect(material.backFaceCulling).toBe(false); expect(material.depthFunction).toBe(Constants.LEQUAL);
    expect(material.disableDepthWrite).toBe(true); expect(material.forceDepthWrite).toBe(false);
    expect(material.needAlphaBlending()).toBe(true); expect(material.needAlphaTesting()).toBe(true);
    expect(material.doNotSerialize).toBe(true);
    expect(owner.inspect().blend).toMatchObject({ mode: drawStyle === 3 ? "screen" : "additive", sourceDrawStyle: drawStyle });
    const shader = material.shaderPath as { vertexSource: string; fragmentSource: string };
    expect(shader.fragmentSource).toContain("texel.a*selectedColor.a*sourceOpacity");
    expect(shader.fragmentSource).toContain("texel.rgb*selectedColor.rgb*sourceMultiplier*alpha");
    expect(shader.fragmentSource).not.toMatch(/luminance|gamma|pow\(/);
    expect(shader.vertexSource).toContain("componentUV=uv*sourceUV.xy+sourceUV.zw");
    owner.dispose();
  });

  it("selects exact retained color keys and UV crops manually without mutating texture state or inventing time", async () => {
    const { scene, signal } = fixture(), owner = await createNativeEffectMaterial(scene, await input(), signal.signal);
    const texture = owner.material.getActiveTextures()[0] as Texture;
    const before = [texture.uScale, texture.vScale, texture.uOffset, texture.vOffset];
    owner.setColorKey(1); owner.setUVTransform([.5, .5], [.5, 0]);
    expect(owner.inspect()).toMatchObject({ selectedColorKey: 1, selectedColorRelativeTime: .357143,
      selectedColorRgbaBytes: [255, 128, 64, 191], uvScale: [.5, .5], uvOffset: [.5, 0] });
    const uniforms = owner.material.serialize() as { colors4: Record<string, number[]>; vectors4: Record<string, number[]> };
    expect(uniforms.colors4.selectedColor).toEqual([1, 128 / 255, 64 / 255, 191 / 255]);
    expect(uniforms.vectors4.sourceUV).toEqual([.5, .5, .5, 0]);
    expect([texture.uScale, texture.vScale, texture.uOffset, texture.vOffset]).toEqual(before);
    const state = owner.inspect();
    expect(() => owner.setColorKey(99)).toThrow(); expect(() => owner.setColorKey(null)).toThrow();
    expect(() => owner.setUVTransform([.5, 1], [.75, 0])).toThrow();
    expect(() => owner.setUVTransform([0, 1], [0, 0])).toThrow();
    expect(owner.inspect()).toEqual(state);
    owner.dispose(); expect(() => owner.setColorKey(0)).toThrow("disposed"); expect(() => owner.setUVTransform([1, 1], [0, 0])).toThrow("disposed");
  });

  it("preserves absent ColorScale enable and unsupported dynamics rather than evaluating them", async () => {
    const { scene, signal } = fixture(), source = await input();
    const properties = source.component.effectiveProperties as Record<string, unknown>; delete properties.UseColorScale;
    const owner = await createNativeEffectMaterial(scene, source, signal.signal), report = owner.inspect();
    expect(report.selectedColorKey).toBeNull(); expect(report.selectedColorRgbaBytes).toEqual([255, 255, 255, 255]);
    expect(report.retainedUnimplementedFields).toEqual(expect.arrayContaining(["ColorScale", "ColorScaleRepeats", "FadeOut", "LifetimeRange", "UnknownSourceField", "Texture"]));
    expect(report.sourceProperties).toEqual(properties);
    expect(() => owner.setColorKey(0)).toThrow("UseColorScale=true"); owner.setColorKey(null);
    owner.dispose();
  });

  it("snapshots caller records before async hashing and returns independent inspection copies", async () => {
    const { scene, signal } = fixture(), source = await input(), oldHash = source.texture.sha256;
    const pending = createNativeEffectMaterial(scene, source, signal.signal);
    (source.component.effectiveProperties as Record<string, unknown>).Opacity = 0;
    (source.texture as { object: string }).object = "Modified.Foreign"; source.png.fill(0);
    const owner = await pending, report = owner.inspect();
    expect(report.sourceOpacity).toBe(.72); expect(report.texture.sha256).toBe(oldHash);
    expect(report.texture.object).toBe("LineageEffectsTextures.Particles.fx_m_t0050");
    (report.sourceProperties as Record<string, unknown>).Opacity = 0;
    expect(owner.inspect().sourceProperties.Opacity).toBe(.72); owner.dispose();
  });

  it("uses explicit sprite culling and disabled source test flags without source flag invention", async () => {
    const { scene, signal } = fixture(), source = await input();
    (source.component as { class: string }).class = "Engine.SpriteEmitter";
    const properties = source.component.effectiveProperties as Record<string, unknown>;
    delete properties.RenderTwoSided; delete properties.UseMeshBlendMode; properties.ZTest = false; properties.AlphaTest = false;
    const owner = await createNativeEffectMaterial(scene, source, signal.signal);
    expect(owner.material.depthFunction).toBe(Constants.ALWAYS); expect(owner.material.backFaceCulling).toBe(false);
    expect(owner.material.needAlphaTesting()).toBe(false);
    expect(owner.inspect().raster.cullPolicy).toBe("two-sided sprite preview");
    expect(owner.inspect().sourceProperties).not.toHaveProperty("RenderTwoSided"); owner.dispose();
  });

  it.each(["hash", "length", "blend", "meshBlend", "opacity", "alphaFlag", "depthFlag", "cull", "multiplier", "colorKey", "class"])("refuses unsupported %s without allocating", async kind => {
    const { scene, signal } = fixture(), source = await input(), properties = source.component.effectiveProperties as Record<string, unknown>;
    if (kind === "hash") (source.texture as { sha256: string }).sha256 = "0".repeat(64);
    if (kind === "length") (source.texture as { bytes: number }).bytes++;
    if (kind === "blend") properties.DrawStyle = 1;
    if (kind === "meshBlend") properties.UseMeshBlendMode = true;
    if (kind === "opacity") properties.Opacity = NaN;
    if (kind === "alphaFlag") delete properties.AlphaTest;
    if (kind === "depthFlag") properties.ZTest = 1;
    if (kind === "cull") delete properties.RenderTwoSided;
    if (kind === "multiplier") properties.ColorMultiplierRange = { X: { Min: 0, Max: 1 } };
    if (kind === "colorKey") properties.ColorScale = [{ RelativeTime: 0, Color: { R: 999, G: 255, B: 255, A: 255 } }];
    if (kind === "class") (source.component as { class: string }).class = "Engine.UnknownEmitter";
    await expect(createNativeEffectMaterial(scene, source, signal.signal)).rejects.toThrow();
    expect(scene.materials).toHaveLength(0); expect(scene.textures).toHaveLength(0);
  });

  it("owns only new resources, never assignments/shared textures, and excludes its material from scene serialization", async () => {
    const { scene, signal } = fixture(), original = new StandardMaterial("original", scene);
    const shared = RawTexture.CreateRGBATexture(new Uint8Array([4, 3, 2, 1]), 1, 1, scene);
    original.diffuseTexture = shared;
    const mesh = MeshBuilder.CreatePlane("original mesh", {}, scene); mesh.material = original;
    const disposeOriginal = vi.spyOn(original, "dispose"), disposeShared = vi.spyOn(shared, "dispose");
    const owner = await createNativeEffectMaterial(scene, await input(), signal.signal);
    expect(mesh.material).toBe(original);
    const serialized = SceneSerializer.Serialize(scene) as { materials: { id: string }[] };
    expect(serialized.materials.some(row => row.id === owner.material.id)).toBe(false);
    expect(serialized.materials.some(row => row.id === original.id)).toBe(true);
    // A caller can rebind a foreign texture; disposal must still only release
    // our owned texture, not the material's current sampler dependency.
    owner.material.setTexture("sourceTexture", shared);
    owner.dispose(); owner.dispose();
    expect(disposeOriginal).not.toHaveBeenCalled(); expect(disposeShared).not.toHaveBeenCalled();
    expect(scene.materials).toEqual([original]); expect(scene.textures).toEqual([shared]); expect(mesh.material).toBe(original);
    expect(owner.inspect().status).toBe("disposed");
  });

  it("cleans active resources on abort or scene disposal and rejects pre-aborted creation", async () => {
    const { scene, signal } = fixture(), source = await input();
    const owner = await createNativeEffectMaterial(scene, source, signal.signal); signal.abort();
    expect(owner.inspect().status).toBe("disposed"); expect(scene.materials).toHaveLength(0); expect(scene.textures).toHaveLength(0);
    await expect(createNativeEffectMaterial(scene, source, signal.signal)).rejects.toMatchObject({ name: "AbortError" });
    const next = await createNativeEffectMaterial(scene, source, new AbortController().signal); scene.dispose();
    expect(next.inspect().status).toBe("disposed");
  });
});
