import { describe, expect, it, vi } from "vitest";
import type { AssetPackage } from "../../src/assets/package/readAssetPackage";
import type { NativeActorClock } from "../../src/assets/native/NativeActor";
import { createNativeFootstepPreview, NATIVE_FOOTSTEP_WORLD_DEFAULT } from "../../src/audio/nativeFootstepPreview";
import type { WorldAudioPlaybackReceipt } from "../../src/audio/WorldAudioMixer";
import type { WorldGroundContact } from "../../src/world/WorldNavigation";

const asset = { manifest: { id: "synthetic:contact" }, files: new Map() } as unknown as AssetPackage;
const clock = (time: number): NativeActorClock => ({ clip: "Run", mode: "loop", durationSeconds: 1,
  elapsedSeconds: time, playing: true, completed: false });
const contact = (z: number): WorldGroundContact => ({ queryPosition: { x: 0, y: 0, z }, position: { x: 0, y: .2, z },
  controllingSample: 0, samples: [{ meshId: "local floor", meshUniqueId: 17, meshName: "not-a-sound-category",
    indexOffset: 3, triangleIndex: 1, position: { x: 0, y: .2, z } }] });

describe("footstep accepted-movement contact observation", () => {
  it("pins the dispatch-time accepted support without selecting a sound or replaying earlier contact", () => {
    let current: WorldGroundContact | null = null;
    const support = vi.fn(() => current), play = vi.fn((key: string, owner: string, offsetSeconds: number): WorldAudioPlaybackReceipt =>
      ({ id: 1, key, owner, offsetSeconds, contextTime: 10, durationSeconds: 1 }));
    const preview = createNativeFootstepPreview([{ asset, clip: "Run", durationSeconds: 1, gait: "run",
      events: [{ ordinal: 7, notify: "Fixture.Notify", timeSeconds: .25,
        arrays: { DefaultRunSound: [{ reference: "Fixture.Sound", key: "original" }] } }] }],
    { play, stopOwner: vi.fn() }, { groundContact: support });
    try {
      const actor = preview.bindActor("local-player", asset); actor.start(clock(0)); actor.advance(clock(0), clock(.3));
      expect(preview.inspection().recent[0]).toMatchObject({ groundContact: null, reason: "disabled", key: null });
      current = contact(1);
      actor.advance(clock(.3), clock(1.3));
      expect(play).not.toHaveBeenCalled();
      const second = preview.inspection().recent[1]!;
      expect(second.groundContact).toEqual(current);
      expect(second).toMatchObject({ occurrenceTimeSeconds: 1.25, reason: "disabled", property: null });
      // The observer and inspection caller cannot rewrite historical evidence.
      (current.position as { z: number }).z = 99;
      (second.groundContact!.samples[0]!.position as { z: number }).z = 88;
      expect(preview.inspection().recent[1]!.groundContact!.position.z).toBe(1);
      expect(preview.inspection().recent[1]!.groundContact!.samples[0]!.position.z).toBe(1);
      current = contact(2); preview.setSurfaceSelection(NATIVE_FOOTSTEP_WORLD_DEFAULT);
      actor.advance(clock(1.3), clock(2.3));
      expect(play).toHaveBeenCalledTimes(1);
      expect(play.mock.calls[0]![0]).toBe("original");
      expect(preview.inspection().recent.at(-1)).toMatchObject({ reason: "played", groundContact: contact(2), occurrenceTimeSeconds: 2.25 });
      expect(support.mock.calls).toEqual([["local-player"], ["local-player"], ["local-player"]]);
      actor.advance(clock(2.3), clock(2.3)); expect(support).toHaveBeenCalledTimes(3);
      expect(preview.inspection().nativeBackendVerified).toBe(false);
    } finally { preview.dispose(); }
  });
});
