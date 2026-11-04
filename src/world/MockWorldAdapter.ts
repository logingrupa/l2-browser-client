import type { GameWorldAdapter } from "./GameWorldAdapter";
import { createInitialWorld } from "./createInitialWorld";
import { moveTowards, simulateRemotePlayer } from "./syntheticMovement";
import type { WorldCommand, WorldEntity, WorldEvent, WorldPosition } from "./worldTypes";

const updateIntervalSeconds = 0.1;
const localMovementMetresPerSecond = 4;

function copyEntity(entity: WorldEntity): WorldEntity {
  return Object.freeze({ ...entity, position: Object.freeze({ ...entity.position }) });
}

/** Entirely local, deterministic data producer. It never creates scene objects. */
export class MockWorldAdapter implements GameWorldAdapter {
  private readonly entities = new Map<string, WorldEntity>();
  private readonly listeners = new Set<(event: WorldEvent) => void>();
  private localDestination: WorldPosition | undefined;
  private pendingSeconds = 0;
  private simulationTicks = 0;
  private spawnedEntityCount = 0;
  private isPaused = false;
  private isDisposed = false;

  constructor() {
    for (const entity of createInitialWorld()) this.entities.set(entity.id, copyEntity(entity));
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
      case "set-animation":
        this.localDestination = undefined;
        if (localPlayer) this.updateEntity({ ...localPlayer, animation: command.animation });
        break;
      case "move-local":
        if (localPlayer && Object.values(command.position).every(Number.isFinite)) {
          this.localDestination = { ...command.position, y: 0 };
          this.updateEntity({ ...localPlayer, animation: "run" });
        }
        break;
      case "teleport-local":
        this.localDestination = undefined;
        if (localPlayer) {
          this.updateEntity({
            ...localPlayer,
            position: { x: localPlayer.position.x < 4 ? 7 : -7, y: 0, z: 0 },
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
    this.localDestination = undefined;
  }

  private advanceTick(): void {
    this.simulationTicks += 1;
    const elapsedSeconds = this.simulationTicks * updateIntervalSeconds;
    for (const entity of this.entities.values()) {
      if (entity.kind === "remote-player") {
        this.updateEntity(simulateRemotePlayer(entity, elapsedSeconds));
      } else if (entity.kind === "local-player" && this.localDestination) {
        const movedEntity = moveTowards(entity, this.localDestination, localMovementMetresPerSecond * updateIntervalSeconds);
        this.updateEntity(movedEntity);
        if (movedEntity.animation === "idle") this.localDestination = undefined;
      } else if (entity.kind === "monster") {
        const attackCycleSeconds = ((elapsedSeconds + entity.position.x) % 8 + 8) % 8;
        const animation = attackCycleSeconds < 0.9 ? "attack" : "idle";
        if (entity.animation !== animation) this.updateEntity({ ...entity, animation });
      }
    }
  }

  private spawnEntity(shouldUseMissingModel: boolean): void {
    this.spawnedEntityCount += 1;
    const entity: WorldEntity = copyEntity({
      id: `spawned-${this.spawnedEntityCount}`,
      kind: "monster",
      displayName: shouldUseMissingModel ? "Fallback Sentinel" : `Sentinel ${this.spawnedEntityCount}`,
      position: { x: -6 + (this.spawnedEntityCount % 5) * 2.5, y: 0, z: -6 },
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
