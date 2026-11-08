import { existsSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NativeActorClock } from "../../src/assets/native/NativeActor";
import { readAssetPackage, sha256, type AssetPackage } from "../../src/assets/package/readAssetPackage";
import type { WorldAudioPlaybackReceipt, WorldAudioVoice, WorldAudioVoiceOptions } from "../../src/audio/WorldAudioMixer";
import type { WorldEntity } from "../../src/world/worldTypes";
import { createNativeCombatAudio, nativeAttackEvents, nativeAttackShotRoute, nativeCombatGain, nativePercentChance, summarizeNativeCombatDispatch,
  APP_RAND_RANGE, FALLBACK_SHOT_FRACTION, OFFLINE_OUTCOME, PRESENTATION_STATUS, type NativeCombatActor, type NativeCombatAudioOptions } from "../../src/audio/nativeCombatAudio";
import { loadNativeCombatAudio, parseNativeCombatManifest, type NativeCombatAudioBundle, type NativeCombatRole,
  type NativeCombatSelection, type NativeCombatSoundSet } from "../../src/audio/loadNativeCombatAudio";
import { attachNativeCombatAudioControls } from "../../src/audio/nativeCombatAudioControls";
import { nativePawnSoundLedger } from "../../src/audio/nativePawnSounds";
import { createNativeActionCuePreview } from "../../src/audio/nativeActionCuePreview";

const event = (clip: string, type: string, object: string, timeSeconds: number, properties: Record<string, unknown> = {}) =>
  ({ clip, type, object, timeSeconds, properties });
const voiceProps = { Random: 50, Volume: 250, Radius: 30 };
const fighterEvents = [
  event("Wait", "AnimNotify_Sound", "Fixture.Sound1", .1),
  event("Atk01_Hand", "AnimNotify_AttackShot", "Fighter.AnimNotify_AttackShot145", .42),
  event("Atk01_Hand", "AnimNotify_AttackVoice", "Fighter.AnimNotify_AttackVoice64", .31, voiceProps),
  event("Atk01_Hand", "AnimNotify_AttackItem", "Fighter.AnimNotify_AttackItem118", .3666),
  event("Atk01_Hand", "AnimNotify_AttackVoice", "Fighter.AnimNotify_AttackVoice65", .7167, voiceProps),
  event("Atk01_Hand", "AnimNotify_AttackItem", "Fighter.AnimNotify_AttackItem119", .7767),
  event("Atk01_Hand", "AnimNotify_AttackShot", "Fighter.AnimNotify_AttackShot146", .8467),
  event("SpAtk01_1HS", "AnimNotify_AttackItem", "Fighter.AnimNotify_AttackItem136", .8766),
  event("SpAtk01_1HS", "AnimNotify_AttackShot", "Fighter.AnimNotify_AttackShot167", .9233),
];
const monsterEvents = [event("atk01", "AnimNotify_Sound", "LineageMonsters.AnimNotify_Sound2851", .2667),
  event("atk01", "AnimNotify_AttackItem", "LineageMonsters.AnimNotify_AttackItemFixture", .5),
  event("atk01", "AnimNotify_AttackShot", "LineageMonsters.AnimNotify_AttackShot310", .7433)];
const asset = (object: string, animationEvents: unknown[]) =>
  ({ manifest: { id: `fixture:${object}`, kind: "model", source: { edition: "interlude", package: "Fixture", object, sha256: "0".repeat(64) },
    animationEvents }, files: new Map() }) as unknown as AssetPackage;
const fighterAsset = asset("Fighter.MFighter_m001_u", fighterEvents), monsterAsset = asset("LineageMonsters.field_stalker_m00", monsterEvents);

const set = (selection: string, table: string, field: string, references: readonly string[], unadmitted = 0): NativeCombatSoundSet => ({
  selection, table, field, unadmitted: Array.from({ length: unadmitted }, (_, index) => ({ index: references.length + index, reference: "", status: "empty" })),
  slots: references.map((reference, index) => ({ index, reference, object: `${reference.split(".")[0]!.toLowerCase()}.Group.${reference.split(".").at(-1)}`,
    status: "unique-package-leaf-candidate" as const, sourcePointer: `/data/${field}/${index}`, key: `key:${reference}` })) });
const selection = (patch: Partial<NativeCombatSelection> & Pick<NativeCombatSelection, "id" | "kind" | "table">,
  roles: Partial<Record<NativeCombatRole, NativeCombatSoundSet>>): NativeCombatSelection =>
  ({ label: patch.id, rowOrdinal: 0, numeric: {}, ...patch, roles });
const configNumbers = { "CharSound.Random": 50, "CharSound.Vol": 250, "CharSound.Radius": 30, "ItemSound.Random": 100, "ItemSound.Vol": 250,
  "ItemSound.Radius": 40, "EtcSound.CriticalSound_Vol": 250, "EtcSound.CriticalSound_Radius": 50, "EtcSound.SoulShotSound_Vol": 250, "EtcSound.SoulShotSound_Radius": 50 };
const bundle: NativeCombatAudioBundle = { id: "native-combat-audio", manifestSha256: "f".repeat(64), sounds: [{ key: "key:ItemSound.fist_1", bytes: new Uint8Array([1]) }],
  selections: [
    selection({ id: "male", kind: "actor", table: "chargrp", catalogId: "human-male-fighter:0", sourceObject: "Fighter.MFighter_m001_u" }, {
      attackItem: set("male", "chargrp", "attack_sound", ["ItemSound.fist_1", "ItemSound.fist_2", "ItemSound.fist_3"]),
      attackVoice: set("male", "chargrp", "voice_snd_hand", ["ChrSound.MHFighter_1H_Atk_1", "ChrSound.MHFighter_1H_Atk_2"]),
      defense: set("male", "chargrp", "defense_sound", ["ItemSound.armor_underwear_1"]),
      damage: set("male", "chargrp", "damage_sound", ["ChrSound.MHFighter_Dmg_1"]) }),
    selection({ id: "musveren", kind: "actor", table: "npcgrp", catalogId: "musveren:0", sourceObject: "LineageMonsters.field_stalker_m00",
      numeric: { soundRadius: 50, soundVolume: 250, soundRandom: 70 } }, {
      attackItem: set("musveren", "npcgrp", "attack_sound1", [], 1),
      defense: set("musveren", "npcgrp", "defense_sound1", ["MonSound.Hit_Bone_6", "MonSound.Hit_Wet_2"]),
      damage: set("musveren", "npcgrp", "damage_sound", ["MonSound.field_stalker_dmg_1"]) }),
    selection({ id: "armor-22", kind: "armor", table: "armorgrp", itemId: 22 }, { defense: set("armor-22", "armorgrp", "item_sound", ["ItemSound.armor_leather_3"]) }),
    selection({ id: "weapon-1", kind: "weapon", table: "weapongrp", itemId: 1, label: "Short Sword (weapongrp object_id 1), 1HS" },
      { attackItem: set("weapon-1", "weapongrp", "item_sound", ["ItemSound.sword_small_1", "ItemSound.sword_big_7"]) }),
    selection({ id: "skill-3", kind: "skill", table: "skillsoundgrp", skillId: 3, level: 1, numeric: { spelleffect_sound_vol_1: 250, spelleffect_sound_rad_1: 40,
      spelleffect_sound_vol_2: 250, spelleffect_sound_rad_2: 40 } }, {
      cast: set("skill-3", "skillsoundgrp", "spelleffect_sound_1", ["SkillSound.power_strike_cast"]),
      shot: set("skill-3", "skillsoundgrp", "spelleffect_sound_2", ["SkillSound.power_strike_shot"]) }),
    selection({ id: "config", kind: "config", table: "alaudio", numeric: configNumbers }, {
      critical: set("config", "alaudio", "EtcSound.CriticalSound", ["SkillSound.Critical_Hit_02"]),
      soulshot: set("config", "alaudio", "EtcSound.SoulShotSound", ["SkillSound.Soul_Shot_Shot"]) }),
  ] };

