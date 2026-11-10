import { afterEach, describe, expect, it, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { GetEnvironmentBRDFTexture } from "@babylonjs/core/Misc/brdfTextureTools";
import { NativeSliceAdapter } from "../../src/world/NativeSliceAdapter";
import type { WorldCommand, WorldEntity, WorldEvent } from "../../src/world/worldTypes";
import { nativeCharacterFactory, type NativeCharacterProfile } from "../../src/assets/native/NativeCharacterVisual";
import { resolveNativeLocomotionClips } from "../../src/assets/native/nativeLocomotion";
import type { CharacterVisual } from "../../src/assets/CharacterVisual";
import { createNativeFootstepPreview, NATIVE_FOOTSTEP_WORLD_DEFAULT, type NativeFootstepDefinition } from "../../src/audio/nativeFootstepPreview";
import type { WorldAudioPlaybackReceipt } from "../../src/audio/WorldAudioMixer";
import { readAssetPackage, sha256, type AssetPackage } from "../../src/assets/package/readAssetPackage";
import { storedPackage } from "../fixtures/assetPackageFixture";
import { nativeVisualClips, nativeVisualFixture } from "../fixtures/nativeVisualFixture";

const origin = { x: 2, y: 3, z: 4 };
const adapters: NativeSliceAdapter[] = [];
const disposals: (() => void)[] = [];
function adapter(walkSupported = true) {
  const value = new NativeSliceAdapter(origin, undefined, null, undefined, { walkSupported, collision: { radius: 9, height: 23 } });
  adapters.push(value); return value;
}
function player(value: NativeSliceAdapter) { return value.getInitialState().find(entity => entity.id === "local-player")!; }
function recorded(value: NativeSliceAdapter) { const events: WorldEvent[] = []; value.subscribe(event => events.push(event)); return events; }
const moveTypes = (events: readonly WorldEvent[]) => events.flatMap(event => event.type === "move" ? [event.moveType] : []);
afterEach(() => {
  for (const dispose of disposals.splice(0).reverse()) dispose();
  for (const value of adapters.splice(0)) value.dispose();
  vi.restoreAllMocks();
});

describe("native slice locomotion intent", () => {
  it("defaults to run and ignores unsupported or invalid walking requests", () => {
    const absent = new NativeSliceAdapter(origin, undefined, null, undefined, { walkSupported: false, collision: { radius: 9, height: 23 } });
    const unsupported = adapter(false), supported = adapter();
    adapters.push(absent);
    for (const value of [absent, unsupported]) {
      const before = value.getInitialState(), events: WorldEvent[] = []; value.subscribe(event => events.push(event));
      expect(player(value).locomotion ?? "run").toBe("run");
      value.dispatch({ type: "set-locomotion", mode: "walk" });
      expect(value.getInitialState()).toEqual(before); expect(events).toEqual([]);
      value.dispatch({ type: "move-local", position: { x: 2, y: 3, z: 5.4 } });
      expect(moveTypes(events)).toEqual([1]);
      expect(player(value).locomotion ?? "run").toBe("run");
    }
    const before = supported.getInitialState(), events: WorldEvent[] = []; supported.subscribe(event => events.push(event));
    for (const mode of ["sprint", "", null, 0]) supported.dispatch({ type: "set-locomotion", mode } as unknown as WorldCommand);
    expect(supported.getInitialState()).toEqual(before); expect(events).toEqual([]);
  });

  it("switches gait between move records without changing position, action sequence or other actors", () => {
    const value = adapter(), monster = value.getInitialState().find(entity => entity.kind === "monster"), events = recorded(value);
    value.dispatch({ type: "move-local", position: { x: 2, y: 3, z: 6.8 } });
    const moving = player(value);
    value.dispatch({ type: "set-locomotion", mode: "walk" });
    expect(player(value)).toMatchObject({ position: moving.position, animation: "idle", locomotion: "walk" });
    expect(player(value).animationSequence).toBe(moving.animationSequence);
    value.dispatch({ type: "move-local", position: { x: 2, y: 3, z: 6.8 } });
    value.dispatch({ type: "set-locomotion", mode: "run" });
    value.dispatch({ type: "move-local", position: { x: 2, y: 3, z: 6.8 } });
    expect(moveTypes(events)).toEqual([1, 0, 1]);
    expect(value.getInitialState().find(entity => entity.kind === "monster")).toEqual(monster);
  });

  it("does not restart an idle state or publish a redundant gait selection", () => {
    const value = adapter(), events = recorded(value);
    value.dispatch({ type: "set-locomotion", mode: "walk" });
    expect(events).toHaveLength(1); const selected = player(value);
    value.dispatch({ type: "set-locomotion", mode: "walk" });
    expect(player(value)).toEqual(selected); expect(events).toHaveLength(1);
    expect(selected).toMatchObject({ position: origin, animation: "idle", locomotion: "walk" });
  });

  it("keeps pause while changing gait and equipment", () => {
    const value = adapter(); value.dispatch({ type: "move-local", position: { x: 2, y: 3, z: 6.1 } });
    value.dispatch({ type: "set-paused", isPaused: true });
    value.dispatch({ type: "set-locomotion", mode: "walk" }); value.dispatch({ type: "equip-item", slot: "upper", itemId: 22 });
    expect(value.isPaused).toBe(true);
    expect(player(value)).toMatchObject({ position: origin, locomotion: "walk", equipment: { upper: 22 } });
    value.dispatch({ type: "set-paused", isPaused: false }); value.dispatch({ type: "equip-item", slot: "upper", itemId: null });
    expect(player(value)).toMatchObject({ position: origin, locomotion: "walk", equipment: {} });
  });

  it("sends no move for a dead actor and keeps the gait for the first move after revival", () => {
    const value = adapter(), events = recorded(value);
    value.dispatch({ type: "set-health", entityId: "local-player", health: 0 });
    value.dispatch({ type: "set-locomotion", mode: "walk" }); value.dispatch({ type: "equip-item", slot: "upper", itemId: 22 });
    value.dispatch({ type: "move-local", position: { x: 2, y: 3, z: 6.8 } });
    expect(player(value)).toMatchObject({ position: origin, health: 0, locomotion: "walk", equipment: { upper: 22 } });
    expect(moveTypes(events)).toEqual([]);
    value.dispatch({ type: "set-health", entityId: "local-player", health: 100 });
    value.dispatch({ type: "move-local", position: { x: 2, y: 3, z: 6.8 } });
    expect(moveTypes(events)).toEqual([0]);
  });

  it("stops the local move on an attack and does not turn a gait change into movement", () => {
    const value = adapter(), events = recorded(value);
    value.dispatch({ type: "move-local", position: { x: 2, y: 3, z: 6.8 } });
    value.dispatch({ type: "set-animation", animation: "attack" }); const action = player(value);
    value.dispatch({ type: "set-locomotion", mode: "walk" });
    expect(player(value)).toMatchObject({ position: origin, animation: "attack", locomotion: "walk", animationSequence: action.animationSequence });
    value.dispatch({ type: "set-animation", animation: "idle" }); const idle = player(value);
    value.dispatch({ type: "set-locomotion", mode: "run" });
    expect(player(value)).toMatchObject({ position: origin, animation: "idle", locomotion: "run", animationSequence: idle.animationSequence });
    expect(events.map(event => event.type).filter(type => type === "move" || type === "stop")).toEqual(["move", "stop"]);
  });
});

describe("verified locomotion pair selection", () => {
  const pair = (asset: AssetPackage): NativeFootstepDefinition[] => [
    { asset, gait: "walk", clip: "OriginalWalkingClip", durationSeconds: .8, events: [] },
    { asset, gait: "run", clip: "OriginalRunningClip", durationSeconds: 13 / 15, events: [] },
  ];

  it("uses only the selected asset object even when another asset has the same metadata", async () => {
    const asset = await nativeVisualFixture(), other: AssetPackage = { manifest: structuredClone(asset.manifest), files: asset.files };
    const definitions = [...pair(other), ...pair(asset)], before = definitions.map(row => ({ ...row }));
    expect(resolveNativeLocomotionClips(asset, "OriginalRunningClip", definitions))
      .toEqual({ walkClip: "OriginalWalkingClip", runClip: "OriginalRunningClip", walkSource: "footstep-pair", reason: null });
    expect(resolveNativeLocomotionClips(asset, "OriginalRunningClip", pair(other)).walkClip).toBeNull();
    expect(definitions).toEqual(before);
  });

  it("walks on the profile's native WalkAnimName alias only when the bundle has no gait row for the package", async () => {
    const asset = await nativeVisualFixture(), other: AssetPackage = { manifest: structuredClone(asset.manifest), files: asset.files };
    expect(resolveNativeLocomotionClips(asset, "Run_Hand_MMagic", pair(other), "Walk_Hand_MMagic"))
      .toEqual({ walkClip: "Walk_Hand_MMagic", runClip: "Run_Hand_MMagic", walkSource: "profile-alias", reason: null });
    const verifiedPairWinsOverAlias = resolveNativeLocomotionClips(asset, "OriginalRunningClip", pair(asset), "Walk_Hand_MMagic");
    expect(verifiedPairWinsOverAlias).toMatchObject({ walkClip: "OriginalWalkingClip", walkSource: "footstep-pair" });
    const partialBundleNotPatchedByAlias = resolveNativeLocomotionClips(asset, "OriginalRunningClip", [pair(asset)[1]!], "Walk_Hand_MMagic");
    expect(partialBundleNotPatchedByAlias).toMatchObject({ walkClip: null, walkSource: null });
    const contradictingBundleNotPatchedByAlias = resolveNativeLocomotionClips(asset, "AuthoredWeaponRun", pair(asset), "Walk_Hand_MMagic");
    expect(contradictingBundleNotPatchedByAlias).toMatchObject({ walkClip: null, walkSource: null });
    expect(resolveNativeLocomotionClips(asset, "Run_Hand_MMagic", [])).toMatchObject({ walkClip: null, reason: expect.any(String) });
  });

  it("preserves an authored different run selection instead of replacing its family", async () => {
    const asset = await nativeVisualFixture();
    expect(resolveNativeLocomotionClips(asset, "AuthoredWeaponRun", pair(asset)))
      .toMatchObject({ walkClip: null, runClip: "AuthoredWeaponRun", reason: expect.stringContaining("saved run clip differs") });
  });

  it("rejects missing or ambiguous walk/run pairs instead of guessing a gait clip", async () => {
    const asset = await nativeVisualFixture(), [walk, run] = pair(asset);
    for (const definitions of [[], [walk!], [run!], [walk!, walk!, run!], [walk!, run!, run!]]) {
      expect(resolveNativeLocomotionClips(asset, "OriginalRunningClip", definitions))
        .toMatchObject({ walkClip: null, runClip: "OriginalRunningClip", reason: expect.any(String) });
    }
  });
});

const walkClip = "Native_Walk";
async function testOnlyWalkingFixtureCopiedFromIdle(options: Parameters<typeof nativeVisualFixture>[0] = {}): Promise<AssetPackage> {
  const input = await nativeVisualFixture(options), original = input.files.get("model.glb")!;
  const originalView = new DataView(original.buffer, original.byteOffset, original.byteLength), jsonSize = originalView.getUint32(12, true);
  const document = JSON.parse(new TextDecoder().decode(original.subarray(20, 20 + jsonSize)));
  const walk = structuredClone(document.animations.find((animation: { name: string }) => animation.name === nativeVisualClips.idle));
  walk.name = walkClip; document.animations.push(walk);
  const json = new TextEncoder().encode(JSON.stringify(document)), padded = Math.ceil(json.length / 4) * 4;
  const binary = original.subarray(28 + jsonSize), glb = new Uint8Array(28 + padded + binary.length), view = new DataView(glb.buffer);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, glb.length, true);
  view.setUint32(12, padded, true); view.setUint32(16, 0x4e4f534a, true); glb.fill(32, 20, 20 + padded); glb.set(json, 20);
  view.setUint32(20 + padded, binary.length, true); view.setUint32(24 + padded, 0x004e4942, true); glb.set(binary, 28 + padded);
  const manifest = structuredClone(input.manifest);
  manifest.files = [{ path: "model.glb", bytes: glb.length, sha256: await sha256(glb), mime: "model/gltf-binary" }];
  return readAssetPackage(storedPackage([{ name: "asset.json", bytes: new TextEncoder().encode(JSON.stringify(manifest)) }, { name: "model.glb", bytes: glb }]));
}
const initial: WorldEntity = { id: "fixture-player", kind: "local-player", displayName: "Locomotion fixture", appearanceId: "fixture",
  health: 100, maximumHealth: 100, position: origin, orientationRadians: 0, animation: "idle" };
