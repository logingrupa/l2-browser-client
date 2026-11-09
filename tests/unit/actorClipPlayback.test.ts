import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { GetEnvironmentBRDFTexture } from "@babylonjs/core/Misc/brdfTextureTools";
import { nativeCharacterFactory } from "../../src/assets/native/NativeCharacterVisual";
import { createNativeClipPreviewHub } from "../../src/assets/native/nativeClipPreview";
import { parseActorClipEvents } from "../../src/assets/native/actorClipEvents";
import { listActorClips, playActorClip, type ActorClipListing, type ActorClipPlayer } from "../../src/animation/actorClipPlayback";
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

function eventOn(clip: string, normalizedTime: number, timeSeconds = normalizedTime * 2) {
  return { ...syntheticEvent(normalizedTime, `Fixture.NotifyAt${normalizedTime}`), clip, timeSeconds };
}

const loadedClips = [{ name: "Fixture_Wait", durationSeconds: 2 }, { name: "Fixture_Attack", durationSeconds: 1.5 }, { name: "Fixture_Cast", durationSeconds: 3 }];

function recordingPlayer(listing: ActorClipListing) {
  const played: string[] = [];
  const player: ActorClipPlayer = { play: clipName => { played.push(clipName); }, previewing: null, listing };
  return { player, played };
}

describe("actor clip listing and play rules", () => {
  it("keeps loaded clip order and sorts events by normalized time with ties in ordinal order", () => {
    const events = parseActorClipEvents([eventOn("Fixture_Cast", .5), eventOn("Fixture_Attack", .9), eventOn("Fixture_Cast", .25),
      eventOn("Fixture_Cast", .5), eventOn("Fixture_Attack", .1)]);
    const listing = listActorClips(loadedClips, events);
    expect(listing.clips.map(clip => clip.name)).toEqual(["Fixture_Wait", "Fixture_Attack", "Fixture_Cast"]);
    expect(listing.clips.map(clip => clip.events.map(event => event.ordinal))).toEqual([[], [4, 1], [2, 0, 3]]);
    expect(listing.clips[2]?.events.map(event => event.normalizedTime)).toEqual([.25, .5, .5]);
    expect(listActorClips(loadedClips, events)).toEqual(listing);
  });

  it("keeps clip-end events at normalized time 0 and exactly 1 with their source seconds", () => {
    const listing = listActorClips(loadedClips, parseActorClipEvents([eventOn("Fixture_Attack", 1, 1.49), eventOn("Fixture_Attack", 0, 0)]));
    expect(listing.clips[1]?.events.map(event => [event.ordinal, event.normalizedTime, event.timeSeconds])).toEqual([[1, 0, 0], [0, 1, 1.49]]);
  });

  it("lists every clip with an empty event list when the asset has no events", () => {
    const listing = listActorClips(loadedClips, parseActorClipEvents(undefined));
    expect(listing.clips.map(clip => [clip.name, clip.durationSeconds, clip.events])).toEqual([
      ["Fixture_Wait", 2, []], ["Fixture_Attack", 1.5, []], ["Fixture_Cast", 3, []]]);
    expect(listing.eventsWithoutClip).toEqual([]);
  });

  it("lists nothing for an actor with zero clips and refuses every clip name", () => {
    const listing = listActorClips([], parseActorClipEvents(undefined)), { player, played } = recordingPlayer(listing);
    expect(listing).toEqual({ clips: [], eventsWithoutClip: [] });
    expect(playActorClip(player, "Fixture_Wait")).toBe("Fixture_Wait is not a clip of this package.");
    expect(playActorClip(player, "")).toBe(" is not a clip of this package.");
    expect(played).toEqual([]);
  });

  it("keeps an event whose clip is not loaded in eventsWithoutClip with its ordinal", () => {
    const listing = listActorClips(loadedClips, parseActorClipEvents([eventOn("Fixture_Wait", .5), eventOn("Fixture_Unloaded", .5)]));
    expect(listing.eventsWithoutClip.map(event => [event.ordinal, event.clip])).toEqual([[1, "Fixture_Unloaded"]]);
    expect(listing.clips.flatMap(clip => clip.events).map(event => event.ordinal)).toEqual([0]);
  });

  it("joins and plays clip names only by exact string equality", () => {
    const composed = "Fixture_Café", decomposed = "Fixture_Café";
    const clips = [{ name: "Fixture_Attack", durationSeconds: 1 }, { name: composed, durationSeconds: 1 }];
    const listing = listActorClips(clips, parseActorClipEvents([eventOn("fixture_attack", .5), eventOn("Fixture_Attack ", .5), eventOn(decomposed, .5)]));
    expect(listing.clips.map(clip => clip.events.length)).toEqual([0, 0]);
    expect(listing.eventsWithoutClip.map(event => event.ordinal)).toEqual([0, 1, 2]);
    const { player, played } = recordingPlayer(listing);
    for (const spelling of ["fixture_attack", "FIXTURE_ATTACK", "Fixture_Attack ", " Fixture_Attack", decomposed]) {
      expect(playActorClip(player, spelling)).toBe(`${spelling} is not a clip of this package.`);
    }
    expect(playActorClip(player, composed)).toBeNull();
    expect(played).toEqual([composed]);
  });

  it("refuses a loaded clip list that names one clip twice", () => {
    expect(() => listActorClips([...loadedClips, { name: "Fixture_Attack", durationSeconds: 1.5 }], [])).toThrow("Fixture_Attack");
  });

  it("returns the refusal for an actor that has not loaded and the player's own error", () => {
    const listing = listActorClips(loadedClips, []);
    expect(playActorClip(undefined, "Fixture_Wait")).toBe("The native model has not loaded yet.");
    const failing: ActorClipPlayer = { play: () => { throw new Error("Fixture player refused."); }, previewing: null, listing };
    expect(playActorClip(failing, "Fixture_Wait")).toBe("Fixture player refused.");
    const throwingText: ActorClipPlayer = { play: () => { throw "fixture"; }, previewing: null, listing };
    expect(playActorClip(throwingText, "Fixture_Wait")).toBe("The clip could not be played.");
  });

  it("lists and plays a clip without running the event's notify function", () => {
    const marker = "actorClipPlaybackFunctionWasExecuted";
    const listing = listActorClips(loadedClips, parseActorClipEvents([{ ...eventOn("Fixture_Cast", .5), function: `globalThis.${marker} = true` }]));
    const { player, played } = recordingPlayer(listing);
    expect(playActorClip(player, "Fixture_Cast")).toBeNull();
    expect(played).toEqual(["Fixture_Cast"]);
    expect(listing.clips[2]?.events[0]?.notifyFunction).toBe(`globalThis.${marker} = true`);
    expect(marker in globalThis).toBe(false);
  });
});

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
    expect(hub.actorClipPlayer(initial.id)?.listing).toBe(listing);
    expect(hub.play(initial.id, nativeVisualClips.attack)).toBeNull();
    expect(visual.animation.playback?.activeClip).toBe(nativeVisualClips.attack);
    expect(visual.animation.playback?.looping).toBe(false);
    expect(hub.previewing(initial.id)).toBe(nativeVisualClips.attack);
    visual.dispose();
    expect(hub.actorClipEntityIds()).toEqual([]);
    expect(hub.actorClipPlayer(initial.id)).toBeUndefined();
    expect(hub.actorClipListing(initial.id)).toBeNull();
  });
});
