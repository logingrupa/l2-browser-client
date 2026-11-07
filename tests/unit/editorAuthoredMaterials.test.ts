import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { SceneSerializer } from "@babylonjs/core/Misc/sceneSerializer";
import { LoadAssetContainer } from "@babylonjs/core/Loading/Plugins/babylonFileLoader";
import "@babylonjs/core/Meshes/groundMesh";
import "@babylonjs/core/Materials/colorCurves";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { restoreEditorAuthoredMaterials } from "../../src/editor/restoreEditorAuthoredMaterials";

describe("Editor Play omitted authored ShaderMaterial recovery", () => {
  let engine: NullEngine, source: Scene, target: Scene, releases: (() => void)[];
  const manifestSha256 = "a".repeat(64);
  beforeEach(() => {
    engine = new NullEngine(); source = new Scene(engine); target = new Scene(engine); releases = [];
    vi.stubGlobal("location", { protocol: "file:" });
  });
  afterEach(() => { for (const release of releases) release(); engine.dispose(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  function terrain(scene: Scene, suffix = "0") {
    scene.metadata = { nativeEditorImport: { schemaVersion: 1, manifestSha256, targetScene: "assets/native-world.scene" } };
    let root = scene.getTransformNodeById("native-world-root");
    if (!root) {
      root = new TransformNode("Saved world", scene); root.id = "native-world-root"; root.scaling.z = -1;
      root.metadata = { nativeWorldRoot: { schemaVersion: 1, manifestSha256 } };
    }
    const mesh = MeshBuilder.CreateGround(`Terrain ${suffix}`, { width: 4, height: 4 }, scene);
    mesh.id = `native-terrain-${suffix}`; mesh.parent = root;
    mesh.metadata = { worldTerrain: true, nativeEditorSource: { originalId: `20_20.TerrainInfo${suffix}` } };
    return mesh;
  }
  function fixture() {
    const authored = terrain(source), runtime = terrain(target);
    const material = new ShaderMaterial("Current authored terrain", source, {
      vertexSource: "attribute vec3 position; void main(){gl_Position=vec4(position,1.0);}",
      fragmentSource: "precision highp float; uniform float authoredTint; void main(){gl_FragColor=vec4(authoredTint,0.,0.,1.);}",
    }, { attributes: ["position"], uniforms: ["authoredTint"] });
    material.id = "native-current-terrain-material"; material.setFloat("authoredTint", .37); material.backFaceCulling = false;
    authored.material = material;
    return { authored, runtime, material };
  }
  function recover(signal = new AbortController().signal) {
    const release = restoreEditorAuthoredMaterials(target, signal); releases.push(release); return release;
  }
  const resources = (scene: Scene) => ({ materials: [...scene.materials], textures: [...scene.textures] });

  it("parses the live unsaved shader into the Play scene without sharing mutable authoring state", () => {
    const { authored, runtime, material } = fixture();
    material.setFloat("authoredTint", .83);
    material.shaderPath = { vertexSource: "attribute vec3 position; void main(){gl_Position=vec4(position,1.0);}",
      fragmentSource: "precision highp float; void main(){gl_FragColor=vec4(.2,.4,.7,1.);}" };
    const before = structuredClone(material.serialize()), sourceResources = resources(source), targetResources = resources(target);
    const sourceDispose = vi.spyOn(material, "dispose"), fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const release = recover(), copy = runtime.material as ShaderMaterial;
    expect(copy).toBeInstanceOf(ShaderMaterial); expect(copy).not.toBe(material); expect(copy.getScene()).toBe(target);
    const serialized = copy.serialize(); delete serialized.uniqueId; const expected = structuredClone(before); delete expected.uniqueId;
    expect(serialized).toEqual(expected); expect(copy.options).not.toBe(material.options); expect(copy.shaderPath).not.toBe(material.shaderPath);
    expect(authored.material).toBe(material); expect(material.serialize()).toEqual(before); expect(resources(source)).toEqual(sourceResources);
    expect(fetcher).not.toHaveBeenCalled();
    release(); release();
    expect(runtime.material).toBeNull(); expect(resources(target)).toEqual(targetResources); expect(sourceDispose).not.toHaveBeenCalled();
  });

  it.each([false, true])("parses current texture settings with delayed loading %s and disposes only the new texture wrappers", delayed => {
    const { runtime, material } = fixture(), originalTexture = new Texture("C:\\Fixture Project\\assets\\current-authored.png", source);
    originalTexture.name = "assets/current-authored.png"; originalTexture.wrapU = Texture.CLAMP_ADDRESSMODE; originalTexture.uScale = 2.5;
    originalTexture.url = originalTexture.name; target.useDelayedTextureLoading = delayed;
    material.setTexture("currentLayer", originalTexture);
    const sourceDispose = vi.spyOn(originalTexture, "dispose");
    const parser = vi.spyOn(Texture, "Parse"), createTexture = vi.spyOn(engine, "createTexture");
    const before = resources(target), release = recover(), copy = runtime.material as ShaderMaterial;
    expect(parser).toHaveBeenCalledWith(expect.objectContaining({ name: "assets/current-authored.png", uScale: 2.5, wrapU: 0 }), target, "C:/Fixture Project/");
    // Exercise the actual parser, including deferred requests. Absolute paths
    // bypass Editor's WebGL-only and relative-fetch rewriting hooks.
    const copiedTexture = copy.getActiveTextures()[0]!;
    if (delayed) (copiedTexture as Texture).delayLoad();
    expect(createTexture.mock.calls.map(call => call[0])).toEqual(["C:/Fixture Project/assets/current-authored.png"]);
    expect(copiedTexture).not.toBe(originalTexture); expect(copiedTexture.getScene()).toBe(target);
    expect(copiedTexture.name).toBe(originalTexture.name);
    expect((copiedTexture as Texture).url).toBe("C:/Fixture Project/assets/current-authored.png");
    expect(copiedTexture.wrapU).toBe(Texture.CLAMP_ADDRESSMODE); expect((copiedTexture as Texture).uScale).toBe(2.5);
    expect(originalTexture.url).toBe("assets/current-authored.png");
    const copiedDispose = vi.spyOn(copiedTexture, "dispose");
    release(); expect(copiedDispose).toHaveBeenCalledTimes(1); expect(sourceDispose).not.toHaveBeenCalled(); expect(resources(target)).toEqual(before);
  });

  it("recovers the undefined material produced by Babylon's real unresolved numeric material lookup and restores that exact assignment", async () => {
    const { material } = fixture();
    target.dispose(); target = new Scene(engine);
    const exported = await SceneSerializer.SerializeAsync(source);
    // Reproduce Editor 5.5.3 configureMaterials: keep the mesh's materialUniqueId
    // while filtering every ShaderMaterial from the serialized material array.
    exported.materials = exported.materials.filter((value: { customType?: string }) => value.customType !== "BABYLON.ShaderMaterial");
    LoadAssetContainer(target, JSON.stringify(exported), "", (message, error) => { throw error ?? new Error(message); }, true);
    target.metadata = structuredClone(exported.metadata);
    const runtime = target.getMeshById("native-terrain-0")!;
    expect(runtime.material).toBeUndefined(); expect(target.getMaterialById(material.id)).toBeNull();
    const before = resources(target), release = recover();
    expect(runtime.material).toBeInstanceOf(ShaderMaterial); expect(runtime.material).not.toBe(material);
    release(); expect(runtime.material).toBeUndefined(); expect(resources(target)).toEqual(before);
  });

  it.each(["unresolved", "conflicting"])("refuses %s live texture roots without guessing or changing authoring resources", fault => {
    const { runtime, material } = fixture();
    const first = new Texture(fault === "unresolved" ? null : "C:/One/assets/a.png", source); first.name = "assets/a.png";
    material.setTexture("first", first);
    if (fault === "conflicting") {
      const second = new Texture("C:/Two/assets/b.png", source); second.name = "assets/b.png"; material.setTexture("second", second);
    }
    const before = resources(target), sourceBefore = resources(source);
    expect(() => recover()).toThrow(/live texture|resource roots/);
    expect(runtime.material).toBeNull(); expect(resources(target)).toEqual(before); expect(resources(source)).toEqual(sourceBefore);
  });

  it.each(["http:", "https:"])("does nothing in %s production even when terrain has no material", protocol => {
    const { runtime, material } = fixture(), serialized = vi.spyOn(material, "serialize"); vi.stubGlobal("location", { protocol });
    recover()(); expect(runtime.material).toBeNull(); expect(serialized).not.toHaveBeenCalled();
  });

  it("leaves an existing runtime material untouched without requiring an authoring scene", () => {
    const runtime = terrain(target), existing = new StandardMaterial("User material", target); runtime.material = existing;
    const before = resources(target); recover()(); expect(runtime.material).toBe(existing); expect(resources(target)).toEqual(before);
  });

  it.each(["missing", "ambiguous", "manifest", "terrain-id", "provenance", "non-shader"] as const)("refuses %s source evidence before allocating or assigning resources", fault => {
    const { authored, runtime } = fixture();
    if (fault === "missing") source.dispose();
    if (fault === "ambiguous") terrain(new Scene(engine));
    if (fault === "manifest") source.metadata.nativeEditorImport.manifestSha256 = "b".repeat(64);
    if (fault === "terrain-id") authored.id = "different-terrain";
    if (fault === "provenance") authored.metadata.nativeEditorSource.originalId = "Other.Terrain";
    if (fault === "non-shader") authored.material = new StandardMaterial("User standard material", source);
    const before = resources(target);
    expect(() => recover()).toThrow(/Editor authored terrain material:/); expect(runtime.material).toBeNull(); expect(resources(target)).toEqual(before);
  });

  it("rolls back partially allocated parsing resources without disposing source or unrelated materials", () => {
    const { runtime, material } = fixture(), unrelated = new StandardMaterial("Unrelated", target), before = resources(target);
    const sourceDispose = vi.spyOn(material, "dispose"), unrelatedDispose = vi.spyOn(unrelated, "dispose");
    vi.spyOn(ShaderMaterial, "Parse").mockImplementation((_data, destination) => {
      new ShaderMaterial("Partial parse", destination, {}, {}); new Texture(null, destination);
      throw new Error("Texture parse failed");
    });
    expect(() => recover()).toThrow("Texture parse failed"); expect(runtime.material).toBeNull(); expect(resources(target)).toEqual(before);
    expect(sourceDispose).not.toHaveBeenCalled(); expect(unrelatedDispose).not.toHaveBeenCalled();
  });

  it.each(["before", "serialize", "parse"] as const)("cleans up when cancellation occurs during %s", stage => {
    const { runtime, material } = fixture(), controller = new AbortController(), before = resources(target);
    if (stage === "before") controller.abort();
    if (stage === "serialize") {
      const serialize = material.serialize.bind(material);
      vi.spyOn(material, "serialize").mockImplementation(() => { const value = serialize(); controller.abort(); return value; });
    }
    if (stage === "parse") {
      const parse = ShaderMaterial.Parse;
      vi.spyOn(ShaderMaterial, "Parse").mockImplementation((data, destination, url) => { const value = parse(data, destination, url); controller.abort(); return value; });
    }
    expect(() => recover(controller.signal)).toThrow(); expect(runtime.material).toBeNull(); expect(resources(target)).toEqual(before);
  });

  it("shares one parsed copy for shared source materials and retains a later runtime replacement on release", () => {
    const { runtime, material } = fixture(), secondSource = terrain(source, "1"), secondTarget = terrain(target, "1");
    secondSource.material = material; const before = resources(target), parser = vi.spyOn(ShaderMaterial, "Parse");
    const release = recover(), copy = runtime.material;
    expect(parser).toHaveBeenCalledTimes(1); expect(secondTarget.material).toBe(copy);
    const replacement = new StandardMaterial("Later authored choice", target); runtime.material = replacement;
    release(); expect(runtime.material).toBe(replacement); expect(secondTarget.material).toBeNull();
    expect(target.materials).toEqual([...before.materials, replacement]);
  });
});
