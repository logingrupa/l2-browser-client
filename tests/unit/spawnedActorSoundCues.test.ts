import { afterEach, describe, expect, it, vi } from "vitest";
import type { NativeActorClock } from "../../src/assets/native/NativeActor";
import { parseActorClipEvents } from "../../src/assets/native/actorClipEvents";
import { buildNativeCatalogIndex } from "../../src/assets/native/nativeCatalogIndex";
import { sha256 } from "../../src/assets/package/readAssetPackage";
import { combatAudioRoleRoutingDiagnostics } from "../../src/audio/combatAudioRoleRouting";
import type { NativeCombatAudioBundle, NativeCombatSlot } from "../../src/audio/loadNativeCombatAudio";
import { bindSpawnedActorSoundCues, loadSpawnedActorSounds } from "../../src/audio/spawnedActorSoundCues";
import type { WorldAudioPlaybackReceipt } from "../../src/audio/WorldAudioMixer";
import { catalogWith } from "../support/nativeCatalogIndexFixtures";

const slot = (index: number, object: string, key: string): NativeCombatSlot => ({ index, reference: object, object,
  status: "exact-identity", sourcePointer: `/synthetic/${index}`, key });

function syntheticBundle(id: string, sounds: readonly { object: string; key: string }[]): NativeCombatAudioBundle {
  return { id, manifestSha256: "f".repeat(64), sounds: sounds.map((sound, index) => ({ key: sound.key, bytes: new Uint8Array([index + 1]) })),
    selections: [{ id: "synthetic-actor", kind: "actor", label: "Synthetic actor", table: "npcgrp", rowOrdinal: 0, numeric: {},
      roles: { damage: { selection: "synthetic-actor", table: "npcgrp", field: "damage_sound",
        slots: sounds.map((sound, index) => slot(index, sound.object, sound.key)), unadmitted: [] } } }] };
}

function soundEvent(clip: string, sound: string | null, timeSeconds: number, notify = `Synthetic.AnimNotify_Sound${timeSeconds}`) {
  return { animationSet: "Synthetic.anim", clip, normalizedTime: timeSeconds, timeSeconds, type: sound ? "AnimNotify_Sound" : "AnimNotify_AttackVoice",
    object: notify, function: "None", sound, properties: sound ? { Sound: sound } : {}, sourceFrames: 30, sourceRate: 30, timingBasis: "source-frames" };
}

function clockAt(clip: string | null, elapsedSeconds: number, patch: Partial<NativeActorClock> = {}): NativeActorClock {
  return { clip, mode: "once", elapsedSeconds, durationSeconds: 1, playing: true, completed: elapsedSeconds >= 1, ...patch };
}

function fakeMixer() {
  const registered = new Map<string, Uint8Array>(), played: WorldAudioPlaybackReceipt[] = [], stoppedOwners: string[] = [];
  let nextId = 0;
  return {
    registered, played, stoppedOwners,
    register(key: string, bytes: Uint8Array) { registered.set(key, bytes); },
    play(key: string, owner: string, offsetSeconds = 0): WorldAudioPlaybackReceipt {
      const receipt = { id: ++nextId, key, owner, contextTime: 0, offsetSeconds, durationSeconds: 1 };
      played.push(receipt);
      return receipt;
    },
    stopOwner(owner: string) { stoppedOwners.push(owner); },
  };
}

function drivenBinding(bundle: NativeCombatAudioBundle, sourceClipEvents: unknown[], entityId = "npc-entity-1", mixer = fakeMixer()) {
  let clock: NativeActorClock | null = null;
  const binding = bindSpawnedActorSoundCues({ entityId, clipEvents: parseActorClipEvents(sourceClipEvents), bundle, mixer, clipClock: () => clock });
  const advanceTo = (next: NativeActorClock | null) => { clock = next; binding.update(); };
  return { binding, mixer, advanceTo };
}

const cueOne = { object: "SyntheticSound.Group.CueOne", key: "native-combat:cue-one" };
const cueTwo = { object: "SyntheticSound.Group.CueTwo", key: "native-combat:cue-two" };

afterEach(() => { vi.unstubAllGlobals(); });

