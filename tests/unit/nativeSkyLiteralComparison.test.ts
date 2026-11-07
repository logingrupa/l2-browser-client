import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { GetEnvironmentBRDFTexture } from "@babylonjs/core/Misc/brdfTextureTools";
import { createNativeSkyLiteralComparison } from "../../src/scene/world/nativeSkyLiteralComparison";
import { parseNativeEnvironmentTables, selectNativeSkyLiteral, skyEnvironmentBindings } from "../../src/scene/world/nativeEnvironmentTables";

const source = parseNativeEnvironmentTables(JSON.parse(readFileSync("artifacts/native-parity/research/sky-environment-conversion-20261107/converted/sky-tables.json", "utf8")));
const literal = (key = "COLOR13", file = "timeenv0.int") => selectNativeSkyLiteral(source, file, key);

describe("private literal sky material comparison", () => {
  let engine: NullEngine, scene: Scene, comparisons: ReturnType<typeof createNativeSkyLiteralComparison>[];
  beforeEach(() => { engine = new NullEngine(); scene = new Scene(engine); GetEnvironmentBRDFTexture(scene); comparisons = []; });
  afterEach(() => { for (const comparison of comparisons) comparison.dispose(); scene.dispose(); engine.dispose(); vi.restoreAllMocks(); });
  function fixture() {
    const entries = skyEnvironmentBindings.map((binding, index) => {
      const mesh = MeshBuilder.CreateBox(`sky-${index}`, {}, scene), material = new PBRMaterial(`authored-${index}`, scene);
      material.metadata = { gltf: { extras: { nativeSourceReference: binding.material } }, authoredNote: "preserve me" };
      material.albedoColor = Color3.FromArray([[206 / 255, 150 / 255, 0], [.3, .4, .5], [.9, .8, .7]][index]!);
      material.emissiveColor = new Color3(.02, .03, .04); material.unlit = true;
      material.alpha = .4 + index * .2; material.backFaceCulling = false; material.disableDepthWrite = true;
      material.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND; material.fogEnabled = false;
      material.stencil.enabled = true; material.stencil.funcRef = 7;
      const texture = new Texture(null, scene); texture.name = `source-texture-${index}`;
      texture.hasAlpha = true; texture.gammaSpace = false; texture.uScale = 2; texture.coordinatesIndex = 1;
      material.albedoTexture = texture; material.opacityTexture = texture;
      mesh.material = material;
      return { mesh, material, texture };
    });
    const comparison = createNativeSkyLiteralComparison(entries.map(entry => entry.mesh)); comparisons.push(comparison);
    return { entries, comparison };
  }
  const state = (material: PBRMaterial) => ({
    albedo: material.albedoColor.asArray(), emissive: material.emissiveColor.asArray(), alpha: material.alpha,
    unlit: material.unlit, cull: material.backFaceCulling, depth: material.disableDepthWrite, fog: material.fogEnabled,
    alphaMode: material.alphaMode, transparencyMode: material.transparencyMode, stencil: material.stencil.serialize(),
    metadata: structuredClone(material.metadata),
  });

  it("changes only private albedo factors and keeps source materials, geometry and texture policies intact", () => {
    const { entries, comparison } = fixture(), original = entries.map(entry => state(entry.material));
    const positions = entries.map(entry => [...entry.mesh.getVerticesData("position")!]);
    const originalTextures = new Set(scene.textures);
    comparison.apply(literal());
    entries.forEach((entry, index) => {
      const clone = entry.mesh.material as PBRMaterial;
      expect(clone).not.toBe(entry.material);
      expect(state(entry.material)).toEqual(original[index]);
      expect(state(clone)).toEqual({ ...original[index], albedo: literal().layers[index]!.row.rgb.map(channel => channel / 255) });
      expect(clone.albedoColor).not.toBe(entry.material.albedoColor);
      expect(clone.albedoTexture).not.toBe(entry.texture);
      expect(clone.albedoTexture).toBe(clone.opacityTexture);
      expect(clone.albedoTexture).toMatchObject({ hasAlpha: true, gammaSpace: false, uScale: 2, coordinatesIndex: 1 });
      expect([...entry.mesh.getVerticesData("position")!]).toEqual(positions[index]);
    });
    const privateTextures = scene.textures.filter(texture => !originalTextures.has(texture));
    expect(privateTextures).toHaveLength(3);
    const privateDisposes = privateTextures.map(texture => vi.spyOn(texture, "dispose"));
    const originalDisposes = entries.map(entry => vi.spyOn(entry.texture, "dispose"));
    comparison.restore();
    expect(entries.map(entry => entry.mesh.material)).toEqual(entries.map(entry => entry.material));
    expect(entries.map(entry => state(entry.material))).toEqual(original);
    privateDisposes.forEach(dispose => expect(dispose).toHaveBeenCalledTimes(1));
    originalDisposes.forEach(dispose => expect(dispose).not.toHaveBeenCalled());
    expect(new Set(scene.textures)).toEqual(originalTextures);
    expect(comparison.inspection()).toMatchObject({ mode: "stored-materials", selected: null });
  });

  it("reuses private materials between explicit rows, exposes immutable selection evidence, and can apply after restoration", () => {
    const { entries, comparison } = fixture(); comparison.apply(literal());
    const clones = entries.map(entry => entry.mesh.material), textures = [...scene.textures];
    comparison.apply(literal("COLOR25", "timeenv3.int"));
    expect(entries.map(entry => entry.mesh.material)).toEqual(clones); expect(scene.textures).toEqual(textures);
    const inspected = comparison.inspection();
    expect(inspected).toMatchObject({ mode: "literal-source-row-comparison", nativeSelection: "unverified", nativeInterpolation: "unverified",
      selected: { file: "timeenv3.int", key: "COLOR25", tLiteral: 24 } });
    expect(inspected.selected!.layers[0]).toMatchObject({ declaredNum: 1, physicalColorRows: 25, declaredNumMatchesPhysicalRows: false });
    inspected.selected!.layers[0]!.row.rgb[0] = 0;
    expect(comparison.inspection().selected!.layers[0]!.row.rgb).toEqual([255, 35, 35]);
    comparison.restore(); comparison.restore(); comparison.apply(literal());
    expect(entries.every((entry, index) => entry.mesh.material !== clones[index] && entry.mesh.material !== entry.material)).toBe(true);
    comparison.dispose(); comparison.dispose();
    expect(comparison.inspection()).toMatchObject({ mode: "disposed", selected: null });
    expect(() => comparison.apply(literal())).toThrow("disposed");
  });

  it.each(["missing", "duplicate", "invalid-rgb"])("rejects a %s layer without partial material replacement", fault => {
    const { entries, comparison } = fixture(), candidate = literal(), materials = [...scene.materials], textures = [...scene.textures];
    if (fault === "missing") candidate.layers.pop();
    if (fault === "duplicate") candidate.layers.push(structuredClone(candidate.layers[0]!));
    if (fault === "invalid-rgb") candidate.layers[2]!.row.rgb[0] = 256;
    expect(() => comparison.apply(candidate)).toThrow("Invalid literal color");
    expect(entries.map(entry => entry.mesh.material)).toEqual(entries.map(entry => entry.material));
    expect(scene.materials).toEqual(materials); expect(scene.textures).toEqual(textures);
    expect(comparison.inspection().selected).toBeNull();
  });

  it("does not overwrite a newer external assignment during apply, restore or disposal", () => {
    const { entries, comparison } = fixture(); comparison.apply(literal());
    const replacement = new PBRMaterial("new user edit", scene); replacement.albedoColor = new Color3(.1, .2, .3);
    entries[1]!.mesh.material = replacement;
    expect(() => comparison.apply(literal("COLOR25"))).toThrow("newer edits are retained");
    comparison.restore(); comparison.dispose();
    expect(entries[1]!.mesh.material).toBe(replacement); expect(replacement.albedoColor.asArray()).toEqual([.1, .2, .3]);
    expect(entries[0]!.mesh.material).toBe(entries[0]!.material); expect(entries[2]!.mesh.material).toBe(entries[2]!.material);
    expect(scene.materials).toContain(replacement);
  });

  it("preserves an original material's newer color edits while the comparison is active", () => {
    const { entries, comparison } = fixture(); comparison.apply(literal());
    entries[0]!.material.albedoColor = new Color3(.15, .25, .35); entries[0]!.material.alpha = .23;
    comparison.restore();
    expect(entries[0]!.mesh.material).toBe(entries[0]!.material);
    expect(entries[0]!.material.albedoColor.asArray()).toEqual([.15, .25, .35]); expect(entries[0]!.material.alpha).toBe(.23);
  });

  it("retains a temporary texture wrapper explicitly adopted by another live material", () => {
    const { entries, comparison } = fixture(); comparison.apply(literal());
    const adopted = (entries[0]!.mesh.material as PBRMaterial).albedoTexture!;
    const other = new PBRMaterial("new authored texture reference", scene); other.albedoTexture = adopted;
    const dispose = vi.spyOn(adopted, "dispose");
    comparison.restore(); comparison.dispose();
    expect(dispose).not.toHaveBeenCalled(); expect(other.albedoTexture).toBe(adopted); expect(scene.textures).toContain(adopted);
    expect(entries[0]!.mesh.material).toBe(entries[0]!.material);
  });

  it("retains a comparison material explicitly adopted by a different live mesh", () => {
    const { entries, comparison } = fixture(); comparison.apply(literal());
    const adopted = entries[0]!.mesh.material as PBRMaterial, other = MeshBuilder.CreateBox("new authored reference", {}, scene);
    other.material = adopted;
    const materialDispose = vi.spyOn(adopted, "dispose"), textureDispose = vi.spyOn(adopted.albedoTexture!, "dispose");
    comparison.restore();
    expect(entries[0]!.mesh.material).toBe(entries[0]!.material); expect(other.material).toBe(adopted);
    expect(materialDispose).not.toHaveBeenCalled(); expect(textureDispose).not.toHaveBeenCalled();
    expect(scene.materials).toContain(adopted);
  });

  it("releases earlier clones when a later clone fails, leaving original assignments and textures intact", () => {
    const { entries, comparison } = fixture(), materials = [...scene.materials], textures = [...scene.textures];
    vi.spyOn(entries[1]!.material, "clone").mockImplementation(() => { throw new Error("clone failure"); });
    expect(() => comparison.apply(literal())).toThrow("clone failure");
    expect(entries.map(entry => entry.mesh.material)).toEqual(entries.map(entry => entry.material));
    expect(scene.materials).toEqual(materials); expect(scene.textures).toEqual(textures);
    expect(comparison.inspection().selected).toBeNull();
  });

  it("cleans up a partially created material and texture if cloning throws after construction", () => {
    const { entries, comparison } = fixture(), materials = [...scene.materials], textures = [...scene.textures];
    vi.spyOn(entries[1]!.material, "clone").mockImplementation(() => {
      const partial = new PBRMaterial("failed plugin clone", scene); partial.albedoTexture = new Texture(null, scene);
      throw new Error("plugin clone failed after allocation");
    });
    expect(() => comparison.apply(literal())).toThrow("plugin clone failed");
    expect(entries.map(entry => entry.mesh.material)).toEqual(entries.map(entry => entry.material));
    expect(scene.materials.map(material => material.uniqueId)).toEqual(materials.map(material => material.uniqueId));
    expect(scene.textures.map(texture => texture.uniqueId)).toEqual(textures.map(texture => texture.uniqueId));
  });

  it.each(["original", "null"])("rejects a clone method returning %s without changing or disposing authored materials", returned => {
    const { entries, comparison } = fixture(), materials = [...scene.materials], textures = [...scene.textures];
    const before = entries.map(entry => state(entry.material)), dispose = vi.spyOn(entries[1]!.material, "dispose");
    vi.spyOn(entries[1]!.material, "clone").mockReturnValue(returned === "original" ? entries[1]!.material : null as unknown as PBRMaterial);
    expect(() => comparison.apply(literal())).toThrow();
    expect(entries.map(entry => entry.mesh.material)).toEqual(entries.map(entry => entry.material));
    expect(entries.map(entry => state(entry.material))).toEqual(before); expect(dispose).not.toHaveBeenCalled();
    expect(scene.materials.map(material => material.uniqueId)).toEqual(materials.map(material => material.uniqueId));
    expect(scene.textures.map(texture => texture.uniqueId)).toEqual(textures.map(texture => texture.uniqueId));
  });

  it.each(["missing", "duplicate", "unsupported"])("rejects %s sky material mapping before mutating the scene", fault => {
    const { entries } = fixture();
    if (fault === "missing") entries[2]!.material.metadata = {};
    if (fault === "duplicate") entries[2]!.material.metadata = structuredClone(entries[1]!.material.metadata);
    if (fault === "unsupported") {
      const standard = new StandardMaterial("authored custom alternative", scene); standard.metadata = entries[2]!.material.metadata;
      entries[2]!.mesh.material = standard;
    }
    const materials = [...scene.materials], textures = [...scene.textures], assignments = entries.map(entry => entry.mesh.material);
    expect(() => createNativeSkyLiteralComparison(entries.map(entry => entry.mesh))).toThrow("requires one PBR material");
    expect(entries.map(entry => entry.mesh.material)).toEqual(assignments); expect(scene.materials).toEqual(materials); expect(scene.textures).toEqual(textures);
  });
});
