import type { AssetPackage } from "../assets/package/readAssetPackage";
import type { NativeActorClock } from "../assets/native/NativeActor";
import { nativeSoundEventsBetween, type NativeSoundEvent } from "../assets/package/nativeEventAudio";
import type { NativeActionCuePlayer } from "./nativeActionCuePreview";
import type { WorldAudioMixer, WorldAudioPlaybackReceipt, WorldAudioVector } from "./WorldAudioMixer";
import type { WorldGroundContact } from "../world/WorldNavigation";
import {
  createFootstepRandom, drawSlot, isFootstepSurface, isFootstepVariation, pickVariation, surfaceClips, FOOTSTEP_RANDOM_SEED,
  type FootstepGait, type FootstepSurfaceId, type FootstepVariation, type StepSoundLibrary,
} from "./footstepSurfaces";
import {
  createFootstepAutoSurface, isWaterGroup, pickStepSoundSlot, FOOTSTEP_GROUP_ARRAYS,
  type FootstepAutoSurface, type FootstepGroundContext, type FootstepNativeGroup, type FootstepSurfaceResolution,
} from "./footstepSurfaceAuto";

export type NativeFootstepMode = "auto" | "manual" | "off";
export interface NativeFootstepSurfaceSelection {
  readonly mode: NativeFootstepMode;
  /** One of the 16 original groups; Manual plays it, Auto and Off ignore it. */
  readonly surface: FootstepSurfaceId;
  /** Manual only: "random" or a 0-based index within the actual clip count. */
  readonly variation: FootstepVariation;
}
export const NATIVE_FOOTSTEP_WORLD_DEFAULT: NativeFootstepSurfaceSelection = Object.freeze({ mode: "auto", surface: "Default", variation: "random" });
export const NATIVE_FOOTSTEP_MODE_LABELS: Readonly<Record<NativeFootstepMode, string>> = { auto: "Auto (native order)", manual: "Manual", off: "Off" };
/** Step notify Volume 250 / Radius 30 (SOURCE_BOUNDARY.json bfb8caa5…); PlaySound gain = Volume / 255. */
export const NATIVE_FOOTSTEP_NOTIFY = Object.freeze({ volume: 250, radius: 30 });

/** Presentation choice — ALAudio's actor-source attenuation is unproved, so this
 * reuses the ambient curve: linear range falloff to 50·R times the OpenAL
 * inverse-clamped model (rolloff 0.5, l2.ini) beyond R. Distance in source units. */
export function footstepAttenuation(distanceUnits: number, radius: number = NATIVE_FOOTSTEP_NOTIFY.radius): number {
  if (!Number.isFinite(distanceUnits) || distanceUnits <= 0) return 1;
  const range = radius * 50;
  if (distanceUnits >= range) return 0;
  return (range - distanceUnits) / range * (distanceUnits > radius ? radius / (radius + .5 * (distanceUnits - radius)) : 1);
}
export const footstepGain = (distanceUnits: number) =>
  Math.min(1, Math.max(0, NATIVE_FOOTSTEP_NOTIFY.volume / 255 * footstepAttenuation(distanceUnits)));

