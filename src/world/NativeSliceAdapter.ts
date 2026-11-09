import type { GameWorldAdapter } from "./GameWorldAdapter";
import type { LocomotionMode, WorldCommand, WorldEntity, WorldEvent, WorldPosition } from "./worldTypes";
import type { WorldGroundContact, WorldNavigation } from "./WorldNavigation";
import { moveTowards } from "./syntheticMovement";
import { commandRejectedEvent, createSpawnedCharacterEntity, createSpawnedNpcEntity, entityWithClampedHealth, entityWithEquippedItem, entityWithRequestedClip,
  isLineageIdentifier, reportedPositionRejectionReason, skillCastEvent, unknownWorldCommandError } from "./sandboxCommands";
import { sourceHeadingToWorldYaw, sourcePositionToWorld } from "./sourceFrame";

type PreviewActionCommand = Extract<WorldCommand, { readonly type: "preview-action" }>;
type ReportPositionCommand = Extract<WorldCommand, { readonly type: "report-position" }>;
type CannotMoveCommand = Extract<WorldCommand, { readonly type: "cannot-move" }>;

const sandboxActorSpacingMetres = 1.4;
const velocityWithoutAccelerationRampRoutine = "APawn::calcVelocity 0x10639950";
const runStartAtWalkSpeedRoutine = "APawn::GetCurSpeed 0x1061eaf0 (MoveTimer <= WalkAnimFrameInMove / 30)";

export interface NativeSliceSpeedProfile {
  readonly walkMetresPerSecond: number;
  readonly runMetresPerSecond: number;
  readonly runStartSeconds: number;
  readonly source: string;
  readonly isSourced: boolean;
}
export const SYNTHETIC_SLICE_SPEED: NativeSliceSpeedProfile = Object.freeze({
  walkMetresPerSecond: .7, runMetresPerSecond: .7, runStartSeconds: 0, source: "synthetic slice speed (presentation choice)", isSourced: false });
export const ACIS_HUMAN_FIGHTER_SPEED = Object.freeze({ walkUnitsPerSecond: 80, runUnitsPerSecond: 115, runStartSeconds: 12 / 30,
  source: "aCis server data, not client data (humanFighter.xml line 6, sha256 6f7ef9f6b5cb8e5e…, class 0, both sexes: walkSpd 80, runSpd 115 UU/s, move multiplier 1.0; " +
    `chargrp walkanimframe 12/30 s run start, rows 0..13, ${runStartAtWalkSpeedRoutine}; no acceleration ramp, ${velocityWithoutAccelerationRampRoutine})` });
const sourcedServerSpeedByPlayerProfileId: ReadonlyMap<string, typeof ACIS_HUMAN_FIGHTER_SPEED> = new Map([
  ["human-male-fighter", ACIS_HUMAN_FIGHTER_SPEED], ["human-female-fighter", ACIS_HUMAN_FIGHTER_SPEED]]);
