import { existsSync, readFileSync } from "node:fs";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { readAssetPackage, sha256, type AssetPackage } from "../../src/assets/package/readAssetPackage";
import { createNativeActionCuePreview, type NativeActionCuePreview } from "../../src/audio/nativeActionCuePreview";
import type { NativeActorClock } from "../../src/assets/native/NativeActor";
import type { WorldAudioPlaybackReceipt } from "../../src/audio/WorldAudioMixer";

const femaleId = "human-female-fighter:0", maleId = "human-male-fighter:0", monsterId = "musveren:0";
const femaleHash = "ce3984dded01419ce9fc1ec1644ffe06346803f889d5925684d583a154015990";
const femalePath = `artifacts/native-parity/research/native-ffighter-expansion-20261107/build-corrected/jobs/human-female-fighter/${femaleHash}/asset.l2asset`;
const maleHash = "678067311414990c82307a045f01b3da0cb083d2075ed927c83372ca647bd2d5";
const monsterHash = "6b6f7d72b2f81bdcca2991bcc84b0eb908a689eadcda8bc7f9b94c78c290fd03";
const malePath = `public/l2/${maleHash}/asset.l2asset`, monsterPath = `public/l2/${monsterHash}/asset.l2asset`;
const deathTimes = [0.21250000735744834, 0.4250000147148967, 1.1000000201165676, 2.1812500581145287];
const deathSounds = ["MonSound2.heltor_silenos.h_silenos_wait_alt_1", "ChrSound.FHFighter_Basic_Action.FHFighter_Death",
  "ChrSound.Character_Public.Death_Fall_Knee", "ChrSound.Character_Public.Death_Fall_Light"];
const attackEvents = [
  ["Fighter.AnimNotify_AttackVoice21", "AnimNotify_AttackVoice", 0.2833333343267441],
  ["Fighter.AnimNotify_AttackItem47", "AnimNotify_AttackItem", 0.34666664799054464],
  ["Fighter.AnimNotify_AttackShot58", "AnimNotify_AttackShot", 0.3966666360696157],
  ["Fighter.AnimNotify_AttackVoice22", "AnimNotify_AttackVoice", 0.7133333186308544],
  ["Fighter.AnimNotify_AttackItem48", "AnimNotify_AttackItem", 0.796666677792867],
  ["Fighter.AnimNotify_AttackShot59", "AnimNotify_AttackShot", 0.8900000254313152],
];
function mixer() {
  let accepting = true, serial = 0;
  return { register: vi.fn<(key: string, bytes: Uint8Array) => void>(), stopOwner: vi.fn<(owner: string) => void>(),
    play: vi.fn((key: string, owner: string, offsetSeconds = 0): WorldAudioPlaybackReceipt | null => accepting ?
      { id: ++serial, key, owner, offsetSeconds, contextTime: 10, durationSeconds: 4 } : null),
    accept(value: boolean) { accepting = value; } };
}
function clock(elapsedSeconds: number, attack = false, extra: Partial<NativeActorClock> = {}): NativeActorClock {
  const durationSeconds = attack ? 46 / 30 : 41 / 16;
  return { clip: attack ? "Atk01_Hand_FFighter" : "Death_FFighter", mode: "once", elapsedSeconds, durationSeconds,
    playing: elapsedSeconds < durationSeconds, completed: elapsedSeconds >= durationSeconds, ...extra };
}
function changed(asset: AssetPackage): AssetPackage {
  return { manifest: structuredClone(asset.manifest), files: new Map(asset.files) };
}
const previews: NativeActionCuePreview[] = [];
afterEach(() => { for (const preview of previews) preview.dispose(); previews.length = 0; });

