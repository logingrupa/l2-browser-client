import { afterEach, describe, expect, it, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { readStagedWorld } from "../../src/scene/world/loadImportedWorld";
import { verifiedWorldBytes, WORLD_PINS, WORLD_SOURCE } from "../../src/scene/world/worldAssets";
import { worldModelRadius, worldVisibilityInRange } from "../../src/scene/world/worldVisibility";
import { fnRepairFoliageCutouts } from "../../src/scene/world/foliageCutout";
import { fnDisabledSourceCollider } from "../../src/scene/world/sourceColliderPolicy";

afterEach(() => vi.unstubAllGlobals());

describe("audited world staging boundary", () => {
  const receipt = {
    schemaVersion: 1, sourceRoute: "unity-reference", sourceVersion: WORLD_SOURCE,
    terrain: { url: "/assets/world/terrain.glb", sha256: WORLD_PINS.terrain },
    bundles: {
      "world-models": { manifestUrl: "/assets/world/world-models/manifest.json", manifestSha256: WORLD_PINS.models },
      surfaces: { manifestUrl: "/assets/world/surfaces/manifest.json", manifestSha256: WORLD_PINS.surfaces },
      locations: { manifestUrl: "/assets/world/locations/manifest.json", manifestSha256: WORLD_PINS.locations },
    },
  };
  it("recognizes both missing static files and Vite HTML fallback as an unstaged checkout", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response("Missing", { status: 404 }))
      .mockResolvedValueOnce(new Response("<!doctype html><html><body>App</body></html>")));
    expect(await readStagedWorld()).toBeNull();
    expect(await readStagedWorld()).toBeNull();
  });
  it("accepts the pinned bundle combination and refuses changed receipts or malformed JSON", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json(receipt))
      .mockResolvedValueOnce(Response.json({ ...receipt, terrain: { sha256: "0".repeat(64) } }))
      .mockResolvedValueOnce(new Response("{broken")));
    expect(await readStagedWorld()).toEqual(receipt);
    await expect(readStagedWorld()).rejects.toThrow("does not match");
    await expect(readStagedWorld()).rejects.toThrow();
  });
  it("verifies binary content before parsing and refuses nonlocal paths", async () => {
    const content = new TextEncoder().encode("audited fixture");
    const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", content))]
      .map(value => value.toString(16).padStart(2, "0")).join("");
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(new Response(content))));
    expect(await verifiedWorldBytes("/assets/world/fixture.glb", hash)).toEqual(content);
    await expect(verifiedWorldBytes("/assets/world/fixture.glb", "0".repeat(64))).rejects.toThrow("hash mismatch");
    await expect(verifiedWorldBytes("/assets/world/../private.glb", hash)).rejects.toThrow("Invalid local");
  });
});

describe("world precision and cutout policies", () => {
  it("encloses mixed corners and retains already visible buildings across the stream boundary", () => {
    const radius = worldModelRadius([-12, -1, -2], [1, 9, 7]);
    for (const x of [-12, 1]) for (const y of [-1, 9]) for (const z of [-2, 7]) {
      expect(Math.hypot(x, y, z)).toBeLessThanOrEqual(radius);
    }
    let visible = false;
    expect([198, 201, 199, 204, 211, 222].map(distance => {
      visible = worldVisibilityInRange(distance, 200, visible); return visible;
    })).toEqual([true, true, true, true, true, true]);
    expect(worldVisibilityInRange(225, 200, true)).toBe(false);
    expect(worldVisibilityInRange(210, 200, false)).toBe(false);
  });
  it("repairs only hash-matched leaf alpha, leaving bark and unknown revisions unchanged", () => {
    const engine = new NullEngine(); const scene = new Scene(engine);
    try {
      const leaf = new PBRMaterial("e41a83c8f74b7854da4f2af0542a790a", scene);
      leaf.albedoTexture = new Texture(null, scene);
      const bark = new PBRMaterial("bark", scene);
      const container = { materials: [leaf, bark] };
      const id = "splandddztree1_4ad8c30e4b", hash = "f37a253110fdd229493819e54c44420c9afcf80399e98810f79524f76cceb043";
      expect(fnRepairFoliageCutouts(container, id, "unverified")).toBe(0);
      expect(fnRepairFoliageCutouts(container, id, hash)).toBe(1);
      expect(leaf.needAlphaTesting()).toBe(true);
      expect(leaf.needAlphaBlending()).toBe(false);
      expect(leaf.alphaCutOff).toBe(.5);
      expect(leaf.backFaceCulling).toBe(false);
      expect(bark.backFaceCulling).toBe(true);
      expect(() => fnRepairFoliageCutouts({ materials: [] }, id, hash)).toThrow("material/texture missing");
      const threeLeaves = ["7d1ae4ee8cf6fff4b8acc31af6908918", "7b7694b6e3e52994e8f29303ac522434", "71919eff66d9ffa45b846db6f9f9c5e3"].map(name => {
        const material = new PBRMaterial(name, scene);
        material.albedoTexture = new Texture(null, scene);
        return material;
      });
      const secondId = "spLand_Legend_tree01_ac6c9d508f", secondHash = "6e83aed096e31b779a2cf6de6bf4fcb4ece308e6f3aa7feabdb2c22826660aaa";
      expect(() => fnRepairFoliageCutouts({ materials: threeLeaves.slice(0, 2) }, secondId, secondHash)).toThrow("material/texture missing");
      expect(threeLeaves.every(material => material.backFaceCulling)).toBe(true);
      expect(fnRepairFoliageCutouts({ materials: [...threeLeaves, bark] }, secondId, secondHash)).toBe(3);
      expect(threeLeaves.every(material => material.needAlphaTesting() && !material.needAlphaBlending() && material.alphaCutOff === .5 && !material.backFaceCulling && material.twoSidedLighting)).toBe(true);
      expect(bark.backFaceCulling).toBe(true);
    } finally { scene.dispose(); engine.dispose(); }
  });
  it("keeps the third flag collidable and rejects edited transforms for the two exact disabled components", () => {
    const model = { id: "interior_B_126_33b3ce50ad", file: "interior_B_126_33b3ce50ad.glb",
      sha256: "27448f813eeac09ce419c5512ef2f3f5876020de290689008c80d7dca8b53456",
      sourceFbxSha256: "a61188d3057fe4864922c09a28d07eb50b9cf296426749f785affcdc0b9d4b29",
      materialGuids: ["fb76b08a21e792848af0fcfa7fdf2e36"] };
    const placement = { id: "17_25:static:1388874679683410040",
      position: [4627.2294921875, -69.52545928955078, 1642.397705078125],
      rotationQuaternion: [0, -0.9700312614440918, 0, 0.2429802119731903],
      scale: [1.0000001192092896, 1, 1.0000001192092896] };
    expect(fnDisabledSourceCollider(model, placement)).toBe("6858508977984017953");
    expect(fnDisabledSourceCollider(model, { ...placement, id: "17_25:static:4175466291098708973" })).toBeNull();
    expect(fnDisabledSourceCollider(model, { ...placement, scale: [1, 1, 1] })).toBeNull();
    expect(fnDisabledSourceCollider({ ...model, sha256: "0".repeat(64) }, placement)).toBeNull();
  });
});
