import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { GetEnvironmentBRDFTexture } from "@babylonjs/core/Misc/brdfTextureTools";
import { EntityRegistry } from "../../src/entities/EntityRegistry";
import { nativeCharacterFactory } from "../../src/assets/native/NativeCharacterVisual";
import type { GameWorldAdapter } from "../../src/world/GameWorldAdapter";
import type { WorldEntity, WorldEvent, WorldPosition } from "../../src/world/worldTypes";
import { nativeVisualClips, nativeVisualFixture } from "../fixtures/nativeVisualFixture";
import { itemlessEquippedItemSource } from "../fixtures/nativeEquippedItemSourceFixture";

vi.mock("../../src/ui/EntityLabel", () => ({ EntityLabel: class {
  select() {} setState() {} setDiagnostic() {} update() {} dispose() {}
} }));

describe("native entity support placement", () => {
  let engine: NullEngine, scene: Scene, registry: EntityRegistry | undefined;
  beforeEach(() => { engine = new NullEngine(); scene = new Scene(engine); GetEnvironmentBRDFTexture(scene); registry = undefined; });
  afterEach(() => { registry?.dispose(); scene.dispose(); engine.dispose(); });

  it.each([true, false])("keeps the native pivot offset fixed through attack/death with ground hook = %s", async withGround => {
    const initial: WorldEntity = { id: "fighter", kind: "local-player", displayName: "Fixture fighter", appearanceId: "fixture",
      health: 100, maximumHealth: 100, position: { x: 3, y: 9, z: -2 }, orientationRadians: 0, animation: "idle" };
    let emit!: (event: WorldEvent) => void;
    const adapter: GameWorldAdapter = { getInitialState: () => [initial], subscribe(listener) { emit = listener; return () => {}; },
      dispatch() {}, dispose() {} };
    const asset = await nativeVisualFixture({ minimumY: -.75, skinned: true,
      verticalMotion: { idle: [.25, .25], attack: [0, 1], death: [0, -1] } });
    const ground = vi.fn((position: WorldPosition) => ({ ...position, y: 4 }));
    registry = new EntityRegistry(scene, adapter, {} as HTMLElement, () => {}, {
      createVisual: nativeCharacterFactory(new Map([["fixture", { asset, clips: nativeVisualClips }]]), itemlessEquippedItemSource),
      ...withGround ? { ground } : {},
    });
    await vi.waitFor(() => expect(registry!.snapshot()[0]!.hasNativeModel).toBe(true));
    const check = (boneY: number) => {
      expect(registry!.snapshot()[0]).toMatchObject({ position: { x: 3, y: withGround ? 4.5 : 9, z: -2 },
        groundClearance: withGround ? .5 : 0, authoritativePosition: initial.position });
      const skeletons = scene.skeletons;
      expect(skeletons).toHaveLength(2);
      for (const skeleton of skeletons) expect(skeleton.bones[1]!.getTransformNode()!.position.y).toBeCloseTo(boneY);
    };
    registry.update(0); check(.25);
    emit({ type: "update", entity: { ...initial, animation: "attack" } }); registry.update(.5); check(.5);
    emit({ type: "update", entity: { ...initial, health: 0 } }); registry.update(.5); check(-.5);
    registry.update(10); check(-1);
    expect(ground).toHaveBeenCalledTimes(withGround ? 4 : 0);
  });
});