// Original packages stay local. These cases must run without skips in the
// implementation workspace; source-only checkout skips are not playback proof.
describe.skipIf(!existsSync(femalePath))("female source action cue selection and timing", () => {
  let female: AssetPackage;
  beforeAll(async () => {
    const bytes = new Uint8Array(readFileSync(femalePath));
    expect(await sha256(bytes)).toBe(femaleHash); female = await readAssetPackage(bytes);
  });
  async function setup(asset = female, activeCatalogIds: readonly string[] = [femaleId]) {
    const output = mixer();
    const preview = await createNativeActionCuePreview(new Map([[femaleId, asset]]), output, { activeCatalogIds });
    previews.push(preview); return { preview, output };
  }

  it("admits four original death cues, records six uncovered attack events, and excludes absent male diagnostics", async () => {
    const { preview, output } = await setup();
    expect(preview.inspection()).toMatchObject({ available: 4, diagnostics: [], policy: "source-cue-preview", nativeBackendVerified: false });
    expect(output.register).toHaveBeenCalledTimes(4);
    expect(preview.inspection().coverage).toHaveLength(2);
    expect(preview.inspection().coverage[0]).toMatchObject({ clip: "Death_FFighter", admitted: 4, uncovered: [] });
    expect(preview.inspection().coverage[1]).toMatchObject({ clip: "Atk01_Hand_FFighter", admitted: 0 });
    expect(preview.inspection().coverage[1]!.uncovered.map(event => [event.notify, event.type, event.timeSeconds])).toEqual(attackEvents);
    expect(preview.inspection().coverage[1]!.uncovered.every(event => event.reason.length > 0)).toBe(true);
    const player = preview.bindActor("female", female);
    player.start(clock(0, true)); player.advance(clock(0, true), clock(46 / 30, true));
    expect(output.play).not.toHaveBeenCalled(); expect(preview.inspection().dropped).toBe(0);
  });

  it("fires at each exact source boundary once, including the authored silenos sound", async () => {
    const { preview, output } = await setup(), player = preview.bindActor("female", female);
    player.start(clock(0));
    let prior = 0;
    for (const [index, time] of deathTimes.entries()) {
      player.advance(clock(prior), clock(time - 1e-9)); expect(output.play).toHaveBeenCalledTimes(index);
      player.advance(clock(time - 1e-9), clock(time)); expect(output.play).toHaveBeenCalledTimes(index + 1);
      player.advance(clock(time), clock(time)); expect(output.play).toHaveBeenCalledTimes(index + 1);
      prior = time;
    }
    output.stopOwner.mockClear();
    player.advance(clock(prior), clock(41 / 16)); player.advance(clock(41 / 16), clock(41 / 16));
    expect(output.play).toHaveBeenCalledTimes(4); expect(output.stopOwner).not.toHaveBeenCalled();
    expect(preview.inspection().recent.map(event => event.sound)).toEqual(deathSounds);
    expect(preview.inspection().recent.map(event => event.sourceTimeSeconds)).toEqual(deathTimes);
    expect(preview.inspection().recent.every(event => event.offsetSeconds === 0 && event.accepted)).toBe(true);
  });

  it("consumes locked output, avoids late replay, and permits explicit retrigger", async () => {
    const { preview, output } = await setup(), player = preview.bindActor("female", female);
    output.accept(false); player.start(clock(0)); player.advance(clock(0), clock(.5));
    expect(preview.inspection()).toMatchObject({ played: 0, dropped: 2 });
    output.accept(true); player.advance(clock(.5), clock(.6)); expect(output.play).toHaveBeenCalledTimes(2);
    player.start(clock(0)); player.advance(clock(0), clock(.5));
    expect(preview.inspection()).toMatchObject({ played: 2, dropped: 2 });
    expect(preview.inspection().recent.map(event => event.generation)).toEqual([1, 1, 2, 2]);
    expect(preview.inspection().recent.slice(2).map(event => event.offsetSeconds)).toEqual(deathTimes.slice(0, 2).map(time => .5 - time));
  });

  it("stops death on unresolved attack transition and disposal without producing substitute sounds", async () => {
    const { preview, output } = await setup(), player = preview.bindActor("female", female);
    player.start(clock(0)); player.advance(clock(0), clock(.5));
    const owner = output.play.mock.calls[0]![1]; output.stopOwner.mockClear();
    player.start(clock(0, true)); expect(output.stopOwner).toHaveBeenCalledExactlyOnceWith(owner);
    player.advance(clock(0, true), clock(46 / 30, true)); expect(output.play).toHaveBeenCalledTimes(2);
    player.start(clock(0)); player.advance(clock(0), clock(.5));
    player.dispose(); player.dispose();
    player.start(clock(0)); player.advance(clock(0), clock(41 / 16));
    expect(output.play).toHaveBeenCalledTimes(4); expect(output.stopOwner).toHaveBeenCalledTimes(3);
    expect(preview.inspection()).toMatchObject({ activeOwners: 0 });
  });

  it.each(["object", "sha256"] as const)("rejects changed female source %s", async field => {
    const asset = changed(female); asset.manifest.source[field] = "changed";
    const { preview, output } = await setup(asset);
    expect(preview.inspection().available).toBe(0); expect(output.register).not.toHaveBeenCalled();
    expect(preview.inspection().diagnostics.map(entry => entry.reason)).toEqual(["Source asset identity mismatch", "Source asset identity mismatch"]);
  });

  it.each(["timeSeconds", "sound", "sourceFrames", "Volume", "Radius", "Random"])("rejects changed female %s while retaining other cues", async field => {
    const asset = changed(female), event = asset.manifest.animationEvents!.find(value =>
      (value as Record<string, unknown>).object === "Fighter.AnimNotify_Sound235") as Record<string, unknown>;
    if (["Volume", "Radius", "Random"].includes(field)) (event.properties as Record<string, unknown>)[field] = 1;
    else event[field] = field === "sound" ? "invented" : 1;
    const { preview } = await setup(asset);
    expect(preview.inspection()).toMatchObject({ available: 3, diagnostics: [
      { assetId: female.manifest.id, clip: "Death_FFighter", notify: "Fighter.AnimNotify_Sound235", reason: "Source notification tuple mismatch" },
    ] });
  });

  it("rejects changed audio bytes even when the rest of the selected female asset remains valid", async () => {
    const asset = changed(female), file = "audio/chrsound.FHFighter_Basic_Action.FHFighter_Death.wav";
    const bytes = asset.files.get(file)!.slice(); bytes[bytes.length - 1]! ^= 1;
    (asset.files as Map<string, Uint8Array>).set(file, bytes);
    const { preview } = await setup(asset);
    expect(preview.inspection()).toMatchObject({ available: 3, diagnostics: [expect.objectContaining({ reason: `File identity mismatch: ${file}` })] });
  });

  it("rejects rewritten UAX provenance even when its internal file hash is updated", async () => {
    const asset = changed(female), file = "provenance.json";
    const provenance = JSON.parse(new TextDecoder().decode(asset.files.get(file)));
    provenance.metadata.eventAudio[deathSounds[1]!].sourceSha256 = "0".repeat(64);
    const bytes = new TextEncoder().encode(JSON.stringify(provenance)); (asset.files as Map<string, Uint8Array>).set(file, bytes);
    Object.assign(asset.manifest.files.find(entry => entry.path === file)!, { bytes: bytes.length, sha256: await sha256(bytes) });
    const { preview } = await setup(asset);
    expect(preview.inspection()).toMatchObject({ available: 3, diagnostics: [expect.objectContaining({ reason: "Source audio provenance mismatch" })] });
  });

  it("accepts an empty active selection without validating unrelated assets", async () => {
    const { preview, output } = await setup(female, []);
    expect(preview.inspection()).toMatchObject({ available: 0, diagnostics: [], coverage: [] });
    expect(output.register).not.toHaveBeenCalled();
  });

  it("reports selected missing female assets explicitly without reporting unrelated catalog entries", async () => {
    const output = mixer(), preview = await createNativeActionCuePreview(new Map(), output, { activeCatalogIds: [femaleId] });
    previews.push(preview);
    expect(preview.inspection().diagnostics.map(event => event.reason)).toEqual([
      `Missing catalog asset: ${femaleId}`, `Missing catalog asset: ${femaleId}`,
    ]);
    expect(preview.inspection().available).toBe(0);
  });

  describe.skipIf(!existsSync(malePath) || !existsSync(monsterPath))("route selection with existing actors", () => {
    let male: AssetPackage, monster: AssetPackage;
    beforeAll(async () => {
      const bytes = [new Uint8Array(readFileSync(malePath)), new Uint8Array(readFileSync(monsterPath))];
      expect(await sha256(bytes[0]!)).toBe(maleHash); expect(await sha256(bytes[1]!)).toBe(monsterHash);
      [male, monster] = await Promise.all(bytes.map(readAssetPackage)) as [AssetPackage, AssetPackage];
    });

    it("keeps legacy nine-cue behavior with female absent or present when selection is omitted", async () => {
      for (const includeFemale of [false, true]) {
        const assets = new Map([[maleId, male], [monsterId, monster]]);
        if (includeFemale) assets.set(femaleId, female);
        const preview = await createNativeActionCuePreview(assets, mixer()); previews.push(preview);
        expect(preview.inspection()).toMatchObject({ available: 9, diagnostics: [] });
        expect(preview.inspection().coverage).toHaveLength(4);
      }
    });

    it("selects female plus Musveren without requiring male", async () => {
      const output = mixer(), preview = await createNativeActionCuePreview(new Map([[femaleId, female], [monsterId, monster]]), output,
        { activeCatalogIds: [femaleId, monsterId] }); previews.push(preview);
      expect(preview.inspection()).toMatchObject({ available: 9, diagnostics: [] });
      expect(preview.inspection().coverage).toHaveLength(4); expect(output.register).toHaveBeenCalledTimes(9);
      expect(preview.inspection().coverage.some(entry => entry.assetId === male.manifest.id)).toBe(false);
    });

    it("deduplicates three shared payloads when both fighters are explicitly selected", async () => {
      const output = mixer(), preview = await createNativeActionCuePreview(new Map([[femaleId, female], [maleId, male], [monsterId, monster]]), output,
        { activeCatalogIds: [femaleId, maleId, monsterId, femaleId] }); previews.push(preview);
      expect(preview.inspection()).toMatchObject({ available: 13, diagnostics: [] });
      expect(output.register).toHaveBeenCalledTimes(10);
    });
  });
});
