import { afterEach, describe, expect, it, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Scene } from "@babylonjs/core/scene";
import type { NativeCatalogIndex, NativeCatalogLookup } from "../../src/assets/native/nativeCatalogIndex";
import { buildCastSkillIndex } from "../../src/effects/castSkillIndex";
import type { LoadedEffectComponent } from "../../src/effects/loadEffectComponent";
import type { EffectBundle, EffectComponent, EffectStageRecord } from "../../src/effects/nativeEffectComponents";
import { createSkillCastPresentation } from "../../src/effects/skillCastPresentation";
import { readSyntheticParticleFixture } from "./support/particleFixtures";

const bundlesByManifestSha256 = vi.hoisted(() => new Map<string, EffectBundle>());

vi.mock("../../src/effects/nativeEffectComponents", async importOriginal => {
  const original = await importOriginal<typeof import("../../src/effects/nativeEffectComponents")>();
  return {
    ...original,
    loadCastSkillEffectBundle: async (record: { entry: Readonly<Record<string, unknown>> }) => {
      const bundle = bundlesByManifestSha256.get(String(record.entry.manifestSha256));
      if (!bundle) throw new Error("the test serves no bundle for this record");
      return bundle;
    },
  };
});

vi.mock("../../src/effects/loadEffectComponent", () => ({
  loadEffectComponent: async (scene: Scene, _bundle: EffectBundle, component: EffectComponent): Promise<LoadedEffectComponent> => {
    const root = new TransformNode(`stub component ${component.object}`, scene);
    return {
      root, meshes: [], frames: [], component, record: {} as LoadedEffectComponent["record"], materials: [],
      render: () => 0, inspection: () => ({}), dispose: () => root.dispose(),
    };
  },
}));

const spriteFixture = readSyntheticParticleFixture("synthetic-sprite");
const actorObject = spriteFixture.actor.object;
const releases: (() => void)[] = [];
afterEach(() => { releases.splice(0).reverse().forEach(release => release()); bundlesByManifestSha256.clear(); });

function casterStage(effectObject: string): EffectStageRecord {
  return { class: "Engine.SkillAction_LocateEffect", stage: "CastingActions", effectObject: effectObject.toLowerCase(),
    effectiveProperties: { AttachOn: 1, EffectClass: { class: "Object", object: effectObject }, bRelativeToCylinder: true } };
}

function syntheticBundle(manifestSha256: string, stages: readonly EffectStageRecord[]): EffectBundle {
  return {
    manifestSha256,
    readResource: async () => { throw new Error("the stub components read no resources"); },
    manifest: {
      schemaVersion: 1, kind: "native-effect-components", resources: {}, textureGraph: [], stages: [...stages],
      actors: [{ object: actorObject, properties: spriteFixture.actor.properties, effectiveProperties: spriteFixture.actor.effectiveProperties }],
      components: spriteFixture.components.map((component, emitterOrdinal) => ({
        object: component.object, class: component.class!, actor: actorObject, emitterOrdinal, sourcePointer: `/effects/0/children/${emitterOrdinal}`,
        properties: component.properties, effectiveProperties: component.effectiveProperties,
        bindings: { mesh: null, texture: null, primitiveMaterials: [] },
      })),
    },
  };
}

function effectComponentRecord(skillId: number, level: number, manifestSha256: string) {
  return { id: `interlude:skill:${skillId}:level:${level}:native-description-action`, manifestSha256, manifest: `/l2/effects/${manifestSha256}/manifest.json` };
}

function catalogIndexOf(lookups: readonly NativeCatalogLookup[]): NativeCatalogIndex {
  const byKey = new Map(lookups.map(lookup => [lookup.key, lookup]));
  return {
    lookup: key => byKey.get(key) ?? { status: "not-in-catalog", key, reason: "not in catalog" },
    keys: prefix => [...byKey.keys()].filter(key => key.startsWith(prefix)),
  };
}

