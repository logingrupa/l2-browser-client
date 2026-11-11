import type { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import type { GameWorldAdapter } from "../world/GameWorldAdapter";
import type { WorldEvent } from "../world/worldTypes";
import {
  sourceDistanceToWorld, sourceHeadingToWorldYaw, sourcePositionToWorld, worldDistanceToSource, worldPositionToSource, type WorldPosition,
} from "../world/sourceFrame";
import type { CollisionWorld, CollisionWorldInspection } from "../scene/world/movement/core/collisionWorld";
import type { MovementNativeRules } from "../scene/world/movement/core/movementRules";
import { traceClickDestination } from "../scene/world/movement/core/clickTrace";
import { calculateBehindView, type BehindView } from "../scene/world/movement/core/behindViewCamera";
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
  readonly adapter: Pick<GameWorldAdapter, "subscribe" | "dispatch">;
  readonly camera: ArcRotateCamera;
  readonly rules: MovementNativeRules;
  readonly collisionWorld: CollisionWorld;
  readonly loadCollisionCells: (world: CollisionWorld, signal: AbortSignal) => Promise<TileCollisionLoad | null>;
  readonly loadedBounds: WorldBounds | null;
  readonly localPlayerId: string;
  readonly localWalkAnimationFramesInMove: number | null;
  readonly signal: AbortSignal;
}

export interface SourceCollisionCylinder {
  readonly radius: number;
  readonly height: number;
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
  groundBelow(feetPosition: WorldPosition): WorldPosition | null;
  isStraightWalkBlocked(fromFeet: WorldPosition, toFeet: WorldPosition, cylinder: SourceCollisionCylinder): boolean;
  inspection(): WorldMovementInspection;
  release(): void;
}

const presentedRecordTypes: ReadonlySet<WorldEvent["type"]> = new Set(["move", "stop", "correct", "teleport", "despawn"]);
const rotatorUnitsPerHalfTurn = 32768;
const zeroExtent = { x: 0, y: 0, z: 0 };
const groundQueryLimit = 64;

const toRotatorUnits = (radians: number) => Math.round(radians * rotatorUnitsPerHalfTurn / Math.PI);

function clampToCameraRadiusLimits(camera: ArcRotateCamera, radius: number): number {
  const raised = camera.lowerRadiusLimit === null ? radius : Math.max(radius, camera.lowerRadiusLimit);
  return camera.upperRadiusLimit === null ? raised : Math.min(raised, camera.upperRadiusLimit);
}

function boundsDiagonalSourceLength(bounds: WorldBounds): number {
  const { minimum, maximum } = bounds;
  return worldDistanceToSource(Math.hypot(maximum.x - minimum.x, maximum.y - minimum.y, maximum.z - minimum.z));
}

export function wireWorldMovement(options: WorldMovementOptions): WorldMovement {
  const { adapter, camera, rules, localPlayerId, collisionWorld } = options;
  const pendingIntents: MovementIntent[] = [];
  const presenter = createMovementPresenter({
    collisionWorld, rules, reportIntent: intent => { pendingIntents.push(intent); },
    pawnTraits: entityId => ({ isLocalPlayer: entityId === localPlayerId,
      walkAnimationFramesInMove: entityId === localPlayerId ? options.localWalkAnimationFramesInMove : null, flies: false }),
  });
  let status: CollisionLoadStatus = "loading", failure: string | null = null, load: TileCollisionLoad | null = null;
  let rejectedRecordCount = 0, lastRejectedRecord: string | null = null, released = false;
  let lastLocalDestination: WorldPosition | null = null;
  const groundByQuery = new Map<string, WorldPosition | null>();
  let lastBehindView: { readonly queryKey: string; readonly view: BehindView } | null = null;
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
    const top = worldPositionToSource({ x, y: bounds.maximum.y, z }), bottom = worldPositionToSource({ x, y: bounds.minimum.y, z });
    return { start: { ...top, z: top.z + rules.pawn.maxStepHeight }, end: { ...bottom, z: bottom.z - rules.pawn.maxStepHeight } };
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
      const query = {
        pivot: worldPositionToSource({ x: camera.target.x, y: camera.target.y, z: camera.target.z }),
        pitch: toRotatorUnits(Math.atan2(direction.z, horizontalLength)), yaw: toRotatorUnits(Math.atan2(direction.y, direction.x)),
        zoomDistance: worldDistanceToSource(zoomRadius) + rules.camera.wallMargin - rules.camera.zoomOffset,
      };
      const queryKey = `${collisionWorld.inspection().revision}:${query.pivot.x}:${query.pivot.y}:${query.pivot.z}:${query.pitch}:${query.yaw}:${query.zoomDistance}`;
      if (queryKey !== lastBehindView?.queryKey) lastBehindView = { queryKey, view: calculateBehindView(collisionWorld, query, rules) };
      const view = lastBehindView.view;
      hitDistance = view.hitDistance === null ? null : sourceDistanceToWorld(view.hitDistance);
      appliedRadius = clampToCameraRadiusLimits(camera, sourceDistanceToWorld(view.distance - rules.camera.wallMargin));
      camera.radius = appliedRadius;
    },
    collisionSurfaceHeightsAt(x, z) {
      const probe = verticalProbe(x, z);
      if (probe === null || status !== "resident") return [];
      const hit = singleLineCheck(collisionWorld, { ...probe, extent: zeroExtent }, rules);
      return hit === null ? [] : [sourcePositionToWorld(hit.location).y];
    },
    groundBelow(feetPosition) {
      const bounds = options.loadedBounds;
      if (bounds === null || status !== "resident" || ![feetPosition.x, feetPosition.y, feetPosition.z].every(Number.isFinite)) return null;
      const revision = collisionWorld.inspection().revision, key = `${revision}:${feetPosition.x}:${feetPosition.y}:${feetPosition.z}`;
      if (groundByQuery.has(key)) return groundByQuery.get(key)!;
      const feet = worldPositionToSource(feetPosition);
      const start = { x: feet.x, y: feet.y, z: feet.z + rules.pawn.maxStepHeight };
      const end = worldPositionToSource({ x: feetPosition.x, y: bounds.minimum.y, z: feetPosition.z });
      const hit = end.z >= start.z ? null : singleLineCheck(collisionWorld, { start, end, extent: zeroExtent }, rules);
      const ground = hit === null ? null : sourcePositionToWorld(hit.location);
      if (groundByQuery.size >= groundQueryLimit) groundByQuery.delete(groundByQuery.keys().next().value!);
      groundByQuery.set(key, ground);
      return ground;
    },
    isStraightWalkBlocked(fromFeet, toFeet, cylinder) {
      if (status !== "resident") return true;
      const raisedCentre = (feetPosition: WorldPosition) => {
        const feet = worldPositionToSource(feetPosition);
        return { x: feet.x, y: feet.y, z: feet.z + cylinder.height + rules.pawn.maxStepHeight };
      };
      const extent = { x: cylinder.radius, y: cylinder.radius, z: cylinder.height };
      return singleLineCheck(collisionWorld, { start: raisedCentre(fromFeet), end: raisedCentre(toFeet), extent }, rules) !== null;
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
      pendingIntents.length = 0;
    },
  };
}
