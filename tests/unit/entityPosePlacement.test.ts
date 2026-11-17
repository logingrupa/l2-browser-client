import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { GetEnvironmentBRDFTexture } from "@babylonjs/core/Misc/brdfTextureTools";
import { EntityRegistry, type EntityMovementPose } from "../../src/entities/EntityRegistry";
import { nativeCharacterFactory } from "../../src/assets/native/NativeCharacterVisual";
import type { GameWorldAdapter } from "../../src/world/GameWorldAdapter";
import type { WorldEntity, WorldEvent } from "../../src/world/worldTypes";
import { nativeVisualClips, nativeVisualFixture } from "../fixtures/nativeVisualFixture";
import { itemlessEquippedItemSource } from "../fixtures/nativeEquippedItemSourceFixture";
import { unlistedActorMaterialPrograms } from "../fixtures/actorMaterialProgramsFixture";

vi.mock("../../src/ui/EntityLabel", () => ({ EntityLabel: class {
  select() {} setState() {} setDiagnostic() {} update() {} dispose() {}
} }));

describe("entity root placement from the movement pose", () => {
  let engine: NullEngine, scene: Scene, registry: EntityRegistry | undefined;
  beforeEach(() => { engine = new NullEngine(); scene = new Scene(engine); GetEnvironmentBRDFTexture(scene); registry = undefined; });
  afterEach(() => { registry?.dispose(); scene.dispose(); engine.dispose(); });

  it.each([true, false])("puts the root at the simulated pawn location, or at the adapter position without a pose, through attack and death (pose = %s)", async hasPose => {
    const initial: WorldEntity = { id: "fighter", kind: "local-player", displayName: "Fixture fighter", appearanceId: "fixture",
      health: 100, maximumHealth: 100, position: { x: 3, y: 9, z: -2 }, orientationRadians: 0, animation: "idle" };
    let emit!: (event: WorldEvent) => void;
    const adapter: GameWorldAdapter = { getInitialState: () => [initial], subscribe(listener) { emit = listener; return () => {}; },
      dispatch() {}, dispose() {} };
    const asset = await nativeVisualFixture({ minimumY: -.75, skinned: true,
      verticalMotion: { idle: [.25, .25], attack: [0, 1], death: [0, -1] } });
    const pose: EntityMovementPose = { location: { x: 3, y: 4.255, z: -2 }, orientationRadians: 1.25, isMoving: false };
    const movementPose = vi.fn(() => hasPose ? pose : null);
    registry = new EntityRegistry(scene, adapter, {} as HTMLElement, () => {}, {
      createVisual: nativeCharacterFactory(new Map([["fixture", { asset, clips: nativeVisualClips }]]), itemlessEquippedItemSource, unlistedActorMaterialPrograms),
      movementPose,
    });
    await vi.waitFor(() => expect(registry!.snapshot()[0]!.hasNativeModel).toBe(true));
    const check = (boneY: number) => {
      expect(registry!.snapshot()[0]).toMatchObject({ position: hasPose ? pose.location : initial.position, authoritativePosition: initial.position });
      if (hasPose) expect(registry!.snapshot()[0]!.orientationRadians).toBe(pose.orientationRadians);
      for (const skeleton of scene.skeletons) expect(skeleton.bones[1]!.getTransformNode()!.position.y).toBeCloseTo(boneY);
    };
    registry.update(0); check(.25);
    emit({ type: "update", entity: { ...initial, animation: "attack" } }); registry.update(.5); check(.5);
    emit({ type: "update", entity: { ...initial, health: 0 } }); registry.update(.5); check(-.5);
    registry.update(10); check(-1);
    expect(registry.snapshot()[0]).not.toHaveProperty("groundClearance");
  });
});