const entity = (id: string, kind: WorldEntity["kind"], x: number, patch: Partial<WorldEntity> = {}): WorldEntity =>
  ({ id, kind, displayName: id, position: { x, y: 0, z: 0 }, orientationRadians: 0, health: 100, maximumHealth: 100, animation: "idle", ...patch });
const clock = (clip: string | null, elapsedSeconds: number, patch: Partial<NativeActorClock> = {}): NativeActorClock =>
  ({ clip, mode: "once", elapsedSeconds, durationSeconds: 1.4333, playing: true, completed: false, ...patch });
const randomForAppRand = (value: number) => (value + .5) / APP_RAND_RANGE;

function fakeMixer() {
  let next = 0, now = 10, accepting = true;
  const live = new Set<number>();
  const voices: (WorldAudioVoiceOptions & { key: string; id: number })[] = [];
  const mixer = {
    register: vi.fn(), stopOwner: vi.fn<(owner: string) => void>(), contextTime: () => now,
    play: vi.fn((key: string, owner: string, offsetSeconds = 0): WorldAudioPlaybackReceipt | null =>
      accepting ? { id: ++next, key, owner, offsetSeconds, contextTime: now, durationSeconds: 1 } : null),
    startVoice: vi.fn((key: string, options: WorldAudioVoiceOptions): WorldAudioVoice | null => {
      if (!accepting) return null;
      const id = ++next; live.add(id); voices.push({ ...options, key, id });
      return { id, key, owner: options.owner, bus: options.bus, loop: false, durationSeconds: 1, startedAt: now,
        active: () => live.has(id), setGain: () => undefined, setPosition: () => undefined, stop: () => { live.delete(id); } };
    }),
  };
  return { mixer, voices, endAll: () => live.clear(), advance: (seconds: number) => { now += seconds; }, accept: (value: boolean) => { accepting = value; } };
}

function fixture(options: NativeCombatAudioOptions = {}, randoms: number[] = [], listener: [number, number, number] | null = null) {
  const entities = new Map<string, WorldEntity>([["local-player", entity("local-player", "local-player", 0)], ["native-musveren", entity("native-musveren", "monster", 1.4)]]);
  const clocks = new Map<string, NativeActorClock | null>([["local-player", clock("Wait", 0, { mode: "loop" })], ["native-musveren", clock("Wait", 0, { mode: "loop" })]]);
  let selected: string | null = null, paused = false;
  const fake = fakeMixer();
  const actors: NativeCombatActor[] = [
    { entityId: "local-player", catalogId: "human-male-fighter:0", asset: fighterAsset, collisionRadiusMetres: .09, collisionHeightMetres: .235 },
    { entityId: "native-musveren", catalogId: "musveren:0", asset: monsterAsset, collisionRadiusMetres: .18, collisionHeightMetres: .3 }];
  const queue = [...randoms];
  const combat = createNativeCombatAudio(bundle, fake.mixer, {
    entity: id => entities.get(id) ?? null, sourceClock: id => clocks.get(id) ?? null,
    selectedEntityId: () => selected, paused: () => paused, listener: () => listener,
  }, actors, { random: () => queue.length ? queue.shift()! : 0, ...options });
  const step = (id: string, value: NativeActorClock | null) => { clocks.set(id, value); combat.update(); };
  return { combat, ...fake, entities, clocks, step, queue, select(id: string | null) { selected = id; }, pause(value: boolean) { paused = value; } };
}
type Fixture = ReturnType<typeof fixture>;
const keys = (fake: Fixture) => fake.voices.map(voice => voice.key);

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("native combat rules", () => {
  it("keeps exact notify times per clip with the AttackVoice Random/Volume/Radius and AttackShot ordinals", () => {
    const clips = nativeAttackEvents(fighterAsset);
    expect([...clips.keys()]).toEqual(["Atk01_Hand", "SpAtk01_1HS"]);
    expect(clips.get("Atk01_Hand")!.map(row => [row.type.replace("AnimNotify_", ""), row.time, row.random, row.shot?.index ?? null])).toEqual([
      ["AttackVoice", .31, 50, null], ["AttackItem", .3666, null, null], ["AttackShot", .42, null, 1],
      ["AttackVoice", .7167, 50, null], ["AttackItem", .7767, null, null], ["AttackShot", .8467, null, 2]]);
    expect(clips.get("Atk01_Hand")![2]!.shot).toEqual({ index: 1, count: 2 });
  });

  it("reproduces the native appRand()%100 probabilities and the Action_Attack flags order", () => {
    expect(nativePercentChance(50)).toBe(16728 / 32768);
    expect(nativePercentChance(70)).toBe(23285 / 32768);
    expect([nativePercentChance(100), nativePercentChance(-1)]).toEqual([1, 0]);
    expect([0, 0x80, 0xc0, 0x40, 0x60, 0x20, 0x30, 0x10, 0x0f].map(flags => nativeAttackShotRoute(flags)))
      .toEqual(["defense", "miss", "miss", "shield", "shield", "critical", "critical", "soulshot", "defense"]);
    expect(nativeAttackShotRoute(0, true)).toBe("soulshot");
    expect(() => nativeAttackShotRoute(256)).toThrow();
  });

  it("applies volume/255 and, as a labelled presentation choice, the proved ambient falloff", () => {
    expect(nativeCombatGain(250, 30, 0, "ambient-curve")).toBeCloseTo(250 / 255, 12);
    expect(nativeCombatGain(250, 50, 140, "flat")).toBeCloseTo(250 / 255, 12);
    expect(nativeCombatGain(250, 50, 140, "ambient-curve")).toBeCloseTo(250 / 255 * (2360 / 2500) * (50 / 95), 12);
    expect(nativeCombatGain(250, 50, 2500, "ambient-curve")).toBe(0);
    expect(nativeCombatGain(250, 50, null, "ambient-curve")).toBeCloseTo(250 / 255, 12);
  });
});

