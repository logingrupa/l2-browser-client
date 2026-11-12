import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NativeActorClock } from "../../src/assets/native/NativeActor";
import { parseActorClipEvents, type ActorClipEvent } from "../../src/assets/native/actorClipEvents";
import type { NativeCatalogIndex, NativeCatalogLookup } from "../../src/assets/native/nativeCatalogIndex";
import type { NativeCombatAudioBundle } from "../../src/audio/loadNativeCombatAudio";
import type { WorldAudioPlaybackReceipt } from "../../src/audio/WorldAudioMixer";
import { actorClipListingEvents, wireSpawnedActorSounds } from "../../src/runtime/spawnedActorSoundWiring";
import type { WorldEntity, WorldEvent } from "../../src/world/worldTypes";
import { installMiniDom } from "./support/miniDom";
import { attachSandboxSheetWithFakes, fakeCatalogIndexOver } from "./support/sandboxCommandSheetFakes";

const servedBundles = vi.hoisted(() => new Map<string, NativeCombatAudioBundle>());
const loadedCatalogKeys = vi.hoisted(() => [] as string[]);

vi.mock("../../src/audio/spawnedActorSoundCues", async importOriginal => {
  const original = await importOriginal<typeof import("../../src/audio/spawnedActorSoundCues")>();
  return {
    ...original,
    loadSpawnedActorSounds: async (catalogKey: string, catalogIndex: Pick<NativeCatalogIndex, "lookup">, signal: AbortSignal) => {
      loadedCatalogKeys.push(catalogKey);
      const bundle = servedBundles.get(`actor-sounds:${catalogKey}`);
      return bundle ? { bundle, reason: null } : original.loadSpawnedActorSounds(catalogKey, catalogIndex, signal);
    },
  };
});

const cueObject = "SyntheticSound.Group.CueOne", cueKey = "native-combat:cue-one";

function syntheticBundle(id: string): NativeCombatAudioBundle {
  return { id, manifestSha256: "f".repeat(64), sounds: [{ key: cueKey, bytes: new Uint8Array([1]) }],
    selections: [{ id: "synthetic-actor", kind: "actor", label: "Synthetic actor", table: "npcgrp", rowOrdinal: 0, numeric: {},
      roles: { damage: { selection: "synthetic-actor", table: "npcgrp", field: "damage_sound", unadmitted: [],
        slots: [{ index: 0, reference: cueObject, object: cueObject, status: "exact-identity", sourcePointer: "/synthetic/0", key: cueKey }] } } }] };
}

const clipEvents: readonly ActorClipEvent[] = parseActorClipEvents([{ animationSet: "Synthetic.anim", clip: "atk01", normalizedTime: .4, timeSeconds: .4,
  type: "AnimNotify_Sound", object: "Synthetic.AnimNotify_Sound0", function: "None", sound: cueObject, properties: { Sound: cueObject },
  sourceFrames: 30, sourceRate: 30, timingBasis: "source-frames" }]);

const catalogIndex: Pick<NativeCatalogIndex, "lookup"> = {
  lookup: (key): NativeCatalogLookup => servedBundles.has(key)
    ? { status: "converted", key, namedGaps: [], record: { entityCatalogKey: key.slice("actor-sounds:".length) } }
    : { status: "not-in-catalog", key, reason: "not in catalog" },
};

function entity(id: string, patch: Partial<WorldEntity>): WorldEntity {
  return { id, kind: "npc", displayName: id, position: { x: 0, y: 0, z: 0 }, orientationRadians: 0, health: 100, maximumHealth: 100, animation: "idle", ...patch };
}

function fakeMixer() {
  const played: WorldAudioPlaybackReceipt[] = [], stoppedOwners: string[] = [];
  let nextId = 0;
  return {
    played, stoppedOwners,
    register: vi.fn(),
    play(key: string, owner: string, offsetSeconds = 0): WorldAudioPlaybackReceipt {
      const receipt = { id: ++nextId, key, owner, contextTime: 0, offsetSeconds, durationSeconds: 1 };
      played.push(receipt);
      return receipt;
    },
    stopOwner(owner: string) { stoppedOwners.push(owner); },
  };
}

