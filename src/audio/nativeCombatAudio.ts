import type { AssetPackage } from "../assets/package/readAssetPackage";
import type { NativeActorClock } from "../assets/native/NativeActor";
import type { WorldEntity } from "../world/worldTypes";
import type { WorldAudioMixer, WorldAudioPlaybackReceipt, WorldAudioVector } from "./WorldAudioMixer";
import type { NativeCombatAudioBundle, NativeCombatRole, NativeCombatSelection, NativeCombatSlot, NativeCombatSoundSet } from "./loadNativeCombatAudio";
import { combatAudioRoleRoutingDiagnostics } from "./combatAudioRoleRouting";
import { nativePawnSoundLedger } from "./nativePawnSounds";
import { nativeAmbientRules } from "./worldAmbience";

export const FALLBACK_SHOT_FRACTION = .5;
export const DEFAULT_REACH_METRES = 1.5;
export const PRESENTATION_STATUS = "presentation choice — native rule unverified";
export const OFFLINE_ATTACK_FLAGS = 0;
export const OFFLINE_OUTCOME = "offline: no server result, treated as flags 0";
export const CONDITIONAL_FIGHTER_TARGET = "conditional: native route C with the fighter's own GetDefenseItemSound/GetDamageSound; no server attack record proves this hit";
export const APP_RAND_RANGE = 32768;
const UNITS_PER_METRE = 100;
const EVIDENCE = "native-sound-answers-20261107 REPORT.md Q4";

export function nativePercentChance(threshold: number): number {
  if (!Number.isFinite(threshold) || threshold < 0) return 0;
  const top = Math.min(99, Math.floor(threshold)) + 1, cycles = Math.floor(APP_RAND_RANGE / 100), rest = APP_RAND_RANGE % 100;
  return (cycles * top + Math.min(rest, top)) / APP_RAND_RANGE;
}

export type NativeAttackShotRoute = "miss" | "shield" | "critical" | "soulshot" | "defense";
export function nativeAttackShotRoute(flags: number, attackerSoulshot = false): NativeAttackShotRoute {
  if (!Number.isInteger(flags) || flags < 0 || flags > 0xff) throw new RangeError("Attack flags must be one byte.");
  if (flags & 0x80) return "miss";
  if (flags & 0x40) return "shield";
  if (flags & 0x20) return "critical";
  if (flags & 0x10 || attackerSoulshot) return "soulshot";
  return "defense";
}

export type NativeCombatDistanceGain = "ambient-curve" | "flat";
export function nativeCombatGain(volume: number, radiusUnits: number, distanceUnits: number | null, mode: NativeCombatDistanceGain): number {
  const base = Math.min(1, Math.max(0, volume / 255 * nativeAmbientRules.soundVolume));
  if (mode === "flat" || distanceUnits === null || !(radiusUnits > 0)) return base;
  const outer = radiusUnits * 50;
  if (!(distanceUnits < outer)) return 0;
  const linear = (outer - distanceUnits) / outer;
  const inverse = distanceUnits > radiusUnits ? radiusUnits / (radiusUnits + nativeAmbientRules.rolloff * (distanceUnits - radiusUnits)) : 1;
  return Math.min(1, Math.max(0, base * linear * inverse));
}

export type NativeCombatTargetRule = "selected" | "selected-or-nearest";
export type NativeCombatWeaponChoice = "fist" | `weapon:${number}`;
export type NativeCombatTestScenario = "player-hit" | "musveren-hit" | "power-strike";
type EventType = "AnimNotify_AttackVoice" | "AnimNotify_AttackItem" | "AnimNotify_AttackShot" | "fraction-fallback";
type Mixer = Pick<WorldAudioMixer, "register" | "startVoice" | "stopOwner"> & Partial<Pick<WorldAudioMixer, "contextTime">>;

