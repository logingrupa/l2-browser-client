import type { GameWorldAdapter } from "./GameWorldAdapter";
import { createInitialWorld } from "./createInitialWorld";
import { moveTowards, simulateRemotePlayer } from "./syntheticMovement";
import type { WorldCommand, WorldEntity, WorldEvent, WorldPosition } from "./worldTypes";
import { createSpawnedNpcEntity, entityWithClampedHealth, entityWithEquippedItem, isLineageIdentifier, skillCastEvent } from "./sandboxCommands";
import type { WorldNavigation } from "./WorldNavigation";

const updateIntervalSeconds = 0.1;
const localMovementMetresPerSecond = 4;

function copyEntity(entity: WorldEntity): WorldEntity {
  return Object.freeze({ ...entity, position: Object.freeze({ ...entity.position }) });
}

export class MockWorldAdapter implements GameWorldAdapter {
  private readonly entities = new Map<string, WorldEntity>();
  private readonly listeners = new Set<(event: WorldEvent) => void>();
  private localDestination: WorldPosition | undefined;
  private pendingSeconds = 0;
  private simulationTicks = 0;
  private spawnedEntityCount = 0;
  private spawnedNpcCount = 0;
  private isPaused = false;
  private isDisposed = false;
  private readonly initialPositions = new Map<string, WorldPosition>();
  private teleportCount = 0;

  constructor(private readonly navigation?: WorldNavigation) {
    for (const entity of createInitialWorld()) {
      const grounded = navigation?.spawn({ x: entity.position.x * .5, y: 0, z: entity.position.z * .5 }, [...this.entities.values()].map(other => other.position));
      if (navigation && !grounded) throw new Error(`No supported spawn for ${entity.displayName}.`);
      const initial = copyEntity(grounded ? { ...entity, position: grounded } : entity);
      this.entities.set(initial.id, initial);
      this.initialPositions.set(initial.id, initial.position);
    }
  }

  getInitialState(): readonly WorldEntity[] {
    return Object.freeze(Array.from(this.entities.values(), copyEntity));
  }

