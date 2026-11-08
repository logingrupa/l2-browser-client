import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CharacterAnimator } from "../../src/animation/CharacterAnimator";
import type { CharacterVisual, CharacterVisualFactory } from "../../src/assets/CharacterVisual";
import type { NativeCatalogIndex, NativeCatalogLookup } from "../../src/assets/native/nativeCatalogIndex";
import { EntityRegistry } from "../../src/entities/EntityRegistry";
import { createMissingAssetMarkerVisual, sandboxNpcVisualFactory } from "../../src/runtime/sandboxNpcVisual";
import { createSpawnedNpcEntity } from "../../src/world/sandboxCommands";
import type { GameWorldAdapter } from "../../src/world/GameWorldAdapter";
import type { WorldEntity, WorldEvent } from "../../src/world/worldTypes";
import { installMiniDom, type FakeElement, type MiniDom } from "./support/miniDom";

const convertedNpcLookups: ReadonlyMap<string, NativeCatalogLookup> = new Map([
  ["npc:21622", { status: "converted", key: "npc:21622", record: { npcId: 21622, profileId: "native-npc-profiles", modelCatalogId: "musveren:0" } }],
  ["npc:30001", { status: "converted", key: "npc:30001", record: { npcId: 30001, profileId: "native-npc-profiles", modelCatalogId: "unstaged:0" } }],
  ["npc:20001", { status: "gap", key: "npc:20001", reason: "skeletal-licensee-unsupported:123/30", coverageStatus: "gap" }],
]);

const fakeCatalogIndex: NativeCatalogIndex = {
  lookup: key => convertedNpcLookups.get(key) ?? { status: "not-in-catalog", key, reason: "not in catalog" },
  keys: prefix => [...convertedNpcLookups.keys()].filter(key => key.startsWith(prefix)),
};

const appearanceOfModel = (modelCatalogId: string) => modelCatalogId === "musveren:0" ? "native-musveren" : null;

const player: WorldEntity = { id: "local-player", kind: "local-player", displayName: "Fighter", appearanceId: "native-human-fighter",
  health: 100, maximumHealth: 100, position: { x: 0, y: 0, z: 0 }, orientationRadians: 0, animation: "idle" };