describe("browser combat hit sounds (native Q4 routes)", () => {
  it("route B voice and route A fist at the attacker, route C defense + damage at the target, at the exact notify times", () => {
    const fake = fixture();
    const { combat, step, entities } = fake;
    entities.set("local-player", entity("local-player", "local-player", 0, { animation: "attack" }));
    step("local-player", clock("Atk01_Hand", .016));
    expect(fake.mixer.startVoice).not.toHaveBeenCalled();
    step("local-player", clock("Atk01_Hand", .32));
    expect(fake.voices.map(voice => [voice.key, voice.owner, voice.bus])).toEqual([["key:ChrSound.MHFighter_1H_Atk_1", "native-combat:local-player", "effects"]]);
    expect(fake.voices[0]!.offsetSeconds).toBeCloseTo(.01, 9);
    const voiceWithoutListener = fake.voices[0]!, flatVolumeGain = 250 / 255;
    expect(voiceWithoutListener.position).toBeUndefined(); expect(voiceWithoutListener.gain).toBeCloseTo(flatVolumeGain, 12);
    step("local-player", clock("Atk01_Hand", .43));
    expect(keys(fake).slice(1)).toEqual(["key:ItemSound.fist_1", "key:MonSound.Hit_Bone_6", "key:MonSound.field_stalker_dmg_1"]);
    expect(fake.voices.slice(1).map(voice => voice.owner)).toEqual(["native-combat:local-player", "native-combat:native-musveren", "native-combat:native-musveren"]);
    const hit = combat.inspection().lastHit!;
    expect(hit).toMatchObject({ attackerId: "local-player", targetId: "native-musveren", notify: "Fighter.AnimNotify_AttackShot145", route: "C",
      sourceTimeSeconds: .42, outcome: "played", flags: 0, shotRoute: "defense", shot: { index: 1, count: 2 }, reachGated: true });
    expect(hit.sounds.map(sound => [sound.role, sound.volume, sound.radiusUnits])).toEqual([["defense", 250, 50], ["damage", 250, 50]]);
    expect(hit.distanceMetres).toBeCloseTo(1.13, 9);
    expect(summarizeNativeCombatDispatch(hit)).toBe("AttackShot145 1/2: Hit_Bone_6 + field_stalker_dmg_1");
    expect(combat.inspection().recent.map(row => row.route)).toEqual(["B", "A", "C"]);
    expect(combat.inspection().recent[1]!.sounds[0]).toMatchObject({ role: "attackItem", volume: 250, radiusUnits: 30, slotIndex: 0, slotCount: 3 });
  });

  it("Hand clips run route C twice (two AttackShots); both are offline normal hits", () => {
    const fake = fixture();
    fake.step("local-player", clock("Atk01_Hand", .016)); fake.endAll();
    fake.step("local-player", clock("Atk01_Hand", .9));
    const shots = fake.combat.inspection().recent.filter(row => row.route === "C");
    expect(shots.map(row => [row.notify.split(".").at(-1), row.shot, row.flags, row.outcome])).toEqual([
      ["AnimNotify_AttackShot145", { index: 1, count: 2 }, 0, "played"], ["AnimNotify_AttackShot146", { index: 2, count: 2 }, 0, "played"]]);
    expect(fake.combat.inspection().offlineOutcome).toBe(OFFLINE_OUTCOME);
  });

  it("route A plays on a miss (no target or out of reach); only route C needs a target in reach", () => {
    const fake = fixture({ reachMetres: .5 });
    fake.step("local-player", clock("Atk01_Hand", .016)); fake.step("local-player", clock("Atk01_Hand", .43));
    expect(fake.combat.inspection().recent.map(row => [row.route, row.outcome])).toEqual([["B", "played"], ["A", "played"], ["C", "out-of-reach"]]);
    fake.combat.setReach(2); fake.combat.setTargetRule("selected");
    fake.step("local-player", clock("Atk01_Hand", .016)); fake.step("local-player", clock("Atk01_Hand", .43));
    expect(fake.combat.inspection().recent.slice(-1)[0]!.outcome).toBe("no-target");
    fake.select("native-musveren"); fake.entities.set("native-musveren", entity("native-musveren", "monster", 1.4, { health: 0 }));
    fake.step("local-player", clock("Atk01_Hand", .016)); fake.step("local-player", clock("Atk01_Hand", .43));
    expect(fake.combat.inspection().recent.slice(-1)[0]!.outcome).toBe("target-dead");
    fake.entities.set("local-player", entity("local-player", "local-player", 0, { health: 0 }));
    const before = fake.mixer.startVoice.mock.calls.length;
    fake.step("local-player", clock("Atk01_Hand", .016)); fake.step("local-player", clock("Atk01_Hand", .43));
    expect(fake.mixer.startVoice).toHaveBeenCalledTimes(before);
    expect(fake.combat.inspection().recent.slice(-3).map(row => row.outcome)).toEqual(["attacker-dead", "attacker-dead", "attacker-dead"]);
  });

  it("gates AttackVoice by appRand()%100 <= 50 and the NPC damage by <= 70, and picks appRand()%n", () => {
    const skippedVoiceRoll = randomForAppRand(51), fistTwoPick = randomForAppRand(4), hitWetTwoPick = randomForAppRand(3), skippedDamageRoll = randomForAppRand(71);
    const fake = fixture({}, [skippedVoiceRoll, fistTwoPick, hitWetTwoPick, skippedDamageRoll]);
    fake.step("local-player", clock("Atk01_Hand", .016)); fake.step("local-player", clock("Atk01_Hand", .43));
    expect(keys(fake)).toEqual(["key:ItemSound.fist_2", "key:MonSound.Hit_Wet_2"]);
    const [voice, item, shot] = fake.combat.inspection().recent;
    expect(voice).toMatchObject({ outcome: "skipped", skipped: [{ role: "attackVoice", reason: "chance" }] });
    expect(item!.sounds[0]).toMatchObject({ slotIndex: 1, slotCount: 3 });
    expect(shot).toMatchObject({ outcome: "played", skipped: [{ role: "damage", reason: "chance" }] });
    const playingBoundaryVoiceRoll = randomForAppRand(50), playingBoundaryDamageRoll = randomForAppRand(70);
    const boundaryRollsPlay = fixture({}, [playingBoundaryVoiceRoll, 0, 0, playingBoundaryDamageRoll]);
    boundaryRollsPlay.step("local-player", clock("Atk01_Hand", .016)); boundaryRollsPlay.step("local-player", clock("Atk01_Hand", .43));
    expect(keys(boundaryRollsPlay)).toEqual(["key:ChrSound.MHFighter_1H_Atk_1", "key:ItemSound.fist_1", "key:MonSound.Hit_Bone_6", "key:MonSound.field_stalker_dmg_1"]);
  });

  it("skips AttackItem/AttackVoice while the same sound still plays on that pawn, including a direct cue's sound", () => {
    const fake = fixture();
    fake.step("local-player", clock("Atk01_Hand", .016)); fake.step("local-player", clock("Atk01_Hand", .85));
    const recentWithRepeatedSlotZeroPicksSkippedAndRouteCReplayed = fake.combat.inspection().recent;
    expect(recentWithRepeatedSlotZeroPicksSkippedAndRouteCReplayed.map(row => [row.route, row.outcome]))
      .toEqual([["B", "played"], ["A", "played"], ["C", "played"], ["B", "skipped"], ["A", "skipped"], ["C", "played"]]);
    expect(recentWithRepeatedSlotZeroPicksSkippedAndRouteCReplayed[4]!.skipped[0]).toMatchObject({ role: "attackItem", reason: "still-playing" });
    expect(fake.combat.describe().find(row => row.name === "combat.isPlayingSkip")!.value()).toContain("still playing on local-player");
    const skippedVoiceRoll = randomForAppRand(99), fistTwoPick = randomForAppRand(1);
    const directCueBlocksFistPick = fixture({}, [skippedVoiceRoll, fistTwoPick]);
    const sharedPawnSoundLedger = nativePawnSoundLedger(directCueBlocksFistPick.mixer);
    sharedPawnSoundLedger.started("local-player", "ItemSound.Group.fist_2", "native-action:1:local-player", 10.5);
    directCueBlocksFistPick.step("local-player", clock("Atk01_Hand", .016)); directCueBlocksFistPick.step("local-player", clock("Atk01_Hand", .37));
    expect(directCueBlocksFistPick.combat.inspection().recent.at(-1)).toMatchObject({ route: "A", outcome: "skipped", skipped: [{ reason: "still-playing" }] });
    sharedPawnSoundLedger.release("native-action:1:local-player"); directCueBlocksFistPick.queue.push(skippedVoiceRoll, fistTwoPick);
    directCueBlocksFistPick.step("local-player", clock("Atk01_Hand", .016)); directCueBlocksFistPick.step("local-player", clock("Atk01_Hand", .37));
    expect(directCueBlocksFistPick.combat.inspection().recent.at(-1)).toMatchObject({ route: "A", outcome: "played" });
  });

  it("Musveren: empty attack_sound1 stays silent, no AttackVoice for NPCs, fighter defense/damage via chargrp or chest armor (conditional)", () => {
    const emptyAttackSoundPick = 0, defensePick = 0, skippedPlayerDamageRollAboveCharSoundRandom = randomForAppRand(51);
    const fake = fixture({}, [emptyAttackSoundPick, defensePick, skippedPlayerDamageRollAboveCharSoundRandom]);
    fake.step("native-musveren", clock("atk01", .02, { durationSeconds: 1.8333 })); fake.step("native-musveren", clock("atk01", .75, { durationSeconds: 1.8333 }));
    const [item, shot] = fake.combat.inspection().recent;
    expect(item).toMatchObject({ route: "A", outcome: "no-sound", skipped: [{ role: "attackItem", reason: "empty-slot" }] });
    expect(shot!.sounds.map(sound => [sound.reference, sound.entityId, sound.volume, sound.radiusUnits])).toEqual([["ItemSound.armor_underwear_1", "local-player", 250, 30]]);
    expect(shot!.skipped).toEqual([{ role: "damage", reason: "chance", detail: "appRand()%100 > 50 (p 0.510)" }]);
    fake.entities.set("local-player", entity("local-player", "local-player", 0, { equipment: { upper: 22 } }));
    fake.step("native-musveren", clock("atk01", .02, { durationSeconds: 1.8333 })); fake.step("native-musveren", clock("atk01", .75, { durationSeconds: 1.8333 }));
    expect(fake.combat.inspection().lastHit!.sounds.map(sound => [sound.reference, sound.radiusUnits])).toEqual([["ItemSound.armor_leather_3", 40], ["ChrSound.MHFighter_Dmg_1", 30]]);
  });

  it("never replays: late joins skip earlier notifies, disabled/paused events are consumed, retriggers start a new generation", () => {
    const fake = fixture();
    fake.step("local-player", clock("Atk01_Hand", .4)); fake.step("local-player", clock("Atk01_Hand", .45));
    expect(keys(fake)).toEqual(["key:MonSound.Hit_Bone_6", "key:MonSound.field_stalker_dmg_1"]);
    fake.combat.setEnabled(false);
    fake.step("local-player", clock("Atk01_Hand", .016)); fake.step("local-player", clock("Atk01_Hand", .43));
    fake.combat.setEnabled(true); fake.step("local-player", clock("Atk01_Hand", .6));
    expect(fake.mixer.startVoice).toHaveBeenCalledTimes(2);
    expect(fake.combat.inspection().recent.slice(1).map(row => row.outcome)).toEqual(["disabled", "disabled", "disabled"]);
    fake.pause(true); fake.step("local-player", clock("Atk01_Hand", .016)); fake.step("local-player", clock("Atk01_Hand", .43));
    expect(fake.mixer.startVoice).toHaveBeenCalledTimes(2); fake.pause(false); fake.endAll();
    fake.step("local-player", clock("Atk01_Hand", .016)); fake.step("local-player", clock("Atk01_Hand", .43));
    expect(fake.mixer.startVoice).toHaveBeenCalledTimes(6);
  });

  it("uses a documented clip fraction for an attack clip without AttackShot", () => {
    const fake = fixture();
    fake.entities.set("local-player", entity("local-player", "local-player", 0, { animation: "attack" }));
    fake.step("local-player", clock("NoShotAttack", .016, { durationSeconds: 1 }));
    fake.step("local-player", clock("NoShotAttack", FALLBACK_SHOT_FRACTION + .01, { durationSeconds: 1 }));
    expect(keys(fake)).toEqual(["key:ItemSound.fist_1", "key:MonSound.Hit_Bone_6", "key:MonSound.field_stalker_dmg_1"]);
    expect(fake.combat.inspection().lastHit).toMatchObject({ type: "fraction-fallback", sourceTimeSeconds: FALLBACK_SHOT_FRACTION });
  });

  it("Power Strike at target: cast at clip start, no reach gate for the explicit target, shot + defense + damage at AttackShot", () => {
    const fake = fixture();
    fake.entities.set("native-musveren", entity("native-musveren", "monster", 30));
    fake.entities.set("local-player", entity("local-player", "local-player", 0, { animation: "attack", actionPreview: "special-attack", actionTargetId: "native-musveren" }));
    fake.step("local-player", clock("SpAtk01_1HS", .016, { durationSeconds: 1.5667 }));
    expect(keys(fake)).toEqual(["key:SkillSound.power_strike_cast"]);
    fake.step("local-player", clock("SpAtk01_1HS", .93, { durationSeconds: 1.5667 }));
    expect(keys(fake).slice(1)).toEqual(["key:ItemSound.fist_1", "key:SkillSound.power_strike_shot", "key:MonSound.Hit_Bone_6", "key:MonSound.field_stalker_dmg_1"]);
    expect(fake.combat.inspection().lastHit).toMatchObject({ special: true, notify: "Fighter.AnimNotify_AttackShot167", reachGated: false, targetId: "native-musveren" });
    expect(fake.combat.inspection().lastHit!.distanceMetres).toBeGreaterThan(29);
  });

  it("right-hand Short Sword replaces the fist list with [ItemSound] Vol/Radius", () => {
    const voiceRoll = 0, voicePick = 0, swordBigSevenPick = randomForAppRand(1);
    const fake = fixture({}, [voiceRoll, voicePick, swordBigSevenPick]);
    fake.combat.setWeapon("weapon:1");
    fake.step("local-player", clock("Atk01_Hand", .016)); fake.step("local-player", clock("Atk01_Hand", .37));
    expect(fake.combat.inspection().recent.at(-1)!.sounds[0]).toMatchObject({ reference: "ItemSound.sword_big_7", volume: 250, radiusUnits: 40, slotCount: 2 });
    expect(fake.combat.inspection().weapons.map(row => row.label)).toEqual(["Empty hand (fist)", "Short Sword"]);
    expect(() => fake.combat.setWeapon("weapon:99")).toThrow();
  });

  it("test auditions: full impact ignoring reach and probabilities; later server flags take their native branch", () => {
    const fake = fixture({ enabled: false }, [randomForAppRand(99), randomForAppRand(99), randomForAppRand(99), randomForAppRand(99)]);
    fake.entities.set("native-musveren", entity("native-musveren", "monster", 40));
    expect(fake.combat.test("musveren-hit")).toMatchObject({ attackerId: "native-musveren", targetId: "local-player", outcome: "played" });
    expect(keys(fake)).toEqual(["key:ItemSound.armor_underwear_1", "key:ChrSound.MHFighter_Dmg_1"]);
    fake.combat.test("player-hit", 0x20);
    expect(keys(fake).slice(2)).toEqual(["key:ItemSound.fist_1", "key:SkillSound.Critical_Hit_02", "key:MonSound.field_stalker_dmg_1"]);
    fake.combat.test("player-hit", 0x10);
    expect(keys(fake).slice(5, 7)).toEqual(["key:ItemSound.fist_1", "key:SkillSound.Soul_Shot_Shot"]);
    const miss = fake.combat.test("player-hit", 0x80)!;
    expect(miss.outcome).toBe("miss"); expect(miss.sounds.map(sound => sound.role)).toEqual(["attackItem"]); expect(miss.shotRoute).toBe("miss");
    expect(fake.combat.test("player-hit", 0x40)!.sounds.map(sound => sound.role)).toEqual(["attackItem", "defense", "damage"]);
    fake.combat.test("power-strike");
    expect(keys(fake).slice(-4)).toEqual(["key:ItemSound.fist_1", "key:SkillSound.power_strike_shot", "key:MonSound.Hit_Bone_6", "key:MonSound.field_stalker_dmg_1"]);
  });

  it("positions voices at the pawn Location and applies the distance gain chip", () => {
    const fake = fixture({}, [], [0, .235, 0]);
    fake.combat.test("player-hit");
    expect(fake.voices[0]!.position).toEqual([0, .235, 0]); expect(fake.voices[0]!.gain).toBeCloseTo(250 / 255, 12);
    expect(fake.voices[1]!.position).toEqual([1.4, .3, 0]);
    const distance = Math.hypot(1.4, .065) * 100;
    expect(fake.voices[1]!.gain).toBeCloseTo(nativeCombatGain(250, 50, distance, "ambient-curve"), 12);
    fake.combat.setDistanceGain("flat"); fake.combat.test("player-hit");
    expect(fake.voices[4]!.gain).toBeCloseTo(250 / 255, 12);
    expect(() => fake.combat.setDistanceGain("loud" as never)).toThrow();
  });

  it("stops an entity's voices on despawn and every owner on dispose; disposal is final", () => {
    const fake = fixture();
    fake.step("native-musveren", clock("atk01", .02)); fake.entities.delete("native-musveren"); fake.combat.update();
    expect(fake.mixer.stopOwner).toHaveBeenCalledWith("native-combat:native-musveren");
    fake.combat.dispose(); fake.combat.dispose();
    expect(fake.mixer.stopOwner).toHaveBeenCalledWith("native-combat:local-player");
    fake.step("local-player", clock("Atk01_Hand", .016)); fake.step("local-player", clock("Atk01_Hand", .43));
    expect(fake.mixer.startVoice).not.toHaveBeenCalled(); expect(fake.combat.test("player-hit")).toBeNull();
    expect(fake.combat.inspection().disposed).toBe(true);
  });

  it("registers staged sounds and reports source-mismatched actors or a missing config row without guessing", () => {
    const { mixer } = fakeMixer();
    const combat = createNativeCombatAudio(bundle, mixer, { entity: () => null, sourceClock: () => null, selectedEntityId: () => null, paused: () => false },
      [{ entityId: "local-player", catalogId: "human-male-fighter:0", asset: monsterAsset, collisionRadiusMetres: .09 }]);
    expect(mixer.register).toHaveBeenCalledWith("key:ItemSound.fist_1", new Uint8Array([1]));
    expect(combat.inspection().actors[0]!.selection).toBeNull();
    expect(combat.inspection().diagnostics[0]).toContain("source differs");
    const missing = createNativeCombatAudio(null, mixer, { entity: () => null, sourceClock: () => null, selectedEntityId: () => null, paused: () => false }, []);
    expect(missing.inspection().diagnostics).toContain("Combat sound bundle is not staged (catalog.combatAudio).");
    const noConfig = createNativeCombatAudio({ ...bundle, selections: bundle.selections.filter(row => row.kind !== "config") }, mixer,
      { entity: () => null, sourceClock: () => null, selectedEntityId: () => null, paused: () => false }, []);
    expect(noConfig.inspection().diagnostics[0]).toContain("no ALAudio.int config row");
    expect(noConfig.inspection().rules.config).toBe("missing");
  });

  it("describes live developer-sheet variables with dotted names and explicit status", () => {
    const fake = fixture();
    const rows = fake.combat.describe();
    expect(rows.every(row => /^combat\.[A-Za-z]+$/.test(row.name) && ["native", "presentation", "unverified"].includes(row.status) &&
      typeof row.values === "string" && row.source.length > 0)).toBe(true);
    const row = (name: string) => rows.find(item => item.name === name)!;
    expect(row("combat.reachMetres").value()).toBe("1.5");
    fake.combat.setReach(2.5); expect(row("combat.reachMetres").value()).toBe("2.5");
    expect(row("combat.rightHand").value()).toBe("Empty hand (fist)"); fake.combat.setWeapon("weapon:1"); expect(row("combat.rightHand").value()).toBe("Short Sword");
    expect(row("combat.targetRule").detail).toContain(PRESENTATION_STATUS);
    expect(row("combat.attackOutcome")).toMatchObject({ status: "presentation" }); expect(row("combat.attackOutcome").source).toContain(OFFLINE_OUTCOME);
    expect(row("combat.attackItem").status).toBe("native"); expect(row("combat.damageSound").values).toContain("p 71.1%");
    expect(row("combat.attackVoice").values).toContain("p 51.0%");
    expect(row("combat.attackItem").value()).toBe("none yet");
    fake.combat.test("player-hit");
    expect(row("combat.attackItem").value()).toBe("sword_small_1 · slot 1/2 · gain 0.98");
    expect(row("combat.lastHit").value()).toContain("local-player → native-musveren");
  });
});