export interface NativeCombatActor {
  readonly entityId: string;
  readonly catalogId: string;
  readonly asset: AssetPackage;
  readonly collisionRadiusMetres: number;
  readonly collisionHeightMetres?: number;
}
export interface NativeCombatWorld {
  entity(entityId: string): WorldEntity | null;
  sourceClock(entityId: string): NativeActorClock | null;
  selectedEntityId(): string | null;
  paused(): boolean;
  listener?(): WorldAudioVector | null;
}
export interface NativeCombatAudioOptions {
  random?: () => number;
  enabled?: boolean;
  reachMetres?: number;
  targetRule?: NativeCombatTargetRule;
  weapon?: NativeCombatWeaponChoice;
  distanceGain?: NativeCombatDistanceGain;
  startWindowSeconds?: number;
}
export type NativeCombatRoute = "A" | "B" | "C" | "skill" | "test";
export type NativeCombatSkipReason = "chance" | "still-playing" | "empty-slot" | "not-staged" | "npc-no-voice" | "miss";
export interface NativeCombatSkip { role: NativeCombatRole; reason: NativeCombatSkipReason; detail: string }
export interface NativeCombatSoundReceipt {
  role: NativeCombatRole; entityId: string; selection: string; field: string; reference: string; object: string;
  slotIndex: number; slotCount: number; volume: number; radiusUnits: number; distanceUnits: number | null; gain: number;
  accepted: boolean; playback: WorldAudioPlaybackReceipt | null;
}
export interface NativeCombatDispatch {
  sequence: number; attackerId: string; targetId: string | null; clip: string; notify: string; type: EventType | "skill-start" | "test";
  route: NativeCombatRoute; sourceTimeSeconds: number; observedTimeSeconds: number; offsetSeconds: number;
  outcome: "played" | "skipped" | "disabled" | "paused" | "attacker-dead" | "no-target" | "out-of-reach" | "target-dead" | "no-sound" | "miss";
  distanceMetres: number | null; special: boolean; reachGated: boolean;
  flags: number | null; shotRoute: NativeAttackShotRoute | null;
  shot: { index: number; count: number } | null;
  sounds: NativeCombatSoundReceipt[];
  skipped: NativeCombatSkip[];
}
export interface NativeCombatDescription {
  readonly name: string;
  readonly label: string;
  value(): string;
  readonly values: string;
  readonly source: string;
  readonly status: "native" | "presentation" | "unverified";
  readonly detail: string;
}
export interface NativeCombatInspection {
  policy: "browser-combat-audio-native-q4-routes"; nativeCombatVerified: false; nativeSlotSelectionVerified: false;
  evidence: string; offlineOutcome: string;
  bundle: string | null; enabled: boolean; reachMetres: number; targetRule: NativeCombatTargetRule; weapon: NativeCombatWeaponChoice;
  distanceGain: NativeCombatDistanceGain;
  weapons: { value: NativeCombatWeaponChoice; label: string }[];
  actors: { entityId: string; catalogId: string; selection: string | null; attackClips: number }[];
  rules: { attackVoiceChance: number; npcDamageChance: number | null; playerDamageChance: number; config: "staged" | "missing" };
  played: number; dropped: number; lastHit: NativeCombatDispatch | null; lastAttack: NativeCombatDispatch | null; recent: NativeCombatDispatch[];
  diagnostics: string[]; disposed: boolean;
}
export interface NativeCombatAudio {
  update(): void;
  setEnabled(value: boolean): void;
  setReach(metres: number): void;
  setTargetRule(rule: NativeCombatTargetRule): void;
  setWeapon(choice: NativeCombatWeaponChoice): void;
  setDistanceGain(mode: NativeCombatDistanceGain): void;
  test(scenario: NativeCombatTestScenario, flags?: number): NativeCombatDispatch | null;
  readout(): { readonly reachMetres: number; readonly lastHit: Readonly<NativeCombatDispatch> | null; readonly lastAttack: Readonly<NativeCombatDispatch> | null };
  inspection(): NativeCombatInspection;
  describe(): readonly NativeCombatDescription[];
  dispose(): void;
}

interface AttackEvent {
  readonly type: EventType; readonly notify: string; readonly time: number;
  readonly random: number | null; readonly volume: number | null; readonly radius: number | null;
  readonly shot: { index: number; count: number } | null;
}
interface Bound { readonly actor: NativeCombatActor; readonly selection: NativeCombatSelection | null; readonly clips: ReadonlyMap<string, readonly AttackEvent[]> }
interface Tracker { clip: string | null; duration: number; cursor: number; events: readonly AttackEvent[]; special: boolean; explicitTarget: string | null }
interface Cue { volume: number; radius: number; source: string }
const attackTypes = new Set(["AnimNotify_AttackVoice", "AnimNotify_AttackItem", "AnimNotify_AttackShot"]);
const owner = (entityId: string) => `native-combat:${entityId}`;
const playerKind = (entity: WorldEntity) => entity.kind !== "monster";
const finite = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : null;
const MISSING_CONFIG_ROW_REPORT_VALUES: Readonly<Record<string, number>> = { "CharSound.Random": 50, "CharSound.Vol": 250, "CharSound.Radius": 30,
  "ItemSound.Vol": 250, "ItemSound.Radius": 40, "EtcSound.CriticalSound_Vol": 250, "EtcSound.CriticalSound_Radius": 50,
  "EtcSound.SoulShotSound_Vol": 250, "EtcSound.SoulShotSound_Radius": 50 };

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function nativeAttackEvents(asset: AssetPackage): ReadonlyMap<string, readonly AttackEvent[]> {
  const clips = new Map<string, Omit<AttackEvent, "shot">[]>();
  for (const raw of asset.manifest.animationEvents ?? []) {
    const event = record(raw), type = event.type, clip = event.clip, time = event.timeSeconds;
    if (typeof type !== "string" || !attackTypes.has(type) || typeof clip !== "string" || !clip ||
      typeof time !== "number" || !Number.isFinite(time) || time < 0) continue;
    const properties = record(event.properties);
    const rows = clips.get(clip) ?? [];
    rows.push({ type: type as EventType, notify: typeof event.object === "string" ? event.object : type, time,
      random: finite(properties.Random), volume: finite(properties.Volume), radius: finite(properties.Radius) });
    clips.set(clip, rows);
  }
  const result = new Map<string, readonly AttackEvent[]>();
  for (const [clip, rows] of clips) {
    rows.sort((a, b) => a.time - b.time);
    const count = rows.filter(row => row.type === "AnimNotify_AttackShot").length;
    let index = 0;
    result.set(clip, rows.map(row => ({ ...row, shot: row.type === "AnimNotify_AttackShot" ? { index: ++index, count } : null })));
  }
  return result;
}

