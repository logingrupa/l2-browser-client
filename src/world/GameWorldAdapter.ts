import type { WorldCommand, WorldEntity, WorldEvent } from "./worldTypes";

export interface GameWorldAdapter {
  getInitialState(): readonly WorldEntity[];
  subscribe(listener: (event: WorldEvent) => void): () => void;
  dispatch(command: WorldCommand): void;
  dispose(): void;
}