describe("sandbox NPC presentation through the catalog index", () => {
  let dom: MiniDom, engine: NullEngine, scene: Scene;
  beforeEach(() => { dom = installMiniDom(); engine = new NullEngine(); scene = new Scene(engine); });
  afterEach(() => { scene.dispose(); engine.dispose(); dom.restore(); });

  function nativeFactoryDouble() {
    return vi.fn<CharacterVisualFactory>((visualScene, entity) => {
      const root = new TransformNode(`entity:${entity.id}`, visualScene);
      MeshBuilder.CreateBox(`${entity.id}-body`, {}, visualScene).parent = root;
      const animation = new CharacterAnimator({ setState() {}, update() {}, dispose() {} });
      const visual: CharacterVisual = { root, animation, hasNativeModel: true, modelId: entity.appearanceId ?? null,
        bounds: { minimum: Vector3.Zero(), maximum: Vector3.One(), labelHeight: 1, selectionRadius: .5 },
        ready: Promise.resolve(), groundClearance: 0, forwardDirection: null,
        attachmentSnapshot: () => [], attachmentAnchor: () => null, sourceClock: () => null, setEntity() {},
        dispose() { animation.dispose(); root.dispose(); } };
      return visual;
    });
  }

  function registryWithSandboxFactory(nativeFactory: CharacterVisualFactory) {
    let emit!: (event: WorldEvent) => void;
    const adapter: GameWorldAdapter = { getInitialState: () => [player],
      subscribe(listener) { emit = listener; return () => {}; }, dispatch() {}, advance() {}, dispose() {} };
    const labels = dom.document.createElement("div");
    dom.document.body.append(labels);
    const registry = new EntityRegistry(scene, adapter, labels as unknown as HTMLElement, () => {}, {
      createVisual: sandboxNpcVisualFactory(fakeCatalogIndex, nativeFactory, appearanceOfModel) });
    const spawnNpc = (npcId: number, sequence: number) => emit({ type: "spawn", entity: createSpawnedNpcEntity(npcId, sequence, { x: sequence, y: 0, z: 0 }) });
    const labelOf = (entityId: string) => labels.querySelector(`[data-entity-id="${entityId}"]`) as FakeElement;
    return { registry, spawnNpc, labelOf };
  }

  it("gives an ID absent from the index a marker with no meshes and a diagnostic", () => {
    const nativeFactory = nativeFactoryDouble();
    const visual = sandboxNpcVisualFactory(fakeCatalogIndex, nativeFactory, appearanceOfModel)(scene, createSpawnedNpcEntity(12345, 1, { x: 0, y: 0, z: 0 }));
    expect(nativeFactory).not.toHaveBeenCalled();
    expect(visual.root.getChildMeshes()).toHaveLength(0);
    expect(visual.missingAssetDiagnostic).toBe("npc:12345 not in catalog");
    expect(visual.hasNativeModel).toBe(false);
    expect(visual.modelId).toBeNull();
    visual.dispose();
    expect(visual.root.isDisposed()).toBe(true);
  });

  it("gives an ID the coverage report marks as a gap a marker with the gap reason", () => {
    const nativeFactory = nativeFactoryDouble();
    const visual = sandboxNpcVisualFactory(fakeCatalogIndex, nativeFactory, appearanceOfModel)(scene, createSpawnedNpcEntity(20001, 1, { x: 0, y: 0, z: 0 }));
    expect(nativeFactory).not.toHaveBeenCalled();
    expect(visual.root.getChildMeshes()).toHaveLength(0);
    expect(visual.missingAssetDiagnostic).toBe("npc:20001 gap: skeletal-licensee-unsupported:123/30");
    visual.dispose();
  });

  it("keeps the missing NPC in the registry snapshot and shows the diagnostic on its label", () => {
    const { registry, spawnNpc, labelOf } = registryWithSandboxFactory(nativeFactoryDouble());
    spawnNpc(12345, 1);
    const row = registry.snapshot().find(entity => entity.id === "npc-12345-1");
    expect(row).toMatchObject({ meshCount: 0, missingAssetDiagnostic: "npc:12345 not in catalog", hasNativeModel: false, modelId: null });
    const diagnostic = labelOf("npc-12345-1").querySelector(".entity-diagnostic")!;
    expect(diagnostic.hidden).toBe(false);
    expect(diagnostic.textContent).toBe("npc:12345 not in catalog");
    expect(labelOf("local-player").querySelector(".entity-diagnostic")!.hidden).toBe(true);
    registry.dispose();
  });

  it("gives two spawns of the same missing ID two entities, each with its own marker", () => {
    const { registry, spawnNpc, labelOf } = registryWithSandboxFactory(nativeFactoryDouble());
    spawnNpc(12345, 1);
    spawnNpc(12345, 2);
    const markers = registry.snapshot().filter(entity => entity.missingAssetDiagnostic === "npc:12345 not in catalog");
    expect(markers.map(entity => entity.id)).toEqual(["npc-12345-1", "npc-12345-2"]);
    expect(labelOf("npc-12345-1")).not.toBe(labelOf("npc-12345-2"));
    expect(labelOf("npc-12345-2").querySelector(".entity-diagnostic")!.textContent).toBe("npc:12345 not in catalog");
    registry.dispose();
  });

  it("sends a converted NPC with a loaded model to the native factory with its appearance", () => {
    const nativeFactory = nativeFactoryDouble();
    const { registry, spawnNpc } = registryWithSandboxFactory(nativeFactory);
    spawnNpc(21622, 1);
    expect(nativeFactory).toHaveBeenLastCalledWith(scene, expect.objectContaining({ id: "npc-21622-1", npcId: 21622, appearanceId: "native-musveren" }), expect.any(Function));
    const row = registry.snapshot().find(entity => entity.id === "npc-21622-1");
    expect(row?.missingAssetDiagnostic).toBeNull();
    expect(row?.meshCount).toBe(1);
    registry.dispose();
  });

  it("passes entities without an NPC ID to the native factory unchanged", () => {
    const nativeFactory = nativeFactoryDouble();
    registryWithSandboxFactory(nativeFactory).registry.dispose();
    expect(nativeFactory).toHaveBeenCalledWith(scene, player, expect.any(Function));
  });

  it("marks a converted NPC whose model is not loaded in this sandbox instead of substituting a body", () => {
    const visual = sandboxNpcVisualFactory(fakeCatalogIndex, nativeFactoryDouble(), appearanceOfModel)(scene, createSpawnedNpcEntity(30001, 1, { x: 0, y: 0, z: 0 }));
    expect(visual.missingAssetDiagnostic).toBe("npc:30001 converted but model unstaged:0 is not loaded in this sandbox");
    expect(visual.root.getChildMeshes()).toHaveLength(0);
    visual.dispose();
  });

  it("builds a marker whose ready promise is already settled, so a later spawn never re-blocks the startup barrier", async () => {
    const marker = createMissingAssetMarkerVisual(scene, createSpawnedNpcEntity(7, 1, { x: 0, y: 0, z: 0 }), "npc:7 not in catalog");
    const settlement = await Promise.race([marker.ready.then(() => "settled"), Promise.resolve().then(() => "pending")]);
    expect(settlement).toBe("settled");
    const { registry, spawnNpc } = registryWithSandboxFactory(nativeFactoryDouble());
    await registry.whenReady();
    spawnNpc(12345, 1);
    await expect(registry.whenReady()).resolves.toBeUndefined();
    marker.dispose();
    registry.dispose();
  });
});