export function createNativeCombatAudio(bundle: NativeCombatAudioBundle | null, mixer: Mixer, world: NativeCombatWorld,
  actors: readonly NativeCombatActor[], options: NativeCombatAudioOptions = {}): NativeCombatAudio {
  const random = options.random ?? Math.random, startWindow = options.startWindowSeconds ?? .25;
  const pawnSounds = nativePawnSoundLedger(mixer);
  const diagnostics: string[] = [], recent: NativeCombatDispatch[] = [];
  const selections = bundle?.selections ?? [];
  for (const sound of bundle?.sounds ?? []) mixer.register(sound.key, sound.bytes);
  const bound: Bound[] = actors.map(actor => {
    const selection = selections.find(row => row.kind === "actor" && row.catalogId === actor.catalogId) ?? null;
    if (!selection) diagnostics.push(`${actor.entityId}: no combat sound selection for ${actor.catalogId}`);
    else if (selection.sourceObject !== actor.asset.manifest.source.object) {
      diagnostics.push(`${actor.entityId}: combat selection ${selection.id} source differs from the loaded actor`);
      return { actor, selection: null, clips: nativeAttackEvents(actor.asset) };
    }
    return { actor, selection, clips: nativeAttackEvents(actor.asset) };
  });
  const weaponSelections = selections.filter(row => row.kind === "weapon" && row.itemId !== undefined && row.roles.attackItem?.slots.length);
  const weapons: NativeCombatInspection["weapons"] = [{ value: "fist", label: "Empty hand (fist)" },
    ...weaponSelections.map(row => ({ value: `weapon:${row.itemId}` as NativeCombatWeaponChoice, label: row.label.replace(/\s*\(.*$/, "") }))];
  const skill = selections.find(row => row.kind === "skill" && row.skillId === 3 && row.level === 1) ?? null;
  const config = selections.find(row => row.kind === "config") ?? null;
  if (bundle && !config) diagnostics.push(`Combat bundle has no ALAudio.int config row; using ${EVIDENCE} values.`);
  const configValue = (name: string) => config?.numeric[name] ?? MISSING_CONFIG_ROW_REPORT_VALUES[name] ?? 0;
  const npcNumbers = (selection: NativeCombatSelection | null) => {
    const numeric = selection?.numeric ?? {};
    return { volume: numeric.soundVolume ?? null, radius: numeric.soundRadius ?? null, random: numeric.soundRandom ?? null };
  };
  for (const row of bound) if (row.selection?.table === "npcgrp" && npcNumbers(row.selection).radius === null) {
    diagnostics.push(`${row.actor.entityId}: npcgrp soundRadius/soundVolume/soundRandom (native meaning) are not staged.`);
  }
  const trackers = new Map<string, Tracker>();
  let enabled = options.enabled ?? true, reach = options.reachMetres ?? DEFAULT_REACH_METRES;
  let targetRule: NativeCombatTargetRule = options.targetRule ?? "selected-or-nearest";
  let weapon: NativeCombatWeaponChoice = options.weapon ?? "fist";
  let distanceGain: NativeCombatDistanceGain = options.distanceGain ?? "ambient-curve";
  let disposed = false, sequence = 0, played = 0, dropped = 0;
  let lastHit: NativeCombatDispatch | null = null, lastAttack: NativeCombatDispatch | null = null;
  if (!bundle) diagnostics.push("Combat sound bundle is not staged (catalog.combatAudio).");
  diagnostics.push(...combatAudioRoleRoutingDiagnostics(bundle));
  if (!Number.isFinite(reach) || reach < 0 || reach > 50) throw new RangeError("Combat reach must be within 0–50 m.");

  const appRand = () => Math.min(APP_RAND_RANGE - 1, Math.max(0, Math.floor(random() * APP_RAND_RANGE)));
  const roll = (threshold: number) => appRand() % 100 <= threshold;
  const boundOf = (entityId: string) => bound.find(row => row.actor.entityId === entityId) ?? null;
  const pick = (set: NativeCombatSoundSet, audition: boolean): { slot: NativeCombatSlot | null; index: number; count: number } => {
    const count = set.slots.length + set.unadmitted.length;
    if (!count) return { slot: null, index: -1, count };
    const index = audition && set.slots.length ? set.slots[appRand() % set.slots.length]!.index : appRand() % count;
    return { slot: set.slots.find(slot => slot.index === index) ?? null, index, count };
  };
  const location = (row: Bound | null, entity: WorldEntity): WorldAudioVector =>
    [entity.position.x, entity.position.y + (row?.actor.collisionHeightMetres ?? 0), entity.position.z];
  const distanceUnits = (position: WorldAudioVector) => {
    const ear = world.listener?.() ?? null;
    return ear ? Math.hypot(position[0] - ear[0], position[1] - ear[1], position[2] - ear[2]) * UNITS_PER_METRE : null;
  };
  const play = (dispatch: NativeCombatDispatch, role: NativeCombatRole, set: NativeCombatSoundSet | undefined, entity: WorldEntity,
    cue: Cue, flags: { isPlayingSkip?: boolean; audition?: boolean } = {}) => {
    if (!set) { dispatch.skipped.push({ role, reason: "not-staged", detail: "no staged sound set" }); return; }
    const chosen = pick(set, flags.audition === true);
    if (!chosen.slot) {
      dispatch.skipped.push({ role, reason: "empty-slot", detail: `${set.table}.${set.field}[${chosen.index}] is empty or unadmitted` }); return;
    }
    const slot = chosen.slot;
    if (flags.isPlayingSkip && !flags.audition && pawnSounds.playing(entity.id, slot.object)) {
      dispatch.skipped.push({ role, reason: "still-playing", detail: `${slot.reference} still playing on ${entity.id}` }); return;
    }
    const position = location(boundOf(entity.id), entity), distance = distanceUnits(position);
    const gain = nativeCombatGain(cue.volume, cue.radius, distance, distanceGain);
    const voice = gain > 0 ? mixer.startVoice(slot.key, { bus: "effects", owner: owner(entity.id), gain, offsetSeconds: dispatch.offsetSeconds,
      ...(distance === null ? {} : { position }) }) : null;
    const playback: WorldAudioPlaybackReceipt | null = voice ? { id: voice.id, key: voice.key, owner: voice.owner, contextTime: voice.startedAt,
      offsetSeconds: dispatch.offsetSeconds, durationSeconds: voice.durationSeconds } : null;
    if (voice) {
      played++;
      pawnSounds.started(entity.id, slot.object, voice.owner, voice.startedAt + voice.durationSeconds - dispatch.offsetSeconds, () => voice.active());
    } else dropped++;
    dispatch.sounds.push({ role, entityId: entity.id, selection: set.selection, field: set.field, reference: slot.reference, object: slot.object,
      slotIndex: chosen.index, slotCount: chosen.count, volume: cue.volume, radiusUnits: cue.radius, distanceUnits: distance, gain,
      accepted: !!playback, playback });
  };
  const remember = (dispatch: NativeCombatDispatch) => {
    recent.push(dispatch); if (recent.length > 32) recent.shift();
    if (dispatch.type !== "skill-start") lastAttack = dispatch;
    if ((dispatch.route === "C" || dispatch.type === "test") && dispatch.outcome === "played" && dispatch.targetId) lastHit = dispatch;
    return dispatch;
  };
  const dispatchFor = (attacker: WorldEntity, tracker: Tracker | null, event: { type: NativeCombatDispatch["type"]; notify: string; time: number },
    route: NativeCombatRoute, observed: number, shot: AttackEvent["shot"] = null): NativeCombatDispatch => ({
    sequence: ++sequence, attackerId: attacker.id, targetId: null, clip: tracker?.clip ?? "", notify: event.notify, type: event.type, route,
    sourceTimeSeconds: event.time, observedTimeSeconds: observed, offsetSeconds: Math.max(0, observed - event.time), outcome: "played",
    distanceMetres: null, special: tracker?.special ?? false, reachGated: false, flags: null, shotRoute: null, shot, sounds: [], skipped: [] });
  const settle = (dispatch: NativeCombatDispatch) => {
    if (dispatch.outcome !== "played" || dispatch.sounds.length) return;
    dispatch.outcome = dispatch.skipped.some(skip => skip.reason === "chance" || skip.reason === "still-playing" || skip.reason === "npc-no-voice")
      ? "skipped" : "no-sound";
  };
  const gap = (a: Bound, ea: WorldEntity, b: Bound, eb: WorldEntity) =>
    Math.max(0, Math.hypot(ea.position.x - eb.position.x, ea.position.z - eb.position.z) - a.actor.collisionRadiusMetres - b.actor.collisionRadiusMetres);
  const resolveTarget = (attacker: Bound, entity: WorldEntity, tracker: Tracker | null):
    { target: Bound; entity: WorldEntity; distance: number; gated: boolean } | { reason: "no-target" | "out-of-reach" | "target-dead"; distance: number | null } => {
    const others = bound.filter(row => row !== attacker).flatMap(row => {
      const other = world.entity(row.actor.entityId); return other ? [{ row, other }] : [];
    });
    const explicit = tracker?.special ? tracker.explicitTarget : null;
    const preferred = explicit ?? (playerKind(entity) ? world.selectedEntityId() : null);
    if (preferred && preferred !== entity.id) {
      const match = others.find(item => item.row.actor.entityId === preferred);
      if (!match) return { reason: "no-target", distance: null };
      const distance = gap(attacker, entity, match.row, match.other);
      if (match.other.health <= 0) return { reason: "target-dead", distance };
      if (explicit) return { target: match.row, entity: match.other, distance, gated: false };
      return distance <= reach ? { target: match.row, entity: match.other, distance, gated: true } : { reason: "out-of-reach", distance };
    }
    if (playerKind(entity) && targetRule === "selected") return { reason: "no-target", distance: null };
    const hostile = others.filter(item => playerKind(item.other) !== playerKind(entity) && item.other.health > 0)
      .map(item => ({ ...item, distance: gap(attacker, entity, item.row, item.other) })).sort((a, b) => a.distance - b.distance);
    const nearest = hostile[0];
    if (!nearest) return { reason: "no-target", distance: null };
    return nearest.distance <= reach ? { target: nearest.row, entity: nearest.other, distance: nearest.distance, gated: true } :
      { reason: "out-of-reach", distance: nearest.distance };
  };
  const attackItem = (attacker: Bound, entity: WorldEntity): { set: NativeCombatSoundSet | undefined; cue: Cue } => {
    if (playerKind(entity) && weapon !== "fist") {
      const itemId = Number(weapon.slice("weapon:".length));
      const selected = weaponSelections.find(row => row.itemId === itemId)?.roles.attackItem;
      if (selected) return { set: selected, cue: { volume: configValue("ItemSound.Vol"), radius: configValue("ItemSound.Radius"), source: "ALAudio.int [ItemSound]" } };
    }
    if (!playerKind(entity)) {
      const npc = npcNumbers(attacker.selection);
      return { set: attacker.selection?.roles.attackItem, cue: { volume: npc.volume ?? 250, radius: npc.radius ?? 50, source: "npcgrp +0xd0/+0xcc" } };
    }
    return { set: attacker.selection?.roles.attackItem, cue: { volume: configValue("CharSound.Vol"), radius: configValue("CharSound.Radius"), source: "ALAudio.int [CharSound]" } };
  };
  const impact = (dispatch: NativeCombatDispatch, target: Bound, targetEntity: WorldEntity, flags: number, audition: boolean) => {
    const route = nativeAttackShotRoute(flags);
    dispatch.flags = flags; dispatch.shotRoute = route;
    if (route === "miss") { dispatch.outcome = "miss"; dispatch.skipped.push({ role: "defense", reason: "miss", detail: "flags 0x80: no sound" }); return; }
    const npcTarget = !playerKind(targetEntity), npc = npcNumbers(target.selection);
    const npcCue: Cue = { volume: npc.volume ?? 250, radius: npc.radius ?? 50, source: "npcgrp +0xd0/+0xcc" };
    const charCue: Cue = { volume: configValue("CharSound.Vol"), radius: configValue("CharSound.Radius"), source: "ALAudio.int [CharSound]" };
    if (dispatch.special) play(dispatch, "shot", skill?.roles.shot, targetEntity,
      { volume: skill?.numeric.spelleffect_sound_vol_2 ?? 250, radius: skill?.numeric.spelleffect_sound_rad_2 ?? 40, source: "skillsoundgrp" }, { audition });
    if (route === "critical" || route === "soulshot") {
      const key = route === "critical" ? "CriticalSound" : "SoulShotSound";
      play(dispatch, route, config?.roles[route], targetEntity,
        { volume: configValue(`EtcSound.${key}_Vol`), radius: configValue(`EtcSound.${key}_Radius`), source: `ALAudio.int [EtcSound] ${key}` }, { audition });
    } else if (npcTarget) {
      play(dispatch, "defense", target.selection?.roles.defense, targetEntity, npcCue, { audition });
    } else {
      const upper = targetEntity.equipment?.upper;
      const armor = upper === undefined ? undefined : selections.find(row => row.kind === "armor" && row.itemId === upper)?.roles.defense;
      if (armor?.slots.length) play(dispatch, "defense", armor, targetEntity,
        { volume: configValue("ItemSound.Vol"), radius: configValue("ItemSound.Radius"), source: "ALAudio.int [ItemSound]" }, { audition });
      else play(dispatch, "defense", target.selection?.roles.defense, targetEntity, charCue, { audition });
    }
    const threshold = npcTarget ? npc.random ?? 70 : configValue("CharSound.Random");
    if (!audition && !roll(threshold)) {
      dispatch.skipped.push({ role: "damage", reason: "chance", detail: `appRand()%100 > ${threshold} (p ${nativePercentChance(threshold).toFixed(3)})` });
    } else play(dispatch, "damage", target.selection?.roles.damage, targetEntity, npcTarget ? npcCue : charCue, { audition });
  };
  const fire = (attacker: Bound, entity: WorldEntity, tracker: Tracker, event: AttackEvent, observed: number) => {
    const route: NativeCombatRoute = event.type === "AnimNotify_AttackVoice" ? "B" : event.type === "AnimNotify_AttackItem" ? "A" : "C";
    const dispatch = dispatchFor(entity, tracker, event, route, observed, event.shot);
    if (!enabled) { dispatch.outcome = "disabled"; return remember(dispatch); }
    if (world.paused()) { dispatch.outcome = "paused"; return remember(dispatch); }
    if (entity.health <= 0) { dispatch.outcome = "attacker-dead"; return remember(dispatch); }
    if (route === "B") {
      const threshold = event.random ?? 100;
      if (!playerKind(entity)) dispatch.skipped.push({ role: "attackVoice", reason: "npc-no-voice", detail: "AttackVoice skips NPC pawns (+0x694 & 4)" });
      else if (!roll(threshold)) dispatch.skipped.push({ role: "attackVoice", reason: "chance",
        detail: `appRand()%100 > ${threshold} (p ${nativePercentChance(threshold).toFixed(3)})` });
      else play(dispatch, "attackVoice", attacker.selection?.roles.attackVoice, entity,
        { volume: event.volume ?? configValue("CharSound.Vol"), radius: event.radius ?? configValue("CharSound.Radius"), source: "AnimNotify_AttackVoice" },
        { isPlayingSkip: true });
      settle(dispatch); return remember(dispatch);
    }
    if (route === "A") {
      const item = attackItem(attacker, entity);
      play(dispatch, "attackItem", item.set, entity, item.cue, { isPlayingSkip: true });
      settle(dispatch); return remember(dispatch);
    }
    if (event.type === "fraction-fallback") {
      const item = attackItem(attacker, entity);
      play(dispatch, "attackItem", item.set, entity, item.cue, { isPlayingSkip: true });
    }
    const resolved = resolveTarget(attacker, entity, tracker);
    dispatch.distanceMetres = resolved.distance;
    if ("reason" in resolved) { if (!dispatch.sounds.length) dispatch.outcome = resolved.reason; return remember(dispatch); }
    dispatch.targetId = resolved.entity.id; dispatch.reachGated = resolved.gated;
    impact(dispatch, resolved.target, resolved.entity, OFFLINE_ATTACK_FLAGS, false);
    settle(dispatch); return remember(dispatch);
  };
  const release = (entityId: string) => { mixer.stopOwner(owner(entityId)); pawnSounds.release(owner(entityId)); };
  const reset = (entityId: string) => { if (trackers.delete(entityId)) release(entityId); };
  const generation = (row: Bound, entity: WorldEntity, clock: NativeActorClock): Tracker => {
    const source = row.clips.get(clock.clip!) ?? [];
    const shot = source.some(event => event.type === "AnimNotify_AttackShot");
    const events: readonly AttackEvent[] = !shot && entity.animation === "attack" ? [...source, { type: "fraction-fallback" as const,
      notify: `fallback:${FALLBACK_SHOT_FRACTION}`, time: clock.durationSeconds * FALLBACK_SHOT_FRACTION, random: null, volume: null, radius: null,
      shot: { index: 1, count: 1 } }].sort((a, b) => a.time - b.time) : source;
    const special = entity.actionPreview === "special-attack";
    const tracker: Tracker = { clip: clock.clip, duration: clock.durationSeconds, events, special,
      explicitTarget: special ? entity.actionTargetId ?? null : null,
      cursor: clock.elapsedSeconds <= startWindow ? -1 : clock.elapsedSeconds };
    if (special && skill?.roles.cast && enabled && !world.paused() && entity.health > 0 && tracker.cursor < 0) {
      const dispatch = dispatchFor(entity, tracker, { type: "skill-start", notify: "skill-start", time: 0 }, "skill", clock.elapsedSeconds);
      play(dispatch, "cast", skill.roles.cast, entity,
        { volume: skill.numeric.spelleffect_sound_vol_1 ?? 250, radius: skill.numeric.spelleffect_sound_rad_1 ?? 40, source: "skillsoundgrp" });
      settle(dispatch); remember(dispatch);
    }
    return tracker;
  };

  const api: NativeCombatAudio = {
    update() {
      if (disposed) return;
      for (const row of bound) {
        const entity = world.entity(row.actor.entityId), clock = entity ? world.sourceClock(row.actor.entityId) : null;
        if (!entity || !clock) { reset(row.actor.entityId); continue; }
        let tracker = trackers.get(row.actor.entityId);
        if (!clock.clip || clock.mode !== "once" || !Number.isFinite(clock.elapsedSeconds)) {
          if (tracker && tracker.clip === clock.clip && !tracker.events.length) tracker.cursor = clock.elapsedSeconds;
          else trackers.set(row.actor.entityId, { clip: clock.clip, duration: clock.durationSeconds, cursor: clock.elapsedSeconds,
            events: [], special: false, explicitTarget: null });
          continue;
        }
        if (!tracker || tracker.clip !== clock.clip || tracker.duration !== clock.durationSeconds || clock.elapsedSeconds < tracker.cursor) {
          tracker = generation(row, entity, clock); trackers.set(row.actor.entityId, tracker);
        }
        const end = Math.min(clock.elapsedSeconds, clock.durationSeconds);
        for (const event of tracker.events) if (event.time > tracker.cursor && event.time <= end) fire(row, entity, tracker, event, end);
        tracker.cursor = Math.max(tracker.cursor, end);
      }
    },
    setEnabled(value) {
      if (typeof value !== "boolean") throw new TypeError("Combat audio enabled must be boolean.");
      enabled = value;
      if (!value) for (const row of bound) release(row.actor.entityId);
    },
    setReach(metres) {
      if (!Number.isFinite(metres) || metres < 0 || metres > 50) throw new RangeError("Combat reach must be within 0–50 m.");
      reach = metres;
    },
    setTargetRule(rule) {
      if (rule !== "selected" && rule !== "selected-or-nearest") throw new TypeError("Unsupported combat target rule.");
      targetRule = rule;
    },
    setWeapon(choice) {
      if (!weapons.some(row => row.value === choice)) throw new TypeError("Unsupported combat weapon sound choice.");
      weapon = choice;
    },
    setDistanceGain(mode) {
      if (mode !== "ambient-curve" && mode !== "flat") throw new TypeError("Unsupported combat distance gain.");
      distanceGain = mode;
    },
    test(scenario, flags = OFFLINE_ATTACK_FLAGS) {
      if (disposed) return null;
      nativeAttackShotRoute(flags);
      const player = bound.find(row => { const entity = world.entity(row.actor.entityId); return entity && playerKind(entity); });
      const monster = bound.find(row => world.entity(row.actor.entityId)?.kind === "monster");
      const [attacker, target] = scenario === "musveren-hit" ? [monster, player] : [player, monster];
      const attackerEntity = attacker && world.entity(attacker.actor.entityId), targetEntity = target && world.entity(target.actor.entityId);
      if (!attacker || !target || !attackerEntity || !targetEntity) return null;
      const dispatch = dispatchFor(attackerEntity, null, { type: "test", notify: `test:${scenario}`, time: 0 }, "test", 0);
      dispatch.targetId = targetEntity.id; dispatch.special = scenario === "power-strike";
      dispatch.distanceMetres = gap(attacker, attackerEntity, target, targetEntity);
      const item = attackItem(attacker, attackerEntity);
      play(dispatch, "attackItem", item.set, attackerEntity, item.cue, { audition: true });
      impact(dispatch, target, targetEntity, flags, true);
      settle(dispatch);
      return remember(dispatch);
    },
    readout: () => ({ reachMetres: reach, lastHit, lastAttack }),
    inspection: () => {
      const npc = bound.find(row => row.selection?.table === "npcgrp"), npcRandom = npcNumbers(npc?.selection ?? null).random;
      return { policy: "browser-combat-audio-native-q4-routes", nativeCombatVerified: false, nativeSlotSelectionVerified: false,
        evidence: EVIDENCE, offlineOutcome: OFFLINE_OUTCOME,
        bundle: bundle?.manifestSha256 ?? null, enabled, reachMetres: reach, targetRule, weapon, distanceGain, weapons: weapons.map(row => ({ ...row })),
        actors: bound.map(row => ({ entityId: row.actor.entityId, catalogId: row.actor.catalogId, selection: row.selection?.id ?? null,
          attackClips: [...row.clips.values()].filter(events => events.some(event => event.type === "AnimNotify_AttackShot")).length })),
        rules: { attackVoiceChance: nativePercentChance(50), npcDamageChance: npcRandom === null ? null : nativePercentChance(npcRandom),
          playerDamageChance: nativePercentChance(configValue("CharSound.Random")), config: config ? "staged" : "missing" },
        played, dropped, lastHit: lastHit ? structuredClone(lastHit) : null, lastAttack: lastAttack ? structuredClone(lastAttack) : null,
        recent: recent.map(row => structuredClone(row)), diagnostics: [...diagnostics], disposed };
    },
    describe: () => describeNativeCombatAudio(api, bundle),
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const row of bound) release(row.actor.entityId);
      trackers.clear();
    },
  };
  return api;
}

