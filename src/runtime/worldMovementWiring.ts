import type { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import type { Scene } from "@babylonjs/core/scene";
import type { GameWorldAdapter } from "../world/GameWorldAdapter";
import type { WorldEvent, WorldPosition } from "../world/worldTypes";
import {
  sourceDistanceToWorld, sourceHeadingToWorldYaw, sourcePositionToWorld, worldDistanceToSource, worldPositionToSource,
} from "../world/sourceFrame";
import { provideCollisionCellContext } from "../scene/world/movement/collisionCellContext";
import { createCollisionWorld, type CollisionWorld, type CollisionWorldInspection } from "../scene/world/movement/core/collisionWorld";
import type { MovementNativeRules } from "../scene/world/movement/core/movementRules";
import { traceClickDestination } from "../scene/world/movement/core/clickTrace";
import { calculateBehindView } from "../scene/world/movement/core/behindViewCamera";
import { singleLineCheck } from "../scene/world/movement/core/lineCheck";
import {
  createMovementPresenter, MovementPresenterError, type MovementIntent, type MovementPresenterInspection,
} from "../scene/world/movement/movementPresenter";
import type { TileCollisionLoad } from "./tileCollisionCells";

export interface WorldBounds {
  readonly minimum: WorldPosition;
  readonly maximum: WorldPosition;
}

export interface WorldMovementOptions {
  readonly scene: Scene;
  readonly adapter: Pick<GameWorldAdapter, "subscribe" | "dispatch">;
  readonly camera: ArcRotateCamera;
  readonly rules: MovementNativeRules;
  readonly focusPosition: () => WorldPosition | null;
  readonly loadCollisionCells: (world: CollisionWorld, signal: AbortSignal) => Promise<TileCollisionLoad>;
  readonly loadedBounds: WorldBounds | null;
  readonly localPlayerId: string;
  readonly localWalkAnimationFramesInMove: number | null;
  readonly signal: AbortSignal;
}

export interface MovementPose {
  readonly feetPosition: WorldPosition;
  readonly orientationRadians: number;
  readonly isMoving: boolean;
}

export type CollisionLoadStatus = "loading" | "resident" | "failed";

export interface WorldMovementCollisionCells extends CollisionWorldInspection {
  readonly status: CollisionLoadStatus;
  readonly failure: string | null;
  readonly load: TileCollisionLoad | null;
}

export interface WorldMovementInspection {
  readonly collisionCells: WorldMovementCollisionCells;
  readonly presenter: MovementPresenterInspection;
  readonly rejectedRecordCount: number;
  readonly lastRejectedRecord: string | null;
  readonly lastLocalDestination: WorldPosition | null;
  readonly dispatchedIntentCounts: Readonly<Record<MovementIntent["type"], number>>;
  readonly followCamera: { readonly desiredRadius: number | null; readonly appliedRadius: number | null; readonly hitDistance: number | null };
}

export interface WorldMovement {
  readonly collisionWorld: CollisionWorld;
  advance(frameSeconds: number): void;
  pose(entityId: string): MovementPose | null;
  destinationAlongRay(origin: WorldPosition, direction: WorldPosition): WorldPosition | null;
  constrainFollowCamera(): void;
  collisionSurfaceHeightsAt(x: number, z: number): number[];
  inspection(): WorldMovementInspection;
  release(): void;
}

const presentedRecordTypes: ReadonlySet<WorldEvent["type"]> = new Set(["move", "stop", "correct", "teleport", "despawn"]);
const rotatorUnitsPerHalfTurn = 32768;
const zeroExtent = { x: 0, y: 0, z: 0 };

const toRotatorUnits = (radians: number) => Math.round(radians * rotatorUnitsPerHalfTurn / Math.PI);

function boundsDiagonalSourceLength(bounds: WorldBounds): number {
  const { minimum, maximum } = bounds;
  return worldDistanceToSource(Math.hypot(maximum.x - minimum.x, maximum.y - minimum.y, maximum.z - minimum.z));
}

export function wireWorldMovement(options: WorldMovementOptions): WorldMovement {
  const { scene, adapter, camera, rules, localPlayerId } = options;
  const collisionWorld = createCollisionWorld();
  const withdrawContext = provideCollisionCellContext(scene, { world: collisionWorld, focusPosition: options.focusPosition });
  const pendingIntents: MovementIntent[] = [];
  const presenter = createMovementPresenter({
    collisionWorld, rules, reportIntent: intent => { pendingIntents.push(intent); },
    pawnTraits: entityId => ({ isLocalPlayer: entityId === localPlayerId,
      walkAnimationFramesInMove: entityId === localPlayerId ? options.localWalkAnimationFramesInMove : null, flies: false }),
  });
  let status: CollisionLoadStatus = "loading", failure: string | null = null, load: TileCollisionLoad | null = null;
  let rejectedRecordCount = 0, lastRejectedRecord: string | null = null, released = false;
  let lastLocalDestination: WorldPosition | null = null;
  const dispatchedIntentCounts: Record<MovementIntent["type"], number> = { "report-position": 0, "cannot-move": 0 };
  let desiredRadius: number | null = null, appliedRadius: number | null = null, hitDistance: number | null = null;
  options.loadCollisionCells(collisionWorld, options.signal).then(
    result => { if (!released) { load = result; status = "resident"; } },
    (error: unknown) => { if (!released) { status = "failed"; failure = error instanceof Error ? error.message : String(error); } });
  const unsubscribe = adapter.subscribe(event => {
    if (!presentedRecordTypes.has(event.type)) return;
    try {
      presenter.applyEvent(event);
      if (event.type === "move" && event.entityId === localPlayerId) lastLocalDestination = sourcePositionToWorld(event.destination);
    }
    catch (error) {
      if (!(error instanceof MovementPresenterError)) throw error;
      rejectedRecordCount += 1; lastRejectedRecord = error.message;
    }
  });
  const pawnOf = (entityId: string) => presenter.inspection().pawns.find(pawn => pawn.entityId === entityId) ?? null;
  const localSwimsOrFlies = () => {
    const mode = pawnOf(localPlayerId)?.mode;
    return mode === "swimming" || mode === "flying";
  };
  const verticalProbe = (x: number, z: number) => {
    const bounds = options.loadedBounds;
    if (bounds === null) return null;
    if (!Number.isFinite(x) || !Number.isFinite(z)) throw new RangeError("collisionSurfaceHeightsAt needs finite x and z metres.");
    return {
      start: worldPositionToSource({ x, y: bounds.maximum.y, z }), end: worldPositionToSource({ x, y: bounds.minimum.y, z }),
    };
  };
  return {
    collisionWorld,
    advance(frameSeconds) {
      if (status !== "resident") return;
      presenter.advance(frameSeconds);
      for (const intent of pendingIntents.splice(0)) {
        dispatchedIntentCounts[intent.type] += 1;
        adapter.dispatch(intent);
      }
    },
    pose(entityId) {
      const pawn = pawnOf(entityId);
      if (pawn === null) return null;
      return { feetPosition: sourcePositionToWorld(pawn.feetPosition), orientationRadians: sourceHeadingToWorldYaw(pawn.heading), isMoving: pawn.isMoving };
    },
    destinationAlongRay(origin, direction) {
      if (status !== "resident" || options.loadedBounds === null) return null;
      const destination = traceClickDestination(collisionWorld, {
        origin: worldPositionToSource(origin), direction: worldPositionToSource(direction),
        loadedBoundsLength: boundsDiagonalSourceLength(options.loadedBounds), swimsOrFlies: localSwimsOrFlies(),
      }, rules);
      return destination === null ? null : sourcePositionToWorld(destination);
    },
    constrainFollowCamera() {
      const zoomRadius = appliedRadius !== null && camera.radius === appliedRadius && desiredRadius !== null ? desiredRadius : camera.radius;
      desiredRadius = zoomRadius;
      const sineBeta = Math.sin(camera.beta);
      const direction = worldPositionToSource({ x: -Math.cos(camera.alpha) * sineBeta, y: -Math.cos(camera.beta), z: -Math.sin(camera.alpha) * sineBeta });
      const horizontalLength = Math.hypot(direction.x, direction.y);
      const view = calculateBehindView(collisionWorld, {
        pivot: worldPositionToSource({ x: camera.target.x, y: camera.target.y, z: camera.target.z }),
        pitch: toRotatorUnits(Math.atan2(direction.z, horizontalLength)), yaw: toRotatorUnits(Math.atan2(direction.y, direction.x)),
        zoomDistance: worldDistanceToSource(zoomRadius) - rules.camera.zoomOffset,
      }, rules);
      hitDistance = view.hitDistance === null ? null : sourceDistanceToWorld(view.hitDistance);
      appliedRadius = sourceDistanceToWorld(view.distance - rules.camera.wallMargin);
      camera.radius = appliedRadius;
    },
    collisionSurfaceHeightsAt(x, z) {
      const probe = verticalProbe(x, z);
      if (probe === null || status !== "resident") return [];
      const hit = singleLineCheck(collisionWorld, { ...probe, extent: zeroExtent }, rules);
      return hit === null ? [] : [sourcePositionToWorld(hit.location).y];
    },
    inspection() {
      return {
        collisionCells: { ...collisionWorld.inspection(), status, failure, load },
        presenter: presenter.inspection(), rejectedRecordCount, lastRejectedRecord, lastLocalDestination, dispatchedIntentCounts: { ...dispatchedIntentCounts }, followCamera: { desiredRadius, appliedRadius, hitDistance },
      };
    },
    release() {
      if (released) return;
      released = true;
      unsubscribe();
      withdrawContext();
      pendingIntents.length = 0;
    },
  };
}