export interface NativeFootstepSound { readonly reference: string; readonly key: string }
export interface NativeFootstepEvent {
  readonly ordinal: number;
  readonly notify: string;
  readonly timeSeconds: number;
  readonly arrays: Readonly<Record<string, readonly NativeFootstepSound[]>>;
}
export interface NativeFootstepDefinition {
  readonly asset: AssetPackage;
  readonly clip: string;
  readonly durationSeconds: number;
  readonly gait: FootstepGait;
  readonly events: readonly NativeFootstepEvent[];
}
export interface NativeFootstepLayerDispatch {
  readonly kind: "boots" | "water-in" | "water-out";
  readonly object: string;
  readonly key: string;
  readonly accepted: boolean;
}
export interface NativeFootstepDispatch {
  readonly owner: string;
  readonly playbackOwner: string;
  readonly generation: number;
  readonly assetId: string;
  readonly clip: string;
  /** Gait used for the arrays: movement state when known, else the clip's. */
  readonly gait: FootstepGait;
  readonly gaitSource: "movement-state" | "clip";
  readonly clipGait: FootstepGait;
  readonly ordinal: number;
  readonly notify: string;
  readonly sourceTimeSeconds: number;
  readonly occurrenceTimeSeconds: number;
  readonly observedTimeSeconds: number;
  readonly offsetSeconds: number;
  readonly mode: NativeFootstepMode;
  /** Native array group played in Auto (null for support/step-volume Sounds and Manual). */
  readonly group: FootstepNativeGroup | null;
  readonly surface: FootstepSurfaceId | null;
  readonly variationIndex: number | null;
  /** Authored array (Auto groups) or StepSound_n slot (support declarations). */
  readonly property: string | null;
  readonly reference: string | null;
  readonly key: string | null;
  readonly accepted: boolean;
  readonly reason: "played" | "disabled" | "actor-paused" | "native-silent" | "unresolved-selection" | "mixer-rejected";
  readonly playback: WorldAudioPlaybackReceipt | null;
  /** Gain/position applied when spatial playback was available. */
  readonly spatial: { readonly gain: number; readonly distanceUnits: number; readonly position: WorldAudioVector } | null;
  /** Last accepted local movement support at dispatch, not the historical
   * notification instant or animated foot position. */
  readonly groundContact: WorldGroundContact | null;
  readonly context: FootstepGroundContext | null;
  readonly resolution: FootstepSurfaceResolution | null;
  readonly layers: readonly NativeFootstepLayerDispatch[];
}
export interface NativeFootstepInspection {
  policy: "native-order-footstep-preview";
  nativeBackendVerified: false;
  nativeAttenuationVerified: false;
  surfaceSelection: NativeFootstepSurfaceSelection;
  bootsLayer: boolean;
  renderDecoGrass: boolean;
  enabled: boolean;
  definitions: number;
  available: number;
  /** Null when the caller injected its own generator. */
  random: { seed: number | null; policy: "seeded mulberry32 (presentation choice)" };
  playback: { volume: number; radius: number; attenuation: "presentation choice: ambient curve (linear 50·R range × OpenAL inverse clamped, rolloff 0.5)"; listener: string };
  stepSounds: { manifest: string | null; sounds: number; placements: number };
  played: number;
  dropped: number;
  skippedByCatchup: number;
  skippedClockGap: number;
  invalidClocks: number;
  activeOwners: number;
  recent: readonly NativeFootstepDispatch[];
  disposed: boolean;
}
export interface NativeFootstepPreview {
  bindActor(owner: string, asset: AssetPackage): NativeActionCuePlayer;
  setSurfaceSelection(selection: NativeFootstepSurfaceSelection): void;
  surfaceSelection(): NativeFootstepSurfaceSelection;
  setBootsLayer(enabled: boolean): void;
  /** Test action: plays an original water entry/exit Sound now. */
  playWaterEvent(event: "Water_In" | "Water_Out"): WorldAudioPlaybackReceipt | null;
  stepSounds(): StepSoundLibrary | null;
  autoSurface(): FootstepAutoSurface;
  /** Cheap accessor for live readouts (no copy of the whole recent list). */
  latest(): NativeFootstepDispatch | null;
  inspection(): NativeFootstepInspection;
  dispose(): void;
}
export interface NativeFootstepSpatialOptions {
  /** Pawn Location in browser metres (sound position). */
  readonly position: (owner: string) => WorldAudioVector | null;
  /** Listener pawn in browser metres; null keeps non-spatial playback. */
  readonly listener: () => WorldAudioVector | null;
  readonly sourceUnitsPerMetre: number;
}
export interface NativeFootstepPreviewOptions {
  readonly groundContact?: (owner: string) => WorldGroundContact | null;
  /** Package-keyed original stepsound clips (Manual, support StepSounds, boots, water). */
  readonly stepSounds?: StepSoundLibrary | null;
  /** Describes the accepted support for Auto (see footstepSurfaceGround.ts). */
  readonly surfaceContext?: (owner: string, contact: WorldGroundContact | null) => FootstepGroundContext | null;
  readonly autoSurface?: FootstepAutoSurface;
  /** Controller.MoveType equivalent (walk = PMT_SLOW, run = PMT_FAST); null uses the clip's gait. */
  readonly gait?: (owner: string) => FootstepGait | null;
  /** Grass needs the local player; defaults to owner === "local-player". */
  readonly localPlayer?: (owner: string) => boolean;
  readonly spatial?: NativeFootstepSpatialOptions;
  readonly initialSelection?: NativeFootstepSurfaceSelection;
  readonly random?: () => number;
}

