import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { GetEnvironmentBRDFTexture } from "@babylonjs/core/Misc/brdfTextureTools";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { NativeActor } from "../../src/assets/native/NativeActor";
import { nativeCharacterFactory, type NativeCharacterProfile } from "../../src/assets/native/NativeCharacterVisual";
import { createNativeClipPreviewHub } from "../../src/assets/native/nativeClipPreview";
import type { CharacterVisual } from "../../src/assets/CharacterVisual";
import type { WorldEntity } from "../../src/world/worldTypes";
import { nativeVisualClips, nativeVisualFixture } from "../fixtures/nativeVisualFixture";

const initial: WorldEntity = { id: "fixture-player", kind: "local-player", displayName: "Fixture player", appearanceId: "fixture",
  health: 100, maximumHealth: 100, position: { x: 0, y: 0, z: 0 }, orientationRadians: 0, animation: "idle" };

function refreshLinkedBoneTransformsWithoutRendering(mesh: AbstractMesh) {
  const skeleton = mesh.skeleton!;
  skeleton.prepare(true); skeleton.computeAbsoluteMatrices(true); mesh.computeWorldMatrix(true);
  mesh.refreshBoundingInfo({ applySkeleton: true });
}

describe("native character presentation boundary", () => {
  let engine: NullEngine, scene: Scene, visuals: CharacterVisual[], releases: (() => void)[], pending: Promise<unknown>[];
  beforeEach(() => { engine = new NullEngine(); scene = new Scene(engine); GetEnvironmentBRDFTexture(scene); visuals = []; releases = []; pending = []; });
  afterEach(async () => {
    for (const release of releases) release();
    await Promise.allSettled(pending);
    for (const visual of visuals) visual.dispose();
    scene.dispose(); engine.dispose(); vi.restoreAllMocks();
  });
  async function create(profile: Partial<NativeCharacterProfile> = {}, entity = initial) {
    const status = vi.fn<(message: string) => void>();
    const visual = nativeCharacterFactory(new Map([["fixture", { asset: await nativeVisualFixture(), clips: nativeVisualClips, ...profile }]]))(scene, entity, status);
    visuals.push(visual); return { visual, status };
  }
  function gateCreate() {
    const actual = NativeActor.create.bind(NativeActor);
    let release!: () => void, loaded!: (actor: NativeActor) => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const ready = new Promise<NativeActor>(resolve => { loaded = resolve; });
    releases.push(release);
    vi.spyOn(NativeActor, "create").mockImplementationOnce((...args) => {
      const operation = actual(...args).then(async actor => { loaded(actor); await gate; return actor; });
      pending.push(operation); return operation;
    });
    return { ready, release };
  }
  function materials() { return scene.meshes.filter(mesh => mesh.getTotalVertices() && mesh.isEnabled()).map(mesh => mesh.material?.name).sort(); }
  function update(visual: CharacterVisual, entity: WorldEntity) {
    visual.setEntity(entity); visual.animation.setState(entity.animation);
  }

  it("uses the latest state after loading, preserves source dimensions/world transform and tags picking meshes", async () => {
    const gate = gateCreate(), { visual } = await create();
    visual.root.position.set(13, 3, -8); visual.root.rotation.y = .6;
    await gate.ready; update(visual, { ...initial, animation: "run" }); gate.release();
    await visual.ready;
    expect(visual.hasNativeModel).toBe(true);
    expect(visual.root.position.asArray()).toEqual([13, 3, -8]); expect(visual.root.rotation.y).toBe(.6);
    expect(visual.root.scaling.asArray()).toEqual([1, 1, 1]);
    expect(visual.bounds.minimum.y).toBeCloseTo(0); expect(visual.bounds.maximum.y).toBeCloseTo(2);
    expect(visual.animation.playback?.activeClip).toBe(nativeVisualClips.run);
    expect(materials()).toEqual(["base:Lower", "base:Upper"]);
    for (const mesh of visual.root.getChildMeshes().filter(mesh => mesh.getTotalVertices())) {
      expect(mesh.metadata?.clientEntityId).toBe(initial.id); expect(mesh.isPickable).toBe(true);
    }
  });

  it("previews one exact package clip without changing the requested state, then resumes that state", async () => {
    const hub = createNativeClipPreviewHub(), status = vi.fn<(message: string) => void>();
    const visual = nativeCharacterFactory(new Map([["fixture", { asset: await nativeVisualFixture(), clips: nativeVisualClips }]]), undefined, undefined, hub)(scene, initial, status);
    visuals.push(visual);
    expect(hub.play(initial.id, nativeVisualClips.death)).toBe("The native model has not loaded yet.");
    await visual.ready;
    expect(hub.available(initial.id)).toEqual(expect.arrayContaining(Object.values(nativeVisualClips)));
    expect(hub.play(initial.id, "Native_Missing")).toContain("not a clip of this package");
    expect(hub.play(initial.id, nativeVisualClips.death)).toBeNull();
    expect(visual.animation.playback?.activeClip).toBe(nativeVisualClips.death);
    expect(visual.animation.playback?.looping).toBe(false);
    expect(visual.animation.state).toBe("idle"); expect(hub.previewing(initial.id)).toBe(nativeVisualClips.death);
    visual.animation.update(5);
    expect(visual.animation.playback?.activeClip).toBe(nativeVisualClips.idle); expect(hub.previewing(initial.id)).toBeNull();
    expect(hub.play(initial.id, nativeVisualClips.attack)).toBeNull();
    const interruptPreviewWithSemanticAnimationChange = () => update(visual, { ...initial, animation: "run" });
    interruptPreviewWithSemanticAnimationChange();
    expect(visual.animation.playback?.activeClip).toBe(nativeVisualClips.run); expect(hub.previewing(initial.id)).toBeNull();
    visual.setEntity({ ...initial, animation: "run", health: 0 });
    expect(hub.play(initial.id, nativeVisualClips.idle)).toContain("Revive");
    visual.dispose();
    expect(hub.play(initial.id, nativeVisualClips.idle)).toBe("The native model has not loaded yet.");
  });

  it("rejects and disposes a model missing a required native clip without creating a dummy", async () => {
    const { visual, status } = await create({ asset: await nativeVisualFixture({ omitDeath: true }) });
    await expect(visual.ready).rejects.toThrow("Native_Death is missing");
    expect(status).toHaveBeenCalledWith(expect.stringContaining("Native_Death is missing"));
    expect(visual.hasNativeModel).toBe(false); expect(visual.modelId).toBeNull();
    expect(scene.animationGroups).toHaveLength(0); expect(scene.meshes).toHaveLength(0);
    expect(scene.transformNodes).toHaveLength(0);
  });

  it("aligns a verified +X native facing axis with semantic movement in every horizontal direction", async () => {
    scene.useRightHandedSystem = true;
    const { visual } = await create({ forwardAxis: Vector3.Right() });
    if (!visual.hasNativeModel) expect(visual.forwardDirection).toBeNull();
    await visual.ready;
    const placement = scene.getTransformNodeByName(`${initial.id}:native-actor-placement`)!;
    expect(placement.rotation.y).toBe(-Math.PI / 2);
    const sourceKeys = scene.animationGroups.map(group => group.targetedAnimations.map(channel => channel.animation.serialize()));
    for (const [x, z] of [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, -1]]) {
      visual.root.rotation.y = Math.atan2(x!, z!);
      const direction = visual.forwardDirection!;
      const movement = new Vector3(x!, 0, z!).normalize();
      expect(Vector3.Dot(direction, movement)).toBeCloseTo(1, 7);
    }
    expect(scene.animationGroups.map(group => group.targetedAnimations.map(channel => channel.animation.serialize()))).toEqual(sourceKeys);
    expect(visual.root.scaling.asArray()).toEqual([1, 1, 1]);
  });

  it("fixes clearance at the skinned idle datum while preserving attack/death motion, geometry, rig and keys", async () => {
    const asset = await nativeVisualFixture({ minimumY: -.75, skinned: true,
      verticalMotion: { idle: [.25, .25], attack: [0, 1], death: [0, -1] } });
    const { visual } = await create({ asset }, { ...initial, animation: "attack" });
    visual.root.position.set(13, 3, -8); visual.root.rotation.y = .6;
    await vi.waitFor(() => expect(visual.hasNativeModel).toBe(true));
    const meshes = visual.root.getChildMeshes().filter(mesh => mesh.getTotalVertices());
    expect(meshes).toHaveLength(2); expect(new Set(meshes.map(mesh => mesh.skeleton)).size).toBe(2);
    const keys = () => scene.animationGroups.map(group => ({ name: group.name, channels: group.targetedAnimations.map(({ animation }) =>
      animation.getKeys().map(key => ({ frame: key.frame, value: key.value instanceof Vector3 ? key.value.asArray() : null }))) }));
    const originalKeys = keys();
    const idleSupportDatumY = -.75 + .25;
    const check = (boneY: number) => {
      expect(visual.groundClearance).toBeCloseTo(-idleSupportDatumY);
      expect(visual.bounds.minimum.y).toBeCloseTo(-.5); expect(visual.bounds.maximum.y).toBeCloseTo(1.5);
      expect(visual.root.position.asArray()).toEqual([13, 3, -8]); expect(visual.root.rotation.y).toBe(.6);
      expect(visual.root.scaling.asArray()).toEqual([1, 1, 1]);
      for (const mesh of meshes) {
        expect(Array.from(mesh.getVerticesData(VertexBuffer.PositionKind)!)).toEqual([-.5, -.75, 0, .5, -.75, 0, 0, 1.25, 0]);
        expect(mesh.position.asArray()).toEqual([0, 0, 0]); expect(mesh.scaling.asArray()).toEqual([1, 1, 1]);
        const skeleton = mesh.skeleton!;
        expect(skeleton.bones.map(bone => bone.name)).toEqual(["NativeRoot", "NativeBone"]);
        expect(skeleton.bones[0]!.getTransformNode()!.position.asArray()).toEqual([0, 0, 0]);
        expect(skeleton.bones[1]!.getTransformNode()!.position.y).toBeCloseTo(boneY);
        for (const bone of skeleton.bones) expect(Array.from(bone.getRestMatrix().asArray())).toEqual(Array.from(Matrix.IdentityReadOnly.asArray()));
        refreshLinkedBoneTransformsWithoutRendering(mesh);
        expect(mesh.getBoundingInfo().boundingBox.minimum.y).toBeCloseTo(-.75 + boneY);
      }
      expect(keys()).toEqual(originalKeys);
    };
    check(0); visual.animation.update(.5); check(.5);
    update(visual, { ...initial, health: 0 }); visual.animation.update(.5); check(-.5);
    visual.animation.update(10); check(-1);
    expect(visual.animation.playback).toMatchObject({ activeClip: nativeVisualClips.death, playing: false });
  });

  it("rejects a zero-height native candidate without exposing a fallback", async () => {
    const { visual, status } = await create({ asset: await nativeVisualFixture({ height: 0 }) });
    await expect(visual.ready).rejects.toThrow("finite visible bounds");
    expect(status).toHaveBeenCalledWith(expect.stringContaining("finite visible bounds"));
    expect(visual.hasNativeModel).toBe(false); expect(scene.animationGroups).toHaveLength(0);
    expect(scene.meshes).toHaveLength(0);
  });

  it("supports a hovering native profile by its collision half-height through death and revival", async () => {
    const asset = await nativeVisualFixture({ minimumY: -.12, skinned: true,
      verticalMotion: { idle: [0, 0], death: [0, -.28] } });
    const { visual } = await create({ asset, collisionHalfHeight: .36 });
    await vi.waitFor(() => expect(visual.hasNativeModel).toBe(true));
    const positions = visual.root.getChildMeshes().filter(mesh => mesh.getTotalVertices())
      .map(mesh => Array.from(mesh.getVerticesData(VertexBuffer.PositionKind)!));
    expect(visual.groundClearance).toBe(.36);
    expect(visual.bounds.minimum.y + visual.groundClearance).toBeCloseTo(.24);
    update(visual, { ...initial, health: 0 }); visual.animation.update(10);
    expect(visual.animation.playback).toMatchObject({ activeClip: nativeVisualClips.death, playing: false });
    expect(visual.groundClearance).toBe(.36);
    expect(visual.root.getChildMeshes().filter(mesh => mesh.getTotalVertices())
      .map(mesh => Array.from(mesh.getVerticesData(VertexBuffer.PositionKind)!))).toEqual(positions);
    expect(visual.root.scaling.asArray()).toEqual([1, 1, 1]);
    update(visual, { ...initial, health: 100 });
    expect(visual.animation.playback?.activeClip).toBe(nativeVisualClips.idle);
    expect(visual.groundClearance).toBe(.36);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])("rejects invalid collision half-height %s", async collisionHalfHeight => {
    const { visual, status } = await create({ collisionHalfHeight });
    await expect(visual.ready).rejects.toThrow("collision half-height must be finite and positive");
    expect(status).toHaveBeenCalledWith(expect.stringContaining("collision half-height must be finite and positive"));
    expect(visual.hasNativeModel).toBe(false); expect(visual.groundClearance).toBe(0);
    expect(scene.animationGroups).toHaveLength(0);
  });

  it("scales the whole native assembly outside its rig while keeping collision height independent", async () => {
    const asset = await nativeVisualFixture({ minimumY: -.12, skinned: true, nativeParentTranslation: [1, 2, 3],
      verticalMotion: { idle: [0, 0], death: [0, -.28] } });
    const { visual } = await create({ asset, collisionHalfHeight: .36, actorScale: new Vector3(1.2, 1.2, 1.2) });
    await vi.waitFor(() => expect(visual.hasNativeModel).toBe(true));
    expect(visual.root.scaling.asArray()).toEqual([1, 1, 1]);
    expect(visual.groundClearance).toBe(.36);
    expect(visual.bounds.minimum.y).toBeCloseTo((2 - .12) * 1.2);
    expect(visual.bounds.maximum.y).toBeCloseTo((2 + 1.88) * 1.2);
    expect(scene.getTransformNodeByName("NativeMeshTransform")!.position.asArray()).toEqual([1, 2, 3]);
    const placement = scene.getTransformNodeByName(`${initial.id}:native-actor-placement`)!;
    expect(placement.scaling.asArray()).toEqual([1.2, 1.2, 1.2]);
    const meshes = visual.root.getChildMeshes().filter(mesh => mesh.getTotalVertices());
    const positions = meshes.map(mesh => Array.from(mesh.getVerticesData(VertexBuffer.PositionKind)!));
    update(visual, { ...initial, health: 0 }); visual.animation.update(10);
    expect(visual.groundClearance).toBe(.36);
    for (const mesh of meshes) {
      expect(mesh.scaling.asArray()).toEqual([1, 1, 1]);
      expect(mesh.skeleton!.bones[1]!.getTransformNode()!.position.y).toBeCloseTo(-.28);
    }
    expect(meshes.map(mesh => Array.from(mesh.getVerticesData(VertexBuffer.PositionKind)!))).toEqual(positions);
    visual.dispose();
    expect(placement.isDisposed()).toBe(true);
    expect(scene.meshes).toHaveLength(0); expect(scene.transformNodes).toHaveLength(0);
  });

  it("holds death despite ordinary state updates and restores the requested locomotion on revival", async () => {
    const { visual } = await create({}, { ...initial, animation: "run" });
    await vi.waitFor(() => expect(visual.hasNativeModel).toBe(true));
    update(visual, { ...initial, animation: "run", health: 0 }); visual.animation.update(10);
    expect(visual.animation.playback).toMatchObject({ activeClip: nativeVisualClips.death, looping: false, playing: false });
    update(visual, { ...initial, animation: "run", health: 0 }); visual.animation.update(1);
    expect(visual.animation.playback?.activeClip).toBe(nativeVisualClips.death);
    update(visual, { ...initial, animation: "run", health: 100 }); visual.animation.update(.1);
    expect(visual.animation.playback).toMatchObject({ activeClip: nativeVisualClips.run, looping: true, playing: true });
  });

  it("plays one attack, returns visually to idle and retriggers only an explicit repeated action", async () => {
    const { visual } = await create(); await vi.waitFor(() => expect(visual.hasNativeModel).toBe(true));
    visual.animation.setState("attack"); visual.animation.update(.5);
    expect(visual.animation.playback).toMatchObject({ activeClip: nativeVisualClips.attack, frame: 30, looping: false });
    visual.animation.setState("attack"); expect(visual.animation.playback?.frame).toBe(30);
    visual.animation.update(10); expect(visual.animation.playback?.activeClip).toBe(nativeVisualClips.idle);
    visual.animation.setState("attack", true); expect(visual.animation.playback).toMatchObject({ activeClip: nativeVisualClips.attack, frame: 0 });
  });

  it.each([false, true])("does not replay a previous attack on revival (completed: %s)", async completed => {
    const { visual } = await create(); await visual.ready;
    visual.animation.setState("attack"); visual.animation.update(completed ? 10 : .1);
    update(visual, { ...initial, animation: "attack", health: 0 }); visual.animation.update(10);
    expect(visual.animation.playback?.activeClip).toBe(nativeVisualClips.death);
    update(visual, { ...initial, animation: "attack", health: 100 });
    expect(visual.animation.playback).toMatchObject({ activeClip: nativeVisualClips.idle, looping: true });
    visual.animation.setState("attack", true);
    expect(visual.animation.playback).toMatchObject({ activeClip: nativeVisualClips.attack, frame: 0, looping: false });
  });

  it("preserves the equipped appearance on failure and can still restore the starter part afterward", async () => {
    const upperItems = new Map([
      [22, await nativeVisualFixture({ parts: ["Upper"], material: "leather" })],
      [23, await nativeVisualFixture({ parts: ["Upper"], material: "invalid", omitDeath: true })],
    ]);
    const { visual, status } = await create({ upperItems }, { ...initial, equipment: { upper: 22 } });
    await visual.ready;
    expect(materials()).toEqual(["base:Lower", "leather:Upper"]);
    update(visual, { ...initial, equipment: { upper: 23 } });
    await vi.waitFor(() => expect(status).toHaveBeenCalledWith(expect.stringContaining("Previous appearance retained")));
    expect(materials()).toEqual(["base:Lower", "leather:Upper"]);
    update(visual, { ...initial, equipment: {} });
    await vi.waitFor(() => expect(materials()).toEqual(["base:Lower", "base:Upper"]));
  });

  it("disposes a late load after visual removal without resurrecting meshes or sending a loaded status", async () => {
    const gate = gateCreate(), { visual, status } = await create();
    const actor = await gate.ready; visual.dispose(); visual.dispose();
    await expect(visual.ready).rejects.toHaveProperty("name", "AbortError");
    gate.release();
    await vi.waitFor(() => expect(actor.root.isDisposed()).toBe(true));
    expect(status).not.toHaveBeenCalled();
    expect(scene.meshes).toHaveLength(0); expect(scene.transformNodes).toHaveLength(0); expect(scene.materials).toHaveLength(0);
    expect(scene.animationGroups).toHaveLength(0); expect(scene.textures).toHaveLength(1);
  });

  it("disposes the visual through scene lifetime even if the model load finishes afterward", async () => {
    const gate = gateCreate(), { visual, status } = await create();
    await gate.ready; scene.dispose();
    await expect(visual.ready).rejects.toHaveProperty("name", "AbortError");
    gate.release();
    await vi.waitFor(() => expect(visual.root.isDisposed()).toBe(true));
    await Promise.allSettled(pending); await Promise.resolve();
    expect(status).not.toHaveBeenCalled(); expect(scene.meshes).toHaveLength(0);
  });

  it("does not construct a procedural stand-in while the model is delayed", async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; }); releases.push(release);
    const actual = NativeActor.create.bind(NativeActor);
    vi.spyOn(NativeActor, "create").mockImplementationOnce(async (...args) => { await gate; return actual(...args); });
    const { visual } = await create();
    const onReady = vi.fn(); void visual.ready.then(onReady);
    await Promise.resolve();
    expect(onReady).not.toHaveBeenCalled();
    expect(scene.meshes).toHaveLength(0);
    release(); await visual.ready;
    expect(onReady).toHaveBeenCalledOnce(); expect(visual.hasNativeModel).toBe(true);
  });

  it("waits for initial equipment, tags its meshes and never enables the starter appearance first", async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; }); releases.push(release);
    const actual = NativeActor.prototype.replacePart;
    const replace = vi.spyOn(NativeActor.prototype, "replacePart").mockImplementationOnce(async function (this: NativeActor, object, replacement) {
      await gate; return actual.call(this, object, replacement);
    });
    const { visual } = await create({ upperItems: new Map([[22, await nativeVisualFixture({ parts: ["Upper"], material: "leather" })]]) },
      { ...initial, equipment: { upper: 22 } });
    const onReady = vi.fn(); void visual.ready.then(onReady);
    await vi.waitFor(() => expect(replace).toHaveBeenCalledOnce());
    expect(materials()).toEqual([]); expect(onReady).not.toHaveBeenCalled(); expect(visual.hasNativeModel).toBe(false);
    release(); await visual.ready;
    expect(materials()).toEqual(["base:Lower", "leather:Upper"]);
    for (const mesh of visual.root.getChildMeshes().filter(mesh => mesh.getTotalVertices() && mesh.isEnabled())) {
      expect(mesh.metadata?.clientEntityId).toBe(initial.id); expect(mesh.isPickable).toBe(true);
    }
  });

  it("rejects invalid initial equipment and cleans the entire unpublished assembly", async () => {
    const { visual, status } = await create({ upperItems: new Map([[22, await nativeVisualFixture({ parts: ["Upper"], omitDeath: true })]]) },
      { ...initial, equipment: { upper: 22 } });
    await expect(visual.ready).rejects.toThrow("original native animation relationships");
    expect(status).not.toHaveBeenCalledWith(expect.stringContaining("native model loaded"));
    expect(scene.meshes).toHaveLength(0); expect(scene.transformNodes).toHaveLength(0);
    expect(scene.animationGroups).toHaveLength(0); expect(visual.modelId).toBeNull();
  });

  it("uses the latest equipment and animation if an update arrives during startup", async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; }); releases.push(release);
    const actual = NativeActor.prototype.replacePart;
    const replace = vi.spyOn(NativeActor.prototype, "replacePart").mockImplementationOnce(async function (this: NativeActor, object, replacement) {
      await actual.call(this, object, replacement); await gate;
    });
    const upperItems = new Map([
      [22, await nativeVisualFixture({ parts: ["Upper"], material: "leather" })],
      [24, await nativeVisualFixture({ parts: ["Upper"], material: "chain" })],
    ]);
    const { visual } = await create({ upperItems }, { ...initial, equipment: { upper: 22 } });
    await vi.waitFor(() => expect(scene.materials.some(material => material.name === "leather:Upper")).toBe(true));
    update(visual, { ...initial, animation: "run", equipment: { upper: 24 } });
    await vi.waitFor(() => expect(replace).toHaveBeenCalledTimes(2));
    expect(materials()).toEqual([]);
    release(); await visual.ready;
    expect(materials()).toEqual(["base:Lower", "chain:Upper"]);
    expect(visual.animation.playback?.activeClip).toBe(nativeVisualClips.run);
  });

  it("settles readiness immediately when disposed during initial equipment loading", async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; }); releases.push(release);
    const actual = NativeActor.prototype.replacePart;
    const replace = vi.spyOn(NativeActor.prototype, "replacePart").mockImplementationOnce(async function (this: NativeActor, object, replacement) {
      await actual.call(this, object, replacement); await gate;
    });
    const { visual } = await create({ upperItems: new Map([[22, await nativeVisualFixture({ parts: ["Upper"], material: "leather" })]]) },
      { ...initial, equipment: { upper: 22 } });
    await vi.waitFor(() => expect(replace).toHaveBeenCalledOnce());
    visual.dispose(); await expect(visual.ready).rejects.toHaveProperty("name", "AbortError");
    release(); await Promise.resolve();
    expect(scene.meshes).toHaveLength(0); expect(scene.transformNodes).toHaveLength(0);
  });

  it("rejects unsupported initial equipment and absent profiles instead of declaring readiness", async () => {
    const { visual } = await create({}, { ...initial, equipment: { upper: 999 } });
    await expect(visual.ready).rejects.toThrow("Native item 999 has no verified upper-body binding");
    const missing = nativeCharacterFactory(new Map())(scene, initial); visuals.push(missing);
    await expect(missing.ready).rejects.toThrow("native profile unavailable");
    expect(scene.meshes).toHaveLength(0); expect(scene.transformNodes).toHaveLength(0);
  });
});
