import { afterEach, describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { GetEnvironmentBRDFTexture } from "@babylonjs/core/Misc/brdfTextureTools";
import { NativeSliceAdapter } from "../../src/world/NativeSliceAdapter";
import type { WorldCommand, WorldEntity, WorldEvent } from "../../src/world/worldTypes";
import { nativeCharacterFactory } from "../../src/assets/native/NativeCharacterVisual";
import { resolveNativeSpecialAttackPreview } from "../../src/assets/native/nativeSpecialAttackPreview";
import type { NativeActionCueCoverage } from "../../src/audio/nativeActionCuePreview";
import type { AssetPackage } from "../../src/assets/package/readAssetPackage";
import { nativeVisualClips, nativeVisualFixture } from "../fixtures/nativeVisualFixture";

const releases: (() => void)[] = [];
afterEach(() => { for (const release of releases.splice(0).reverse()) release(); });
function createAdapter(supported = true) {
  const adapter = new NativeSliceAdapter({ x: 2, y: 3, z: 4 }, undefined, null, undefined,
    { walkSupported: true, specialAttackPreviewSupported: supported });
  releases.push(() => adapter.dispose()); return adapter;
}
const player = (adapter: NativeSliceAdapter) => adapter.getInitialState().find(entity => entity.id === "local-player")!;
const preview = { type: "preview-action", action: "special-attack" } as const;

describe("explicit special attack preview intent", () => {
  it("requires supported source data and rejects invalid or dead-player requests", () => {
    for (const supported of [false, true]) {
      const adapter = createAdapter(supported), events: WorldEvent[] = []; adapter.subscribe(event => events.push(event));
      const before = adapter.getInitialState();
      for (const action of ["skill-3", "", null, 1]) adapter.dispatch({ type: "preview-action", action } as unknown as WorldCommand);
      if (!supported) adapter.dispatch(preview);
      expect(adapter.getInitialState()).toEqual(before); expect(events).toEqual([]);
      adapter.dispatch({ type: "set-health", entityId: "local-player", health: 0 });
      const dead = player(adapter); adapter.dispatch(preview); expect(player(adapter)).toEqual(dead);
    }
  });

  it("cancels travel and retriggers only the selected preview without changing gear, heading or another actor", () => {
    const adapter = createAdapter();
    adapter.dispatch({ type: "equip-upper", itemId: 22 });
    adapter.dispatch({ type: "move-local", position: { x: 3, y: 3, z: 6 } }); adapter.advance(.5);
    const before = player(adapter), monster = adapter.getInitialState()[1];
    adapter.dispatch(preview); adapter.advance(10);
    expect(player(adapter)).toMatchObject({ position: before.position, orientationRadians: before.orientationRadians,
      equipment: { upper: 22 }, animation: "attack", actionPreview: "special-attack", animationSequence: 1 });
    adapter.dispatch(preview); expect(player(adapter).animationSequence).toBe(2);
    expect(adapter.getInitialState()[1]).toEqual(monster);
    adapter.dispatch({ type: "equip-upper", itemId: null });
    expect(player(adapter)).toMatchObject({ actionPreview: "special-attack", animationSequence: 2, equipment: {} });
  });

  it("normal attack, idle and accepted movement leave the explicit preview", () => {
    const adapter = createAdapter();
    for (const animation of ["attack", "idle", "run"] as const) {
      adapter.dispatch(preview); const sequence = player(adapter).animationSequence!;
      adapter.dispatch({ type: "set-animation", animation });
      expect(player(adapter)).toMatchObject({ animation, animationSequence: sequence + 1 });
      expect(player(adapter).actionPreview).toBeUndefined();
    }
    adapter.dispatch(preview); adapter.dispatch({ type: "move-local", position: { x: 2, y: 3, z: 5.4 } });
    expect(player(adapter).actionPreview).toBeUndefined(); adapter.advance(1);
    expect(player(adapter).position.z).toBeCloseTo(4.7);
  });

  it("preserves pause and does not recreate travel after a preview", () => {
    const adapter = createAdapter();
    adapter.dispatch({ type: "move-local", position: { x: 2, y: 3, z: 6 } });
    adapter.dispatch({ type: "set-paused", isPaused: true }); adapter.dispatch(preview);
    const selected = player(adapter); adapter.advance(10); expect(player(adapter)).toEqual(selected);
    adapter.dispatch({ type: "set-paused", isPaused: false }); adapter.advance(10);
    expect(player(adapter)).toEqual(selected);
    adapter.dispose(); adapter.dispatch(preview); expect(adapter.getInitialState()).toEqual([]);
  });
});

describe("source preview selection", () => {
  function selected(female = false) {
    const name = female ? "FFighter" : "MFighter";
    const id = `interlude:assembly:${name}-native-body-face0-hair0`;
    const asset = { manifest: { id, source: { edition: "interlude", object: `Fighter.${name}_m001_u`,
      sha256: "8a22d41ceaa78d52a10b856b923462eb8eb08d61b203d0d7904e464857ae988c" } } } as AssetPackage;
    const coverage: NativeActionCueCoverage[] = [{ assetId: id, clip: `SpAtk01_1HS_${name}`, admitted: 4, uncovered: [] }];
    return { asset, coverage };
  }
  it.each([false, true])("uses only exact active fighter identity and fully admitted direct cues: female=%s", female => {
    const { asset, coverage } = selected(female);
    expect(resolveNativeSpecialAttackPreview(asset, coverage)).toEqual({ clip: coverage[0]!.clip, reason: null });
    expect(resolveNativeSpecialAttackPreview(asset, []).clip).toBeNull();
    expect(resolveNativeSpecialAttackPreview(asset, [...coverage, ...coverage]).clip).toBeNull();
    expect(resolveNativeSpecialAttackPreview(asset, [{ ...coverage[0]!, admitted: 3 }]).clip).toBeNull();
    expect(resolveNativeSpecialAttackPreview(asset, [{ ...coverage[0]!, clip: "Atk01_Hand_MFighter" }]).clip).toBeNull();
  });
  it("rejects another source/assembly without substituting an animation", () => {
    for (const field of ["sha256", "object", "edition"] as const) {
      const { asset, coverage } = selected();
      const altered = structuredClone(asset); Object.assign(altered.manifest.source, { [field]: "changed" });
      expect(resolveNativeSpecialAttackPreview(altered, coverage).clip).toBeNull();
    }
    const { asset, coverage } = selected(); asset.manifest.id = "other";
    expect(resolveNativeSpecialAttackPreview(asset, coverage).clip).toBeNull();
  });
});

describe("native visual source-action selection and lifetime", () => {
  async function create() {
    const engine = new NullEngine(), scene = new Scene(engine); GetEnvironmentBRDFTexture(scene);
    releases.push(() => { scene.dispose(); engine.dispose(); });
    const asset = await nativeVisualFixture({ skinned: true });
    const entity: WorldEntity = { id: "fixture", kind: "local-player", appearanceId: "fixture", displayName: "Fixture",
      health: 100, maximumHealth: 100, animation: "idle", position: { x: 2, y: 3, z: 4 }, orientationRadians: .2 };
    const visual = nativeCharacterFactory(new Map([["fixture", { asset,
      clips: { ...nativeVisualClips, specialAttack: nativeVisualClips.run } }]]))(scene, entity);
    releases.push(() => visual.dispose()); await visual.ready;
    function update(next: WorldEntity, retrigger = false) { visual.setEntity(next); visual.animation.setState(next.animation, retrigger); }
    return { visual, entity, update, scene };
  }
  it("plays the selected source once, returns to idle and retains normal attack mapping", async () => {
    const { visual, entity, update, scene } = await create();
    const keys = () => scene.animationGroups.map(group => group.targetedAnimations.map(channel => channel.animation.serialize()));
    const beforeKeys = keys();
    const action = { ...entity, animation: "attack", actionPreview: "special-attack" } as const;
    update(action, true); visual.animation.update(.5);
    expect(visual.animation.playback).toMatchObject({ activeClip: nativeVisualClips.run, looping: false, frame: 30 });
    update(action); expect(visual.animation.playback?.frame).toBe(30);
    visual.animation.update(2); expect(visual.animation.playback?.activeClip).toBe(nativeVisualClips.idle);
    update({ ...action, equipment: {} });
    expect(visual.animation.playback?.activeClip).toBe(nativeVisualClips.idle);
    update(action, true); expect(visual.animation.playback).toMatchObject({ activeClip: nativeVisualClips.run, frame: 0 });
    update({ ...entity, animation: "attack" }, true);
    expect(visual.animation.playback).toMatchObject({ activeClip: nativeVisualClips.attack, looping: false });
    expect(keys()).toEqual(beforeKeys);
  });
  it("interrupts with locomotion/death and does not replay the action on revival", async () => {
    const { visual, entity, update } = await create();
    const action = { ...entity, animation: "attack", actionPreview: "special-attack" } as const;
    update(action, true); visual.animation.update(.25); update({ ...entity, animation: "run" });
    expect(visual.animation.playback).toMatchObject({ activeClip: nativeVisualClips.run, looping: true });
    update(action, true); update({ ...action, health: 0 });
    expect(visual.animation.playback).toMatchObject({ activeClip: nativeVisualClips.death, looping: false });
    visual.animation.update(3); update(action);
    expect(visual.animation.playback?.activeClip).toBe(nativeVisualClips.idle);
    update(action, true); expect(visual.animation.playback).toMatchObject({ activeClip: nativeVisualClips.run, frame: 0 });
    visual.dispose(); expect(visual.root.isDisposed()).toBe(true);
  });
});
