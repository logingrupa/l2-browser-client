import type { ActorClipListing } from "../animation/actorClipPlayback";
import type { NativeActorClock } from "../assets/native/NativeActor";
import type { ActorClipEvent } from "../assets/native/actorClipEvents";
import { actorSoundsCatalogKey, characterCatalogKey, npcCatalogKey, type NativeCatalogIndex } from "../assets/native/nativeCatalogIndex";
import type { NativeCombatAudioBundle } from "../audio/loadNativeCombatAudio";
import { bindSpawnedActorSoundCues, loadSpawnedActorSounds, type SpawnedActorSoundCueBinding } from "../audio/spawnedActorSoundCues";
import type { WorldAudioMixer } from "../audio/WorldAudioMixer";
import type { GameWorldAdapter } from "../world/GameWorldAdapter";
import type { WorldEntity } from "../world/worldTypes";
import { failureText } from "./settledTasks";

export interface SpawnedActorSoundsEntry {
  readonly entityId: string;
  readonly text: string;
  readonly tone: "info" | "warning";
}

export interface SpawnedActorSounds {
  entries(): readonly SpawnedActorSoundsEntry[];
  subscribe(listener: () => void): () => void;
  update(): void;
  dispose(): void;
}

export interface SpawnedActorSoundsOptions {
  readonly adapter: Pick<GameWorldAdapter, "subscribe">;
  readonly catalogIndex: Pick<NativeCatalogIndex, "lookup">;
  readonly mixer: Pick<WorldAudioMixer, "register" | "play" | "stopOwner">;
  readonly clipEvents: (entityId: string) => readonly ActorClipEvent[] | null;
  readonly clipClock: (entityId: string) => NativeActorClock | null;
  readonly signal: AbortSignal;
}

interface PlayedCue { readonly object: string; readonly clip: string }

interface EntityActorSounds {
  readonly entityId: string;
  readonly bundleId: string;
  readonly controller: AbortController;
  bundle: NativeCombatAudioBundle | null;
  reason: string | null;
  binding: SpawnedActorSoundCueBinding | null;
  played: number;
  dropped: number;
  lastPlayed: PlayedCue | null;
}

export function actorClipListingEvents(listing: ActorClipListing | null): readonly ActorClipEvent[] | null {
  return listing ? [...listing.clips.flatMap(clip => clip.events), ...listing.eventsWithoutClip] : null;
}

function entityCatalogKey(entity: WorldEntity): string | null {
  if (entity.npcId !== undefined) return npcCatalogKey(entity.npcId);
  if (entity.characterTemplateIndex !== undefined) return characterCatalogKey(entity.characterTemplateIndex);
  return null;
}

function boundCueClips(binding: SpawnedActorSoundCueBinding): string {
  const clips = [...new Set(binding.coverage.bound.map(cue => cue.clip))].sort();
  return clips.length === 0 ? "" : ` in ${clips.join(", ")}`;
}

function entryOf(sounds: EntityActorSounds): SpawnedActorSoundsEntry {
  const prefix = `${sounds.entityId}: `;
  if (sounds.reason !== null) return { entityId: sounds.entityId, text: prefix + sounds.reason, tone: "warning" };
  if (!sounds.bundle) return { entityId: sounds.entityId, text: `${prefix}${sounds.bundleId} loading`, tone: "info" };
  const binding = sounds.binding;
  if (!binding) return { entityId: sounds.entityId, text: `${prefix}${sounds.bundleId} loaded, waiting for the native model clip list`, tone: "info" };
  const { bound, unbound, unresolvedRoles } = binding.coverage;
  const last = sounds.lastPlayed ? `, last ${sounds.lastPlayed.object} in ${sounds.lastPlayed.clip}` : "";
  return { entityId: sounds.entityId, tone: bound.length > 0 ? "info" : "warning",
    text: `${prefix}${sounds.bundleId} bound ${bound.length} notify cues${boundCueClips(binding)}, ${unbound.length} unbound, ` +
      `${unresolvedRoles.length} roles unresolved; played ${sounds.played}, dropped ${sounds.dropped}${last}` };
}