type Mixer = Pick<WorldAudioMixer, "play" | "stopOwner"> & Partial<Pick<WorldAudioMixer, "startVoice">>;
interface TimingEvent extends NativeSoundEvent { source: NativeFootstepEvent }
interface Definition extends NativeFootstepDefinition { timeline: readonly TimingEvent[] }
const modes: readonly NativeFootstepMode[] = ["auto", "manual", "off"];
const nonempty = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= 1024;
const object = (value: unknown): boolean => value !== null && typeof value === "object" && !Array.isArray(value);
function requireValue(condition: unknown, message: string): asserts condition { if (!condition) throw new TypeError(`Native footstep preview: ${message}`); }

/** Counts omitted loop occurrences without iterating through a suspended tab's
 * entire history. The actual bounded occurrence selection uses the shared helper. */
function crossingCount(events: readonly TimingEvent[], previous: number, elapsed: number, duration: number, includeStart: boolean): number {
  let count = 0;
  for (const event of events) {
    let first = Math.max(0, Math.ceil((previous - event.timeSeconds) / duration));
    const last = Math.floor((elapsed - event.timeSeconds) / duration);
    const firstTime = first * duration + event.timeSeconds;
    if (firstTime < previous || firstTime === previous && !includeStart) first++;
    count += Math.max(0, last - first + 1);
  }
  return count;
}

interface Choice {
  group: FootstepNativeGroup | null;
  surface: FootstepSurfaceId | null;
  variationIndex: number | null;
  property: string | null;
  reference: string | null;
  key: string | null;
  silent: boolean;
  resolution: FootstepSurfaceResolution | null;
  context: FootstepGroundContext | null;
}

/** Original notify timing drives every mode. Auto follows the native decision
 * order (footstepSurfaceAuto.ts) with the fighter's authored arrays, support
 * StepSound declarations and the deco-grass approximation; Manual plays one of
 * the 16 stepsound.uax groups by gait. Slot draws, boots, water transitions and
 * attenuation are labelled browser choices. */