function wiredWithFakes() {
  const listeners = new Set<(event: WorldEvent) => void>();
  const adapter = { subscribe(listener: (event: WorldEvent) => void) { listeners.add(listener); return () => { listeners.delete(listener); }; } };
  const emit = (event: WorldEvent) => { for (const listener of [...listeners]) listener(event); };
  const clocks = new Map<string, NativeActorClock>(), listedClipEvents = new Map<string, readonly ActorClipEvent[]>();
  const mixer = fakeMixer(), lifetime = new AbortController();
  const changes = vi.fn();
  const sounds = wireSpawnedActorSounds({ adapter, catalogIndex, mixer, signal: lifetime.signal,
    clipEvents: entityId => listedClipEvents.get(entityId) ?? null, clipClock: entityId => clocks.get(entityId) ?? null });
  const unsubscribeChanges = sounds.subscribe(changes);
  const clockAt = (entityId: string, elapsedSeconds: number) => {
    clocks.set(entityId, { clip: "atk01", mode: "once", elapsedSeconds, durationSeconds: 1, playing: true, completed: false });
    sounds.update();
  };
  return { sounds, emit, listeners, mixer, lifetime, changes, unsubscribeChanges, listedClipEvents, clockAt };
}

async function settle() {
  for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
}

const texts = (sounds: ReturnType<typeof wiredWithFakes>["sounds"]) => sounds.entries().map(entry => entry.text);

beforeEach(() => { servedBundles.set("actor-sounds:npc:20001", syntheticBundle("actor-sounds:npc:20001")); });
afterEach(() => { servedBundles.clear(); loadedCatalogKeys.length = 0; });

