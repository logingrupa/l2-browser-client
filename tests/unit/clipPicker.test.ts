import { describe, expect, it } from "vitest";
import type { ActorClipEvent } from "../../src/assets/native/actorClipEvents";
import type { ActorClip, ActorClipPlayer } from "../../src/animation/actorClipPlayback";
import { createNativeClipPreviewHub } from "../../src/assets/native/nativeClipPreview";
import { fire } from "./support/miniDom";
import { createPickerHarness, type MountedPicker } from "./support/sandboxPickerHarness";

const harness = createPickerHarness();

function fakeClipPlayer(clips: readonly ActorClip[], eventsWithoutClip: readonly ActorClipEvent[] = []): ActorClipPlayer {
  let previewing: string | null = null;
  return {
    play: clipName => { previewing = clipName; },
    get previewing() { return previewing; },
    listing: { clips, eventsWithoutClip },
  };
}

function namedClips(names: readonly string[]): ActorClip[] {
  return names.map((name, position) => ({ name, durationSeconds: position + 1, events: [] }));
}

function chooseActor(picker: MountedPicker, entityId: string): void {
  const select = picker.byTestId("sandbox-clips-actor")!.querySelector("select")!;
  select.value = entityId;
  fire(select, "change");
}

describe("clip picker", () => {
  it("dispatches exactly one play-clip with the chosen actor and the exact clip name", () => {
    const clipHub = createNativeClipPreviewHub();
    clipHub.register("npc-20001-1", fakeClipPlayer(namedClips(["ClipOne", "ClipTwo"])));
    const picker = harness.mountPicker("clips", { clipHub });
    chooseActor(picker, "npc-20001-1");
    picker.byTestId("sandbox-clips-clip-1")!.click();
    expect(picker.fakeHost.dispatched).toEqual([{ type: "play-clip", entityId: "npc-20001-1", clipName: "ClipTwo" }]);
  });

  it("shows a note and dispatches nothing when no loaded actor has clips", () => {
    const picker = harness.mountPicker("clips");
    expect(picker.note("sandbox-clips-note")).toBe("No loaded actor has clips.");
    expect(picker.byTestId("sandbox-clips-actor")!.hidden).toBe(true);
    expect(picker.byTestId("sandbox-clips-clip-0")).toBeNull();
    expect(picker.fakeHost.dispatched).toEqual([]);
  });

  it("names an actor with an empty listing and dispatches nothing", () => {
    const clipHub = createNativeClipPreviewHub();
    clipHub.register("npc-20001-1", fakeClipPlayer([]));
    const picker = harness.mountPicker("clips", { clipHub });
    expect(picker.note("sandbox-clips-note")).toBe("npc-20001-1 has no clips.");
    expect(picker.byTestId("sandbox-clips-clip-0")).toBeNull();
    expect(picker.fakeHost.dispatched).toEqual([]);
  });

  it("lists actors in hub registration order and clips in package order across rereads", () => {
    const clipHub = createNativeClipPreviewHub();
    clipHub.register("local-player", fakeClipPlayer(namedClips(["ClipThree", "ClipOne", "ClipTwo"])));
    clipHub.register("npc-20001-1", fakeClipPlayer(namedClips(["ClipTwo"])));
    const picker = harness.mountPicker("clips", { clipHub });
    const clipTexts = () => [0, 1, 2].map(position => picker.byTestId(`sandbox-clips-clip-${position}`)?.textContent ?? null);
    expect(picker.optionTexts("sandbox-clips-actor")).toEqual(["local-player", "npc-20001-1"]);
    expect(clipTexts()).toEqual(["ClipThree", "ClipOne", "ClipTwo"]);
    picker.byTestId("sandbox-clips-reread")!.click();
    expect(picker.optionTexts("sandbox-clips-actor")).toEqual(["local-player", "npc-20001-1"]);
    expect(clipTexts()).toEqual(["ClipThree", "ClipOne", "ClipTwo"]);
  });

  it("picks up an actor registered after attach when the listings are reread", () => {
    const clipHub = createNativeClipPreviewHub();
    const picker = harness.mountPicker("clips", { clipHub });
    clipHub.register("npc-20001-1", fakeClipPlayer(namedClips(["ClipOne"])));
    picker.byTestId("sandbox-clips-reread")!.click();
    expect(picker.byTestId("sandbox-clips-note")).toBeNull();
    expect(picker.optionTexts("sandbox-clips-actor")).toEqual(["npc-20001-1"]);
    expect(picker.byTestId("sandbox-clips-clip-0")!.textContent).toBe("ClipOne");
  });

  it("plays a shared clip name only on the chosen actor", () => {
    const clipHub = createNativeClipPreviewHub();
    clipHub.register("npc-20001-1", fakeClipPlayer(namedClips(["ClipOne"])));
    clipHub.register("npc-20001-2", fakeClipPlayer(namedClips(["ClipOne"])));
    const picker = harness.mountPicker("clips", { clipHub });
    chooseActor(picker, "npc-20001-2");
    picker.byTestId("sandbox-clips-clip-0")!.click();
    expect(picker.fakeHost.dispatched).toEqual([{ type: "play-clip", entityId: "npc-20001-2", clipName: "ClipOne" }]);
    expect(clipHub.previewing("npc-20001-2")).toBe("ClipOne");
    expect(clipHub.previewing("npc-20001-1")).toBeNull();
  });

  it("shows a clip name with markup characters as text and dispatches it unchanged", () => {
    const markupClipName = " <img src=x onerror=alert(1)>&amp; Clip ";
    const clipHub = createNativeClipPreviewHub();
    clipHub.register("npc-20001-1", fakeClipPlayer(namedClips([markupClipName])));
    const picker = harness.mountPicker("clips", { clipHub });
    const clipButton = picker.byTestId("sandbox-clips-clip-0")!;
    expect(clipButton.textContent).toBe(markupClipName);
    expect(clipButton.querySelectorAll("img")).toEqual([]);
    clipButton.click();
    expect(picker.fakeHost.dispatched).toEqual([{ type: "play-clip", entityId: "npc-20001-1", clipName: markupClipName }]);
  });

  it("describes each clip with its native name, duration and events and the previewing clip as presentation", () => {
    const clipEvent = (clip: string, normalizedTime: number, type: string, sound: string | null, ordinal: number): ActorClipEvent => ({
      ordinal, animationSet: "set", clip, normalizedTime, timeSeconds: normalizedTime, type, notifyObject: "object", notifyFunction: "function",
      sound, properties: {}, sourceFrames: 1, sourceRate: 1,
    });
    const clipHub = createNativeClipPreviewHub();
    clipHub.register("npc-20001-1", fakeClipPlayer(
      [{ name: "ClipOne", durationSeconds: 1.25, events: [clipEvent("ClipOne", 0.25, "EventTypeOne", "SoundOne", 0), clipEvent("ClipOne", 0.5, "EventTypeTwo", null, 1)] },
        { name: "ClipTwo", durationSeconds: 2, events: [] }],
      [clipEvent("ClipGone", 0.1, "EventTypeOne", "SoundTwo", 2)],
    ));
    const picker = harness.mountPicker("clips", { clipHub });
    picker.byTestId("sandbox-clips-clip-0")!.click();
    const variablesOf = (position: number) => Object.fromEntries(picker.variables(`sandbox-clips-clip-${position}`).map(variable => [variable.name, variable]));
    const first = variablesOf(0);
    expect(first["clip.name"]?.value()).toBe("ClipOne");
    expect(first["clip.durationSeconds"]?.value()).toBe("1.25");
    expect(first["clip.events"]?.value()).toBe("0.25 EventTypeOne SoundOne; 0.5 EventTypeTwo no sound");
    expect(first["clips.eventsWithoutClip"]?.value()).toBe("1");
    expect(first["clips.previewing"]?.value()).toBe("ClipOne");
    for (const name of ["clip.name", "clip.durationSeconds", "clip.events", "clips.eventsWithoutClip"]) expect(first[name]?.status).toBe("native");
    expect(first["clips.previewing"]?.status).toBe("presentation");
    const second = variablesOf(1);
    expect(second["clip.events"]?.value()).toBe("none");
    expect(second["clips.previewing"]?.value()).toBe("ClipOne");
  });
});