export function wireSpawnedActorSounds(options: SpawnedActorSoundsOptions): SpawnedActorSounds {
  const { catalogIndex, mixer, signal } = options;
  const soundsByEntity = new Map<string, EntityActorSounds>(), listeners = new Set<() => void>();
  let disposed = false;
  const notify = () => { for (const listener of [...listeners]) listener(); };

  const release = (entityId: string) => {
    const sounds = soundsByEntity.get(entityId);
    if (!sounds) return;
    soundsByEntity.delete(entityId);
    sounds.controller.abort();
    sounds.binding?.dispose();
    notify();
  };

  const countingMixer = (sounds: EntityActorSounds): SpawnedActorSoundsOptions["mixer"] => ({
    register: (key, bytes) => mixer.register(key, bytes),
    stopOwner: owner => mixer.stopOwner(owner),
    play: (key, owner, offsetSeconds) => {
      const receipt = mixer.play(key, owner, offsetSeconds);
      const clip = options.clipClock(sounds.entityId)?.clip ?? "no clip";
      const cue = sounds.binding?.coverage.bound.find(bound => bound.key === key && bound.clip === clip);
      if (receipt) { sounds.played += 1; sounds.lastPlayed = { object: cue?.object ?? key, clip }; } else sounds.dropped += 1;
      notify();
      return receipt;
    },
  });

  const load = async (sounds: EntityActorSounds, catalogKey: string) => {
    try {
      const outcome = await loadSpawnedActorSounds(catalogKey, catalogIndex, sounds.controller.signal);
      if (soundsByEntity.get(sounds.entityId) !== sounds) return;
      sounds.bundle = outcome.bundle;
      sounds.reason = outcome.reason;
    } catch (error) {
      if (soundsByEntity.get(sounds.entityId) !== sounds) return;
      sounds.reason = `${sounds.bundleId} failed: ${failureText(error, "the actor sounds could not be loaded")}`;
    }
    notify();
  };

  const spawn = (entity: WorldEntity) => {
    release(entity.id);
    const catalogKey = entityCatalogKey(entity);
    if (catalogKey === null) return;
    const sounds: EntityActorSounds = { entityId: entity.id, bundleId: actorSoundsCatalogKey(catalogKey), controller: new AbortController(),
      bundle: null, reason: null, binding: null, played: 0, dropped: 0, lastPlayed: null };
    soundsByEntity.set(entity.id, sounds);
    notify();
    void load(sounds, catalogKey);
  };

  const unsubscribe = options.adapter.subscribe(event => {
    if (event.type === "spawn") spawn(event.entity);
    else if (event.type === "despawn") release(event.entityId);
  });

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    unsubscribe();
    signal.removeEventListener("abort", dispose);
    for (const entityId of [...soundsByEntity.keys()]) release(entityId);
    listeners.clear();
  };
  signal.addEventListener("abort", dispose, { once: true });
  if (signal.aborted) dispose();

  return {
    entries: () => [...soundsByEntity.values()].map(entryOf),
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    update() {
      if (disposed) return;
      for (const sounds of soundsByEntity.values()) {
        if (!sounds.binding && sounds.bundle && sounds.reason === null) {
          const clipEvents = options.clipEvents(sounds.entityId);
          if (clipEvents === null) continue;
          try {
            sounds.binding = bindSpawnedActorSoundCues({ entityId: sounds.entityId, clipEvents, bundle: sounds.bundle,
              mixer: countingMixer(sounds), clipClock: () => options.clipClock(sounds.entityId) });
          } catch (error) {
            sounds.reason = `${sounds.bundleId} could not bind: ${failureText(error, "the clip cues could not be bound")}`;
          }
          notify();
        }
        sounds.binding?.update();
      }
    },
    dispose,
  };
}
