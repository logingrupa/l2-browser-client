import { existsSync, readFileSync } from "node:fs";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { readAssetPackage, sha256, type AssetPackage } from "../../src/assets/package/readAssetPackage";
import { createNativeActionCuePreview, type NativeActionCuePreview, type NativeActionCuePreviewOptions } from "../../src/audio/nativeActionCuePreview";
import type { NativeActorClock } from "../../src/assets/native/NativeActor";
import type { WorldAudioPlaybackReceipt } from "../../src/audio/WorldAudioMixer";

const ids = { male: "human-male-fighter:0", female: "human-female-fighter:0", monster: "musveren:0" };
const hashes = { male: "678067311414990c82307a045f01b3da0cb083d2075ed927c83372ca647bd2d5",
  female: "ce3984dded01419ce9fc1ec1644ffe06346803f889d5925684d583a154015990",
  monster: "6b6f7d72b2f81bdcca2991bcc84b0eb908a689eadcda8bc7f9b94c78c290fd03" };
const paths = Object.fromEntries(Object.entries(hashes).map(([key, hash]) => [key, `public/l2/${hash}/asset.l2asset`])) as Record<keyof typeof hashes, string>;
const proofPath = "artifacts/native-parity/research/native-human-skill-audio-20261107/attack-source/DIRECT_SPECIAL_CUES.json";
const proofHash = "84565484fcb7bb70780996c19a62009ee74141af365cb430e248329737bbd369";
type Sex = "male" | "female";
interface ProofCue {
  archive: string; eventPointer: string; wavBytes: number; wavSha256: string;
  sourceClipBindingQualified: boolean; nativeEffectivePlaybackPolicyQualified: boolean;
  event: { clip: string; object: string; sound: string; timeSeconds: number; resolvedFile: string; properties: Record<string, unknown> };
}
const clip = (sex: Sex) => `SpAtk01_1HS_${sex === "male" ? "M" : "F"}Fighter`;
function clock(sex: Sex, elapsedSeconds: number, extra: Partial<NativeActorClock> = {}): NativeActorClock {
  return { clip: clip(sex), mode: "once", elapsedSeconds, durationSeconds: 47 / 30,
    playing: elapsedSeconds < 47 / 30, completed: elapsedSeconds >= 47 / 30, ...extra };
}
function handClock(sex: Sex, elapsedSeconds: number): NativeActorClock {
  const durationSeconds = (sex === "male" ? 43 : 46) / 30;
  return clock(sex, elapsedSeconds, { clip: `Atk01_Hand_${sex === "male" ? "M" : "F"}Fighter`, durationSeconds,
    playing: elapsedSeconds < durationSeconds, completed: elapsedSeconds >= durationSeconds });
}
function mixer() {
  let accepting = true, nextId = 0, maxOffset = Infinity;
  return { register: vi.fn<(key: string, bytes: Uint8Array) => void>(), stopOwner: vi.fn<(owner: string) => void>(),
    play: vi.fn((key: string, owner: string, offsetSeconds = 0): WorldAudioPlaybackReceipt | null => accepting && offsetSeconds <= maxOffset ?
      { id: ++nextId, key, owner, offsetSeconds, contextTime: 10, durationSeconds: 2 } : null),
    accept(value: boolean) { accepting = value; }, limitOffset(value: number) { maxOffset = value; } };
}
function changed(asset: AssetPackage): AssetPackage {
  return { manifest: structuredClone(asset.manifest), files: new Map(asset.files) };
}
async function replaceFile(asset: AssetPackage, path: string, bytes: Uint8Array) {
  (asset.files as Map<string, Uint8Array>).set(path, bytes);
  Object.assign(asset.manifest.files.find(row => row.path === path)!, { bytes: bytes.length, sha256: await sha256(bytes) });
}
const previews: NativeActionCuePreview[] = [];
afterEach(() => { for (const preview of previews) preview.dispose(); previews.length = 0; });

