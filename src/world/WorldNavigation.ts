import type { WorldPosition } from "./worldTypes";

/** Local indexed support, not a native BSP polygon or a sound surface. */
export interface WorldSupportSample {
  readonly meshId: string;
  readonly meshUniqueId: number;
  readonly meshName: string;
  readonly indexOffset: number;
  readonly triangleIndex: number;
  readonly position: WorldPosition;
}

/** The original nine-sample decision. The first maximum controls capsule height;
 * it is not a left/right foot contact or an audio-priority rule. */
export interface WorldGroundContact {
  readonly queryPosition: WorldPosition;
  readonly position: WorldPosition;
  readonly samples: readonly WorldSupportSample[];
  readonly controllingSample: number;
}

/** Client-only geometry queries. A real adapter retains its own movement authority. */
export interface WorldNavigation {
  readonly origin: WorldPosition;
  ground(position: WorldPosition): WorldPosition | null;
  groundContact?(position: WorldPosition): WorldGroundContact | null;
  destination(position: WorldPosition): WorldPosition | null;
  spawn(offset: WorldPosition, occupied?: readonly WorldPosition[]): WorldPosition | null;
  /** Contact is the last accepted substep, including a partially blocked move.
   * No accepted substep means no contact; never re-query the raised result. */
  move(from: WorldPosition, to: WorldPosition): { position: WorldPosition; blocked: boolean; contact?: WorldGroundContact };
}
