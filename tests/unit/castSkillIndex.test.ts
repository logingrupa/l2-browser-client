import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildCastSkillIndex, lookupCastSkill, parseSkillEffectComponentId, selectedCastSkill } from "../../src/effects/castSkillIndex";
import { loadNativeEffectComponents, parseEffectManifest, simulatedEffectEmitterClasses } from "../../src/effects/nativeEffectComponents";

const sha256Hex = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const encodeJson = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const textureSha256 = "a".repeat(64);
const texture = { assetId: "texture:sprite", object: "LineageEffectsTextures.Particles.fx_m_t0003", source: {}, file: `resources/${textureSha256}.png`,
  sha256: textureSha256, bytes: 1 };

function syntheticManifest(id: string, extraComponents: Record<string, unknown>[] = []) {
  return { schemaVersion: 1, kind: "native-effect-components", id, resources: { [texture.assetId]: texture },
    actors: [{ object: "lineageeffect.wh_heal_ta", effectiveProperties: {} }], textureGraph: [],
    components: [
      { object: "lineageeffect.wh_heal_ta.SpriteEmitter1", class: "Engine.SpriteEmitter", actor: "lineageeffect.wh_heal_ta", emitterOrdinal: 0,
        sourcePointer: "/effects/1/children/1", properties: {}, effectiveProperties: {}, bindings: { mesh: null, texture, primitiveMaterials: [] } },
      ...extraComponents,
    ] };
}

const beamComponent = { object: "lineageeffect.wh_heal_ta.BeamEmitter0", class: "Engine.BeamEmitter", actor: "lineageeffect.wh_heal_ta",
  emitterOrdinal: 1, sourcePointer: "/effects/1/children/0", properties: {}, effectiveProperties: {},
  bindings: { mesh: null, texture: null, primitiveMaterials: [] } };

