import type { NativeActorClock } from "../assets/native/NativeActor";
import { parseActorClipEvents } from "../assets/native/actorClipEvents";
import { actorSoundsCatalogKey, describeNativeCatalogLookup, type NativeCatalogIndex } from "../assets/native/nativeCatalogIndex";
import { generatedActorSoundBundlePrefix } from "./combatAudioRoleRouting";
import {
  groupLessReferenceAgreesWithAdmittedExport, loadNativeCombatAudio, type NativeCombatAudioBundle, type NativeCombatRole,
} from "./loadNativeCombatAudio";
import { nativePawnSoundLedger } from "./nativePawnSounds";
import type { WorldAudioMixer } from "./WorldAudioMixer";

export type SpawnedActorSoundsOutcome =
  | { readonly bundle: NativeCombatAudioBundle; readonly reason: null }
  | { readonly bundle: null; readonly reason: string };

export interface SpawnedActorBoundNotify {
  readonly clip: string;
  readonly notify: string | null;
  readonly sound: string;
  readonly timeSeconds: number;
  readonly object: string;
  readonly key: string;
}
export interface SpawnedActorUnboundNotify {
  readonly clip: string;
  readonly notify: string | null;
  readonly sound: string;
  readonly timeSeconds: number;
  readonly reason: "notify-sound-has-no-bundle-slot" | "notify-sound-matches-several-bundle-sounds";
}
export interface SpawnedActorUnresolvedRole {
  readonly selection: string;
  readonly role: NativeCombatRole;
  readonly field: string;
  readonly slotKeys: readonly string[];
  readonly reason: string;
}
export interface SpawnedActorSoundCoverage {
  readonly bundleId: string;
  readonly bound: readonly SpawnedActorBoundNotify[];
  readonly unbound: readonly SpawnedActorUnboundNotify[];
  readonly unresolvedRoles: readonly SpawnedActorUnresolvedRole[];
}
export interface SpawnedActorSoundCueBinding {
  readonly coverage: SpawnedActorSoundCoverage;
  update(): void;
  dispose(): void;
}
export interface SpawnedActorSoundCueOptions {
  readonly entityId: string;
  readonly clipEvents: readonly unknown[] | undefined;
  readonly bundle: NativeCombatAudioBundle;
  readonly mixer: Pick<WorldAudioMixer, "register" | "play" | "stopOwner">;
  readonly clipClock: () => NativeActorClock | null;
}

interface ClipGeneration {
  readonly clip: string;
  readonly mode: NativeActorClock["mode"];
  readonly durationSeconds: number;
  cursorSeconds: number;
}

let nextBindingNumber = 0;

export async function loadSpawnedActorSounds(catalogKey: string, catalogIndex: Pick<NativeCatalogIndex, "lookup">,
  signal: AbortSignal): Promise<SpawnedActorSoundsOutcome> {
  const bundleId = actorSoundsCatalogKey(catalogKey), lookup = catalogIndex.lookup(bundleId);
  if (lookup.status !== "converted") return { bundle: null, reason: describeNativeCatalogLookup(lookup) };
  const bundle = await loadNativeCombatAudio(signal, { id: bundleId });
  if (!bundle) return { bundle: null, reason: `${bundleId} is in the catalog index but not in the served catalog` };
  return { bundle, reason: null };
}

function bundleSoundObjects(bundle: NativeCombatAudioBundle): ReadonlyMap<string, string> {
  const objectsByKey = new Map<string, string>();
  for (const selection of bundle.selections) {
    for (const soundSet of Object.values(selection.roles)) for (const slot of soundSet.slots) objectsByKey.set(slot.key, slot.object);
  }
  return objectsByKey;
}

function unresolvedRoles(bundle: NativeCombatAudioBundle): SpawnedActorUnresolvedRole[] {
  return bundle.selections.flatMap(selection => Object.entries(selection.roles).map(([role, soundSet]) => ({
    selection: selection.id, role: role as NativeCombatRole, field: soundSet.field, slotKeys: soundSet.slots.map(slot => slot.key),
    reason: `combat-role-route-unresolved:${selection.table}/${role}`,
  })));
}