describe("spawned actor sound cues", () => {
  it("plays a bound notify cue once when the clip clock passes its source time, never before", () => {
    const { mixer, advanceTo } = drivenBinding(syntheticBundle("actor-sounds:npc:20001", [cueOne]), [soundEvent("atk01", cueOne.object, .4)]);
    expect(mixer.registered.get(cueOne.key)).toEqual(new Uint8Array([1]));
    advanceTo(clockAt("atk01", 0));
    advanceTo(clockAt("atk01", .3));
    expect(mixer.played).toEqual([]);
    advanceTo(clockAt("atk01", .5));
    advanceTo(clockAt("atk01", .9));
    expect(mixer.played.map(receipt => [receipt.key, receipt.offsetSeconds])).toEqual([[cueOne.key, .5 - .4]]);
  });

  it("plays the cue again when the clip replays and plays nothing for a clip stopped before the cue", () => {
    const { mixer, advanceTo } = drivenBinding(syntheticBundle("actor-sounds:npc:20001", [cueOne]), [soundEvent("atk01", cueOne.object, .4)]);
    advanceTo(clockAt("atk01", .5));
    advanceTo(clockAt("atk01", .1));
    advanceTo(clockAt("atk01", .45));
    expect(mixer.played).toHaveLength(2);
    advanceTo(clockAt("atk01", .2));
    advanceTo(clockAt("wait", .6));
    advanceTo(clockAt(null, 0));
    expect(mixer.played).toHaveLength(2);
  });

  it("plays a looping clip cue on every pass and consumes cues without sound while the clock is paused", () => {
    const { mixer, advanceTo } = drivenBinding(syntheticBundle("actor-sounds:npc:20001", [cueOne]), [soundEvent("wait", cueOne.object, .4)]);
    advanceTo(clockAt("wait", .2, { mode: "loop" }));
    advanceTo(clockAt("wait", .5, { mode: "loop" }));
    advanceTo(clockAt("wait", 1.3, { mode: "loop" }));
    advanceTo(clockAt("wait", 1.45, { mode: "loop" }));
    expect(mixer.played.map(receipt => receipt.offsetSeconds.toFixed(2))).toEqual(["0.10", "0.05"]);
    advanceTo(clockAt("wait", 2.5, { mode: "loop", playing: false }));
    advanceTo(clockAt("wait", 2.6, { mode: "loop" }));
    expect(mixer.played).toHaveLength(2);
  });

  it("plays each entity's own bundle and never the other entity's cue", () => {
    const mixer = fakeMixer();
    const first = drivenBinding(syntheticBundle("actor-sounds:npc:20001", [cueOne]),
      [soundEvent("atk01", cueOne.object, .4), soundEvent("atk01", cueTwo.object, .4)], "npc-entity-1", mixer);
    const second = drivenBinding(syntheticBundle("actor-sounds:npc:20002", [cueTwo]),
      [soundEvent("atk01", cueOne.object, .4), soundEvent("atk01", cueTwo.object, .4)], "npc-entity-2", mixer);
    first.advanceTo(clockAt("atk01", .5));
    second.advanceTo(clockAt("atk01", .5));
    expect(mixer.played.map(receipt => [receipt.key, receipt.owner.endsWith(":npc-entity-1") ? "first" : "second"]))
      .toEqual([[cueOne.key, "first"], [cueTwo.key, "second"]]);
  });

  it("lists a notify without a bundle slot as unbound with its sound identity and plays nothing for it", () => {
    const { binding, mixer, advanceTo } = drivenBinding(syntheticBundle("actor-sounds:npc:20001", [cueOne]),
      [soundEvent("atk01", "SyntheticSound.Group.Missing", .4, "Synthetic.AnimNotify_Sound9"), soundEvent("atk01", null, .2)]);
    expect(binding.coverage.bound).toEqual([]);
    expect(binding.coverage.unbound).toEqual([{ clip: "atk01", notify: "Synthetic.AnimNotify_Sound9", sound: "SyntheticSound.Group.Missing",
      timeSeconds: .4, reason: "notify-sound-has-no-bundle-slot" }]);
    advanceTo(clockAt("atk01", .9));
    expect(mixer.played).toEqual([]);
    expect(mixer.registered.size).toBe(0);
  });

  it("lists a group-less notify that agrees with several bundle sounds as unbound instead of picking one", () => {
    const sameLeaf = [{ object: "SyntheticSound.GroupA.Hit", key: "native-combat:a" }, { object: "SyntheticSound.GroupB.Hit", key: "native-combat:b" }];
    const { binding } = drivenBinding(syntheticBundle("actor-sounds:npc:20001", sameLeaf), [soundEvent("atk01", "SyntheticSound.Hit", .4)]);
    expect(binding.coverage.unbound.map(notify => notify.reason)).toEqual(["notify-sound-matches-several-bundle-sounds"]);
  });

  it("lists every role slot as role-routing-unresolved with its slot keys and never plays a role slot by itself", () => {
    const { binding, mixer, advanceTo } = drivenBinding(syntheticBundle("actor-sounds:npc:20001", [cueOne, cueTwo]), []);
    expect(binding.coverage).toEqual({ bundleId: "actor-sounds:npc:20001", bound: [], unbound: [], unresolvedRoles: [{ selection: "synthetic-actor",
      role: "damage", field: "damage_sound", slotKeys: [cueOne.key, cueTwo.key], reason: "combat-role-route-unresolved:npcgrp/damage" }] });
    advanceTo(clockAt("atk01", .9));
    expect(mixer.played).toEqual([]);
  });

  it("stops the playing cue and plays nothing more once disposed", () => {
    const { binding, mixer, advanceTo } = drivenBinding(syntheticBundle("actor-sounds:npc:20001", [cueOne]), [soundEvent("atk01", cueOne.object, .4)]);
    advanceTo(clockAt("atk01", .5));
    binding.dispose();
    expect(mixer.stoppedOwners).toEqual([mixer.played[0]!.owner]);
    advanceTo(clockAt("atk01", .1));
    advanceTo(clockAt("atk01", .6));
    binding.dispose();
    expect(mixer.played).toHaveLength(1);
    expect(mixer.stoppedOwners).toHaveLength(1);
  });

  it("refuses to bind a bundle that is not an actor-sounds bundle", () => {
    expect(() => drivenBinding(syntheticBundle("native-combat-audio", [cueOne]), [])).toThrow("bind only actor-sounds: bundles");
  });
});