const manifest = (sha: string) => ({ schemaVersion: 1, kind: "native-combat-audio-dependencies",
  sounds: [{ dependencyId: `IMPORTA-PC:${"a".repeat(64)}:201`, file: `audio/${sha}.wav`, bytes: 4, sha256: sha, mime: "audio/wav",
    source: { object: "skillsound.critical_hit.critical_hit_02", packageSha256: "a".repeat(64), exportIndex: 201 } }],
  selections: [{ id: "config", kind: "config", label: "ALAudio.int", table: "alaudio", rowOrdinal: 0,
    numeric: { "CharSound.Random": 50 },
    roles: { critical: { field: "EtcSound.CriticalSound", slots: [
      { index: 0, reference: "SkillSound.Critical_Hit_02", status: "unique-package-leaf-candidate", dependencyId: `IMPORTA-PC:${"a".repeat(64)}:201`, sourcePointer: "/config/alaudio/EtcSound.CriticalSound" }] },
    soulshot: { field: "EtcSound.SoulShotSound", slots: [{ index: 0, reference: "", status: "empty", dependencyId: null, sourcePointer: "/config/alaudio/EtcSound.SoulShotSound" }] } } }] });

describe("combat bundle loader", () => {
  it("admits config rows and only bundle-admitted slots whose table string agrees with the export by package and leaf", () => {
    const parsed = parseNativeCombatManifest(manifest("b".repeat(64)), "c".repeat(64));
    const config = parsed.selections[0]!;
    expect(config.kind).toBe("config"); expect(config.numeric).toEqual({ "CharSound.Random": 50 });
    expect(config.roles.critical!.slots.map(slot => [slot.reference, slot.object, slot.key])).toEqual([["SkillSound.Critical_Hit_02", "skillsound.critical_hit.critical_hit_02", `native-combat:${"b".repeat(64)}`]]);
    expect(config.roles.soulshot!.unadmitted).toEqual([{ index: 0, reference: "", status: "empty" }]);
    const wrong = manifest("b".repeat(64)); wrong.selections[0]!.roles.critical.slots[0]!.reference = "SkillSound.Critical_Hit_01";
    expect(() => parseNativeCombatManifest(wrong, "c".repeat(64))).toThrow("differs from its admitted dependency");
  });

  it("returns null when nothing is staged and verifies every fetched hash", async () => {
    const wav = new Uint8Array([82, 73, 70, 70]), wavSha = await sha256(wav);
    const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest(wavSha))), manifestSha = await sha256(manifestBytes);
    const files = new Map<string, Uint8Array | object>([["/l2/catalog.json", { schemaVersion: 1, models: [] }]]);
    const fetcher = vi.fn(async (url: string) => {
      const value = files.get(url);
      if (!value) return new Response(null, { status: 404 });
      return value instanceof Uint8Array ? new Response(value.slice().buffer) : new Response(JSON.stringify(value));
    }) as unknown as typeof fetch;
    await expect(loadNativeCombatAudio(new AbortController().signal, { fetch: fetcher })).resolves.toBeNull();
    files.set("/l2/catalog.json", { schemaVersion: 1, models: [], combatAudio: [{ id: "native-combat-audio",
      manifest: `/l2/combat-audio/${manifestSha}/manifest.json`, manifestBytes: manifestBytes.length, manifestSha256: manifestSha }] });
    files.set(`/l2/combat-audio/${manifestSha}/manifest.json`, manifestBytes);
    files.set(`/l2/combat-audio/${manifestSha}/audio/${wavSha}.wav`, wav);
    const loaded = await loadNativeCombatAudio(new AbortController().signal, { fetch: fetcher });
    expect(loaded?.sounds).toEqual([{ key: `native-combat:${wavSha}`, bytes: wav }]);
    files.set(`/l2/combat-audio/${manifestSha}/audio/${wavSha}.wav`, new Uint8Array([0, 0, 0, 0]));
    await expect(loadNativeCombatAudio(new AbortController().signal, { fetch: fetcher })).rejects.toThrow("hash/length mismatch");
  });
});