function convertedSkill(skillId: number, level: number, namedGaps: readonly string[] = []): NativeCatalogLookup {
  return { status: "converted", key: `skill:${skillId}:${level}`, namedGaps,
    record: { skillId, level, effectComponentId: `interlude:skill:${skillId}:level:${level}:native-description-action` } };
}

function presentationScene(anchorIds: readonly string[]) {
  const engine = new NullEngine(), scene = new Scene(engine);
  releases.push(() => { scene.dispose(); engine.dispose(); });
  const anchors = new Map(anchorIds.map(entityId => [entityId, new TransformNode(`anchor ${entityId}`, scene)]));
  return { scene, anchors };
}

describe("skill cast presentation", () => {
  it("starts the emitter actor of a converted skill other than 3:1 at the caster anchor its manifest records", async () => {
    const manifestSha256 = "7".repeat(64);
    bundlesByManifestSha256.set(manifestSha256, syntheticBundle(manifestSha256, [casterStage(actorObject)]));
    const { scene, anchors } = presentationScene(["local-player", "npc-1"]);
    const presentation = createSkillCastPresentation({
      scene, catalogIndex: catalogIndexOf([convertedSkill(7, 2)]), castSkillIndex: buildCastSkillIndex([effectComponentRecord(7, 2, manifestSha256)]),
      anchors: entityId => anchors.get(entityId) ?? null, signal: new AbortController().signal,
    });
    releases.push(() => presentation.dispose());
    const inspection = await presentation.present({ type: "skill-cast", casterId: "local-player", skillId: 7, level: 2, targetId: "npc-1" });
    expect(inspection).toMatchObject({ key: "skill:7:2", catalogStatus: "converted", reason: null, emitterActors: 1, notDrawn: [],
      placements: [{ actorObject, side: "caster", sourceStage: "CastingActions", unappliedFields: ["AttachOn", "bRelativeToCylinder"] }] });
    const playbackRoot = anchors.get("local-player")!.getChildren()[0];
    expect(playbackRoot?.name).toBe(`Emitter actor playback: ${actorObject}`);
    expect(anchors.get("npc-1")!.getChildren()).toEqual([]);
    presentation.advance(0.25);
    expect((playbackRoot as TransformNode).isEnabled()).toBe(true);
  });

  it("answers a key absent from the catalog index with its catalog reason and starts nothing", async () => {
    const { scene, anchors } = presentationScene(["local-player"]);
    const presentation = createSkillCastPresentation({
      scene, catalogIndex: catalogIndexOf([]), castSkillIndex: buildCastSkillIndex([]),
      anchors: entityId => anchors.get(entityId) ?? null, signal: new AbortController().signal,
    });
    releases.push(() => presentation.dispose());
    const inspection = await presentation.present({ type: "skill-cast", casterId: "local-player", skillId: 8, level: 1 });
    expect(inspection).toMatchObject({ key: "skill:8:1", catalogStatus: "not-in-catalog", reason: "not in catalog", emitterActors: 0, placements: [], notDrawn: [] });
    expect(anchors.get("local-player")!.getChildren()).toEqual([]);
  });

  it("lists a component whose placement the manifest does not record as skill-effect-placement-unresolved and draws nothing", async () => {
    const manifestSha256 = "9".repeat(64);
    bundlesByManifestSha256.set(manifestSha256, syntheticBundle(manifestSha256, []));
    const { scene, anchors } = presentationScene(["local-player"]);
    const presentation = createSkillCastPresentation({
      scene, catalogIndex: catalogIndexOf([convertedSkill(9, 1)]), castSkillIndex: buildCastSkillIndex([effectComponentRecord(9, 1, manifestSha256)]),
      anchors: entityId => anchors.get(entityId) ?? null, signal: new AbortController().signal,
    });
    releases.push(() => presentation.dispose());
    const inspection = await presentation.present({ type: "skill-cast", casterId: "local-player", skillId: 9, level: 1 });
    expect(inspection).toMatchObject({ emitterActors: 0, placements: [],
      notDrawn: [{ object: spriteFixture.components[0]!.object, reason: "skill-effect-placement-unresolved" }] });
    expect(anchors.get("local-player")!.getChildren()).toEqual([]);
  });

  it("lists a recorded target placement with no target anchor as skill-effect-anchor-unavailable:target", async () => {
    const manifestSha256 = "a".repeat(64);
    const targetStage: EffectStageRecord = { ...casterStage(actorObject), stage: "ShotActions",
      effectiveProperties: { ...casterStage(actorObject).effectiveProperties, bSpawnOnTarget: true } };
    bundlesByManifestSha256.set(manifestSha256, syntheticBundle(manifestSha256, [targetStage]));
    const { scene, anchors } = presentationScene(["local-player"]);
    const presentation = createSkillCastPresentation({
      scene, catalogIndex: catalogIndexOf([convertedSkill(10, 1)]), castSkillIndex: buildCastSkillIndex([effectComponentRecord(10, 1, manifestSha256)]),
      anchors: entityId => anchors.get(entityId) ?? null, signal: new AbortController().signal,
    });
    releases.push(() => presentation.dispose());
    const inspection = await presentation.present({ type: "skill-cast", casterId: "local-player", skillId: 10, level: 1 });
    expect(inspection).toMatchObject({ emitterActors: 0, placements: [{ actorObject, side: "target", sourceStage: "ShotActions" }],
      notDrawn: [{ object: actorObject, reason: "skill-effect-anchor-unavailable:target" }] });
  });

  it("carries the named gaps of the catalog index beside the feature gaps of the started emitter actors", async () => {
    const manifestSha256 = "c".repeat(64), beamGapReason = "emitter-class-unported:Engine.BeamEmitter";
    bundlesByManifestSha256.set(manifestSha256, syntheticBundle(manifestSha256, [casterStage(actorObject)]));
    const { scene, anchors } = presentationScene(["local-player"]);
    const presentation = createSkillCastPresentation({
      scene, catalogIndex: catalogIndexOf([convertedSkill(12, 1, [beamGapReason])]),
      castSkillIndex: buildCastSkillIndex([effectComponentRecord(12, 1, manifestSha256)]),
      anchors: entityId => anchors.get(entityId) ?? null, signal: new AbortController().signal,
    });
    releases.push(() => presentation.dispose());
    const inspection = await presentation.present({ type: "skill-cast", casterId: "local-player", skillId: 12, level: 1 });
    expect(inspection).toMatchObject({ emitterActors: 1, namedGaps: [beamGapReason], featureGaps: [
      `${spriteFixture.components[0]!.object} emitter-feature-unported:BlendBetweenSubdivisions`,
      `${spriteFixture.components[0]!.object} emitter-feature-unported:UseDirectionAs`,
    ] });
    const absent = await presentation.present({ type: "skill-cast", casterId: "local-player", skillId: 13, level: 1 });
    expect(absent).toMatchObject({ catalogStatus: "not-in-catalog", namedGaps: [] });
  });

  it("disposes the previous presentation of a caster when that caster casts again", async () => {
    const manifestSha256 = "b".repeat(64);
    bundlesByManifestSha256.set(manifestSha256, syntheticBundle(manifestSha256, [casterStage(actorObject)]));
    const { scene, anchors } = presentationScene(["local-player"]);
    const presentation = createSkillCastPresentation({
      scene, catalogIndex: catalogIndexOf([convertedSkill(11, 1)]), castSkillIndex: buildCastSkillIndex([effectComponentRecord(11, 1, manifestSha256)]),
      anchors: entityId => anchors.get(entityId) ?? null, signal: new AbortController().signal,
    });
    releases.push(() => presentation.dispose());
    const cast = { type: "skill-cast", casterId: "local-player", skillId: 11, level: 1 } as const;
    await presentation.present(cast);
    const first = anchors.get("local-player")!.getChildren()[0];
    await presentation.present(cast);
    expect(first?.isDisposed()).toBe(true);
    expect(anchors.get("local-player")!.getChildren()).toHaveLength(1);
    presentation.dispose();
    expect(anchors.get("local-player")!.getChildren()).toEqual([]);
  });
});
