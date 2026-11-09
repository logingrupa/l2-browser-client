import { existsSync, readFileSync } from "node:fs";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { GetEnvironmentBRDFTexture } from "@babylonjs/core/Misc/brdfTextureTools";
import { readAssetPackage, sha256, type AssetPackage } from "../../src/assets/package/readAssetPackage";
import { copyAssetPackage } from "./support/copyAssetPackage";
import { createNativeActionCuePreview, type NativeActionCuePreview } from "../../src/audio/nativeActionCuePreview";
import type { WorldAudioPlaybackReceipt } from "../../src/audio/WorldAudioMixer";
import type { NativeActorClock } from "../../src/assets/native/NativeActor";
import { nativeCharacterFactory } from "../../src/assets/native/NativeCharacterVisual";
import type { WorldEntity } from "../../src/world/worldTypes";
import { nativeVisualClips, nativeVisualFixture } from "../fixtures/nativeVisualFixture";

const fighterHash = "678067311414990c82307a045f01b3da0cb083d2075ed927c83372ca647bd2d5";
const monsterHash = "6b6f7d72b2f81bdcca2991bcc84b0eb908a689eadcda8bc7f9b94c78c290fd03";
const fighterPath = `public/l2/${fighterHash}/asset.l2asset`, monsterPath = `public/l2/${monsterHash}/asset.l2asset`;
const fighterId = "human-male-fighter:0", monsterId = "musveren:0";
const monsterOnset = 0.03333333417152365;
const attackTimes = [0.033333332277834415, 0.2666666582226753, 0.5000000149011612];
const attackShotTime = 0.7433333347241083;
const attackSounds = ["field_stalker_walk_loop", "field_stalker_atk", "field_stalker_swish"]
  .map(sound => `MonSound.field_stalker.${sound}`);
const fighterTimes = [0.006666667060926557, 0.686666676402092, 1.3866665840148926, 2.4666667222976684];
function mixer() {
  let accepting = true, serial = 0;
  return { register: vi.fn<(key: string, bytes: Uint8Array) => void>(), stopOwner: vi.fn<(owner: string) => void>(),
    play: vi.fn((key: string, owner: string, offsetSeconds = 0): WorldAudioPlaybackReceipt | null => accepting ?
      { id: ++serial, key, owner, offsetSeconds, contextTime: 10, durationSeconds: 4 } : null),
    accept(value: boolean) { accepting = value; } };
}
function clock(elapsedSeconds: number, fighter = false, extra: Partial<NativeActorClock> = {}): NativeActorClock {
  const durationSeconds = fighter ? 3.4 : 91 / 30;
  return { clip: fighter ? "Death_MFighter" : "death", mode: "once", elapsedSeconds, durationSeconds,
    playing: elapsedSeconds < durationSeconds, completed: elapsedSeconds >= durationSeconds, ...extra };
}
function attackClock(elapsedSeconds: number, extra: Partial<NativeActorClock> = {}): NativeActorClock {
  return clock(elapsedSeconds, false, { clip: "atk01", durationSeconds: 55 / 30,
    playing: elapsedSeconds < 55 / 30, completed: elapsedSeconds >= 55 / 30, ...extra });
}
async function renameClip(asset: AssetPackage, name: string): Promise<AssetPackage> {
  const copy = copyAssetPackage(asset), file = copy.manifest.model!.file, original = copy.files.get(file)!;
  const old = new DataView(original.buffer, original.byteOffset, original.byteLength), jsonLength = old.getUint32(12, true);
  const gltf = JSON.parse(new TextDecoder().decode(original.subarray(20, 20 + jsonLength)));
  const animation = gltf.animations.find((entry: { name: string }) => entry.name === name);
  expect(animation).toBeDefined(); animation.name = `${name}-changed`;
  const json = new TextEncoder().encode(JSON.stringify(gltf)), padded = Math.ceil(json.length / 4) * 4;
  const rest = original.subarray(20 + jsonLength), result = new Uint8Array(20 + padded + rest.length);
  result.set(original.subarray(0, 20)); result.fill(32, 20, 20 + padded); result.set(json, 20); result.set(rest, 20 + padded);
  const header = new DataView(result.buffer); header.setUint32(8, result.length, true); header.setUint32(12, padded, true);
  (copy.files as Map<string, Uint8Array>).set(file, result);
  Object.assign(copy.manifest.files.find(entry => entry.path === file)!, { bytes: result.length, sha256: await sha256(result) });
  return copy;
}
const previews: NativeActionCuePreview[] = [];
afterEach(() => { for (const preview of previews) preview.dispose(); previews.length = 0; vi.restoreAllMocks(); });

