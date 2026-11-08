import type { GameWorldAdapter } from "./GameWorldAdapter";
import type { LocomotionMode, WorldCommand, WorldEntity, WorldEvent, WorldPosition } from "./worldTypes";
import type { WorldGroundContact, WorldNavigation } from "./WorldNavigation";
import { moveTowards } from "./syntheticMovement";
import { createSpawnedNpcEntity, isLineageIdentifier } from "./sandboxCommands";

const sandboxActorSpacingMetres = 1.4;
const velocityWithoutAccelerationRampRoutine = "APawn::calcVelocity 0x10639950";
const runStartAtWalkSpeedRoutine = "APawn::GetCurSpeed 0x1061eaf0 (MoveTimer <= WalkAnimFrameInMove / 30)";

export interface NativeSliceSpeedProfile {
  readonly walkMetresPerSecond: number;
  readonly runMetresPerSecond: number;
  readonly runStartSeconds: number;
  readonly source: string;
}
export const SYNTHETIC_SLICE_SPEED: NativeSliceSpeedProfile = Object.freeze({
  walkMetresPerSecond: .7, runMetresPerSecond: .7, runStartSeconds: 0, source: "synthetic slice speed (presentation choice)" });
export const ACIS_HUMAN_FIGHTER_SPEED = Object.freeze({ walkUnitsPerSecond: 80, runUnitsPerSecond: 115, runStartSeconds: 12 / 30,
  source: "aCis server data, not client data (humanFighter.xml line 6, sha256 6f7ef9f6b5cb8e5e…, class 0, both sexes: walkSpd 80, runSpd 115 UU/s, move multiplier 1.0; " +
    `chargrp walkanimframe 12/30 s run start, rows 0..13, ${runStartAtWalkSpeedRoutine}; no acceleration ramp, ${velocityWithoutAccelerationRampRoutine})` });
export function nativeSliceSpeedProfile(sourceUnitsPerMetre: number): NativeSliceSpeedProfile {
  if (!Number.isFinite(sourceUnitsPerMetre) || sourceUnitsPerMetre <= 0) throw new Error("Invalid source units per metre.");
  return Object.freeze({ walkMetresPerSecond: ACIS_HUMAN_FIGHTER_SPEED.walkUnitsPerSecond / sourceUnitsPerMetre,
    runMetresPerSecond: ACIS_HUMAN_FIGHTER_SPEED.runUnitsPerSecond / sourceUnitsPerMetre,
    runStartSeconds: ACIS_HUMAN_FIGHTER_SPEED.runStartSeconds, source: ACIS_HUMAN_FIGHTER_SPEED.source });
}

