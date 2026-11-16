import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CharacterAnimator } from "../../src/animation/CharacterAnimator";
import type { ActorClipPlayer } from "../../src/animation/actorClipPlayback";
import type { CharacterVisual, CharacterVisualFactory } from "../../src/assets/CharacterVisual";
import type { NativeCatalogIndex, NativeCatalogLookup } from "../../src/assets/native/nativeCatalogIndex";
import { EntityRegistry } from "../../src/entities/EntityRegistry";
import type { NativeCharacterProfile } from "../../src/assets/native/NativeCharacterVisual";
import { sandboxCharacterAppearances } from "../../src/runtime/sandboxCharacterAppearances";
import { resolveSandboxCharacterPresentation, sandboxCharacterVisualFactory } from "../../src/runtime/sandboxCharacterVisual";
import { NativeSliceAdapter } from "../../src/world/NativeSliceAdapter";
import { createSpawnedCharacterEntity } from "../../src/world/sandboxCommands";
import type { WorldEntity } from "../../src/world/worldTypes";
import { installMiniDom, type FakeElement, type MiniDom } from "./support/miniDom";
import { fixturePlayerProfile, modelArchiveFixture, serveStoreFiles } from "../support/nativeActorCatalogFixtures";
import { catalogWith } from "../support/nativeCatalogIndexFixtures";

const loadedProfileId = "human-male-fighter";
const loadedAppearanceId = `native-player:${loadedProfileId}`;
const generatedProfile = { ...fixturePlayerProfile, id: "character-1", chargrpIndex: 1, catalogId: "character-model:1", upperItems: [],
  forwardAxis: [1, 0, 0] as const, actorScale: [1, 2, 3] as const };

function characterAppearanceSources(catalog = catalogWith({})) {
  return { catalog, playerProfiles: new Map([[generatedProfile.id, generatedProfile]]),
    loadedAppearanceByProfile: new Map([[loadedProfileId, loadedAppearanceId]]), characterProfiles: new Map<string, NativeCharacterProfile>() };
}

const appearanceOfCharacterRecord = sandboxCharacterAppearances(characterAppearanceSources());

function catalogIndexOver(lookups: readonly NativeCatalogLookup[]): NativeCatalogIndex {
  const byKey = new Map(lookups.map(lookup => [lookup.key, lookup]));
  return {
    lookup: key => byKey.get(key) ?? { status: "not-in-catalog", key, reason: "not in catalog" },
    keys: prefix => [...byKey.keys()].filter(key => key.startsWith(prefix)),
  };
}

const characterLookups: readonly NativeCatalogLookup[] = [
  { status: "converted", key: "character:0", namedGaps: [], record: { chargrpIndex: 0, playerProfileId: loadedProfileId, catalogId: "human-male-fighter:0" } },
  { status: "converted", key: "character:1", namedGaps: [], record: { chargrpIndex: 1, playerProfileId: "character-1", catalogId: "character-model:1" } },
  { status: "converted", key: "character:5", namedGaps: [], record: { chargrpIndex: 5, playerProfileId: "character-5", catalogId: "character-model:5" } },
  { status: "gap", key: "character:4", reason: "converter-refused:chargrp row 4", coverageStatus: "gap" },
];

const origin = { x: 0, y: 0, z: 0 };

