import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { GetEnvironmentBRDFTexture } from "@babylonjs/core/Misc/brdfTextureTools";
import { nativeCharacterFactory } from "../../src/assets/native/NativeCharacterVisual";
import { createNativeClipPreviewHub } from "../../src/assets/native/nativeClipPreview";
import type { AssetPackage } from "../../src/assets/package/readAssetPackage";
import type { CharacterVisual } from "../../src/assets/CharacterVisual";
import type { WorldEntity } from "../../src/world/worldTypes";
import { nativeVisualClips, nativeVisualFixture } from "../fixtures/nativeVisualFixture";

const initial: WorldEntity = { id: "fixture-evented-actor", kind: "monster", displayName: "Fixture evented actor", appearanceId: "fixture",
  health: 100, maximumHealth: 100, position: { x: 0, y: 0, z: 0 }, orientationRadians: 0, animation: "idle" };

function syntheticEvent(normalizedTime: number, notifyObject: string) {
  return { animationSet: "Fixture.FixtureAnimations", clip: nativeVisualClips.attack, timeSeconds: normalizedTime * 2, normalizedTime,
    type: "FixtureNotifyClass", object: notifyObject, properties: {}, sound: null, function: "None", sourceFrames: 60, sourceRate: 30,
    timingBasis: "synthetic fixture timing basis" };
}

async function eventedFixtureAsset(): Promise<AssetPackage> {
  const asset = await nativeVisualFixture();
  return { ...asset, manifest: { ...asset.manifest, animationEvents: [syntheticEvent(.25, "Fixture.FirstNotify"), syntheticEvent(.75, "Fixture.SecondNotify")] } };
}

describe("actor clip playback from asset.json events through the clip hub", () => {
  let engine: NullEngine, scene: Scene, visuals: CharacterVisual[];
  beforeEach(() => { engine = new NullEngine(); scene = new Scene(engine); GetEnvironmentBRDFTexture(scene); visuals = []; });
  afterEach(() => { for (const visual of visuals) visual.dispose(); scene.dispose(); engine.dispose(); });

  it("lists a loaded actor's evented clip and plays it once through the hub", async () => {
    const hub = createNativeClipPreviewHub();
    const visual = nativeCharacterFactory(new Map([["fixture", { asset: await eventedFixtureAsset(), clips: nativeVisualClips }]]), undefined, undefined, hub)(scene, initial);
    visuals.push(visual);
    expect(hub.actorClipEntityIds()).toEqual([]);
    expect(hub.actorClipListing(initial.id)).toBeNull();
    await visual.ready;
    expect(hub.actorClipEntityIds()).toEqual([initial.id]);
    const listing = hub.actorClipListing(initial.id)!;
    expect(listing.clips.map(clip => clip.name)).toEqual(Object.values(nativeVisualClips));
    const attack = listing.clips.find(clip => clip.name === nativeVisualClips.attack)!;
    expect(attack.durationSeconds).toBe(2);
    expect(attack.events.map(event => [event.ordinal, event.notifyObject, event.normalizedTime, event.timeSeconds])).toEqual([
      [0, "Fixture.FirstNotify", .25, .5], [1, "Fixture.SecondNotify", .75, 1.5]]);
    expect(listing.eventsWithoutClip).toEqual([]);
    expect(hub.play(initial.id, nativeVisualClips.attack)).toBeNull();
    expect(visual.animation.playback?.activeClip).toBe(nativeVisualClips.attack);
    expect(visual.animation.playback?.looping).toBe(false);
    expect(hub.previewing(initial.id)).toBe(nativeVisualClips.attack);
    visual.dispose();
    expect(hub.actorClipEntityIds()).toEqual([]);
    expect(hub.actorClipListing(initial.id)).toBeNull();
  });
});