describe.skipIf(!existsSync(fighterPath) || !existsSync(monsterPath))("pinned native action cue sources and clock", () => {
  let fighter: AssetPackage, monster: AssetPackage;
  beforeAll(async () => {
    const bytes = [new Uint8Array(readFileSync(fighterPath)), new Uint8Array(readFileSync(monsterPath))];
    expect(await sha256(bytes[0]!)).toBe(fighterHash); expect(await sha256(bytes[1]!)).toBe(monsterHash);
    [fighter, monster] = await Promise.all(bytes.map(readAssetPackage)) as [AssetPackage, AssetPackage];
  });
  async function setup(fighterAsset = fighter, monsterAsset = monster) {
    const output = mixer();
    const preview = await createNativeActionCuePreview(new Map([[fighterId, fighterAsset], [monsterId, monsterAsset]]), output);
    previews.push(preview); return { preview, output };
  }

  it("admits nine pinned cues, registers each payload once, and retains the surprising fighter identity", async () => {
    const { preview, output } = await setup();
    expect(preview.inspection()).toMatchObject({ available: 9, diagnostics: [], nativeBackendVerified: false, policy: "source-cue-preview" });
    expect(output.register).toHaveBeenCalledTimes(9);
    const player = preview.bindActor("fighter", fighter); player.start(clock(0, true));
    let prior = 0;
    for (const time of fighterTimes) { player.advance(clock(prior, true), clock(time, true)); prior = time; }
    expect(output.play).toHaveBeenCalledTimes(4);
    expect(preview.inspection().recent.map(cue => cue.sourceTimeSeconds)).toEqual(fighterTimes);
    expect(preview.inspection().recent[1]?.sound).toBe("MonSound2.heltor_silenos.h_silenos_wait_alt_1");
    expect(preview.inspection().recent.every(cue => cue.offsetSeconds === 0)).toBe(true);
    preview.bindActor("second-fighter", fighter); expect(output.register).toHaveBeenCalledTimes(9);
  });

  it("crosses the three attack cues at their exact source times without replay or an invented AttackShot sound", async () => {
    const { preview, output } = await setup(), player = preview.bindActor("monster", monster);
    const coverage = preview.inspection().coverage.find(entry => entry.clip === "atk01");
    expect(coverage).toMatchObject({ assetId: monster.manifest.id, admitted: 3, uncovered: [{
      notify: "LineageMonsters.AnimNotify_AttackShot310", type: "AnimNotify_AttackShot", timeSeconds: attackShotTime,
      reason: expect.any(String),
    }] });
    expect(coverage!.uncovered[0]!.reason.length).toBeGreaterThan(0);
    player.start(attackClock(0));
    let prior = 0;
    for (const [index, time] of attackTimes.entries()) {
      player.advance(attackClock(prior), attackClock(time - 1e-9));
      expect(output.play).toHaveBeenCalledTimes(index);
      player.advance(attackClock(time - 1e-9), attackClock(time));
      expect(output.play).toHaveBeenCalledTimes(index + 1);
      player.advance(attackClock(time), attackClock(time));
      expect(output.play).toHaveBeenCalledTimes(index + 1);
      prior = time;
    }
    player.advance(attackClock(prior), attackClock(attackShotTime));
    player.advance(attackClock(attackShotTime), attackClock(55 / 30));
    player.advance(attackClock(55 / 30), attackClock(55 / 30));
    expect(output.play).toHaveBeenCalledTimes(3);
    expect(preview.inspection().recent.map(cue => cue.sound)).toEqual(attackSounds);
    expect(preview.inspection().recent.map(cue => cue.sourceTimeSeconds)).toEqual(attackTimes);
    expect(preview.inspection().recent.every(cue => cue.clip === "atk01" && cue.offsetSeconds === 0)).toBe(true);
    expect(preview.inspection().diagnostics).toEqual([]);
  });

  it("consumes attack cues while output is locked and only replays after an explicit retrigger", async () => {
    const { preview, output } = await setup(), player = preview.bindActor("monster", monster);
    output.accept(false); player.start(attackClock(0)); player.advance(attackClock(0), attackClock(.6));
    expect(preview.inspection()).toMatchObject({ played: 0, dropped: 3 });
    output.accept(true); player.advance(attackClock(.6), attackClock(1));
    expect(output.play).toHaveBeenCalledTimes(3);
    player.start(attackClock(0)); player.advance(attackClock(0), attackClock(.6));
    expect(preview.inspection()).toMatchObject({ played: 3, dropped: 3 });
    expect(preview.inspection().recent.map(cue => cue.generation)).toEqual([1, 1, 1, 2, 2, 2]);
  });

  it("keeps attack and death independently selectable and stops the old owner on transitions and retriggers", async () => {
    const { preview, output } = await setup(), player = preview.bindActor("monster", monster);
    player.start(attackClock(0)); player.advance(attackClock(0), attackClock(.1));
    const owner = output.play.mock.calls[0]![1]; output.stopOwner.mockClear();
    player.start(clock(0)); expect(output.stopOwner).toHaveBeenCalledExactlyOnceWith(owner);
    player.advance(clock(0), clock(.1));
    player.start(attackClock(0)); player.advance(attackClock(0), attackClock(.3));
    player.start(attackClock(0)); player.advance(attackClock(0), attackClock(.6));
    expect(output.stopOwner).toHaveBeenCalledTimes(3);
    expect(output.stopOwner.mock.calls.every(([value]) => value === owner)).toBe(true);
    expect(preview.inspection().recent.map(cue => [cue.clip, cue.generation])).toEqual([
      ["atk01", 1], ["death", 2], ["death", 2], ["atk01", 3], ["atk01", 3],
      ["atk01", 4], ["atk01", 4], ["atk01", 4],
    ]);
    output.play.mockClear(); player.start(attackClock(0, { clip: "Wait", mode: "loop" }));
    player.advance(attackClock(0), attackClock(1)); expect(output.play).not.toHaveBeenCalled();
    expect(output.stopOwner).toHaveBeenCalledTimes(4);
  });

  it.each(["atk01", "death"])("rejects a changed %s clip without suppressing the other Musveren clip", async broken => {
    const corrupt = await renameClip(monster, broken), { preview, output } = await setup(fighter, corrupt);
    expect(preview.inspection().available).toBe(broken === "atk01" ? 6 : 7);
    expect(preview.inspection().diagnostics).toEqual([
      expect.objectContaining({ assetId: monster.manifest.id, reason: "Source clip duration or identity mismatch" }),
    ]);
    const player = preview.bindActor("monster", corrupt);
    const brokenClock = broken === "atk01" ? attackClock : clock, validClock = broken === "atk01" ? clock : attackClock;
    player.start(brokenClock(0)); player.advance(brokenClock(0), brokenClock(1)); expect(output.play).not.toHaveBeenCalled();
    player.start(validClock(0)); player.advance(validClock(0), validClock(1));
    expect(output.play).toHaveBeenCalledTimes(broken === "atk01" ? 2 : 3);
  });

  it.each(["sound", "Random"])("rejects an altered attack %s while keeping the other attack cues and both death cues", async field => {
    const corrupt = copyAssetPackage(monster), event = corrupt.manifest.animationEvents!.find(value =>
      (value as Record<string, unknown>).object === "LineageMonsters.AnimNotify_Sound2851") as Record<string, unknown>;
    if (field === "sound") event.sound = "invented";
    else {
      const properties = event.properties as Record<string, unknown>;
      expect(properties.Random).toBeUndefined();
      properties.Random = 100;
    }
    const { preview, output } = await setup(fighter, corrupt), player = preview.bindActor("monster", corrupt);
    expect(preview.inspection().available).toBe(8);
    expect(preview.inspection().diagnostics).toEqual([expect.objectContaining({ notify: event.object, reason: "Source notification tuple mismatch" })]);
    player.start(attackClock(0)); player.advance(attackClock(0), attackClock(.6));
    expect(preview.inspection().recent.map(cue => cue.sound)).toEqual([attackSounds[0], attackSounds[2]]);
    player.start(clock(0)); player.advance(clock(0), clock(.1));
    expect(output.play).toHaveBeenCalledTimes(4);
    expect(preview.inspection().recent.slice(2).map(cue => cue.clip)).toEqual(["death", "death"]);
  });

  it("crosses both simultaneous Musveren cues once and lets the fall outlive natural one-shot completion", async () => {
    const { preview, output } = await setup(), player = preview.bindActor("monster", monster);
    player.start(clock(0)); output.stopOwner.mockClear();
    player.advance(clock(0), clock(monsterOnset - 1e-8)); expect(output.play).not.toHaveBeenCalled();
    player.advance(clock(monsterOnset - 1e-8), clock(monsterOnset)); expect(output.play).toHaveBeenCalledTimes(2);
    expect(preview.inspection().recent.map(cue => cue.sound)).toEqual([
      "MonSound.field_stalker.field_stalker_death", "MonSound.field_stalker.field_stalker_fall",
    ]);
    player.advance(clock(monsterOnset), clock(91 / 30));
    player.advance(clock(91 / 30), clock(91 / 30));
    expect(output.play).toHaveBeenCalledTimes(2); expect(output.stopOwner).not.toHaveBeenCalled();
    player.dispose(); player.dispose(); expect(output.stopOwner).toHaveBeenCalledTimes(1);
  });

  it("dispatches a cue crossed on the final playing tick even though the new clock is complete", async () => {
    const { preview, output } = await setup(), player = preview.bindActor("monster", monster);
    player.start(clock(0)); player.advance(clock(0), clock(91 / 30));
    expect(output.play).toHaveBeenCalledTimes(2);
    expect(output.play.mock.calls[0]?.[2]).toBe(91 / 30 - monsterOnset);
    player.advance(clock(91 / 30), clock(91 / 30)); expect(output.play).toHaveBeenCalledTimes(2);
  });

  it("consumes locked/paused output events without replaying them on later unlock", async () => {
    const { preview, output } = await setup(), player = preview.bindActor("monster", monster);
    output.accept(false); player.start(clock(0)); player.advance(clock(0), clock(.05));
    expect(preview.inspection()).toMatchObject({ played: 0, dropped: 2 });
    output.accept(true); player.advance(clock(.05), clock(.1)); expect(output.play).toHaveBeenCalledTimes(2);
    player.start(clock(0)); player.advance(clock(0), clock(.05));
    expect(preview.inspection()).toMatchObject({ played: 2, dropped: 2 });
    expect(preview.inspection().recent.map(cue => cue.generation)).toEqual([1, 1, 2, 2]);
  });

  it("does not dispatch a seek while the actor is paused or replay its missed cues", async () => {
    const { preview, output } = await setup(), player = preview.bindActor("monster", monster);
    player.start(clock(0)); player.advance(clock(0, false, { playing: false }), clock(.1, false, { playing: false }));
    expect(output.play).not.toHaveBeenCalled(); expect(preview.inspection().dropped).toBe(2);
    player.advance(clock(.1), clock(.2)); expect(output.play).not.toHaveBeenCalled();
  });

  it("ends an explicit interruption, retriggers in a new generation and uses independent owners", async () => {
    const { preview, output } = await setup(), first = preview.bindActor("one", monster), second = preview.bindActor("two", monster);
    first.start(clock(0)); second.start(clock(0));
    first.advance(clock(0), clock(.05)); second.advance(clock(0), clock(.05));
    const firstOwner = output.play.mock.calls[0]![1], secondOwner = output.play.mock.calls[2]![1];
    expect(firstOwner).not.toBe(secondOwner); output.stopOwner.mockClear();
    first.start(clock(0, false, { clip: "wait", mode: "loop" }));
    expect(output.stopOwner).toHaveBeenCalledExactlyOnceWith(firstOwner);
    first.start(clock(0)); first.advance(clock(0), clock(.05));
    expect(preview.inspection().recent.at(-1)?.generation).toBe(3);
    first.dispose(); second.dispose(); expect(preview.inspection().activeOwners).toBe(0);
  });

  it("rejects loop mode, duration changes and silent backward seeks without wrapping at the end", async () => {
    const { preview, output } = await setup(), player = preview.bindActor("monster", monster);
    player.start(clock(0, false, { mode: "loop" })); player.advance(clock(0, false, { mode: "loop" }), clock(10, false, { mode: "loop" }));
    player.start(clock(0, false, { durationSeconds: 4 })); player.advance(clock(0), clock(.1));
    expect(output.play).not.toHaveBeenCalled();
    player.start(clock(0)); player.advance(clock(0), clock(.02)); player.advance(clock(.02), clock(.01));
    player.advance(clock(.01), clock(.1)); expect(output.play).not.toHaveBeenCalled();
  });

  it("stops all owned voices on disposal and never accepts work afterward", async () => {
    const { preview, output } = await setup(), player = preview.bindActor("monster", monster);
    player.start(clock(0)); player.advance(clock(0), clock(.05)); output.stopOwner.mockClear();
    preview.dispose(); preview.dispose(); expect(output.stopOwner).toHaveBeenCalledTimes(1);
    player.start(clock(0)); player.advance(clock(0), clock(.05));
    const late = preview.bindActor("late", monster); late.start(clock(0)); late.advance(clock(0), clock(.05));
    expect(output.play).toHaveBeenCalledTimes(2); expect(preview.inspection()).toMatchObject({ activeOwners: 0, disposed: true });
  });

  it.each(["object", "sha256"] as const)("rejects source %s mismatches instead of guessing by appearance", async field => {
    const corrupt = copyAssetPackage(fighter); corrupt.manifest.source[field] = "changed";
    const { preview, output } = await setup(corrupt);
    expect(preview.inspection()).toMatchObject({ available: 5, diagnostics: ["Death_MFighter", "Atk01_Hand_MFighter"].map(clip =>
      expect.objectContaining({ clip, reason: "Source asset identity mismatch" })) });
    expect(output.register).toHaveBeenCalledTimes(5);
  });

  it.each(["timeSeconds", "sound", "animationSet", "type"])("rejects a changed %s tuple without suppressing other verified cues", async field => {
    const corrupt = copyAssetPackage(fighter), event = corrupt.manifest.animationEvents!.find(value =>
      (value as Record<string, unknown>).object === "Fighter.AnimNotify_Sound757") as Record<string, unknown>;
    event[field] = field === "timeSeconds" ? .7 : "changed";
    const { preview } = await setup(corrupt);
    expect(preview.inspection()).toMatchObject({ available: 8, diagnostics: [expect.objectContaining({ notify: "Fighter.AnimNotify_Sound757", reason: "Source notification tuple mismatch" })] });
  });

  it("rejects missing, duplicate and altered payloads with explicit diagnostics", async () => {
    const corrupt = copyAssetPackage(fighter), events = corrupt.manifest.animationEvents!;
    const first = events.findIndex(value => (value as Record<string, unknown>).object === "Fighter.AnimNotify_Sound756");
    events.splice(first, 1);
    events.push(events.find(value => (value as Record<string, unknown>).object === "Fighter.AnimNotify_Sound757"));
    const file = "audio/chrsound.Character_Public.Death_Fall_Knee.wav";
    const bytes = corrupt.files.get(file)!.slice(); bytes[bytes.length - 1]! ^= 1; (corrupt.files as Map<string, Uint8Array>).set(file, bytes);
    const { preview } = await setup(corrupt);
    expect(preview.inspection().available).toBe(6);
    expect(preview.inspection().diagnostics.map(item => item.reason)).toEqual([
      "Missing or ambiguous source notification", "Missing or ambiguous source notification", `File identity mismatch: ${file}`,
    ]);
  });

  it("rejects changed UAX provenance even when its file hash is internally consistent", async () => {
    const corrupt = copyAssetPackage(monster), path = "provenance.json";
    const doc = JSON.parse(new TextDecoder().decode(corrupt.files.get(path)));
    doc.metadata.eventAudio["MonSound.field_stalker.field_stalker_death"].sourceSha256 = "0".repeat(64);
    const bytes = new TextEncoder().encode(JSON.stringify(doc)); (corrupt.files as Map<string, Uint8Array>).set(path, bytes);
    Object.assign(corrupt.manifest.files.find(file => file.path === path)!, { bytes: bytes.length, sha256: await sha256(bytes) });
    const { preview } = await setup(fighter, corrupt);
    expect(preview.inspection()).toMatchObject({ available: 8, diagnostics: [expect.objectContaining({ reason: "Source audio provenance mismatch" })] });
  });

  it("does not bind a different asset instance by copied ID, and reports absent catalog entries", async () => {
    const { preview, output } = await setup(), player = preview.bindActor("unsupported", copyAssetPackage(monster));
    player.start(clock(0)); player.advance(clock(0), clock(.1)); expect(output.play).not.toHaveBeenCalled();
    expect(preview.inspection().diagnostics.at(-1)?.reason).toMatch(/No verified .*cue source/);
    const empty = await createNativeActionCuePreview(new Map(), output); previews.push(empty);
    expect(empty.inspection().available).toBe(0); expect(empty.inspection().diagnostics).toHaveLength(4);
  });
});