function soundCoverage(bundle: NativeCombatAudioBundle, clipEvents: readonly unknown[] | undefined): SpawnedActorSoundCoverage {
  const objectsByKey = bundleSoundObjects(bundle), bound: SpawnedActorBoundNotify[] = [], unbound: SpawnedActorUnboundNotify[] = [];
  for (const event of parseActorClipEvents(clipEvents)) {
    if (event.sound === null) continue;
    const sound = event.sound;
    const notify = { clip: event.clip, notify: event.notifyObject, sound, timeSeconds: event.timeSeconds };
    const matches = [...objectsByKey].filter(([, object]) => groupLessReferenceAgreesWithAdmittedExport(sound, object));
    if (matches.length === 1) bound.push({ ...notify, object: matches[0]![1], key: matches[0]![0] });
    else unbound.push({ ...notify, reason: matches.length ? "notify-sound-matches-several-bundle-sounds" : "notify-sound-has-no-bundle-slot" });
  }
  return { bundleId: bundle.id, bound, unbound, unresolvedRoles: unresolvedRoles(bundle) };
}

function latestOccurrenceSeconds(cueSeconds: number, clock: NativeActorClock, endSeconds: number): number | null {
  if (cueSeconds > endSeconds) return null;
  if (clock.mode === "once") return cueSeconds;
  return cueSeconds + Math.floor((endSeconds - cueSeconds) / clock.durationSeconds) * clock.durationSeconds;
}

function continuesGeneration(generation: ClipGeneration | null, clip: string, clock: NativeActorClock): generation is ClipGeneration {
  return !!generation && generation.clip === clip && generation.mode === clock.mode &&
    generation.durationSeconds === clock.durationSeconds && clock.elapsedSeconds >= generation.cursorSeconds;
}

export function bindSpawnedActorSoundCues(options: SpawnedActorSoundCueOptions): SpawnedActorSoundCueBinding {
  const { entityId, bundle, mixer, clipClock } = options;
  if (!entityId) throw new TypeError("Spawned actor sound cues need an entity id.");
  if (!bundle.id.startsWith(generatedActorSoundBundlePrefix)) {
    throw new Error(`Spawned actor sound cues bind only ${generatedActorSoundBundlePrefix} bundles, not ${bundle.id}.`);
  }
  const coverage = soundCoverage(bundle, options.clipEvents);
  const owner = `spawned-actor-sounds:${++nextBindingNumber}:${entityId}`, pawnSounds = nativePawnSoundLedger(mixer);
  const bytesByKey = new Map(bundle.sounds.map(sound => [sound.key, sound.bytes]));
  const cuesByClip = new Map<string, SpawnedActorBoundNotify[]>();
  for (const cue of coverage.bound) {
    const bytes = bytesByKey.get(cue.key);
    if (!bytes) throw new Error(`Bundle ${bundle.id} has no loaded bytes for ${cue.object}.`);
    mixer.register(cue.key, bytes);
    cuesByClip.set(cue.clip, [...cuesByClip.get(cue.clip) ?? [], cue]);
  }
  let generation: ClipGeneration | null = null, released = false;
  const play = (cue: SpawnedActorBoundNotify, offsetSeconds: number) => {
    const playback = mixer.play(cue.key, owner, offsetSeconds);
    if (playback) pawnSounds.started(entityId, cue.object, owner, playback.contextTime + playback.durationSeconds - playback.offsetSeconds);
  };
  return {
    coverage,
    update() {
      if (released) return;
      const clock = clipClock(), clip = clock?.clip ?? null;
      if (!clock || clip === null || !Number.isFinite(clock.elapsedSeconds) || !(clock.durationSeconds > 0)) { generation = null; return; }
      const current: ClipGeneration = continuesGeneration(generation, clip, clock) ? generation
        : { clip, mode: clock.mode, durationSeconds: clock.durationSeconds, cursorSeconds: Number.NEGATIVE_INFINITY };
      generation = current;
      const endSeconds = clock.mode === "once" ? Math.min(clock.elapsedSeconds, clock.durationSeconds) : clock.elapsedSeconds;
      for (const cue of cuesByClip.get(clip) ?? []) {
        const occurrenceSeconds = latestOccurrenceSeconds(cue.timeSeconds, clock, endSeconds);
        if (occurrenceSeconds === null || occurrenceSeconds <= current.cursorSeconds) continue;
        if (clock.playing) play(cue, endSeconds - occurrenceSeconds);
      }
      current.cursorSeconds = endSeconds;
    },
    dispose() {
      if (released) return;
      released = true;
      generation = null;
      mixer.stopOwner(owner);
      pawnSounds.release(owner);
    },
  };
}