const leaf = (reference: string) => reference.split(".").at(-1) ?? reference;
export function summarizeNativeCombatDispatch(dispatch: Readonly<NativeCombatDispatch> | null): string {
  if (!dispatch) return "none yet";
  const sounds = dispatch.sounds.map(sound => `${leaf(sound.reference)}${sound.accepted ? "" : " (muted)"}`);
  const skipped = dispatch.skipped.filter(skip => skip.reason === "chance" || skip.reason === "still-playing")
    .map(skip => `${skip.role === "damage" ? "dmg" : skip.role} ${skip.reason === "chance" ? "rolled out" : "still playing"}`);
  const shot = dispatch.shot && dispatch.shot.count > 1 ? ` ${dispatch.shot.index}/${dispatch.shot.count}` : "";
  const when = dispatch.type === "test" ? "test" : dispatch.type === "skill-start" ? "cast" : `${leaf(dispatch.notify).replace(/^AnimNotify_/, "")}${shot}`;
  return `${when}: ${[...sounds, ...skipped].join(" + ") || dispatch.outcome}`;
}

function setSummary(set: NativeCombatSoundSet | undefined): string {
  if (!set) return "none";
  const silent = set.unadmitted.length ? ` (+${set.unadmitted.length} empty original slot${set.unadmitted.length > 1 ? "s" : ""})` : "";
  return `${set.table}.${set.field}: ${set.slots.map(slot => leaf(slot.reference)).join(", ") || "—"}${silent}`;
}
const percent = (value: number | null) => value === null ? "not staged" : `${(value * 100).toFixed(1)}%`;