describe("spawned actor sound wiring", () => {
  it("loads the actor-sounds bundle of a spawned npc once, binds its clip cues when its clip list exists, and plays a cue past its event time", async () => {
    const { sounds, emit, mixer, changes, listedClipEvents, clockAt } = wiredWithFakes();
    emit({ type: "spawn", entity: entity("npc-20001-1", { npcId: 20001 }) });
    expect(texts(sounds)).toEqual(["npc-20001-1: actor-sounds:npc:20001 loading"]);
    await settle();
    sounds.update();
    expect(texts(sounds)).toEqual(["npc-20001-1: actor-sounds:npc:20001 loaded, waiting for the native model clip list"]);
    listedClipEvents.set("npc-20001-1", clipEvents);
    clockAt("npc-20001-1", .3);
    expect(mixer.register).toHaveBeenCalledWith(cueKey, new Uint8Array([1]));
    expect(mixer.played).toEqual([]);
    clockAt("npc-20001-1", .5);
    expect(mixer.played.map(receipt => receipt.key)).toEqual([cueKey]);
    expect(loadedCatalogKeys).toEqual(["npc:20001"]);
    expect(sounds.entries()).toEqual([{ entityId: "npc-20001-1", tone: "info",
      text: `npc-20001-1: actor-sounds:npc:20001 bound 1 notify cues in atk01, 0 unbound, 1 roles unresolved; played 1, dropped 0, last ${cueObject} in atk01` }]);
    expect(changes).toHaveBeenCalled();
  });

  it("releases the binding of a removed entity and forgets it", async () => {
    const { sounds, emit, mixer, listedClipEvents, clockAt } = wiredWithFakes();
    emit({ type: "spawn", entity: entity("npc-20001-1", { npcId: 20001 }) });
    await settle();
    listedClipEvents.set("npc-20001-1", clipEvents);
    clockAt("npc-20001-1", .1);
    emit({ type: "despawn", entityId: "npc-20001-1" });
    expect(mixer.stoppedOwners).toHaveLength(1);
    expect(mixer.stoppedOwners[0]).toMatch(/^spawned-actor-sounds:\d+:npc-20001-1$/);
    expect(sounds.entries()).toEqual([]);
    clockAt("npc-20001-1", .5);
    expect(mixer.played).toEqual([]);
  });

  it("shows the reason of an entity without an actor-sounds record and loads nothing for it", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    try {
      const { sounds, emit } = wiredWithFakes();
      emit({ type: "spawn", entity: entity("npc-20002-1", { npcId: 20002 }) });
      await settle();
      expect(sounds.entries()).toEqual([{ entityId: "npc-20002-1", tone: "warning", text: "npc-20002-1: actor-sounds:npc:20002 not in catalog" }]);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });

  it("keys a spawned character by its chargrp index and ignores entities that are neither npc nor character", async () => {
    servedBundles.set("actor-sounds:character:3", syntheticBundle("actor-sounds:character:3"));
    const { sounds, emit } = wiredWithFakes();
    emit({ type: "spawn", entity: entity("character-3-1", { kind: "remote-player", characterTemplateIndex: 3 }) });
    emit({ type: "spawn", entity: entity("remote-1", { kind: "remote-player" }) });
    await settle();
    expect(loadedCatalogKeys).toEqual(["character:3"]);
    expect(texts(sounds)).toEqual(["character-3-1: actor-sounds:character:3 loaded, waiting for the native model clip list"]);
  });

  it("releases the earlier binding when the same entity id spawns again", async () => {
    const { sounds, emit, mixer, listedClipEvents, clockAt } = wiredWithFakes();
    listedClipEvents.set("npc-20001-1", clipEvents);
    emit({ type: "spawn", entity: entity("npc-20001-1", { npcId: 20001 }) });
    await settle();
    clockAt("npc-20001-1", .1);
    emit({ type: "spawn", entity: entity("npc-20001-1", { npcId: 20001 }) });
    expect(mixer.stoppedOwners).toHaveLength(1);
    expect(texts(sounds)).toEqual(["npc-20001-1: actor-sounds:npc:20001 loading"]);
    expect(loadedCatalogKeys).toEqual(["npc:20001", "npc:20001"]);
  });

  it("releases every binding on dispose and on abort of the runtime signal, and ignores later events", async () => {
    servedBundles.set("actor-sounds:npc:20003", syntheticBundle("actor-sounds:npc:20003"));
    const disposed = wiredWithFakes();
    for (const [id, npcId] of [["npc-20001-1", 20001], ["npc-20003-1", 20003]] as const) {
      disposed.listedClipEvents.set(id, clipEvents);
      disposed.emit({ type: "spawn", entity: entity(id, { npcId }) });
    }
    await settle();
    disposed.sounds.update();
    disposed.sounds.dispose();
    expect(disposed.mixer.stoppedOwners).toHaveLength(2);
    expect(disposed.sounds.entries()).toEqual([]);
    expect(disposed.listeners.size).toBe(0);
    disposed.sounds.dispose();
    expect(disposed.mixer.stoppedOwners).toHaveLength(2);

    const aborted = wiredWithFakes();
    aborted.listedClipEvents.set("npc-20001-1", clipEvents);
    aborted.emit({ type: "spawn", entity: entity("npc-20001-1", { npcId: 20001 }) });
    await settle();
    aborted.sounds.update();
    aborted.lifetime.abort();
    expect(aborted.mixer.stoppedOwners).toHaveLength(1);
    expect(aborted.listeners.size).toBe(0);
  });

  it("reads the clip events of a listing, with the events that have no loaded clip, and none before the listing exists", () => {
    const orphan = parseActorClipEvents([{ animationSet: "Synthetic.anim", clip: "missing", normalizedTime: .2, timeSeconds: .2,
      type: "AnimNotify_Sound", object: "Synthetic.AnimNotify_Sound1", function: "None", sound: cueObject, properties: {},
      sourceFrames: 30, sourceRate: 30, timingBasis: "source-frames" }]);
    expect(actorClipListingEvents(null)).toBeNull();
    expect(actorClipListingEvents({ clips: [{ name: "atk01", durationSeconds: 1, events: clipEvents }], eventsWithoutClip: orphan }))
      .toEqual([...clipEvents, ...orphan]);
  });

  it("writes one sandbox-actor-sounds-note per spawned entity and rewrites the notes on every change", async () => {
    const dom = installMiniDom();
    try {
      const { sounds, emit } = wiredWithFakes();
      const attached = attachSandboxSheetWithFakes(dom, { index: fakeCatalogIndexOver(new Map()), actorSounds: sounds });
      emit({ type: "spawn", entity: entity("npc-20001-1", { npcId: 20001 }) });
      emit({ type: "spawn", entity: entity("npc-20002-1", { npcId: 20002 }) });
      await settle();
      const notes = attached.note("sandbox-actor-sounds-note");
      expect(notes.map(note => [note.textContent, note.dataset.tone])).toEqual([
        ["npc-20001-1: actor-sounds:npc:20001 loaded, waiting for the native model clip list", "info"],
        ["npc-20002-1: actor-sounds:npc:20002 not in catalog", "warning"],
      ]);
      emit({ type: "despawn", entityId: "npc-20001-1" });
      expect(attached.note("sandbox-actor-sounds-note").map(note => note.textContent)).toEqual(["npc-20002-1: actor-sounds:npc:20002 not in catalog"]);
      attached.release();
      expect(attached.note("sandbox-actor-sounds-note")).toHaveLength(0);
      attached.sheet.dispose();
    } finally { dom.restore(); }
  });

  it("drops a load that settles after the entity was removed", async () => {
    const { sounds, emit, mixer, listedClipEvents } = wiredWithFakes();
    listedClipEvents.set("npc-20001-1", clipEvents);
    emit({ type: "spawn", entity: entity("npc-20001-1", { npcId: 20001 }) });
    emit({ type: "despawn", entityId: "npc-20001-1" });
    await settle();
    sounds.update();
    expect(sounds.entries()).toEqual([]);
    expect(mixer.register).not.toHaveBeenCalled();
  });
});