class FakeElement extends EventTarget {
  dataset: Record<string, string> = {}; children: FakeElement[] = []; parent: FakeElement | null = null;
  textContent = ""; value = ""; disabled = false; className = ""; type = ""; hidden = false; tabIndex = 0;
  min = ""; max = ""; step = ""; attributes = new Map<string, string>(); focused = false;
  constructor(readonly tagName: string) { super(); }
  append(...items: (FakeElement | string)[]) {
    for (const item of items) if (typeof item !== "string") { item.parent = this; this.children.push(item); }
  }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); this.parent = null; }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  focus() { this.focused = true; }
  find(testid: string): FakeElement | undefined {
    if (this.dataset.testid === testid) return this;
    for (const child of this.children) { const found = child.find(testid); if (found) return found; }
    return undefined;
  }
  chip(value: string) { return this.children.find(child => child.dataset.value === value)!; }
}
const checked = (group: FakeElement) => group.children.filter(child => child.getAttribute("aria-checked") === "true").map(child => child.dataset.value);

describe("combat audio controls", () => {
  it("renders chip groups and compact readouts, wires every control, and lists its hover-cards", async () => {
    vi.stubGlobal("document", { createElement: (tag: string) => new FakeElement(tag) });
    const fake = fixture();
    const host = new FakeElement("div"), unlock = vi.fn(async () => undefined);
    const controls = attachNativeCombatAudioControls(host as unknown as HTMLElement, fake.combat, null, unlock);
    const root = host.children[0]!;
    expect(root.dataset.testid).toBe("native-combat-audio-controls");
    const enabled = root.find("native-combat-enabled")!, rule = root.find("native-combat-target-rule")!, weapon = root.find("native-combat-weapon")!;
    const distance = root.find("native-combat-distance")!;
    for (const group of [enabled, rule, weapon, distance]) {
      expect([group.className, group.getAttribute("role")]).toEqual(["dev-chips", "radiogroup"]);
      expect(group.getAttribute("aria-label")).toBeTruthy();
      expect(group.children.every(chip => chip.tagName === "button" && chip.type === "button" && chip.getAttribute("role") === "radio")).toBe(true);
    }
    expect([checked(enabled), checked(rule), checked(weapon), checked(distance)]).toEqual([["on"], ["selected-or-nearest"], ["fist"], ["ambient-curve"]]);
    enabled.chip("off").dispatchEvent(new Event("click")); expect(fake.combat.inspection().enabled).toBe(false); expect(checked(enabled)).toEqual(["off"]);
    rule.chip("selected").dispatchEvent(new Event("click")); expect(fake.combat.inspection().targetRule).toBe("selected");
    weapon.chip("weapon:1").dispatchEvent(new Event("click")); expect(fake.combat.inspection().weapon).toBe("weapon:1");
    distance.chip("ambient-curve").dispatchEvent(Object.assign(new Event("keydown"), { key: "ArrowRight" }));
    expect(fake.combat.inspection().distanceGain).toBe("flat"); expect(distance.chip("flat").focused).toBe(true);
    const reach = root.find("native-combat-reach")!, reachValue = root.find("native-combat-reach-value")!;
    expect(reach.value).toBe("1.5"); expect(reachValue.parent).toBe(reach.parent);
    reach.value = "3.2"; reach.dispatchEvent(new Event("input")); expect(fake.combat.inspection().reachMetres).toBe(3.2);
    expect(reachValue.textContent).toBe("3.2 m");
    expect(root.find("native-combat-last-hit")!.textContent).toBe("none yet");
    expect(root.find("native-combat-status")!.hidden).toBe(true);
    expect([...root.children].every(child => !child.attributes.has("title"))).toBe(true);
    root.find("native-combat-test-player")!.dispatchEvent(new Event("click"));
    expect(unlock).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(fake.mixer.startVoice).toHaveBeenCalled());
    expect(root.find("native-combat-last-hit")!.textContent).toMatch(/^test: sword_small_1 \+ Hit_Bone_6 \+ field_stalker_dmg_1$/);
    const cards = controls.cards();
    expect(cards.map(card => card.title)).toEqual(["Hit sounds", "Target rule", "Reach", "Right hand", "Distance gain", "Test impacts", "Last attack event", "Last hit"]);
    const names = new Set(controls.describe().map(row => row.name));
    expect(cards.every(card => card.names.every(name => names.has(name)))).toBe(true);
    expect(cards[0]!.description).toContain("treated as a normal hit (flags 0)");
    controls.dispose(); expect(host.children).toEqual([]);
    root.find("native-combat-test-player")!.dispatchEvent(new Event("click")); expect(unlock).toHaveBeenCalledTimes(1);
  });

  it("disables everything and keeps the failure visible when the bundle is missing", () => {
    vi.stubGlobal("document", { createElement: (tag: string) => new FakeElement(tag) });
    const host = new FakeElement("div");
    attachNativeCombatAudioControls(host as unknown as HTMLElement, null, "network down");
    const root = host.children[0]!;
    expect(root.find("native-combat-enabled")!.children.every(chip => chip.disabled)).toBe(true);
    expect(root.find("native-combat-reach")!.disabled).toBe(true);
    const status = root.find("native-combat-status")!;
    expect([status.textContent, status.hidden]).toEqual(["Hit sounds unavailable: network down", false]);
  });
});