export function describeNativeCombatAudio(audio: Pick<NativeCombatAudio, "inspection" | "readout">, bundle: NativeCombatAudioBundle | null): readonly NativeCombatDescription[] {
  const selections = bundle?.selections ?? [];
  const actor = (table: string) => selections.filter(row => row.kind === "actor" && row.table === table);
  const fighters = actor("chargrp"), npcs = actor("npcgrp");
  const armor = selections.filter(row => row.kind === "armor"), weapon = selections.filter(row => row.kind === "weapon");
  const skill = selections.find(row => row.kind === "skill") ?? null, config = selections.find(row => row.kind === "config") ?? null;
  const sets = (rows: readonly NativeCombatSelection[], role: NativeCombatRole) => rows.map(row => setSummary(row.roles[role])).join(" | ") || "not staged";
  const state = () => audio.inspection();
  const last = (role: NativeCombatRole) => () => {
    const recent = state().recent;
    for (let index = recent.length - 1; index >= 0; index--) {
      const row = recent[index]!, sound = row.sounds.find(item => item.role === role), skip = row.skipped.find(item => item.role === role);
      if (sound) return `${leaf(sound.reference)} · slot ${sound.slotIndex + 1}/${sound.slotCount} · gain ${sound.gain.toFixed(2)}${sound.accepted ? "" : " (not played)"}`;
      if (skip) return `skipped: ${skip.detail}`;
    }
    return "none yet";
  };
  const npcText = npcs.map(row => `radius ${row.numeric.soundRadius ?? "?"}, volume ${row.numeric.soundVolume ?? "?"}, random ${row.numeric.soundRandom ?? "?"}`).join(" | ");
  const configText = config ? "ALAudio.int (pinned original, recipe config)" : "ALAudio.int not staged — REPORT.md Q4 values";
  return [
    { name: "combat.hitSounds", label: "Hit sounds", value: () => state().enabled ? "on" : "off", values: "on | off",
      source: "catalog.combatAudio ← scripts/bundle-native-combat-audio.py (recipes/native-combat-audio.json) → stage_native_combat_audio.py",
      status: "presentation", detail: "Opt-out toggle (presentation choice) over the original table sounds and the native Q4 routes." },
    { name: "combat.attackItem", label: "Route A · AttackItem", value: last("attackItem"),
      values: `${sets(fighters, "attackItem")} | ${sets(weapon, "attackItem")} (right hand) | ${sets(npcs, "attackItem")}`,
      source: `AnimNotify_AttackItem → APawn::GetAttackItemSound 0x1061ec50: at the attacker on hit and miss, appRand()%n, ${configText} [CharSound]/[ItemSound] Vol/Radius; skipped while the same sound plays on that pawn (IsPlaying). Sound identity: unique package+leaf candidate (conditional).`,
      status: "native", detail: `Native route (${EVIDENCE}).` },
    { name: "combat.attackVoice", label: "Route B · AttackVoice", value: last("attackVoice"),
      get values() { return `${sets(fighters, "attackVoice")} · p ${percent(state().rules.attackVoiceChance)} (appRand()%100 <= notify Random 50)`; },
      source: "AnimNotify_AttackVoice → GetAttackVoiceSound 0x10615810: attacker only (never NPCs), notify Volume 250 / Radius 30, same IsPlaying skip.",
      status: "native", detail: `Native route (${EVIDENCE}).` },
    { name: "combat.attackOutcome", label: "AttackShot outcome",
      value: () => { const hit = audio.readout().lastHit; return `flags ${hit?.flags ?? OFFLINE_ATTACK_FLAGS} → ${hit?.shotRoute ?? "defense"}`; },
      values: "0x80 miss | 0x40 shield | 0x20 critical | 0x10 soulshot | else normal hit",
      source: `${OFFLINE_OUTCOME}. APawn::Action_Attack 0x10626bb0 branch order; [EtcSound] ${config ? `${setSummary(config.roles.critical)} | ${setSummary(config.roles.soulshot)}` : "not staged"}.`,
      status: "presentation", detail: `${OFFLINE_OUTCOME} — presentation choice; the flags branches themselves are native.` },
    { name: "combat.defenseSound", label: "Route C · defense", value: last("defense"),
      values: `${sets(npcs, "defense")} | ${sets(armor, "defense")} (chest armor) | ${sets(fighters, "defense")}`,
      source: `GetDefenseItemSound 0x1061f0a0 at the target, appRand()%n. Greater Musveren: ${npcText || "not staged"} (npcgrp floats by native offset; decoded labels sound_vol/sound_radius are swapped).`,
      status: "native", detail: `Native route (${EVIDENCE}); the fighter as Musveren's target is ${CONDITIONAL_FIGHTER_TARGET}.` },
    { name: "combat.damageSound", label: "Route C · damage", value: last("damage"),
      get values() { return `${sets(npcs, "damage")} p ${percent(state().rules.npcDamageChance)} | ${sets(fighters, "damage")} p ${percent(state().rules.playerDamageChance)}`; },
      source: "GetDamageSound 0x1061f9a0 after any non-miss: NPC appRand()%100 <= npc random (70); player appRand()%100 <= [CharSound] Random (50).",
      status: "native", detail: `Native route (${EVIDENCE}).` },
    { name: "combat.isPlayingSkip", label: "Same-sound skip", value: () => {
      const skip = state().recent.flatMap(row => row.skipped).filter(item => item.reason === "still-playing").at(-1);
      return skip ? skip.detail : "none yet"; },
      values: "routes A and B", source: "ALAudio IsPlaying(pawn, sound) vtable +0x90. Browser identity: same source Sound object on the same entity; shared with the direct AnimNotify_Sound cue preview (nativePawnSounds.ts).",
      status: "native", detail: "Native rule; it also keeps the female special attack's direct fist_2 cue and its AttackItem fist pick from doubling." },
    { name: "combat.slotSelection", label: "Sound variation", value: () => "appRand()%n over the original array", values: "uniform 15-bit draw",
      source: "Native pick appRand()%n (empty original slots stay silent). The CRT sequence cannot be reproduced: Math.random stands in (presentation choice).",
      status: "native", detail: "Native modulo rule; the random sequence itself is a presentation choice." },
    { name: "combat.distanceGain", label: "Distance gain", value: () => state().distanceGain === "flat" ? "flat (volume/255 only)" : "ambient curve", values: "ambient curve | flat",
      source: "Native gain argument volume/255 (PlaySoundW). The ambient falloff (50R linear × OpenAL inverse-clamped, rolloff 0.5) is proved only for ambient sources; reusing it for actor sounds, and the listener (fighter + 1.5 m), are presentation choices.",
      status: "presentation", detail: PRESENTATION_STATUS },
    { name: "combat.targetRule", label: "Target rule", value: () => state().targetRule === "selected" ? "selected only" : "selected, else nearest", values: "selected, else nearest | selected only",
      source: "Selected entity, else the nearest living hostile in reach; Greater Musveren targets the nearest player. Native targets come from the server.",
      status: "presentation", detail: PRESENTATION_STATUS },
    { name: "combat.reachMetres", label: "Reach (m, edge to edge)", value: () => state().reachMetres.toFixed(1), values: "0.2–5",
      source: `Default ${DEFAULT_REACH_METRES} m beyond the native collision radii (100 units/m). Not applied to Power Strike at target, which shows its impact at any distance.`,
      status: "presentation", detail: PRESENTATION_STATUS },
    { name: "combat.rightHand", label: "Right hand", value: () => { const current = state(); return current.weapons.find(row => row.value === current.weapon)?.label ?? current.weapon; },
      get values() { return state().weapons.map(row => row.label).join(" | "); },
      source: "Route A reads the right-hand weapon first (weapongrp item_sound, [ItemSound] Vol 250 / Radius 40). The slice cannot equip the Short Sword, so choosing it only auditions that list (presentation choice); the Hand attack animation stays.",
      status: "presentation", detail: PRESENTATION_STATUS },
    { name: "combat.powerStrikeSounds", label: "Power Strike sounds", value: () => skill ? "cast at clip start, shot at AttackShot" : "not staged",
      values: "cast | shot", source: skill ? `${setSummary(skill.roles.cast)} | ${setSummary(skill.roles.shot)} (skillsoundgrp vol/rad)` : "skillsoundgrp row not staged",
      status: "presentation", detail: `${PRESENTATION_STATUS}: skillsoundgrp name-match candidates; no skill route is traced. Route C defense/damage still play at its AttackShot.` },
    { name: "combat.lastAttack", label: "Last attack event", value: () => summarizeNativeCombatDispatch(audio.readout().lastAttack), values: "readout",
      source: "Most recent AttackVoice/AttackItem/AttackShot dispatch", status: "presentation", detail: "Browser readout" },
    { name: "combat.lastHit", label: "Last hit", value: () => {
      const hit = audio.readout().lastHit;
      return hit ? `${summarizeNativeCombatDispatch(hit)} · ${hit.attackerId} → ${hit.targetId ?? "—"}${hit.distanceMetres === null ? "" : ` · gap ${hit.distanceMetres.toFixed(2)} m`}` : "none yet"; },
      values: "readout", source: "Most recent route C AttackShot or test impact", status: "presentation", detail: "Browser readout" },
  ];
}