export function nativeSliceSpeedProfile(playerProfileId: string, sourceUnitsPerMetre: number): NativeSliceSpeedProfile {
  if (!Number.isFinite(sourceUnitsPerMetre) || sourceUnitsPerMetre <= 0) throw new Error("Invalid source units per metre.");
  const sourcedServerSpeed = sourcedServerSpeedByPlayerProfileId.get(playerProfileId);
  if (!sourcedServerSpeed) {
    return Object.freeze({ ...SYNTHETIC_SLICE_SPEED,
      source: `speed unresolved for ${playerProfileId}: no sourced server speed is recorded for this class; ${SYNTHETIC_SLICE_SPEED.source}` });
  }
  return Object.freeze({ walkMetresPerSecond: sourcedServerSpeed.walkUnitsPerSecond / sourceUnitsPerMetre,
    runMetresPerSecond: sourcedServerSpeed.runUnitsPerSecond / sourceUnitsPerMetre,
    runStartSeconds: sourcedServerSpeed.runStartSeconds, source: sourcedServerSpeed.source, isSourced: true });
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
  private spawnedCharacterCount = 0;
  private sandboxSpawnPlacementOrdinal = 0;
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
  private emit(event: WorldEvent): void { for (const listener of this.listeners) listener(event); }
  private update(entity: WorldEntity): void { this.entities.set(entity.id, entity); this.emit({ type: "update", entity }); }
  dispatch(command: WorldCommand): void {
    if (this.disposed) return;
    for (const listener of this.commandListeners) listener(command);
    const player = this.entities.get("local-player");
    switch (command.type) {
      case "set-paused":
        this.paused = command.isPaused;
        break;
      case "set-locomotion":
        if (player) this.setLocomotion(player, command.mode);
        break;
      case "set-health": {
        const entity = this.entities.get(command.entityId);
        const healthChanged = entity ? entityWithClampedHealth(entity, command.health) : null;
        if (healthChanged) this.update(healthChanged);
        break;
      }
      case "despawn":
        if (command.entityId !== "local-player" && this.entities.delete(command.entityId)) this.emit({ type: "despawn", entityId: command.entityId });
        break;
      case "spawn-npc":
        if (player) this.spawnNpc(player, command.npcId);
        break;
      case "spawn-character":
        if (player) this.spawnCharacter(player, command.characterTemplateIndex);
        break;
      case "equip-item": {
        const equippedEntity = entityWithEquippedItem(this.entities, command);
        if (equippedEntity) this.update(equippedEntity);
        break;
      }
      case "cast-skill": {
        const castEvent = skillCastEvent(this.entities, command);
        if (castEvent) this.emit(castEvent);
        break;
      }
      case "play-clip": {
        const clipRequestedEntity = entityWithRequestedClip(this.entities, command);
        if (clipRequestedEntity) this.update(clipRequestedEntity);
        break;
      }
      case "preview-action":
        if (player) this.previewAction(player, command);
        break;
      case "set-animation": {
        const entity = this.entities.get(command.entityId ?? "local-player");
        if (entity) {
          if (entity.id === "local-player") this.destination = undefined;
          const { actionPreview: _preview, actionTargetId: _target, ...ordinary } = entity;
          this.update({ ...ordinary, animation: command.animation, animationSequence: (entity.animationSequence ?? 0) + 1 });
        }
        break;
      }
      case "move-local":
        if (player) this.moveLocalPlayer(player, command.position);
        break;
      case "report-position":
        if (player) this.acceptReportedPosition(player, command);
        break;
      case "cannot-move":
        if (player) this.stopAtReportedPosition(player, command);
        break;
      default: {
        const unhandledCommand: never = command;
        throw unknownWorldCommandError(unhandledCommand);
      }
    }
  }
  private setLocomotion(player: WorldEntity, mode: LocomotionMode): void {
    if ((mode !== "walk" && mode !== "run") || (mode === "walk" && !this.walkSupported) || mode === this.locomotionMode) return;
    this.update({ ...player, locomotion: mode });
  }
  private previewAction(player: WorldEntity, command: PreviewActionCommand): void {
    if (command.action !== "special-attack" || !this.specialAttackPreviewSupported || player.health <= 0) return;
    const target = command.targetId === undefined ? null : this.entities.get(command.targetId);
    if (command.targetId !== undefined && (!target || target.id === player.id || target.health <= 0 ||
      ![target.position.x, target.position.y, target.position.z].every(Number.isFinite))) return;
    this.destination = undefined;
    const { actionTargetId: _previousTarget, ...unbound } = player;
    this.update({ ...unbound, animation: "attack", actionPreview: command.action,
      ...(target ? { actionTargetId: target.id, orientationRadians: Math.atan2(target.position.x - player.position.x, target.position.z - player.position.z) } : {}),
      animationSequence: (player.animationSequence ?? 0) + 1 });
  }
  private moveLocalPlayer(player: WorldEntity, requestedPosition: WorldPosition): void {
    if (player.health <= 0 || ![requestedPosition.x, requestedPosition.y, requestedPosition.z].every(Number.isFinite)) return;
    const target = this.navigation?.destination(requestedPosition) ?? (!this.navigation ? { x: requestedPosition.x, y: player.position.y, z: requestedPosition.z } : null);
    if (!target) return;
    this.destination = target;
    const { actionPreview: _preview, actionTargetId: _target, ...ordinary } = player;
    this.update({ ...ordinary, animation: "run" });
  }
  private acceptReportedPosition(player: WorldEntity, command: ReportPositionCommand): void {
    const rejectionReason = reportedPositionRejectionReason(command);
    if (rejectionReason) { this.emit(commandRejectedEvent(command.type, rejectionReason)); return; }
    this.placeLocalPlayer({ ...player, position: sourcePositionToWorld(command.position) });
  }
  private stopAtReportedPosition(player: WorldEntity, command: CannotMoveCommand): void {
    const rejectionReason = reportedPositionRejectionReason(command);
    if (rejectionReason) { this.emit(commandRejectedEvent(command.type, rejectionReason)); return; }
    this.destination = undefined;
    this.secondsMovingSinceRest = 0;
    this.placeLocalPlayer({ ...player, position: sourcePositionToWorld(command.position), orientationRadians: sourceHeadingToWorldYaw(command.heading) });
    this.emit({ type: "stop", entityId: player.id, position: { x: command.position.x, y: command.position.y, z: command.position.z }, heading: command.heading });
  }
  private placeLocalPlayer(player: WorldEntity): void {
    this.entities.set(player.id, player);
    this.acceptedContact = this.navigation?.groundContact?.(player.position) ?? null;
  }
  private nextSandboxSpawnPosition(player: WorldEntity): WorldPosition | null {
    const placementOrdinal = this.sandboxSpawnPlacementOrdinal + 1;
    const occupied = [...this.entities.values()].map(entity => entity.position);
    const position = this.navigation
      ? this.navigation.spawn({ x: player.position.x - this.navigation.origin.x + sandboxActorSpacingMetres, y: player.position.y - this.navigation.origin.y, z: player.position.z - this.navigation.origin.z }, occupied)
      : { x: player.position.x + sandboxActorSpacingMetres * placementOrdinal, y: player.position.y, z: player.position.z };
    if (position) this.sandboxSpawnPlacementOrdinal = placementOrdinal;
    return position;
  }
  private spawnNpc(player: WorldEntity, npcId: number): void {
    if (!isLineageIdentifier(npcId)) return;
    const position = this.nextSandboxSpawnPosition(player);
    if (!position) return;
    this.spawnedNpcCount += 1;
    this.addSpawnedEntity(createSpawnedNpcEntity(npcId, this.spawnedNpcCount, position));
  }
  private spawnCharacter(player: WorldEntity, characterTemplateIndex: number): void {
    if (!isLineageIdentifier(characterTemplateIndex)) return;
    const position = this.nextSandboxSpawnPosition(player);
    if (!position) return;
    this.spawnedCharacterCount += 1;
    this.addSpawnedEntity(createSpawnedCharacterEntity(characterTemplateIndex, this.spawnedCharacterCount, position));
  }
  private addSpawnedEntity(entity: WorldEntity): void {
    this.entities.set(entity.id, entity);
    this.emit({ type: "spawn", entity });
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
