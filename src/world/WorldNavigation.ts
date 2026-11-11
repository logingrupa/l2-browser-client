import type { WorldPosition } from "./sourceFrame";

export interface WorldSupportSample {
  readonly meshId: string;
  readonly meshUniqueId: number;
  readonly meshName: string;
  readonly indexOffset: number;
  readonly triangleIndex: number;
  readonly position: WorldPosition;
}

export interface WorldGroundContact {
  readonly queryPosition: WorldPosition;
  readonly position: WorldPosition;
  readonly samples: readonly WorldSupportSample[];
  readonly controllingSample: number;
}

export interface WorldNavigation {
  destination(position: WorldPosition): WorldPosition | null;
  move(from: WorldPosition, to: WorldPosition): { position: WorldPosition; blocked: boolean };
}
