import type { WorldCommand, WorldEntity, WorldEvent } from "./worldTypes";

/**
 * World-data boundary. Subscribe and read the snapshot synchronously before
 * starting a frame loop. Events are ordered; every update is a complete state.
 * No Babylon objects, transport types, or wall-clock timers cross this boundary.
 */
export interface GameWorldAdapter {
  getInitialState(): readonly WorldEntity[];
  subscribe(listener: (event: WorldEvent) => void): () => void;
  dispatch(command: WorldCommand): void;
  /** Elapsed seconds. A transport-backed implementation may leave this empty. */
  advance(deltaTimeSeconds: number): void;
  dispose(): void;
}
