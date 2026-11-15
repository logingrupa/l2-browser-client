import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { RenderTargetTexture } from "@babylonjs/core/Materials/Textures/renderTargetTexture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { GetEnvironmentBRDFTexture } from "@babylonjs/core/Misc/brdfTextureTools";
import { createNativeMaterialOverrides, type NativeMaterialOverride } from "../../src/assets/native/nativeMaterialOverrides";

const materialName = "Fixture.Body.SourceTexture", entityId = "local-player";

describe("authored native material overrides", () => {
  let engine: NullEngine, scene: Scene, adapters: ReturnType<typeof createNativeMaterialOverrides>[];
  beforeEach(() => {
    engine = new NullEngine(); scene = new Scene(engine); adapters = [];
    GetEnvironmentBRDFTexture(scene);
  });
  afterEach(() => { for (const adapter of adapters) adapter.dispose(); scene.dispose(); engine.dispose(); vi.restoreAllMocks(); });
  function create(settings?: NativeMaterialOverride) {
    const adapter = createNativeMaterialOverrides(scene, settings); adapters.push(adapter); return adapter;
  }
  function source(name = materialName) {
    const material = new PBRMaterial(name, scene);
    material.albedoColor = new Color3(.8, .6, .4); material.roughness = .9; material.metallic = .15;
    material.alpha = .72; material.alphaCutOff = .35; material.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHATEST;
    material.backFaceCulling = false; material.useRoughnessFromMetallicTextureAlpha = false;
    material.useRoughnessFromMetallicTextureGreen = true; material.clearCoat.isEnabled = true; material.clearCoat.intensity = .45;
    return material;
  }
  function mesh(material: PBRMaterial | StandardMaterial, owner = entityId) {
    const result = MeshBuilder.CreateBox("native primitive", {}, scene);
    result.material = material; result.metadata = { clientEntityId: owner }; return result;
  }
  const counts = () => ({ materials: scene.materials.length, textures: scene.textures.length });

  it("isolates the exact entity/material while preserving alpha, textures, UVs and other PBR settings", () => {
    const original = source(), other = source("Fixture.Body.OtherTexture");
    const texture = new Texture(null, scene); texture.uScale = 2; texture.vOffset = .3; texture.wrapU = Texture.MIRROR_ADDRESSMODE;
    texture.hasAlpha = true; original.albedoTexture = texture; original.opacityTexture = texture;
    const first = mesh(original), second = mesh(original), untouchedActor = mesh(original, "native-musveren"), untouchedMaterial = mesh(other);
    const baseline = counts(), originalSerial = original.serialize();
    const adapter = create({ entityId, sourceMaterial: materialName, tint: [.5, 1, .25], roughness: .2 });
    adapter.update();
    const applied = first.material as PBRMaterial;
    expect(applied).not.toBe(original); expect(second.material).toBe(applied);
    expect(untouchedActor.material).toBe(original); expect(untouchedMaterial.material).toBe(other);
    expect(applied.name).toBe(materialName);
    expect(applied.albedoColor.asArray()).toEqual([.4, .6, .1]); expect(applied.roughness).toBe(.2);
    expect(applied.albedoTexture).not.toBe(texture); expect(applied.opacityTexture).toBe(applied.albedoTexture);
    expect(applied.albedoTexture).toMatchObject({ hasAlpha: true, uScale: 2, vOffset: .3, wrapU: Texture.MIRROR_ADDRESSMODE });
    expect(applied).toMatchObject({ alpha: .72, alphaCutOff: .35, transparencyMode: PBRMaterial.PBRMATERIAL_ALPHATEST,
      metallic: .15, backFaceCulling: false, useRoughnessFromMetallicTextureAlpha: false, useRoughnessFromMetallicTextureGreen: true });
    expect(applied.clearCoat.isEnabled).toBe(true); expect(applied.clearCoat.intensity).toBe(.45);
    expect(original.serialize()).toEqual(originalSerial);
    expect(adapter.snapshot()).toMatchObject({ enabled: true, matchedMeshes: 2, matchedMaterials: 1, failure: null,
      materials: [{ sourceAlbedo: [.8, .6, .4], albedo: [.4, .6, .1], sourceRoughness: .9, roughness: .2, alpha: .72 }] });
    const appliedCounts = counts(); adapter.update(); adapter.update();
    expect(counts()).toEqual(appliedCounts); expect(first.material).toBe(applied); expect(applied.albedoColor.asArray()).toEqual([.4, .6, .1]);
    adapter.dispose(); adapter.dispose();
    expect(first.material).toBe(original); expect(second.material).toBe(original); expect(untouchedActor.material).toBe(original);
    expect(counts()).toEqual(baseline); expect(scene.textures).toContain(texture);
    expect(adapter.snapshot()).toMatchObject({ disposed: true, matchedMeshes: 0, matchedMaterials: 0 });
  });

  it("waits for a late native load, handles equip/unequip and frees copies of disposed models", () => {
    const adapter = create({ entityId, sourceMaterial: materialName, tint: [.25, .5, 1] });
    adapter.update(); expect(adapter.snapshot()).toMatchObject({ matchedMeshes: 0, failure: null });
    const original = source(), base = mesh(original), baseline = counts();
    adapter.update(); expect(base.material).not.toBe(original); expect((base.material as PBRMaterial).roughness).toBe(.9);
    base.setEnabled(false); adapter.update(); expect(base.material).toBe(original); expect(counts()).toEqual(baseline);
    const replacementSource = source(), replacement = mesh(replacementSource), equippedBaseline = counts();
    adapter.update(); expect(adapter.snapshot()).toMatchObject({ matchedMeshes: 1, matchedMaterials: 1 });
    expect(replacement.material).not.toBe(replacementSource);
    replacement.dispose(); replacementSource.dispose(); adapter.update();
    expect(adapter.snapshot()).toMatchObject({ matchedMeshes: 0, matchedMaterials: 0 });
    expect(counts().materials).toBe(equippedBaseline.materials - 1);
    base.setEnabled(true); adapter.update(); expect(base.material).not.toBe(original);
    adapter.dispose(); expect(base.material).toBe(original); expect(counts()).toEqual(baseline);
  });

  it("uses distinct copies for distinct source materials with the same identity and preserves omitted albedo", () => {
    const firstSource = source(), secondSource = source(); secondSource.albedoColor = new Color3(.1, .2, .3);
    const first = mesh(firstSource), second = mesh(secondSource);
    const adapter = create({ entityId, sourceMaterial: materialName, roughness: 0 }); adapter.update();
    expect(first.material).not.toBe(second.material);
    expect((first.material as PBRMaterial).albedoColor.asArray()).toEqual([.8, .6, .4]);
    expect((second.material as PBRMaterial).albedoColor.asArray()).toEqual([.1, .2, .3]);
    expect(adapter.snapshot()).toMatchObject({ matchedMeshes: 2, matchedMaterials: 2, roughness: 0 });
  });

  it("does not restore over an externally replaced material or dispose shared render-target textures", () => {
    const original = source(), target = new RenderTargetTexture("shared native environment", 8, scene);
    original.reflectionTexture = target;
    const primitive = mesh(original), replacement = source("Fixture.Other.Material");
    const baseline = counts(), adapter = create({ entityId, sourceMaterial: materialName, roughness: .5 }); adapter.update();
    expect((primitive.material as PBRMaterial).reflectionTexture).toBe(target);
    primitive.material = replacement; adapter.update(); adapter.dispose();
    expect(primitive.material).toBe(replacement); expect(scene.textures).toContain(target); expect(counts()).toEqual(baseline);
  });

  it("rolls back all copies if cloning one selected source fails, then can recover", () => {
    const firstSource = source(), secondSource = source(), first = mesh(firstSource), second = mesh(secondSource);
    const baseline = counts(), originalClone = secondSource.clone.bind(secondSource);
    const clone = vi.spyOn(secondSource, "clone").mockImplementationOnce(() => {
      new PBRMaterial("incomplete clone", scene); new Texture(null, scene); throw new Error("Clone fixture failed");
    }).mockImplementation(originalClone);
    const adapter = create({ entityId, sourceMaterial: materialName, roughness: .4 }); adapter.update();
    expect(first.material).toBe(firstSource); expect(second.material).toBe(secondSource); expect(counts()).toEqual(baseline);
    expect(adapter.snapshot()).toMatchObject({ matchedMeshes: 0, matchedMaterials: 0, failure: "Clone fixture failed" });
    adapter.update(); expect(clone).toHaveBeenCalledTimes(2);
    expect(adapter.snapshot()).toMatchObject({ matchedMeshes: 2, matchedMaterials: 2, failure: null });
    adapter.dispose(); expect(counts()).toEqual(baseline);
  });

  it("reports unsupported material types without applying to only part of the target", () => {
    const original = source(), first = mesh(original), unsupported = new StandardMaterial(materialName, scene), second = mesh(unsupported);
    const baseline = counts(), adapter = create({ entityId, sourceMaterial: materialName, roughness: .5 }); adapter.update();
    expect(first.material).toBe(original); expect(second.material).toBe(unsupported); expect(counts()).toEqual(baseline);
    expect(adapter.snapshot().failure).toContain("not a supported imported PBR material");
  });

  it("keeps disabled authoring a no-op and requires exact case-sensitive identities", () => {
    const original = source(), primitive = mesh(original), baseline = counts();
    const disabled = create(); disabled.update();
    expect(disabled.snapshot()).toMatchObject({ enabled: false, matchedMeshes: 0 }); expect(primitive.material).toBe(original);
    const unmatched = create({ entityId, sourceMaterial: materialName.toLowerCase(), tint: [1, 1, 1] }); unmatched.update();
    expect(unmatched.snapshot()).toMatchObject({ enabled: true, matchedMeshes: 0, failure: null }); expect(counts()).toEqual(baseline);
  });

  it("rejects invalid settings before allocation and captures the authored values once", () => {
    const valid: NativeMaterialOverride = { entityId, sourceMaterial: materialName, roughness: .5 }, baseline = counts();
    for (const bad of [{ entityId: " " }, { sourceMaterial: "SourceTexture" }, { sourceMaterial: " Fixture.Body.SourceTexture" },
      { roughness: NaN }, { roughness: Infinity }, { roughness: -1 }, { roughness: 1.1 }, { tint: [1, 2, 1] }, { tint: [1, 1] }]) {
      expect(() => create({ ...valid, ...bad } as NativeMaterialOverride)).toThrow("Native material override");
    }
    expect(() => create({ entityId, sourceMaterial: materialName })).toThrow("Native material override"); expect(counts()).toEqual(baseline);
    const tint: [number, number, number] = [.5, 1, 1], settings = { ...valid, tint };
    const primitive = mesh(source()), adapter = create(settings); tint[0] = 0; settings.roughness = .1; adapter.update();
    expect((primitive.material as PBRMaterial).albedoColor.r).toBe(.4);
    expect((primitive.material as PBRMaterial).roughness).toBe(.5);
  });
});
