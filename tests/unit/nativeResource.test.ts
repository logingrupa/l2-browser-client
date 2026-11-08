import { afterEach, describe, expect, it, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { nativeResourceUrl } from "../../src/assets/native/nativeResourceUrl";
import { loadNativePlayerPackages } from "../../src/assets/native/loadNativeCatalog";
import { sha256 } from "../../src/assets/package/readAssetPackage";
import { loadNativeSection } from "../../src/scene/world/loadNativeSection";
import { applyNativeTerrainPreview } from "../../src/scene/world/nativeTerrainPreview";
import { assetFixture } from "../fixtures/assetPackageFixture";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("native public resources in browser and Editor Play", () => {
  it("keeps browser root URLs and accepts only bounded native resource paths", () => {
    expect(nativeResourceUrl("/l2/catalog.json")).toBe("/l2/catalog.json");
    for (const protocol of ["https:", "http:", "file:"]) {
      vi.stubGlobal("location", { protocol });
      expect(nativeResourceUrl("/l2/catalog.json")).toBe(protocol === "file:" ? "l2/catalog.json" : "/l2/catalog.json");
      for (const path of ["/assets/model.glb", "l2/catalog.json", "/l2/../private", "/l2/%2e%2e/private", "/l2/a\\b", "/l2//a", "https://elsewhere/l2/catalog.json"]) {
        expect(() => nativeResourceUrl(path)).toThrow("bounded /l2 path");
      }
    }
  });

  it.each(["https:", "file:"])("loads exact package bytes and rejects corruption under %s", async protocol => {
    vi.stubGlobal("location", { protocol });
    const prefix = protocol === "file:" ? "l2/" : "/l2/";
    const fixture = await assetFixture(), hash = await sha256(fixture.bytes);
    const archive = `/l2/${hash}/asset.l2asset`;
    const catalog = { schemaVersion: 1, models: [{ id: "human-male-fighter:0", archive, archiveSha256: hash }], playerProfiles: [] };
    const responses = new Map<string, Uint8Array<ArrayBuffer>>([
      [`${prefix}catalog.json`, new TextEncoder().encode(JSON.stringify(catalog))],
      [`${prefix}${hash}/asset.l2asset`, new Uint8Array(fixture.bytes)],
    ]);
    const fetcher = vi.fn(async (url: string) => {
      const bytes = responses.get(url);
      return new Response(bytes?.slice().buffer ?? "missing", { status: bytes ? 200 : 404 });
    });
    vi.stubGlobal("fetch", fetcher);
    const signal = new AbortController().signal;
    const loaded = await loadNativePlayerPackages(signal, ["human-male-fighter"]);
    expect(loaded.models.get("human-male-fighter:0")?.manifest).toEqual(fixture.readManifest);
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([...responses.keys()]);
    expect(fetcher).toHaveBeenLastCalledWith(`${prefix}${hash}/asset.l2asset`, { signal });
    responses.set(`${prefix}${hash}/asset.l2asset`, new Uint8Array([1, 2, 3]));
    await expect(loadNativePlayerPackages(signal, ["human-male-fighter"])).rejects.toThrow("archive hash mismatch");
  });

  it.each(["https:", "file:"])("retains section hash validation and cleanup under %s", async protocol => {
    vi.stubGlobal("location", { protocol });
    const prefix = protocol === "file:" ? "l2/" : "/l2/", hash = "a".repeat(64);
    const manifest = `/l2/maps/${hash}/map-section-runtime/manifest.json`;
    const catalog = { schemaVersion: 1, models: [], sections: [{ id: "map-20-20-section", manifest, manifestSha256: hash }] };
    const fetcher = vi.fn(async (url: string) => url === `${prefix}catalog.json`
      ? Response.json(catalog) : url === `${prefix}maps/${hash}/map-section-runtime/manifest.json`
        ? new Response("corrupt manifest") : new Response("missing", { status: 404 }));
    vi.stubGlobal("fetch", fetcher);
    const engine = new NullEngine(), scene = new Scene(engine); scene.useRightHandedSystem = true;
    try {
      await expect(loadNativeSection(scene, new AbortController().signal)).rejects.toThrow("hash/length mismatch");
      expect(fetcher.mock.calls.map(([url]) => url)).toEqual([`${prefix}catalog.json`, `${prefix}maps/${hash}/map-section-runtime/manifest.json`]);
      expect(scene.meshes).toHaveLength(0); expect(scene.materials).toHaveLength(0);
    } finally { scene.dispose(); engine.dispose(); }
  });

  it("fetches Editor terrain textures relative to public without bypassing integrity or neutral fallback", async () => {
    vi.stubGlobal("location", { protocol: "file:" });
    const hash = "a".repeat(64), image = `/l2/${hash}/image.png`;
    const fetcher = vi.fn(async () => new Response("corrupt texture")); vi.stubGlobal("fetch", fetcher);
    const engine = new NullEngine(), scene = new Scene(engine); scene.useRightHandedSystem = true;
    try {
      const mesh = MeshBuilder.CreateGround("terrain", {}, scene), neutral = new StandardMaterial("neutral", scene); mesh.material = neutral;
      mesh.metadata = { gltf: { extras: { nativeLayers: Array.from({ length: 9 }, (_, index) => ({ index,
        texture: "Texture.Diffuse", alphaMap: "Texture.Mask", worldToTextureRowMajor: [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]],
      })) } } };
      const catalog = { schemaVersion: 1, textures: [{ assetId: "interlude:Texture.Diffuse", image, imageBytes: 10, imageSha256: hash, archiveSha256: hash }] };
      await expect(applyNativeTerrainPreview(scene, [mesh], catalog, new AbortController().signal)).rejects.toThrow("hash/length differs");
      expect(fetcher).toHaveBeenCalledOnce(); expect(fetcher).toHaveBeenCalledWith(`l2/${hash}/image.png`, expect.objectContaining({ signal: expect.any(AbortSignal) }));
      expect(mesh.material).toBe(neutral); expect(scene.textures).toHaveLength(0);
    } finally { scene.dispose(); engine.dispose(); }
  });
});