  subscribe(listener: (event: WorldEvent) => void): () => void {
    if (this.isDisposed) return () => undefined;
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispatch(command: WorldCommand): void {
    if (this.isDisposed) return;
    const localPlayer = this.entities.get("local-player");

    switch (command.type) {
      case "set-paused":
        this.isPaused = command.isPaused;
        break;
      case "set-animation": {
        const entity = this.entities.get(command.entityId ?? "local-player");
        if (entity) {
          if (entity.id === "local-player") this.localDestination = undefined;
          this.updateEntity({ ...entity, animation: command.animation, animationSequence: (entity.animationSequence ?? 0) + 1 });
        }
        break;
      }
      case "move-local":
        if (localPlayer && Object.values(command.position).every(Number.isFinite)) {
          const destination = this.navigation ? this.navigation.destination(command.position) : { ...command.position, y: 0 };
          if (destination) {
            this.localDestination = destination;
            this.updateEntity({ ...localPlayer, animation: "run" });
          }
        }
        break;
      case "teleport-local":
        this.localDestination = undefined;
        if (localPlayer) {
          this.teleportCount++;
          const destination = this.navigation
            ? this.navigation.spawn({ x: this.teleportCount % 2 ? 3.5 : -3.5, y: 0, z: 0 }, [...this.entities.values()].filter(other => other.id !== localPlayer.id).map(other => other.position))
            : { x: localPlayer.position.x < 4 ? 7 : -7, y: 0, z: 0 };
          if (!destination) break;
          this.updateEntity({
            ...localPlayer,
            position: destination,
            animation: "idle",
          }, true);
        }
        break;
      case "spawn":
        this.spawnEntity(false);
        break;
      case "load-missing-model":
        this.spawnEntity(true);
        break;
      case "spawn-npc":
        this.spawnNpc(command.npcId);
        break;
      case "set-health": {
        const entity = this.entities.get(command.entityId);
        const healthChanged = entity ? entityWithClampedHealth(entity, command.health) : null;
        if (healthChanged) this.updateEntity(healthChanged);
        break;
      }
      case "equip-item": {
        const equippedEntity = entityWithEquippedItem(this.entities, command);
        if (equippedEntity) this.updateEntity(equippedEntity);
        break;
      }
      case "cast-skill": {
        const castEvent = skillCastEvent(this.entities, command);
        if (castEvent) this.emit(castEvent);
        break;
      }
      case "despawn":
        if (this.entities.delete(command.entityId)) {
          if (command.entityId === "local-player") this.localDestination = undefined;
          this.emit({ type: "despawn", entityId: command.entityId });
        }
        break;
    }
  }

  advance(deltaTimeSeconds: number): void {
    if (this.isDisposed || this.isPaused) return;
    if (!Number.isFinite(deltaTimeSeconds) || deltaTimeSeconds < 0) {
      throw new RangeError("World elapsed time must be a finite, non-negative number of seconds.");
    }
    this.pendingSeconds += deltaTimeSeconds;
    const ticksToAdvance = Math.floor((this.pendingSeconds + 1e-10) / updateIntervalSeconds);
    this.pendingSeconds = Math.max(0, this.pendingSeconds - ticksToAdvance * updateIntervalSeconds);
    for (let tick = 0; tick < ticksToAdvance; tick += 1) this.advanceTick();
  }

  dispose(): void {
    this.isDisposed = true;
    this.listeners.clear();
    this.entities.clear();
    this.initialPositions.clear();
    this.localDestination = undefined;
  }

  private advanceTick(): void {
    this.simulationTicks += 1;
    const elapsedSeconds = this.simulationTicks * updateIntervalSeconds;
    for (const entity of this.entities.values()) {
      if (entity.kind === "remote-player") {
        if (this.navigation) {
          const center = this.initialPositions.get(entity.id)!;
          const direction = entity.id === "remote-1" ? 1 : -1, phase = elapsedSeconds * .45;
          const destination = { x: center.x + Math.sin(phase) * direction, y: entity.position.y, z: center.z + Math.cos(phase) - 1 };
          const desired = moveTowards(entity, destination, 2 * updateIntervalSeconds);
          const moved = this.navigation.move(entity.position, desired.position);
          this.updateEntity({ ...desired, position: moved.position, animation: moved.blocked ? "idle" : "run" });
        } else this.updateEntity(simulateRemotePlayer(entity, elapsedSeconds));
      } else if (entity.kind === "local-player" && this.localDestination) {
        let movedEntity = moveTowards(entity, this.localDestination, (this.navigation ? 2 : localMovementMetresPerSecond) * updateIntervalSeconds);
        if (this.navigation) {
          const moved = this.navigation.move(entity.position, movedEntity.position);
          const arrived = Math.hypot(moved.position.x - this.localDestination.x, moved.position.z - this.localDestination.z) < .01;
          movedEntity = { ...movedEntity, position: moved.position, animation: moved.blocked || arrived ? "idle" : "run" };
        }
        this.updateEntity(movedEntity);
        if (movedEntity.animation === "idle") this.localDestination = undefined;
      } else if (entity.kind === "monster") {
        const attackCycleSeconds = ((elapsedSeconds + entity.position.x) % 8 + 8) % 8;
        const animation = attackCycleSeconds < 0.9 ? "attack" : "idle";
        if (entity.animation !== animation) this.updateEntity({ ...entity, animation });
      }
    }
  }

  private spawnPlacement(spawnSequence: number): WorldPosition | null {
    const flatPosition = { x: -6 + (spawnSequence % 5) * 2.5, y: 0, z: -6 };
    return this.navigation ? this.navigation.spawn({ x: flatPosition.x * .5, y: 0, z: flatPosition.z * .5 }, [...this.entities.values()].map(other => other.position)) : flatPosition;
  }

  private spawnNpc(npcId: number): void {
    if (!isLineageIdentifier(npcId)) return;
    const spawnSequence = this.spawnedNpcCount + 1;
    const spawnPosition = this.spawnPlacement(spawnSequence);
    if (!spawnPosition) return;
    this.spawnedNpcCount = spawnSequence;
    const entity = createSpawnedNpcEntity(npcId, spawnSequence, spawnPosition);
    this.entities.set(entity.id, entity);
    this.emit({ type: "spawn", entity });
  }

  private spawnEntity(shouldUseMissingModel: boolean): void {
    this.spawnedEntityCount += 1;
    const spawnPosition = this.spawnPlacement(this.spawnedEntityCount);
    if (!spawnPosition) return;
    const entity: WorldEntity = copyEntity({
      id: `spawned-${this.spawnedEntityCount}`,
      kind: "monster",
      displayName: shouldUseMissingModel ? "Fallback Sentinel" : `Sentinel ${this.spawnedEntityCount}`,
      position: spawnPosition,
      orientationRadians: 0,
      health: 100,
      maximumHealth: 100,
      animation: "idle",
      ...(shouldUseMissingModel ? { modelUrl: "/assets/missing-character.glb" } : {}),
    });
    this.entities.set(entity.id, entity);
    this.emit({ type: "spawn", entity });
  }

  private updateEntity(entity: WorldEntity, shouldSnap = false): void {
    const snapshot = copyEntity(entity);
    this.entities.set(snapshot.id, snapshot);
    this.emit({ type: "update", entity: snapshot, shouldSnap });
  }

  private emit(event: WorldEvent): void {
    const immutableEvent = Object.freeze(event);
    for (const listener of this.listeners) listener(immutableEvent);
  }
}