// Actual retained licensed packages are required in this workspace. Source-only
// skips explicitly do not establish cue or runtime playback evidence.
describe.skipIf(!existsSync(proofPath) || !Object.values(paths).every(existsSync))("opt-in human special-action source cues", () => {
  let assets: Map<string, AssetPackage>, proof: ProofCue[];
  const actor = (sex: Sex) => assets.get(ids[sex])!;
  const cues = (sex: Sex) => proof.filter(row => row.event.clip === clip(sex));
  beforeAll(async () => {
    const proofBytes = new Uint8Array(readFileSync(proofPath)); expect(await sha256(proofBytes)).toBe(proofHash);
    proof = JSON.parse(new TextDecoder().decode(proofBytes)).cues;
    expect(proof).toHaveLength(8); expect(new Set(proof.map(row => row.wavSha256)).size).toBe(7);
    assets = new Map();
    for (const key of ["male", "female", "monster"] as const) {
      const bytes = new Uint8Array(readFileSync(paths[key])); expect(await sha256(bytes)).toBe(hashes[key]);
      assets.set(ids[key], await readAssetPackage(bytes));
    }
    for (const sex of ["male", "female"] as const) for (const row of cues(sex)) {
      expect(row.archive).toBe(paths[sex]); expect(row.sourceClipBindingQualified).toBe(true); expect(row.nativeEffectivePlaybackPolicyQualified).toBe(false);
      const ordinal = Number(row.eventPointer.split("/").at(-1));
      expect(actor(sex).manifest.animationEvents![ordinal]).toEqual(row.event);
      const bytes = actor(sex).files.get(row.event.resolvedFile)!;
      expect(bytes.length).toBe(row.wavBytes); expect(await sha256(bytes)).toBe(row.wavSha256);
    }
  }, 60000);
  async function setup(options: NativeActionCuePreviewOptions = { activeCatalogIds: [ids.male, ids.female], includeHumanSpecialAttackCues: true }, custom = assets) {
    const output = mixer(), preview = await createNativeActionCuePreview(custom, output, options); previews.push(preview);
    return { output, preview };
  }

  it("requires explicit opt-in while preserving the legacy playable count", async () => {
    const { output, preview } = await setup({});
    expect(preview.inspection()).toMatchObject({ available: 9, diagnostics: [], nativeBackendVerified: false, policy: "source-cue-preview" });
    expect(output.register).toHaveBeenCalledTimes(9);
    expect(preview.inspection().coverage.some(row => row.clip.startsWith("SpAtk"))).toBe(false);
    const player = preview.bindActor("male", actor("male")); player.start(clock("male", 0)); player.advance(clock("male", 0), clock("male", 1.2));
    expect(output.play).not.toHaveBeenCalled();
  });

  it("keeps explicit false equivalent to omitted special-cue selection", async () => {
    const { preview } = await setup({ activeCatalogIds: [ids.male, ids.female], includeHumanSpecialAttackCues: false });
    expect(preview.inspection()).toMatchObject({ available: 8, diagnostics: [] });
    expect(preview.inspection().coverage.map(row => row.clip).filter(name => name.startsWith("SpAtk"))).toEqual([]);
  });

  it("admits all eight direct tuples and deduplicates shared WAV registration", async () => {
    const { preview, output } = await setup();
    expect(preview.inspection()).toMatchObject({ available: 16, diagnostics: [], nativeBackendVerified: false });
    expect(output.register).toHaveBeenCalledTimes(11);
    expect(new Set(output.register.mock.calls.map(([key]) => key)).size).toBe(11);
    for (const row of proof) expect(output.register.mock.calls.find(([key]) => key === `native-action:${row.wavSha256}`)?.[1]).toEqual(
      assets.get(row.archive.includes(hashes.male) ? ids.male : ids.female)!.files.get(row.event.resolvedFile));
    preview.bindActor("male-1", actor("male")); preview.bindActor("male-2", actor("male"));
    expect(output.register).toHaveBeenCalledTimes(11);
  });

  it("keeps all selected existing monster/death cues and filters inactive humans", async () => {
    const all = await setup({ activeCatalogIds: [ids.male, ids.female, ids.monster], includeHumanSpecialAttackCues: true });
    expect(all.preview.inspection()).toMatchObject({ available: 21, diagnostics: [] }); expect(all.output.register).toHaveBeenCalledTimes(16);
    const female = await setup({ activeCatalogIds: [ids.female, ids.monster, ids.female], includeHumanSpecialAttackCues: true });
    expect(female.preview.inspection()).toMatchObject({ available: 13, diagnostics: [] }); expect(female.output.register).toHaveBeenCalledTimes(12);
    expect(female.preview.inspection().coverage.some(row => row.assetId === actor("male").manifest.id)).toBe(false);
  });

  for (const sex of ["male", "female"] as const) {
    it(`${sex}: consumes each direct boundary once and keeps two specialized events uncovered`, async () => {
      const { preview, output } = await setup(), player = preview.bindActor(sex, actor(sex));
      const coverage = preview.inspection().coverage.find(row => row.clip === clip(sex))!;
      const raw = actor(sex).manifest.animationEvents!.filter(value => (value as Record<string, unknown>).clip === clip(sex)) as Record<string, unknown>[];
      expect(coverage.admitted).toBe(4);
      expect(coverage.uncovered.map(row => [row.notify, row.type, row.timeSeconds])).toEqual(
        raw.filter(row => row.type !== "AnimNotify_Sound").map(row => [row.object, row.type, row.timeSeconds]));
      expect(coverage.uncovered.map(row => row.type)).toEqual(["AnimNotify_AttackItem", "AnimNotify_AttackShot"]);
      let previous = 0; player.start(clock(sex, 0));
      for (const [index, row] of cues(sex).entries()) {
        const time = row.event.timeSeconds;
        player.advance(clock(sex, previous), clock(sex, time - 1e-9)); expect(output.play).toHaveBeenCalledTimes(index);
        player.advance(clock(sex, time - 1e-9), clock(sex, time)); expect(output.play).toHaveBeenCalledTimes(index + 1);
        player.advance(clock(sex, time), clock(sex, time)); expect(output.play).toHaveBeenCalledTimes(index + 1); previous = time;
      }
      output.stopOwner.mockClear(); player.advance(clock(sex, previous), clock(sex, 47 / 30));
      player.advance(clock(sex, 47 / 30), clock(sex, 47 / 30));
      expect(output.play).toHaveBeenCalledTimes(4); expect(output.stopOwner).not.toHaveBeenCalled();
      expect(preview.inspection().recent.map(row => [row.notify, row.sound, row.sourceTimeSeconds, row.offsetSeconds])).toEqual(
        cues(sex).map(row => [row.event.object, row.event.sound, row.event.timeSeconds, 0]));
    });

    it(`${sex}: reports six Hand gaps without substituting special-clip cues`, async () => {
      const { preview, output } = await setup(), player = preview.bindActor(sex, actor(sex));
      const coverage = preview.inspection().coverage.find(row => row.clip === handClock(sex, 0).clip)!;
      expect(coverage.admitted).toBe(0); expect(coverage.uncovered).toHaveLength(6);
      expect(coverage.uncovered.map(row => row.type)).toEqual(["AnimNotify_AttackVoice", "AnimNotify_AttackItem", "AnimNotify_AttackShot",
        "AnimNotify_AttackVoice", "AnimNotify_AttackItem", "AnimNotify_AttackShot"]);
      player.start(handClock(sex, 0)); player.advance(handClock(sex, 0), handClock(sex, 2));
      expect(output.play).not.toHaveBeenCalled(); expect(preview.inspection()).toMatchObject({ played: 0, dropped: 0 });
    });

    it(`${sex}: forwards exact late offsets without re-timing source onsets`, async () => {
      const { preview, output } = await setup(), player = preview.bindActor(sex, actor(sex));
      const time = cues(sex)[0]!.event.timeSeconds, end = time + .05;
      player.start(clock(sex, 0)); player.advance(clock(sex, 0), clock(sex, end));
      expect(output.play).toHaveBeenCalledExactlyOnceWith(`native-action:${cues(sex)[0]!.wavSha256}`, expect.any(String), end - time);
      expect(preview.inspection().recent[0]).toMatchObject({ sourceTimeSeconds: time, observedTimeSeconds: end, offsetSeconds: end - time, accepted: true });
    });

    it(`${sex}: consumes locked or stale output without replay until explicit retrigger`, async () => {
      const { preview, output } = await setup(), player = preview.bindActor(sex, actor(sex));
      const first = cues(sex)[0]!.event.timeSeconds, second = cues(sex)[1]!.event.timeSeconds;
      output.accept(false); player.start(clock(sex, 0)); player.advance(clock(sex, 0), clock(sex, .1));
      expect(preview.inspection()).toMatchObject({ played: 0, dropped: 1 }); output.accept(true);
      player.advance(clock(sex, .1), clock(sex, .2)); expect(output.play).toHaveBeenCalledTimes(1);
      output.limitOffset(.25); player.start(clock(sex, 0)); player.advance(clock(sex, 0), clock(sex, first + .251));
      expect(preview.inspection()).toMatchObject({ played: 0, dropped: 2 });
      player.advance(clock(sex, first + .251), clock(sex, second));
      expect(preview.inspection()).toMatchObject({ played: 1, dropped: 2 });
      player.start(clock(sex, 0)); player.advance(clock(sex, 0), clock(sex, first));
      expect(preview.inspection().recent.map(row => [row.generation, row.accepted])).toEqual([[1, false], [2, false], [2, true], [3, true]]);
    });

    it(`${sex}: stops the same owner on restart, Hand, idle, death and disposal`, async () => {
      const { preview, output } = await setup(), player = preview.bindActor(sex, actor(sex));
      const onset = cues(sex)[0]!.event.timeSeconds;
      player.start(clock(sex, 0)); player.advance(clock(sex, 0), clock(sex, onset));
      const owner = output.play.mock.calls[0]![1]; output.stopOwner.mockClear();
      player.start(clock(sex, 0)); player.advance(clock(sex, 0), clock(sex, onset));
      player.start(handClock(sex, 0)); player.advance(handClock(sex, 0), handClock(sex, 2));
      player.start(clock(sex, 0, { clip: "Wait", mode: "loop" }));
      player.start(clock(sex, 0, { clip: `Death_${sex === "male" ? "M" : "F"}Fighter`, durationSeconds: sex === "male" ? 51 / 15 : 41 / 16 }));
      player.dispose(); player.dispose(); player.start(clock(sex, 0)); player.advance(clock(sex, 0), clock(sex, 1));
      expect(output.play).toHaveBeenCalledTimes(2); expect(output.stopOwner).toHaveBeenCalledTimes(5);
      expect(output.stopOwner.mock.calls.every(([value]) => value === owner)).toBe(true);
      expect(preview.inspection().activeOwners).toBe(0);
    });

    it(`${sex}: consumes a paused clock crossing and rejects loop/nonzero-start clocks`, async () => {
      const { preview, output } = await setup(), player = preview.bindActor(sex, actor(sex));
      const first = cues(sex)[0]!.event.timeSeconds;
      player.start(clock(sex, 0)); player.advance(clock(sex, 0, { playing: false }), clock(sex, first, { playing: false }));
      expect(preview.inspection()).toMatchObject({ played: 0, dropped: 1 }); expect(output.play).not.toHaveBeenCalled();
      player.advance(clock(sex, first), clock(sex, .1)); expect(output.play).not.toHaveBeenCalled();
      player.start(clock(sex, .001)); player.advance(clock(sex, .001), clock(sex, .1));
      player.start(clock(sex, 0, { mode: "loop" })); player.advance(clock(sex, 0, { mode: "loop" }), clock(sex, .1, { mode: "loop" }));
      expect(output.play).not.toHaveBeenCalled();
    });
  }

  it.each(["animationSet", "type", "function", "timeSeconds", "normalizedTime", "sourceFrames", "sourceRate", "sound", "resolvedFile", "Sound", "Volume", "Radius", "Random"])(
    "rejects changed special tuple %s without changing other admitted cues", async field => {
      const copy = changed(actor("male")), original = cues("male")[0]!;
      const event = copy.manifest.animationEvents!.find(row => (row as Record<string, unknown>).object === original.event.object) as Record<string, unknown>;
      if (["Sound", "Volume", "Radius", "Random"].includes(field)) (event.properties as Record<string, unknown>)[field] = field === "Sound" ? "ChrSound.MHFighter_Preatk_1" : 1;
      else event[field] = typeof event[field] === "number" ? 1 : "changed";
      const selected = new Map(assets); selected.set(ids.male, copy);
      const { preview } = await setup(undefined, selected);
      expect(preview.inspection()).toMatchObject({ available: 15, diagnostics: [{ assetId: copy.manifest.id, clip: clip("male"),
        notify: original.event.object, reason: "Source notification tuple mismatch" }] });
    });

  it("rejects missing and duplicate direct notifications instead of applying aliases", async () => {
    const copy = changed(actor("female")), names = cues("female").map(row => row.event.object);
    const events = copy.manifest.animationEvents!;
    events.splice(events.findIndex(value => (value as Record<string, unknown>).object === names[0]), 1);
    events.push(events.find(value => (value as Record<string, unknown>).object === names[1]));
    const selected = new Map(assets); selected.set(ids.female, copy);
    const { preview } = await setup(undefined, selected);
    expect(preview.inspection().available).toBe(14);
    expect(preview.inspection().diagnostics.map(row => [row.notify, row.reason])).toEqual(names.slice(0, 2).map(name => [name, "Missing or ambiguous source notification"]));
  });

  it("rejects a rewritten payload even with updated internal file metadata", async () => {
    const copy = changed(actor("female")), original = cues("female")[0]!, path = original.event.resolvedFile;
    const bytes = copy.files.get(path)!.slice(); bytes[bytes.length - 1]! ^= 1; await replaceFile(copy, path, bytes);
    const selected = new Map(assets); selected.set(ids.female, copy);
    const { preview } = await setup(undefined, selected);
    expect(preview.inspection()).toMatchObject({ available: 15, diagnostics: [expect.objectContaining({ notify: original.event.object, reason: "Pinned audio payload mismatch" })] });
  });

  it("rejects internally consistent but rewritten UAX provenance", async () => {
    const copy = changed(actor("female")), original = cues("female")[1]!, path = "provenance.json";
    const value = JSON.parse(new TextDecoder().decode(copy.files.get(path)));
    value.metadata.eventAudio[original.event.sound].sourceObject = "itemsound.Weapon_Fist.fist_1";
    await replaceFile(copy, path, new TextEncoder().encode(JSON.stringify(value)));
    const selected = new Map(assets); selected.set(ids.female, copy);
    const { preview } = await setup(undefined, selected);
    expect(preview.inspection()).toMatchObject({ available: 15, diagnostics: [expect.objectContaining({ notify: original.event.object, reason: "Source audio provenance mismatch" })] });
  });

  it("does not admit an unsupported clip or copied asset instance", async () => {
    const { preview, output } = await setup();
    const wrong = preview.bindActor("copy", changed(actor("male"))); wrong.start(clock("male", 0)); wrong.advance(clock("male", 0), clock("male", 1));
    const player = preview.bindActor("actual", actor("male"));
    player.start(clock("male", 0, { clip: "SpAtk02_1HS_MFighter" }));
    player.advance(clock("male", 0, { clip: "SpAtk02_1HS_MFighter" }), clock("male", 1, { clip: "SpAtk02_1HS_MFighter" }));
    expect(output.play).not.toHaveBeenCalled();
    expect(preview.inspection().diagnostics.at(-1)?.reason).toContain("No verified action-cue source");
  });
});