export class NativeSliceAdapter implements GameWorldAdapter {
  private readonly entities = new Map<string, WorldEntity>();
  private readonly listeners = new Set<(event: WorldEvent) => void>();
  private readonly commandListeners = new Set<(command: WorldCommand) => void>();
  private destination: WorldPosition | undefined;
  private paused = false;
  private disposed = false;
  private acceptedContact: WorldGroundContact | null = null;
  private secondsMovingSinceRest = 0;
  private spawnedNpcCount = 0;
  private readonly speed: NativeSliceSpeedProfile;
  private readonly walkSupported: boolean;
  private readonly specialAttackPreviewSupported: boolean;
  constructor(origin: WorldPosition, private readonly navigation?: WorldNavigation, upperItem: number | null = null,
    presentation: { displayName: string; appearanceId: string } = { displayName: "Human male fighter", appearanceId: "native-human-fighter" },
    locomotion: { walkSupported: boolean; specialAttackPreviewSupported?: boolean; speed?: NativeSliceSpeedProfile } = { walkSupported: false }) {
    this.walkSupported = locomotion.walkSupported === true;
    const speed = locomotion.speed ?? SYNTHETIC_SLICE_SPEED;
    if (![speed.walkMetresPerSecond, speed.runMetresPerSecond].every(value => Number.isFinite(value) && value > 0) ||
      !Number.isFinite(speed.runStartSeconds) || speed.runStartSeconds < 0) throw new Error("Invalid native slice speed profile.");
    this.speed = speed;
    this.specialAttackPreviewSupported = locomotion.specialAttackPreviewSupported === true;
    const player: WorldEntity = { id: "local-player", kind: "local-player", displayName: presentation.displayName,
      appearanceId: presentation.appearanceId, health: 100, maximumHealth: 100, animation: "idle", orientationRadians: 0,
      position: { x: origin.x, y: origin.y, z: origin.z }, ...(upperItem === null ? {} : { equipment: { upper: upperItem } }) };
    const monster: WorldEntity = { id: "native-musveren", kind: "monster", displayName: "Greater Musveren",
      appearanceId: "native-musveren", health: 100, maximumHealth: 100, animation: "idle", orientationRadians: 0,
      position: navigation?.ground({ x: origin.x + sandboxActorSpacingMetres, y: origin.y, z: origin.z }) ?? { x: origin.x + sandboxActorSpacingMetres, y: origin.y, z: origin.z } };
    this.entities.set(player.id, player); this.entities.set(monster.id, monster);
    this.acceptedContact = navigation?.groundContact?.(player.position) ?? null;
  }
  getInitialState(): readonly WorldEntity[] { return [...this.entities.values()].map(entity => structuredClone(entity)); }
  get isPaused(): boolean { return this.paused; }
  get locomotionMode(): LocomotionMode { return this.entities.get("local-player")?.locomotion ?? "run"; }
  get speedProfile(): NativeSliceSpeedProfile { return this.speed; }
  get currentSpeed(): number {
    if (!this.destination) return 0;
    return this.locomotionMode === "walk" || this.secondsMovingSinceRest < this.speed.runStartSeconds ? this.speed.walkMetresPerSecond : this.speed.runMetresPerSecond;
  }
  get groundContact(): WorldGroundContact | null { return this.acceptedContact ? structuredClone(this.acceptedContact) : null; }
  subscribe(listener: (event: WorldEvent) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  subscribeCommands(listener: (command: WorldCommand) => void): () => void { this.commandListeners.add(listener); return () => this.commandListeners.delete(listener); }
  private update(entity: WorldEntity): void { this.entities.set(entity.id, entity); for (const listener of this.listeners) listener({ type: "update", entity }); }
  dispatch(command: WorldCommand): void {
    if (this.disposed) return;
    for (const listener of this.commandListeners) listener(command);
    const player = this.entities.get("local-player");
    if (command.type === "set-paused") this.paused = command.isPaused;
    else if (player && command.type === "set-locomotion") {
      if ((command.mode !== "walk" && command.mode !== "run") ||
        (command.mode === "walk" && !this.walkSupported) || command.mode === this.locomotionMode) return;
      this.update({ ...player, locomotion: command.mode });
    }
    else if (command.type === "set-health") {
      const entity = this.entities.get(command.entityId);
      if (entity && Number.isFinite(command.health)) this.update({ ...entity, health: Math.max(0, Math.min(entity.maximumHealth, command.health)) });
    } else if (command.type === "despawn" && command.entityId !== "local-player") {
      if (this.entities.delete(command.entityId)) for (const listener of this.listeners) listener({ type: "despawn", entityId: command.entityId });
    } else if (player && command.type === "spawn-npc") this.spawnNpc(player, command.npcId);
    else if (player && command.type === "equip-upper") {
      if (command.itemId !== null && (!Number.isSafeInteger(command.itemId) || command.itemId < 0)) return;
      this.update({ ...player, equipment: command.itemId === null ? {} : { upper: command.itemId } });
    } else if (player && command.type === "preview-action") {
      if (command.action !== "special-attack" || !this.specialAttackPreviewSupported || player.health <= 0) return;
      const target = command.targetId === undefined ? null : this.entities.get(command.targetId);
      if (command.targetId !== undefined && (!target || target.id === player.id || target.health <= 0 ||
        ![target.position.x, target.position.y, target.position.z].every(Number.isFinite))) return;
      this.destination = undefined;
      const { actionTargetId: _previousTarget, ...unbound } = player;
      this.update({ ...unbound, animation: "attack", actionPreview: command.action,
        ...(target ? { actionTargetId: target.id, orientationRadians: Math.atan2(target.position.x - player.position.x, target.position.z - player.position.z) } : {}),
        animationSequence: (player.animationSequence ?? 0) + 1 });
    } else if (command.type === "set-animation") {
      const entity = this.entities.get(command.entityId ?? "local-player");
      if (entity) {
        if (entity.id === "local-player") this.destination = undefined;
        const { actionPreview: _preview, actionTargetId: _target, ...ordinary } = entity;
        this.update({ ...ordinary, animation: command.animation, animationSequence: (entity.animationSequence ?? 0) + 1 });
      }
    } else if (player && player.health > 0 && command.type === "move-local" && [command.position.x, command.position.y, command.position.z].every(Number.isFinite)) {
      const target = this.navigation?.destination(command.position) ?? (!this.navigation ? { x: command.position.x, y: player.position.y, z: command.position.z } : null);
      if (target) {
        this.destination = target;
        const { actionPreview: _preview, actionTargetId: _target, ...ordinary } = player;
        this.update({ ...ordinary, animation: "run" });
      }
    }
  }
  private spawnNpc(player: WorldEntity, npcId: number): void {
    if (!isLineageIdentifier(npcId)) return;
    const spawnSequence = this.spawnedNpcCount + 1;
    const occupied = [...this.entities.values()].map(entity => entity.position);
    const position = this.navigation
      ? this.navigation.spawn({ x: player.position.x - this.navigation.origin.x + sandboxActorSpacingMetres, y: player.position.y - this.navigation.origin.y, z: player.position.z - this.navigation.origin.z }, occupied)
      : { x: player.position.x + sandboxActorSpacingMetres * spawnSequence, y: player.position.y, z: player.position.z };
    if (!position) return;
    this.spawnedNpcCount = spawnSequence;
    const entity = createSpawnedNpcEntity(npcId, spawnSequence, position);
    this.entities.set(entity.id, entity);
    for (const listener of this.listeners) listener({ type: "spawn", entity });
  }
  advance(seconds: number): void {
    if (!Number.isFinite(seconds) || seconds < 0) throw new Error("Invalid native slice elapsed time.");
    const player = this.entities.get("local-player");
    if (!this.destination) this.secondsMovingSinceRest = 0;
    if (this.disposed || this.paused || !player || player.health <= 0 || !this.destination) return;
    const { walkMetresPerSecond: walk, runMetresPerSecond: run, runStartSeconds } = this.speed;
    const secondsAtWalkSpeed = this.locomotionMode === "walk" ? seconds : Math.min(seconds, Math.max(0, runStartSeconds - this.secondsMovingSinceRest));
    this.secondsMovingSinceRest += seconds;
    const next = moveTowards(player, this.destination, secondsAtWalkSpeed * walk + (seconds - secondsAtWalkSpeed) * run);
    const moved = this.navigation?.move(player.position, next.position);
    if (moved?.contact) this.acceptedContact = moved.contact;
    else {
      const position = moved?.position ?? next.position;
      if (position.x !== player.position.x || position.y !== player.position.y || position.z !== player.position.z) this.acceptedContact = null;
    }
    this.update({ ...next, ...(moved ? { position: moved.position, animation: moved.blocked ? "idle" : next.animation } : {}) });
    if (next.animation === "idle" || moved?.blocked) { this.destination = undefined; this.secondsMovingSinceRest = 0; }
  }
  dispose(): void { this.disposed = true; this.listeners.clear(); this.commandListeners.clear(); this.entities.clear(); this.destination = undefined; this.acceptedContact = null; }
}
