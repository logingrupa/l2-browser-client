import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CharacterAnimator } from "../../src/animation/CharacterAnimator";
import { EntityRegistry } from "../../src/entities/EntityRegistry";
import type { CharacterVisual } from "../../src/assets/CharacterVisual";
import type { GameWorldAdapter } from "../../src/world/GameWorldAdapter";
import type { WorldEntity, WorldEvent } from "../../src/world/worldTypes";

vi.mock("../../src/ui/EntityLabel", () => ({ EntityLabel: class {
  select() {} setState() {} setDiagnostic() {} update() {} dispose() {}
} }));

const player: WorldEntity = { id: "fighter", kind: "local-player", displayName: "Fighter", appearanceId: "fixture",
  health: 100, maximumHealth: 100, position: { x: 0, y: 0, z: 0 }, orientationRadians: 0, animation: "idle" };

describe("entity startup readiness", () => {
  let engine: NullEngine, scene: Scene, registry: EntityRegistry | undefined;
  beforeEach(() => { engine = new NullEngine(); scene = new Scene(engine); });
  afterEach(() => { registry?.dispose(); scene.dispose(); engine.dispose(); });

  function setup(initial: WorldEntity[] = [player]) {
    let emit!: (event: WorldEvent) => void;
    const adapter: GameWorldAdapter = { getInitialState: () => initial,
      subscribe(listener) { emit = listener; return () => {}; }, dispatch() {}, dispose() {} };
    const loads: { resolve(): void; reject(error: unknown): void; visual: CharacterVisual }[] = [];
    registry = new EntityRegistry(scene, adapter, {} as HTMLElement, () => {}, {
      createVisual(scene, entity) {
        let resolve!: () => void, reject!: (error: unknown) => void;
        const ready = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
        void ready.catch(() => undefined);
        const root = new TransformNode(entity.id, scene);
        const animation = new CharacterAnimator({ setState() {}, update() {}, dispose() {} });
        const visual: CharacterVisual = { root, animation, ready, hasNativeModel: true, modelId: entity.appearanceId ?? null,
          bounds: { minimum: Vector3.Zero(), maximum: Vector3.One(), labelHeight: 1, selectionRadius: .5 },
          groundClearance: 0, forwardDirection: null, missingAssetDiagnostic: null,
          attachmentSnapshot: () => [], attachmentAnchor: () => null, sourceClock: () => null, setEntity() {},
          dispose() { reject(new DOMException("Removed", "AbortError")); animation.dispose(); root.dispose(); } };
        loads.push({ resolve, reject, visual }); return visual;
      },
    });
    return { loads, emit, registry };
  }

  it("waits for every initial native visual", async () => {
    const { loads, registry } = setup([player, { ...player, id: "npc", kind: "monster" }]);
    const done = vi.fn(), waiting = registry.whenReady().then(done);
    loads[0]!.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(done).not.toHaveBeenCalled();
    loads[1]!.resolve(); await waiting; expect(done).toHaveBeenCalledOnce();
  });

  it("rejects a failed current visual instead of accepting the entity count", async () => {
    const { loads, registry } = setup(); const waiting = registry.whenReady();
    loads[0]!.reject(new Error("Native upper texture failed"));
    await expect(waiting).rejects.toThrow("Native upper texture failed");
  });

  it("ignores removed visual cancellation and waits for its replacement", async () => {
    const { loads, registry, emit } = setup(); const done = vi.fn(), waiting = registry.whenReady().then(done);
    emit({ type: "update", entity: { ...player, appearanceId: "replacement" } });
    await Promise.resolve(); await Promise.resolve(); expect(done).not.toHaveBeenCalled();
    expect(loads[0]!.visual.root.isDisposed()).toBe(true);
    loads[1]!.resolve(); await waiting; expect(done).toHaveBeenCalledOnce();
  });

  it("rejects a disposed registry", async () => {
    const { registry: pending } = setup(); const waiting = pending.whenReady(); pending.dispose();
    await expect(waiting).rejects.toHaveProperty("name", "AbortError");
    await expect(pending.whenReady()).rejects.toHaveProperty("name", "AbortError");
  });
});