describe("loading a spawned actor's sound bundle", () => {
  async function servedCombatAudio(bundleIds: readonly string[]) {
    const wav = new Uint8Array([82, 73, 70, 70]), wavSha = await sha256(wav), packageSha = "a".repeat(64);
    const manifest = { schemaVersion: 1, kind: "native-combat-audio-dependencies",
      sounds: [{ dependencyId: `IMPORTA-PC:${packageSha}:7`, file: `audio/${wavSha}.wav`, bytes: wav.length, sha256: wavSha, mime: "audio/wav",
        source: { object: "syntheticsound.group.cueone", packageSha256: packageSha, exportIndex: 7 } }],
      selections: [{ id: "npc-20001-npcgrp", kind: "actor", label: "Synthetic", table: "npcgrp", rowOrdinal: 0, roles: { damage: {
        field: "damage_sound", slots: [{ index: 0, reference: "SyntheticSound.CueOne", status: "unique-package-leaf-candidate",
          dependencyId: `IMPORTA-PC:${packageSha}:7`, sourcePointer: "/data/npc/0/damage_sound" }] } } }] };
    const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest)), manifestSha = await sha256(manifestBytes);
    const combatAudio = bundleIds.map(id => ({ id, manifest: `/l2/combat-audio/${manifestSha}/manifest.json`,
      manifestBytes: manifestBytes.length, manifestSha256: manifestSha }));
    const files = new Map<string, Uint8Array>([["/l2/catalog.json", new TextEncoder().encode(JSON.stringify({ schemaVersion: 1, models: [], combatAudio }))],
      [`/l2/combat-audio/${manifestSha}/manifest.json`, manifestBytes], [`/l2/combat-audio/${manifestSha}/audio/${wavSha}.wav`, wav]]);
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const bytes = files.get(url);
      return bytes ? new Response(bytes.slice()) : new Response(null, { status: 404 });
    }));
    return buildNativeCatalogIndex(catalogWith({ combatAudio }), new AbortController().signal);
  }

  it("loads the actor-sounds bundle of any catalog key the index lists and keeps it out of the default role routing", async () => {
    const index = await servedCombatAudio(["actor-sounds:npc:20001", "actor-sounds:character:3"]);
    const outcome = await loadSpawnedActorSounds("npc:20001", index, new AbortController().signal);
    expect(outcome.reason).toBeNull();
    expect(outcome.bundle?.id).toBe("actor-sounds:npc:20001");
    expect(combatAudioRoleRoutingDiagnostics(outcome.bundle)).toEqual([]);
    expect((await loadSpawnedActorSounds("character:3", index, new AbortController().signal)).bundle?.id).toBe("actor-sounds:character:3");
  });

  it("answers null with the reason for a catalog key without an actor-sounds record", async () => {
    const index = await servedCombatAudio(["actor-sounds:npc:20001"]);
    await expect(loadSpawnedActorSounds("npc:20002", index, new AbortController().signal))
      .resolves.toEqual({ bundle: null, reason: "actor-sounds:npc:20002 not in catalog" });
  });
});