export function createNativeFootstepPreview(definitions: readonly NativeFootstepDefinition[], mixer: Mixer,
  options: NativeFootstepPreviewOptions = {}): NativeFootstepPreview {
  requireValue(Array.isArray(definitions) && definitions.length <= 128, "invalid definition list");
  const byAsset = new Map<AssetPackage, Map<string, Definition>>();
  let available = 0;
  for (const input of definitions) {
    requireValue(object(input) && object(input.asset) && nonempty(input.asset.manifest?.id) && nonempty(input.clip) &&
      Number.isFinite(input.durationSeconds) && input.durationSeconds > 0 && input.durationSeconds <= Number.MAX_SAFE_INTEGER &&
      (input.gait === "walk" || input.gait === "run") && Array.isArray(input.events) && input.events.length <= 2048,
    "invalid clip definition");
    const clips = byAsset.get(input.asset) ?? new Map<string, Definition>();
    requireValue(!clips.has(input.clip), "duplicate asset/clip definition");
    const ordinals = new Set<number>();
    const events: NativeFootstepEvent[] = input.events.map((event: NativeFootstepEvent) => {
      requireValue(object(event) && Number.isSafeInteger(event.ordinal) && event.ordinal >= 0 && !ordinals.has(event.ordinal) &&
        nonempty(event.notify) && Number.isFinite(event.timeSeconds) && event.timeSeconds >= 0 && event.timeSeconds <= input.durationSeconds &&
        object(event.arrays) && Object.keys(event.arrays).length <= 64, "invalid or duplicate event ordinal");
      ordinals.add(event.ordinal);
      const arrays: Record<string, readonly NativeFootstepSound[]> = Object.create(null);
      for (const [property, values] of Object.entries(event.arrays)) {
        requireValue(nonempty(property) && Array.isArray(values) && values.length <= 128, "invalid source array");
        arrays[property] = values.map(value => {
          requireValue(object(value) && nonempty(value.reference) && nonempty(value.key), "invalid source array entry");
          return { reference: value.reference, key: value.key };
        });
      }
      return { ordinal: event.ordinal, notify: event.notify, timeSeconds: event.timeSeconds, arrays };
    });
    // Timing selection is independent of the selected source Sound array.
    // The shared helper uses only clip/time; empty lookup fields are not aliases.
    const timeline: TimingEvent[] = events.map(source => ({ source, clip: input.clip, timeSeconds: source.timeSeconds, sound: "", resolvedFile: "" }));
    clips.set(input.clip, { asset: input.asset, clip: input.clip, durationSeconds: input.durationSeconds, gait: input.gait, events, timeline });
    byAsset.set(input.asset, clips); available += events.length;
  }
  const library = options.stepSounds ?? null, random = options.random ?? createFootstepRandom();
  const auto = options.autoSurface ?? createFootstepAutoSurface(library);
  const isLocal = options.localPlayer ?? ((owner: string) => owner === "local-player");
  const owners = new Map<NativeActionCuePlayer, string>(), recent: NativeFootstepDispatch[] = [];
  const validSelection = (value: NativeFootstepSurfaceSelection | undefined): value is NativeFootstepSurfaceSelection =>
    object(value) && modes.includes(value!.mode) && isFootstepSurface(value!.surface) && isFootstepVariation(value!.variation);
  requireValue(options.initialSelection === undefined || validSelection(options.initialSelection), "invalid initial selection");
  let chosen: NativeFootstepSurfaceSelection = options.initialSelection ? { ...options.initialSelection } : { mode: "off", surface: "Default", variation: "random" };
  let bootsLayer = false, disposed = false, nextOwner = 0, selectionEpoch = 0;
  let played = 0, dropped = 0, skippedByCatchup = 0, skippedClockGap = 0, invalidClocks = 0;
  const stopAll = () => { for (const owner of owners.values()) mixer.stopOwner(owner); };
  const apply = (next: NativeFootstepSurfaceSelection) => {
    if (chosen.mode === next.mode && chosen.surface === next.surface && chosen.variation === next.variation) return;
    chosen = { mode: next.mode, surface: next.surface, variation: next.variation };
    selectionEpoch++; stopAll();
  };
  const fromArray = (choice: Choice, event: NativeFootstepEvent, group: FootstepNativeGroup, gait: FootstepGait): Choice => {
    const property = FOOTSTEP_GROUP_ARRAYS[group][gait], values = event.arrays[property] ?? [];
    // Native GetSound: uniform slot `appRand() % 3` over the authored array, repeats allowed.
    const index = values.length ? drawSlot(random, values.length) : null, picked = index === null ? null : values[index]!;
    return { ...choice, group, property, variationIndex: index, reference: picked?.reference ?? null, key: picked?.key ?? null };
  };
  const choose = (entityId: string, event: NativeFootstepEvent, gait: FootstepGait, contact: WorldGroundContact | null): Choice => {
    const none: Choice = { group: null, surface: null, variationIndex: null, property: null, reference: null, key: null, silent: false, resolution: null, context: null };
    if (chosen.mode === "off") return none;
    // The readout shows what Auto would resolve in every enabled mode.
    const context = options.surfaceContext ? options.surfaceContext(entityId, contact) : null;
    const resolution = auto.resolve(context, { localPlayer: isLocal(entityId) });
    if (chosen.mode === "manual") {
      const picked = pickVariation(surfaceClips(library, chosen.surface, gait), chosen.variation, random);
      return { ...none, surface: chosen.surface, resolution, context, variationIndex: picked?.index ?? null,
        reference: picked?.clip.object ?? null, key: picked?.clip.key ?? null };
    }
    const base: Choice = { ...none, surface: resolution.surface, resolution, context };
    if (resolution.silent) return { ...base, silent: true };
    if (resolution.declared) {
      const slot = pickStepSoundSlot(resolution.declared, random);
      if (slot) return { ...base, property: slot.property, reference: slot.reference, key: slot.clip.key,
        variationIndex: resolution.declared.slots.indexOf(slot) };
      // A null slot returns no Sound; the native chain then reaches ACTOR.
      return fromArray({ ...base, surface: "Stone_Hard" }, event, "ACTOR", gait);
    }
    if (resolution.stepSound) return { ...base, property: "StepSoundID", reference: resolution.stepSound.object, key: resolution.stepSound.key };
    return fromArray(base, event, resolution.group ?? "ACTOR", gait);
  };
  const start = (key: string, owner: string, entityId: string, offset: number) => {
    const spatial = options.spatial, position = spatial?.position(entityId) ?? null, listener = spatial?.listener() ?? null;
    if (!spatial || !position || !listener || !mixer.startVoice) return { playback: mixer.play(key, owner, offset), spatial: null };
    const distanceUnits = Math.hypot(position[0] - listener[0], position[1] - listener[1], position[2] - listener[2]) * spatial.sourceUnitsPerMetre;
    const gain = footstepGain(distanceUnits);
    const voice = gain > 0 ? mixer.startVoice(key, { bus: "effects", owner, gain, position, offsetSeconds: offset }) : null;
    return { playback: voice ? { id: voice.id, key, owner, contextTime: voice.startedAt, offsetSeconds: offset, durationSeconds: voice.durationSeconds } : null,
      spatial: { gain, distanceUnits, position: copyVector(position) } };
  };
  const preview: NativeFootstepPreview = {
    bindActor(entityId, asset) {
      requireValue(nonempty(entityId), "invalid actor owner");
      const clips = byAsset.get(asset), owner = `native-footstep:${++nextOwner}:${entityId}`;
      let selected: Definition | undefined, released = disposed, active = false, cursor = 0, includeStart = false, generation = 0;
      // Auto water state per actor; a selection change restarts it so
      // switching modes never fires a stale entry/exit transition.
      const water: { previous: boolean | null; epoch: number } = { previous: null, epoch: selectionEpoch };
      const valid = (clock: NativeActorClock): boolean => {
        if (!selected || clock.clip !== selected.clip || clock.mode !== "loop" || clock.durationSeconds !== selected.durationSeconds ||
          !Number.isFinite(clock.elapsedSeconds) || clock.elapsedSeconds < 0 || typeof clock.playing !== "boolean" || clock.completed !== false) return false;
        // A finite float can still be too large for ++loop to advance. Bound
        // integer loop/count arithmetic before entering the shared helper.
        const loops = Math.floor(clock.elapsedSeconds / selected.durationSeconds);
        return Number.isSafeInteger(loops) && loops >= 0 && loops <= Math.floor(Number.MAX_SAFE_INTEGER / Math.max(4, selected.events.length * 2));
      };
      const invalidate = () => { active = false; includeStart = false; invalidClocks++; mixer.stopOwner(owner); };
      const player: NativeActionCuePlayer = {
        start(clock) {
          if (released) return;
          mixer.stopOwner(owner); generation++;
          selected = typeof clock.clip === "string" ? clips?.get(clock.clip) : undefined;
          active = false; includeStart = false;
          if (!selected) return;
          if (!valid(clock)) { invalidClocks++; return; }
          cursor = clock.elapsedSeconds; active = true; includeStart = cursor === 0 && clock.playing;
        },
        advance(previous, current) {
          if (released || !active || !selected) return;
          if (!valid(previous) || !valid(current) || current.elapsedSeconds < previous.elapsedSeconds || current.elapsedSeconds < cursor) {
            invalidate(); return;
          }
          const paused = !previous.playing || !current.playing;
          if (paused) mixer.stopOwner(owner);
          if (current.elapsedSeconds === cursor) {
            // A paused zero-time frame consumes the initial boundary rather
            // than turning resume into a late start notification.
            if (paused) includeStart = false;
            return;
          }
          const startTime = Math.max(cursor, previous.elapsedSeconds), end = current.elapsedSeconds;
          if (previous.elapsedSeconds > cursor) {
            const missed = crossingCount(selected.timeline, cursor, previous.elapsedSeconds, selected.durationSeconds, includeStart);
            dropped += missed; skippedClockGap += missed; includeStart = false;
          }
          const initial = includeStart && startTime === 0;
          const occurrences = nativeSoundEventsBetween(selected.timeline, selected.clip, startTime, end, selected.durationSeconds, initial);
          const omitted = Math.max(0, crossingCount(selected.timeline, startTime, end, selected.durationSeconds, initial) - occurrences.length);
          dropped += omitted; skippedByCatchup += omitted;
          // Consume before dispatch, including disabled/locked/paused/muted
          // output. Repeated or overlapping callbacks cannot replay a cue.
          cursor = end; includeStart = false;
          for (const occurrence of occurrences) {
            const event = (occurrence.event as TimingEvent).source;
            const contact = options.groundContact ? options.groundContact(entityId) : null;
            if (water.epoch !== selectionEpoch) { water.previous = null; water.epoch = selectionEpoch; }
            const wasWet = water.previous, stateGait = options.gait?.(entityId) ?? null, gait = stateGait ?? selected.gait;
            const offset = end - occurrence.elapsedSeconds, layers: NativeFootstepLayerDispatch[] = [];
            // 1. Boots add a sound and the native chain continues.
            if (!paused && chosen.mode !== "off" && bootsLayer && library?.boots.length) {
              const boots = pickVariation(library.boots, "random", random)!;
              layers.push({ kind: "boots", object: boots.clip.object, key: boots.clip.key, accepted: !!start(boots.clip.key, owner, entityId, offset).playback });
            }
            const choice = choose(entityId, event, gait, contact);
            const output = !paused && choice.key ? start(choice.key, owner, entityId, offset) : { playback: null, spatial: null };
            const playback = output.playback;
            if (playback) played++; else dropped++;
            // In a water volume (including the silent in-water case) counts as wet.
            const wet = choice.resolution?.rule === "water-volume" || isWaterGroup(choice.group);
            if (!paused && library && chosen.mode === "auto" && wasWet !== null) {
              if (wet !== wasWet) {
                const clip = wet ? library.events.Water_In : library.events.Water_Out;
                layers.push({ kind: wet ? "water-in" : "water-out", object: clip.object, key: clip.key, accepted: !!start(clip.key, owner, entityId, offset).playback });
              }
            }
            if (chosen.mode === "auto") water.previous = wet;
            const reason = playback ? "played" : chosen.mode === "off" ? "disabled" : paused ? "actor-paused" : choice.silent ? "native-silent" :
              !choice.key ? "unresolved-selection" : "mixer-rejected";
            recent.push({ owner: entityId, playbackOwner: owner, generation, assetId: asset.manifest.id, clip: selected.clip,
              gait, gaitSource: stateGait ? "movement-state" : "clip", clipGait: selected.gait,
              ordinal: event.ordinal, notify: event.notify, sourceTimeSeconds: event.timeSeconds,
              occurrenceTimeSeconds: occurrence.elapsedSeconds, observedTimeSeconds: end, offsetSeconds: offset,
              mode: chosen.mode, group: choice.group, surface: choice.surface, variationIndex: choice.variationIndex, property: choice.property,
              reference: choice.reference, key: choice.key, accepted: !!playback, reason, playback: playback ? { ...playback } : null,
              spatial: output.spatial, groundContact: contact ? structuredClone(contact) : null,
              context: choice.context ? structuredClone(choice.context) : null,
              resolution: choice.resolution ? { ...choice.resolution } : null, layers });
            if (recent.length > 64) recent.shift();
          }
        },
        dispose() {
          if (released) return;
          released = true; active = false; includeStart = false; mixer.stopOwner(owner); owners.delete(player);
        },
      };
      if (!released) owners.set(player, owner);
      return player;
    },
    setSurfaceSelection(value) {
      if (disposed) return;
      requireValue(validSelection(value), "invalid surface selection");
      apply(value);
    },
    surfaceSelection: () => ({ ...chosen }),
    setBootsLayer(enabled) { if (!disposed) bootsLayer = enabled === true; },
    playWaterEvent(event) {
      if (disposed || !library || (event !== "Water_In" && event !== "Water_Out")) return null;
      const clip = library.events[event], playback = mixer.play(clip.key, "native-footstep:test-action", 0);
      return playback ? { ...playback } : null;
    },
    stepSounds: () => library,
    autoSurface: () => auto,
    latest: () => { const row = recent.at(-1); return row ? copyDispatch(row) : null; },
    inspection: () => ({ policy: "native-order-footstep-preview", nativeBackendVerified: false, nativeAttenuationVerified: false,
      surfaceSelection: { ...chosen }, bootsLayer, renderDecoGrass: auto.renderDecoGrass(), enabled: chosen.mode !== "off",
      definitions: definitions.length, available,
      random: { seed: options.random ? null : FOOTSTEP_RANDOM_SEED, policy: "seeded mulberry32 (presentation choice)" },
      playback: { ...NATIVE_FOOTSTEP_NOTIFY, attenuation: "presentation choice: ambient curve (linear 50·R range × OpenAL inverse clamped, rolloff 0.5)",
        listener: options.spatial ? "local pawn Location (presentation choice; native listener camera-vs-pawn unproved)" : "non-spatial" },
      stepSounds: { manifest: library?.manifestSha256 ?? null, sounds: library?.soundCount ?? 0, placements: library?.placements.size ?? 0 },
      played, dropped, skippedByCatchup, skippedClockGap, invalidClocks, activeOwners: owners.size, disposed,
      recent: recent.map(copyDispatch) }),
    dispose() {
      if (disposed) return;
      disposed = true; chosen = { ...chosen, mode: "off" };
      for (const player of owners.keys()) player.dispose();
    },
  };
  return preview;
}

const copyVector = (value: WorldAudioVector): WorldAudioVector => [value[0], value[1], value[2]];

function copyDispatch(row: NativeFootstepDispatch): NativeFootstepDispatch {
  return { ...row, playback: row.playback ? { ...row.playback } : null,
    spatial: row.spatial ? { ...row.spatial, position: copyVector(row.spatial.position) } : null,
    groundContact: row.groundContact ? structuredClone(row.groundContact) : null, context: row.context ? structuredClone(row.context) : null,
    resolution: row.resolution ? { ...row.resolution } : null, layers: row.layers.map(layer => ({ ...layer })) };
}