function serveCatalog(effectComponents: unknown[], manifests: readonly Uint8Array[], search: string) {
  vi.stubGlobal("location", { protocol: "https:", search });
  const files = new Map<string, Uint8Array>([["/l2/catalog.json", encodeJson({ schemaVersion: 1, models: [], effectComponents })]]);
  for (const bytes of manifests) files.set(`/l2/effects/${sha256Hex(bytes)}/manifest.json`, bytes);
  const fetcher = vi.fn(async (url: string) => {
    const bytes = files.get(url);
    if (!bytes) throw new Error(`Unexpected request: ${url}`);
    return new Response(bytes.slice().buffer);
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

function catalogRecord(id: string, bytes: Uint8Array, bundleId?: string) {
  const manifestSha256 = sha256Hex(bytes);
  return { id, manifestSha256, manifest: `/l2/effects/${manifestSha256}/manifest.json`, ...(bundleId === undefined ? {} : { bundleId }) };
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("skill effect component identity", () => {
  it("parses the skill id and level of an effect component id", () => {
    expect(parseSkillEffectComponentId("interlude:skill:1011:level:1:x")).toEqual({ skillId: 1011, level: 1 });
    expect(parseSkillEffectComponentId("interlude:skill:3:level:1:raw-source-dispatch")).toEqual({ skillId: 3, level: 1 });
  });

  it.each(["interlude:skill:1011:level:0:x", "interlude:skill:01011:level:1:x", "interlude:skill:1011:level:1:", "interlude:npc-profiles:pack-1"])(
    "gives no identity for %s", id => {
      expect(parseSkillEffectComponentId(id)).toBeNull();
    });

  it("finds the record of a skill id and level and gives null for a missing key", () => {
    const records = [{ id: "interlude:skill:1011:level:1:native-description-action" }, { id: "interlude:npc-profiles:pack-1" }];
    const index = buildCastSkillIndex(records);
    expect(lookupCastSkill(index, 1011, 1)).toMatchObject({ id: records[0]!.id, skillId: 1011, level: 1 });
    expect(lookupCastSkill(index, 1011, 2)).toBeNull();
  });

  it("refuses two records for one skill key", () => {
    expect(() => buildCastSkillIndex([{ id: "interlude:skill:3:level:1:a" }, { id: "interlude:skill:3:level:1:b" }]))
      .toThrow("Cast skill index: skill:3:1 has two effect component records, interlude:skill:3:level:1:a and interlude:skill:3:level:1:b.");
  });

  it("reads ?skill=1011:1 as the selected skill", () => {
    expect(selectedCastSkill({ search: "?skill=1011:1" })).toEqual({ skillId: 1011, level: 1 });
    expect(selectedCastSkill({ search: "?map=20_21&skill=0:3" })).toEqual({ skillId: 0, level: 3 });
  });

  it.each(["", "?skill=", "?skill=1011", "?skill=1011:0", "?skill=1011:-1", "?skill=01011:1", "?skill=1011:01", "?skill=1011:1&skill=1011:2",
    "?skill=1e3:1", "?skill=1011:1.0", "?skill=%201011:1"])("gives no selection for %j", search => {
    expect(selectedCastSkill({ search })).toBeNull();
  });

  it("gives no selection without a location", () => {
    expect(selectedCastSkill(undefined)).toBeNull();
  });
});

describe("selected skill effect loading", () => {
  it("loads the ?skill= record whose shared root bundle id names the manifest", async () => {
    const manifestBytes = encodeJson(syntheticManifest("interlude:skill-root:skill.wh.1011", [beamComponent]));
    serveCatalog([catalogRecord("interlude:skill:1011:level:1:native-description-action", manifestBytes, "interlude:skill-root:skill.wh.1011")],
      [manifestBytes], "?skill=1011:1");
    const bundle = await loadNativeEffectComponents(new AbortController().signal);
    expect(bundle?.manifest.id).toBe("interlude:skill-root:skill.wh.1011");
    expect(bundle?.manifest.components.map(component => component.class)).toEqual(["Engine.SpriteEmitter", "Engine.BeamEmitter"]);
  });

  it("loads the reviewed Power Strike key 3 level 1 when no skill is selected", async () => {
    const powerStrike = encodeJson(syntheticManifest("interlude:skill:3:level:1:raw-source-dispatch"));
    const heal = encodeJson(syntheticManifest("interlude:skill-root:skill.wh.1011"));
    serveCatalog([catalogRecord("interlude:skill:1011:level:1:native-description-action", heal, "interlude:skill-root:skill.wh.1011"),
      catalogRecord("interlude:skill:3:level:1:raw-source-dispatch", powerStrike)], [powerStrike, heal], "");
    const bundle = await loadNativeEffectComponents(new AbortController().signal);
    expect(bundle?.manifest.id).toBe("interlude:skill:3:level:1:raw-source-dispatch");
  });

  it("accepts a lane catalog with more than 64 effect component records", async () => {
    const manifestBytes = encodeJson(syntheticManifest("interlude:skill-root:skill.mo.4"));
    const records = Array.from({ length: 65 }, (_, offset) =>
      catalogRecord(`interlude:skill:4:level:${offset + 1}:native-description-action`, manifestBytes, "interlude:skill-root:skill.mo.4"));
    serveCatalog(records, [manifestBytes], "?skill=4:65");
    expect((await loadNativeEffectComponents(new AbortController().signal))?.manifest.id).toBe("interlude:skill-root:skill.mo.4");
  });

  it("refuses a record whose bundle id names another manifest", async () => {
    const manifestBytes = encodeJson(syntheticManifest("interlude:skill-root:skill.wh.1011"));
    serveCatalog([catalogRecord("interlude:skill:1011:level:1:native-description-action", manifestBytes, "interlude:skill-root:skill.wh.1012")],
      [manifestBytes], "?skill=1011:1");
    await expect(loadNativeEffectComponents(new AbortController().signal)).rejects.toThrow(/bundle identity differs/);
  });
});

describe("emitter class coverage", () => {
  it("keeps an unsimulated emitter record without resources and refuses one that binds a texture", () => {
    expect(parseEffectManifest(syntheticManifest("interlude:skill-root:skill.wh.1011", [beamComponent])).components).toHaveLength(2);
    const bound = { ...beamComponent, bindings: { mesh: null, texture, primitiveMaterials: [] } };
    expect(() => parseEffectManifest(syntheticManifest("interlude:skill-root:skill.wh.1011", [bound]))).toThrow(/unsimulated component binds/);
  });

  it("lists the same simulated emitter classes as recipes/actors/emitter-class-coverage.json", () => {
    const coverage = JSON.parse(readFileSync("recipes/actors/emitter-class-coverage.json", "utf8")) as { simulated: string[] };
    expect([...simulatedEffectEmitterClasses].sort()).toEqual([...coverage.simulated].sort());
  });
});
