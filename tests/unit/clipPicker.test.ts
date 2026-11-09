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
});