describe("native visual audio lifecycle (original synthetic geometry)", () => {
  it("forwards attack retriggers and the existing completion-to-idle interruption to one base audio owner", async () => {
    const engine = new NullEngine(), scene = new Scene(engine); GetEnvironmentBRDFTexture(scene);
    const cues = { start: vi.fn(), advance: vi.fn(), dispose: vi.fn() };
    const preview = { bindActor: vi.fn(() => cues) } as unknown as NativeActionCuePreview;
    const entity: WorldEntity = { id: "attack-fixture", kind: "monster", displayName: "Fixture", appearanceId: "fixture",
      health: 100, maximumHealth: 100, position: { x: 0, y: 0, z: 0 }, orientationRadians: 0, animation: "idle" };
    const visual = nativeCharacterFactory(new Map([["fixture", { asset: await nativeVisualFixture(), clips: nativeVisualClips }]]), preview)(scene, entity);
    try {
      await visual.ready; cues.start.mockClear();
      visual.animation.setState("attack"); visual.animation.update(.5);
      expect(cues.start).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ clip: nativeVisualClips.attack, elapsedSeconds: 0, mode: "once" }));
      visual.animation.setState("attack", true); visual.animation.update(2);
      expect(cues.advance.mock.calls.at(-1)).toEqual([
        expect.objectContaining({ clip: nativeVisualClips.attack, elapsedSeconds: 0, playing: true }),
        expect.objectContaining({ clip: nativeVisualClips.attack, elapsedSeconds: 2, completed: true }),
      ]);
      expect(cues.start.mock.calls.map(([state]) => state.clip)).toEqual([nativeVisualClips.attack, nativeVisualClips.attack, nativeVisualClips.idle]);
      expect(preview.bindActor).toHaveBeenCalledTimes(1);
    } finally { visual.dispose(); scene.dispose(); engine.dispose(); }
    expect(cues.dispose).toHaveBeenCalledTimes(1);
  });

  it("binds once, advances the base clock after pose update, preserves natural death, and disposes", async () => {
    const engine = new NullEngine(), scene = new Scene(engine); GetEnvironmentBRDFTexture(scene);
    const cues = { start: vi.fn(), advance: vi.fn(), dispose: vi.fn() };
    const preview = { bindActor: vi.fn(() => cues) } as unknown as NativeActionCuePreview;
    const entity: WorldEntity = { id: "audio-fixture", kind: "local-player", displayName: "Fixture", appearanceId: "fixture",
      health: 100, maximumHealth: 100, position: { x: 0, y: 0, z: 0 }, orientationRadians: 0, animation: "idle" };
    const asset = await nativeVisualFixture(), item = await nativeVisualFixture({ parts: ["Upper"], material: "replacement" });
    const visual = nativeCharacterFactory(new Map([["fixture", { asset, clips: nativeVisualClips, upperItems: new Map([[22, item]]) }]]), preview)(scene, entity);
    try {
      await visual.ready;
      visual.setEntity({ ...entity, health: 0 });
      expect(cues.start.mock.calls.at(-1)?.[0]).toMatchObject({ clip: nativeVisualClips.death, elapsedSeconds: 0, mode: "once" });
      visual.animation.update(2);
      expect(cues.advance.mock.calls.at(-1)).toEqual([
        expect.objectContaining({ elapsedSeconds: 0, playing: true }), expect.objectContaining({ elapsedSeconds: 2, completed: true, playing: false }),
      ]);
      expect(cues.start.mock.calls.at(-1)?.[0].clip).toBe(nativeVisualClips.death);
      visual.setEntity({ ...entity, health: 0, equipment: { upper: 22 } });
      await vi.waitFor(() => expect(scene.materials.some(material => material.name === "replacement:Upper")).toBe(true));
      expect(preview.bindActor).toHaveBeenCalledTimes(1);
      visual.setEntity(entity); expect(cues.start.mock.calls.at(-1)?.[0].clip).toBe(nativeVisualClips.idle);
      visual.dispose(); expect(cues.dispose).toHaveBeenCalled();
    } finally { visual.dispose(); scene.dispose(); engine.dispose(); }
  });

  it("releases the bound owner when initial equipment fails before publication", async () => {
    const engine = new NullEngine(), scene = new Scene(engine); GetEnvironmentBRDFTexture(scene);
    const cues = { start: vi.fn(), advance: vi.fn(), dispose: vi.fn() };
    const preview = { bindActor: vi.fn(() => cues) } as unknown as NativeActionCuePreview;
    const entity: WorldEntity = { id: "failed", kind: "local-player", displayName: "Fixture", appearanceId: "fixture", equipment: { upper: 999 },
      health: 100, maximumHealth: 100, position: { x: 0, y: 0, z: 0 }, orientationRadians: 0, animation: "idle" };
    const visual = nativeCharacterFactory(new Map([["fixture", { asset: await nativeVisualFixture(), clips: nativeVisualClips }]]), preview)(scene, entity);
    try {
      await expect(visual.ready).rejects.toThrow("no verified upper-body binding");
      expect(cues.dispose).toHaveBeenCalledOnce(); expect(scene.meshes).toHaveLength(0);
    } finally { visual.dispose(); scene.dispose(); engine.dispose(); }
  });
});