describe("spawn-character presentation through the catalog index", () => {
  let dom: MiniDom, engine: NullEngine, scene: Scene;
  beforeEach(() => { dom = installMiniDom(); engine = new NullEngine(); scene = new Scene(engine); });
  afterEach(() => { scene.dispose(); engine.dispose(); dom.restore(); });

  function nextFactoryDouble() {
    return vi.fn<CharacterVisualFactory>((visualScene, entity) => {
      const root = new TransformNode(`entity:${entity.id}`, visualScene);
      const animation = new CharacterAnimator({ setState() {}, update() {}, dispose() {} });
      const visual: CharacterVisual = { root, animation, hasNativeModel: true, modelId: entity.appearanceId ?? null,
        bounds: { minimum: Vector3.Zero(), maximum: Vector3.One(), labelHeight: 1, selectionRadius: .5 },
        ready: Promise.resolve(), groundClearance: 0, forwardDirection: null, missingAssetDiagnostic: null,
        attachmentSnapshot: () => [], attachmentAnchor: () => null, sourceClock: () => null, setEntity() {},
        dispose() { animation.dispose(); root.dispose(); } };
      return visual;
    });
  }

  it("gives template index 3 without a character:3 record a label-only marker, and two spawns two markers", () => {
    const nextFactory = nextFactoryDouble();
    const factory = sandboxCharacterVisualFactory(catalogIndexOver(characterLookups), nextFactory, appearanceOfCharacterRecord);
    const first = factory(scene, createSpawnedCharacterEntity(3, 1, origin));
    const second = factory(scene, createSpawnedCharacterEntity(3, 2, origin));
    expect(nextFactory).not.toHaveBeenCalled();
    for (const visual of [first, second]) {
      expect(visual.root.getChildMeshes()).toHaveLength(0);
      expect(visual.missingAssetDiagnostic).toBe("character:3 not in catalog");
      expect(visual.hasNativeModel).toBe(false);
      expect(visual.modelId).toBeNull();
    }
    expect(first.root).not.toBe(second.root);
    first.dispose(); second.dispose();
  });

  it("resolves template index 0 to character:0 and hands it to the native factory with the loaded player appearance", () => {
    const nextFactory = nextFactoryDouble();
    const entity = createSpawnedCharacterEntity(0, 1, origin);
    const visual = sandboxCharacterVisualFactory(catalogIndexOver(characterLookups), nextFactory, appearanceOfCharacterRecord)(scene, entity);
    expect(nextFactory).toHaveBeenCalledOnce();
    expect(nextFactory.mock.calls[0]![1]).toEqual({ ...entity, appearanceId: loadedAppearanceId });
    expect(visual.missingAssetDiagnostic).toBeNull();
    visual.dispose();
  });

  it("gives a converted record with a served profile the appearance of that profile, registered once with its profile values", () => {
    const sources = characterAppearanceSources(), appearanceOf = sandboxCharacterAppearances(sources);
    expect(resolveSandboxCharacterPresentation(catalogIndexOver(characterLookups), 1, appearanceOf)).toEqual({ appearanceId: "native-player:character-1" });
    const registered = sources.characterProfiles.get("native-player:character-1")!;
    expect(resolveSandboxCharacterPresentation(catalogIndexOver(characterLookups), 1, appearanceOf)).toEqual({ appearanceId: "native-player:character-1" });
    expect(sources.characterProfiles.get("native-player:character-1")).toBe(registered);
    expect([...sources.characterProfiles.keys()]).toEqual(["native-player:character-1"]);
    expect(registered.clips).toEqual(generatedProfile.clips);
    expect(registered.forwardAxis?.asArray()).toEqual([1, 0, 0]);
    expect(registered.actorScale?.asArray()).toEqual([1, 2, 3]);
    expect(registered.collisionHalfHeight).toBe(.235);
    expect(typeof registered.asset).toBe("function");
  });

  it("loads the served profile model on spawn and checks it against the profile", async () => {
    const model = await modelArchiveFixture(generatedProfile.sourceObject, generatedProfile.sourceSha256);
    serveStoreFiles(new Map([[model.archive, model.bytes]]));
    const sources = characterAppearanceSources(catalogWith({ models: [{ id: generatedProfile.catalogId, archive: model.archive, archiveSha256: model.archiveSha256 }] }));
    sandboxCharacterAppearances(sources)({ chargrpIndex: 1, playerProfileId: "character-1", catalogId: "character-model:1" });
    const loader = sources.characterProfiles.get("native-player:character-1")!.asset;
    if (typeof loader !== "function") throw new Error("a served character must load its model on spawn");
    expect((await loader(new AbortController().signal)).manifest.source.object).toBe(generatedProfile.sourceObject);
    const mismatched = characterAppearanceSources(catalogWith({ models: [{ id: generatedProfile.catalogId, archive: model.archive, archiveSha256: model.archiveSha256 }] }));
    mismatched.playerProfiles.set("character-1", { ...generatedProfile, sourceSha256: "c".repeat(64) });
    sandboxCharacterAppearances(mismatched)({ chargrpIndex: 1, playerProfileId: "character-1", catalogId: "character-model:1" });
    const mismatchedLoader = mismatched.characterProfiles.get("native-player:character-1")!.asset;
    if (typeof mismatchedLoader !== "function") throw new Error("a served character must load its model on spawn");
    await expect(mismatchedLoader(new AbortController().signal)).rejects.toThrow("Native player body source identity mismatch.");
    vi.unstubAllGlobals();
  });

  it("marks a converted record whose player profile is not served", () => {
    expect(resolveSandboxCharacterPresentation(catalogIndexOver(characterLookups), 5, appearanceOfCharacterRecord))
      .toEqual({ missingAssetDiagnostic: "character:5 converted but player profile character-5 is not in the served player profiles" });
  });

  it("marks a gap record with its coverage reason", () => {
    expect(resolveSandboxCharacterPresentation(catalogIndexOver(characterLookups), 4, appearanceOfCharacterRecord))
      .toEqual({ missingAssetDiagnostic: "character:4 gap: converter-refused:chargrp row 4" });
  });

  it("marks every spawn when the catalog holds no character records", () => {
    const nextFactory = nextFactoryDouble();
    const factory = sandboxCharacterVisualFactory(catalogIndexOver([]), nextFactory, appearanceOfCharacterRecord);
    for (const templateIndex of [0, 1, 7]) {
      const visual = factory(scene, createSpawnedCharacterEntity(templateIndex, 1, origin));
      expect(visual.missingAssetDiagnostic).toBe(`character:${templateIndex} not in catalog`);
      visual.dispose();
    }
    expect(nextFactory).not.toHaveBeenCalled();
  });

  it("passes an entity without a template index to the next factory unchanged", () => {
    const nextFactory = nextFactoryDouble();
    const player: WorldEntity = { id: "local-player", kind: "local-player", displayName: "Fighter", appearanceId: "native-human-fighter",
      health: 100, maximumHealth: 100, position: origin, orientationRadians: 0, animation: "idle" };
    const visual = sandboxCharacterVisualFactory(catalogIndexOver(characterLookups), nextFactory, appearanceOfCharacterRecord)(scene, player);
    expect(nextFactory.mock.calls[0]![1]).toBe(player);
    visual.dispose();
  });

  it("refuses a converted character key that holds another record kind", () => {
    const index = catalogIndexOver([{ status: "converted", key: "character:2", namedGaps: [], record: { itemId: 2, slot: "upper", catalogIds: [], playerProfileIds: [] } }]);
    expect(() => resolveSandboxCharacterPresentation(index, 2, appearanceOfCharacterRecord)).toThrow("character:2 does not hold a character catalog record.");
  });

  describe("through the native slice adapter and the entity registry", () => {
    function registryOverAdapter(lookups: readonly NativeCatalogLookup[], actorClipPlayer?: (entityId: string) => ActorClipPlayer | undefined) {
      const adapter = new NativeSliceAdapter(origin);
      const labels = dom.document.createElement("div");
      dom.document.body.append(labels);
      const nextFactory = nextFactoryDouble();
      const registry = new EntityRegistry(scene, adapter, labels as unknown as HTMLElement, () => {}, {
        createVisual: sandboxCharacterVisualFactory(catalogIndexOver(lookups), nextFactory, appearanceOfCharacterRecord),
        ...(actorClipPlayer ? { actorClipPlayer } : {}) });
      const labelDiagnostic = (entityId: string) => (labels.querySelector(`[data-entity-id="${entityId}"]`) as FakeElement).querySelector(".entity-diagnostic")!;
      return { adapter, registry, nextFactory, labelDiagnostic };
    }

    it("creates no entity and no marker for an index the adapter rejects", () => {
      const { adapter, registry } = registryOverAdapter(characterLookups);
      const countBefore = registry.count;
      for (const characterTemplateIndex of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN]) adapter.dispatch({ type: "spawn-character", characterTemplateIndex });
      expect(registry.count).toBe(countBefore);
      registry.dispose(); adapter.dispose();
    });

    it("gives two spawns of one template index two entities in spawn order, each with its own marker", () => {
      const { adapter, registry, labelDiagnostic } = registryOverAdapter([]);
      adapter.dispatch({ type: "spawn-character", characterTemplateIndex: 3 });
      adapter.dispatch({ type: "spawn-character", characterTemplateIndex: 3 });
      const spawned = registry.snapshot().filter(row => row.id.startsWith("character-"));
      expect(spawned.map(row => row.id)).toEqual(["character-3-1", "character-3-2"]);
      for (const row of spawned) {
        expect(row).toMatchObject({ missingAssetDiagnostic: "character:3 not in catalog", meshCount: 0, hasNativeModel: false });
        expect(labelDiagnostic(row.id).textContent).toBe("character:3 not in catalog");
      }
      registry.dispose(); adapter.dispose();
    });

    function fakeClipPlayer(clipNames: readonly string[]) {
      const played: string[] = [];
      const player: ActorClipPlayer = {
        play: clipName => { played.push(clipName); },
        previewing: null,
        listing: { clips: clipNames.map(name => ({ name, durationSeconds: 1, events: [] })), eventsWithoutClip: [] },
      };
      return { player, played };
    }

    it("plays a listed clip by its exact name and replaces it with the next request in dispatch order", () => {
      const { player, played } = fakeClipPlayer(["Wait", "atk01", "Atk01"]);
      const { adapter, registry, labelDiagnostic } = registryOverAdapter(characterLookups, entityId => entityId === "local-player" ? player : undefined);
      adapter.dispatch({ type: "play-clip", entityId: "local-player", clipName: "atk01" });
      adapter.dispatch({ type: "play-clip", entityId: "local-player", clipName: "Atk01" });
      expect(played).toEqual(["atk01", "Atk01"]);
      expect(registry.snapshot().find(row => row.id === "local-player")).toMatchObject({ clipDiagnostic: null, clipNames: ["Wait", "atk01", "Atk01"] });
      expect(labelDiagnostic("local-player").hidden).toBe(true);
      registry.dispose(); adapter.dispose();
    });

    it.each(["ATK01", "atk01 ", " atk01", "atk"])("refuses the unlisted or differently spelled clip %j and plays nothing", clipName => {
      const { player, played } = fakeClipPlayer(["Wait", "atk01"]);
      const { adapter, registry, labelDiagnostic } = registryOverAdapter(characterLookups, () => player);
      adapter.dispatch({ type: "play-clip", entityId: "local-player", clipName });
      expect(played).toEqual([]);
      const diagnostic = `clip ${clipName} not in local-player clip list`;
      expect(registry.snapshot().find(row => row.id === "local-player")?.clipDiagnostic).toBe(diagnostic);
      expect(labelDiagnostic("local-player").textContent).toBe(diagnostic);
      registry.dispose(); adapter.dispose();
    });

    it("gives a marker, which has no clip list, the not-in-clip-list diagnostic next to its catalog diagnostic", () => {
      const { adapter, registry, labelDiagnostic } = registryOverAdapter([], () => undefined);
      adapter.dispatch({ type: "spawn-character", characterTemplateIndex: 3 });
      adapter.dispatch({ type: "play-clip", entityId: "character-3-1", clipName: "Wait" });
      const row = registry.snapshot().find(entity => entity.id === "character-3-1");
      expect(row).toMatchObject({ clipDiagnostic: "clip Wait not in character-3-1 clip list", clipNames: [], missingAssetDiagnostic: "character:3 not in catalog" });
      expect(labelDiagnostic("character-3-1").textContent).toBe("character:3 not in catalog; clip Wait not in character-3-1 clip list");
      registry.dispose(); adapter.dispose();
    });

    it("clears the clip diagnostic once a listed clip plays", () => {
      const { player, played } = fakeClipPlayer(["Wait"]);
      const { adapter, registry, labelDiagnostic } = registryOverAdapter(characterLookups, () => player);
      adapter.dispatch({ type: "play-clip", entityId: "local-player", clipName: "wait" });
      adapter.dispatch({ type: "play-clip", entityId: "local-player", clipName: "Wait" });
      expect(played).toEqual(["Wait"]);
      expect(registry.snapshot().find(row => row.id === "local-player")?.clipDiagnostic).toBeNull();
      expect(labelDiagnostic("local-player").hidden).toBe(true);
      registry.dispose(); adapter.dispose();
    });
  });
});