function update(visual: CharacterVisual, state: WorldEntity) { visual.setEntity(state); visual.animation.setState(state.animation); }
async function createVisual(profile: Partial<NativeCharacterProfile> = {}, footsteps?: ReturnType<typeof createNativeFootstepPreview>, entity = initial) {
  const engine = new NullEngine(), scene = new Scene(engine); GetEnvironmentBRDFTexture(scene);
  disposals.push(() => { scene.dispose(); engine.dispose(); });
  const configured: NativeCharacterProfile = { asset: await testOnlyWalkingFixtureCopiedFromIdle(), clips: { ...nativeVisualClips, walk: walkClip }, ...profile };
  const visual = nativeCharacterFactory(new Map([["fixture", configured]]), undefined, footsteps)(scene, entity);
  disposals.push(() => visual.dispose()); await visual.ready; return { visual, scene, asset: configured.asset };
}

describe("native moving gait presentation and source-clock boundary", () => {
  it("uses the walk clip clock for repeated footsteps and preserves it across ordinary updates and equipment replacement", async () => {
    const body = await testOnlyWalkingFixtureCopiedFromIdle(), shirt = await testOnlyWalkingFixtureCopiedFromIdle({ parts: ["Upper"], material: "shirt" });
    const before = body.files.get("model.glb")!.slice(); let nextId = 0;
    const output = { stopOwner: vi.fn<(owner: string) => void>(), play: vi.fn((key: string, owner: string, offsetSeconds = 0): WorldAudioPlaybackReceipt =>
      ({ id: ++nextId, key, owner, offsetSeconds, contextTime: 10, durationSeconds: 2 })) };
    const definitionWithLandDefaultArrays = (gait: "walk" | "run", clip: string, times: number[]): NativeFootstepDefinition => ({ asset: body, gait, clip, durationSeconds: 2,
      events: times.map((timeSeconds, ordinal) => ({ ordinal, timeSeconds, notify: `Fixture.${gait}${ordinal}`,
        arrays: { DefaultWalkSound: [{ reference: "Fixture.Walk", key: "walk" }], DefaultRunSound: [{ reference: "Fixture.Run", key: "run" }] } })) });
    const footsteps = createNativeFootstepPreview([definitionWithLandDefaultArrays("walk", walkClip, [.5, 1.5]),
      definitionWithLandDefaultArrays("run", nativeVisualClips.run, [.25, 1.25])], output, { initialSelection: NATIVE_FOOTSTEP_WORLD_DEFAULT });
    disposals.push(() => footsteps.dispose());
    const { visual, scene } = await createVisual({ asset: body, upperItems: new Map([[22, shirt]]) }, footsteps);
    const walking: WorldEntity = { ...initial, animation: "run", locomotion: "walk" };
    update(visual, walking); visual.animation.update(.6);
    expect(visual.animation.playback).toMatchObject({ activeClip: walkClip, looping: true, playing: true });
    expect(footsteps.inspection().recent.map(row => [row.gait, row.occurrenceTimeSeconds])).toEqual([["walk", .5]]);
    const clockFrame = visual.animation.playback!.frame;
    update(visual, { ...walking }); update(visual, { ...walking, equipment: { upper: 22 } });
    await vi.waitFor(() => expect(scene.meshes.some(mesh => mesh.isEnabled() && mesh.material?.name === "shirt:Upper")).toBe(true));
    expect(visual.animation.playback!.frame).toBe(clockFrame); expect(output.play).toHaveBeenCalledTimes(1);
    visual.animation.update(.99); visual.animation.update(.92);
    expect(footsteps.inspection().recent.map(row => [row.gait, row.occurrenceTimeSeconds])).toEqual([["walk", .5], ["walk", 1.5], ["walk", 2.5]]);
    update(visual, { ...walking, locomotion: "run", equipment: { upper: 22 } });
    expect(visual.animation.playback).toMatchObject({ activeClip: nativeVisualClips.run, looping: true, frame: 0 });
    visual.animation.update(.3);
    expect(footsteps.inspection().recent.at(-1)).toMatchObject({ gait: "run", occurrenceTimeSeconds: .25, key: "run" });
    expect(output.play.mock.calls.map(call => call[0])).toEqual(["walk", "walk", "walk", "run"]);
    update(visual, { ...initial, locomotion: "walk", equipment: { upper: 22 } }); visual.animation.update(3);
    expect(visual.animation.playback!.activeClip).toBe(nativeVisualClips.idle); expect(output.play).toHaveBeenCalledTimes(4);
    expect(body.files.get("model.glb")).toEqual(before);
    expect(footsteps.inspection()).toMatchObject({ invalidClocks: 0, skippedByCatchup: 0, skippedClockGap: 0 });
  });

  it("keeps attack/death presentation authoritative while gait changes and resumes the selected moving clip on revival", async () => {
    const { visual } = await createVisual();
    update(visual, { ...initial, animation: "attack" }); visual.animation.update(.3);
    update(visual, { ...initial, animation: "attack", locomotion: "walk" });
    expect(visual.animation.playback).toMatchObject({ activeClip: nativeVisualClips.attack, frame: 18, looping: false });
    visual.animation.update(2); expect(visual.animation.playback!.activeClip).toBe(nativeVisualClips.idle);
    const walking: WorldEntity = { ...initial, animation: "run", locomotion: "walk" };
    update(visual, walking); visual.animation.update(.3);
    update(visual, { ...walking, health: 0 }); visual.animation.update(.2);
    update(visual, { ...walking, health: 0, locomotion: "run" });
    expect(visual.animation.playback).toMatchObject({ activeClip: nativeVisualClips.death, frame: 12, looping: false });
    visual.animation.update(3); expect(visual.animation.playback!.playing).toBe(false);
    update(visual, { ...walking, locomotion: "run" });
    expect(visual.animation.playback).toMatchObject({ activeClip: nativeVisualClips.run, looping: true, playing: true });
    update(visual, { ...walking, health: 0 }); visual.animation.update(3);
    update(visual, walking);
    expect(visual.animation.playback).toMatchObject({ activeClip: walkClip, looping: true, playing: true });
  });

  it("keeps existing profiles without walking support usable and rejects a declared missing walk clip", async () => {
    const { visual } = await createVisual({ asset: await nativeVisualFixture(), clips: nativeVisualClips });
    update(visual, { ...initial, animation: "run" });
    expect(visual.animation.playback!.activeClip).toBe(nativeVisualClips.run);
    await expect(createVisual({ asset: await nativeVisualFixture(), clips: { ...nativeVisualClips, walk: walkClip } }))
      .rejects.toThrow("Native_Walk is missing");
  });
});
