import { describe, expect, it } from "vitest";
import { createNativeEventAudio, nativeSoundEventsBetween, type NativeSoundEvent } from "../../src/assets/package/nativeEventAudio";
import type { AssetPackage } from "../../src/assets/package/readAssetPackage";

const events: NativeSoundEvent[] = [
  { clip: "Run_Hand_MFighter", timeSeconds: 0, sound: "ChrSound.start", resolvedFile: "audio/start.wav" },
  { clip: "Run_Hand_MFighter", timeSeconds: .5, sound: "ChrSound.breath", resolvedFile: "audio/breath.wav" },
  { clip: "Run_Hand_MFighter", timeSeconds: 1, sound: "ChrSound.end", resolvedFile: "audio/end.wav" },
];
describe("native notification audio", () => {
  it("keeps zero, end, repeated, and same-time events distinct without retriggering a boundary", () => {
    expect(nativeSoundEventsBetween(events, events[0]!.clip, 0, .6, 1, true).map(row => row.elapsedSeconds)).toEqual([0, .5]);
    const crossed = nativeSoundEventsBetween(events, events[0]!.clip, .6, 1, 1);
    expect(crossed.map(row => row.event.sound)).toEqual(["ChrSound.start", "ChrSound.end"]);
    expect(nativeSoundEventsBetween(events, events[0]!.clip, 1, 1.1, 1)).toEqual([]);
    expect(nativeSoundEventsBetween(events, "Other", 0, 1, 1, true)).toEqual([]);
    expect(() => nativeSoundEventsBetween(events, "Run", 0, Infinity, 1)).toThrow("clock");
  });
  it("bounds catch-up work after long suspension", () => {
    const crossed = nativeSoundEventsBetween(events, events[0]!.clip, 0, 1000000, 1, true);
    expect(crossed.length).toBeLessThanOrEqual(6);
    expect(crossed.every(row => row.elapsedSeconds >= 999998)).toBe(true);
  });
  it("opens audio only on enable, uses exact files, and releases active sound and context", async () => {
    let created = 0, stopped = 0, disconnected = 0, closed = 0, decoded = 0;
    const source = { buffer: null, onended: null, connect() {}, start() {}, stop() { stopped++; }, disconnect() { disconnected++; } };
    const context = { state: "running", currentTime: 0, destination: {}, resume: async () => {}, close: async () => { closed++; },
      decodeAudioData: async (bytes: ArrayBuffer) => { expect(new Uint8Array(bytes)).toEqual(new Uint8Array([1, 2, 3])); decoded++; return { duration: 2 }; }, createBufferSource: () => source };
    const asset = { manifest: { animationEvents: [events[0], { ...events[1], resolvedFile: "missing.wav" }], files: [{ path: "audio/start.wav", mime: "audio/wav" }] },
      files: new Map([["audio/start.wav", new Uint8Array([1, 2, 3])]]) } as unknown as AssetPackage;
    const audio = createNativeEventAudio(asset, () => { created++; return context as unknown as AudioContext; });
    expect(created).toBe(0); expect(audio.inspection().available).toBe(1);
    await audio.setEnabled(true);
    expect(created).toBe(1); expect(decoded).toBe(1);
    audio.advance(events[0]!.clip, 0, .01, 1);
    expect(audio.inspection().played).toBe(1);
    await audio.setEnabled(false);
    expect(stopped).toBe(1); expect(disconnected).toBe(1);
    audio.dispose(); audio.dispose();
    expect(closed).toBe(1);
  });
});