const stagedCatalog = existsSync("public/l2/catalog.json") ? JSON.parse(readFileSync("public/l2/catalog.json", "utf8")) as
  { combatAudio?: unknown[]; models: { id: string; archive: string }[] } : null;
describe.skipIf(!stagedCatalog?.combatAudio)("staged combat bundle with the real actor packages", () => {
  const disk = (async (url: string) => {
    const path = `public${url}`;
    return existsSync(path) ? new Response(readFileSync(path)) : new Response(null, { status: 404 });
  }) as unknown as typeof fetch;
  const archive = async (id: string) => readAssetPackage(new Uint8Array(readFileSync(`public${stagedCatalog!.models.find(row => row.id === id)!.archive}`)));

  it("loads the native-meaning numbers and ALAudio.int config, and plays both Hand AttackShots on Musveren", async () => {
    const staged = (await loadNativeCombatAudio(new AbortController().signal, { fetch: disk }))!;
    expect(staged.sounds.length).toBe(59);
    const musveren = staged.selections.find(row => row.id === "greater-musveren")!;
    expect(musveren.numeric).toEqual({ soundRadius: 50, soundVolume: 250, soundRandom: 70 });
    const config = staged.selections.find(row => row.kind === "config")!;
    expect(config.numeric).toMatchObject({ "CharSound.Random": 50, "CharSound.Vol": 250, "CharSound.Radius": 30, "ItemSound.Radius": 40 });
    expect([config.roles.critical!.slots[0]!.object, config.roles.soulshot!.slots[0]!.object])
      .toEqual(["skillsound.critical_hit.critical_hit_02", "skillsound.soul_shot.soul_shot_shot"]);
    const [fighter, monster] = await Promise.all([archive("human-male-fighter:0"), archive("musveren:0")]);
    const entities = new Map([["local-player", entity("local-player", "local-player", 0)], ["native-musveren", entity("native-musveren", "monster", 1.4)]]);
    const clocks = new Map<string, NativeActorClock>();
    const fake = fakeMixer();
    const combat = createNativeCombatAudio(staged, fake.mixer, { entity: id => entities.get(id) ?? null, sourceClock: id => clocks.get(id) ?? null,
      selectedEntityId: () => "native-musveren", paused: () => false }, [
      { entityId: "local-player", catalogId: "human-male-fighter:0", asset: fighter, collisionRadiusMetres: .09 },
      { entityId: "native-musveren", catalogId: "musveren:0", asset: monster, collisionRadiusMetres: .18 }], { random: () => 0 });
    expect(combat.inspection().diagnostics).toEqual([]);
    expect(fake.mixer.register).toHaveBeenCalledTimes(59);
    const step = (id: string, value: NativeActorClock) => { clocks.set(id, value); combat.update(); };
    step("local-player", clock("Atk01_Hand_MFighter", .01, { durationSeconds: 43 / 30 })); fake.endAll();
    step("local-player", clock("Atk01_Hand_MFighter", 1, { durationSeconds: 43 / 30 }));
    const shots = combat.inspection().recent.filter(row => row.route === "C");
    expect(shots.map(row => [row.notify, row.sourceTimeSeconds, row.shot])).toEqual([
      ["Fighter.AnimNotify_AttackShot145", 0.42000000377496083, { index: 1, count: 2 }],
      ["Fighter.AnimNotify_AttackShot146", 0.8466666261355082, { index: 2, count: 2 }]]);
    expect(shots[0]!.sounds.map(sound => [sound.role, sound.object, sound.volume, sound.radiusUnits])).toEqual([
      ["defense", "monsound.Public_Hit_Bone.Hit_Bone_6", 250, 50], ["damage", "monsound.field_stalker.field_stalker_dmg_1", 250, 50]]);
    expect(combat.inspection().recent.slice(0, 2).map(row => row.sounds.map(sound => sound.object))).toEqual([
      ["chrsound.MHFighter_Normal_Attack.MHFighter_1H_Atk_1"], ["itemsound.Weapon_Fist.fist_1"]]);
    step("native-musveren", clock("atk01", .01, { durationSeconds: 55 / 30 }));
    step("native-musveren", clock("atk01", .75, { durationSeconds: 55 / 30 }));
    expect(combat.inspection().lastHit!.sounds.map(sound => [sound.reference, sound.radiusUnits])).toEqual([["ItemSound.armor_underwear_1", 30], ["ChrSound.MHFighter_Dmg_1", 30]]);
  });

  const appRandZeroAlwaysPlayingAttackVoice = () => 0;
  it.each([
    ["human-female-fighter:0", "FFighter", "Fighter", "chrsound.FHFighter_Normal_Attack.FHFighter_1H_Atk_1", "ChrSound.FHFighter_Dmg_1"],
    ["human-male-mystic:0", "MMagic", "Magic", "chrsound.MHMagician_Normal_Attack.MHMagician_1H_Atk_1", "ChrSound.MHMagician_Dmg_1"],
    ["human-female-mystic:0", "FMagic", "Magic", "chrsound.FHMagician_Normal_Attack.FHMagician_1H_Atk_1", "ChrSound.FHMagician_Dmg_1"],
  ])("%s plays its own fist, attack voice and hurt voice from the staged bundle", async (catalogId, cls, pkg, voice, hurt) => {
    const staged = (await loadNativeCombatAudio(new AbortController().signal, { fetch: disk }))!;
    const [player, monster] = await Promise.all([archive(catalogId), archive("musveren:0")]);
    const attack = `Atk01_Hand_${cls}`, first = (player.manifest.animationEvents ?? [])
      .find(row => (row as { clip?: string }).clip === attack) as { sourceFrames: number; sourceRate: number };
    const durationSeconds = first.sourceFrames / first.sourceRate;
    const entities = new Map([["local-player", entity("local-player", "local-player", 0)], ["native-musveren", entity("native-musveren", "monster", 1.4)]]);
    const clocks = new Map<string, NativeActorClock>();
    const fake = fakeMixer();
    const combat = createNativeCombatAudio(staged, fake.mixer, { entity: id => entities.get(id) ?? null, sourceClock: id => clocks.get(id) ?? null,
      selectedEntityId: () => "native-musveren", paused: () => false }, [
      { entityId: "local-player", catalogId, asset: player, collisionRadiusMetres: .09 },
      { entityId: "native-musveren", catalogId: "musveren:0", asset: monster, collisionRadiusMetres: .18 }], { random: appRandZeroAlwaysPlayingAttackVoice });
    expect(combat.inspection().diagnostics).toEqual([]);
    const step = (id: string, value: NativeActorClock) => { clocks.set(id, value); combat.update(); };
    step("local-player", clock(attack, .01, { durationSeconds })); fake.endAll();
    step("local-player", clock(attack, durationSeconds - .01, { durationSeconds }));
    const recent = combat.inspection().recent;
    expect(recent.slice(0, 3).map(row => [row.route, row.notify.split(".")[0], row.sounds.map(sound => sound.object)])).toEqual([
      ["B", pkg, [voice]], ["A", pkg, ["itemsound.Weapon_Fist.fist_1"]],
      ["C", pkg, ["monsound.Public_Hit_Bone.Hit_Bone_6", "monsound.field_stalker.field_stalker_dmg_1"]]]);
    expect(recent.filter(row => row.route === "C").map(row => row.shot)).toEqual([{ index: 1, count: 2 }, { index: 2, count: 2 }]);
    step("native-musveren", clock("atk01", .01, { durationSeconds: 55 / 30 }));
    step("native-musveren", clock("atk01", .75, { durationSeconds: 55 / 30 }));
    expect(combat.inspection().lastHit!.sounds.map(sound => sound.reference)).toEqual(["ItemSound.armor_underwear_1", hurt]);
    combat.dispose();
  });

  it("female special attack: the direct fist_2 cue blocks a fist_2 AttackItem pick on the same pawn (shared IsPlaying)", async () => {
    const staged = (await loadNativeCombatAudio(new AbortController().signal, { fetch: disk }))!;
    const female = await archive("human-female-fighter:0"), monster = await archive("musveren:0");
    const fake = fakeMixer();
    const cues = await createNativeActionCuePreview(new Map([["human-female-fighter:0", female], ["musveren:0", monster]]), fake.mixer,
      { activeCatalogIds: ["human-female-fighter:0", "musveren:0"], includeHumanSpecialAttackCues: true });
    const player = cues.bindActor("local-player", female);
    const special = (elapsedSeconds: number): NativeActorClock => ({ clip: "SpAtk01_1HS_FFighter", mode: "once", elapsedSeconds,
      durationSeconds: 47 / 30, playing: true, completed: false });
    const powerStrikeCastPick = 0, attackItemFistTwoPick = randomForAppRand(1);
    const randoms = [powerStrikeCastPick, attackItemFistTwoPick];
    const entities = new Map([["local-player", entity("local-player", "local-player", 0, { animation: "attack", actionPreview: "special-attack" })]]);
    const clocks = new Map<string, NativeActorClock>();
    const combat = createNativeCombatAudio(staged, fake.mixer, { entity: id => entities.get(id) ?? null, sourceClock: id => clocks.get(id) ?? null,
      selectedEntityId: () => null, paused: () => false }, [
      { entityId: "local-player", catalogId: "human-female-fighter:0", asset: female, collisionRadiusMetres: .08 }],
      { random: () => randoms.length ? randoms.shift()! : 0 });
    player.start(special(0)); clocks.set("local-player", special(0)); combat.update();
    player.advance(special(0), special(.6));
    expect(fake.mixer.play.mock.calls.map(call => call[0])).toContain("native-action:a352d22e8f2ca23e47520034d39ea98620c514d5e01abbcd820c67eb28165bc3");
    clocks.set("local-player", special(.77)); combat.update();
    const item = combat.inspection().recent.find(row => row.route === "A")!;
    expect(item).toMatchObject({ notify: "Fighter.AnimNotify_AttackItem56", outcome: "skipped",
      skipped: [{ role: "attackItem", reason: "still-playing", detail: "ItemSound.fist_2 still playing on local-player" }] });
    cues.dispose(); combat.dispose();
  });
});
