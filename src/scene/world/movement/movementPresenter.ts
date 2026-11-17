import { float32Vector, type Vector3 } from "../../../shared/math/vector3";
import { worldPositionToSource, worldYawToSourceHeading, type SourcePosition } from "../../../world/sourceFrame";
import type { SourceCollisionCylinder, WorldCommand, WorldEvent } from "../../../world/worldTypes";
import type { CollisionPrimitive } from "./core/collisionTrace";
import type { CollisionReadiness, CollisionWorld } from "./core/collisionWorld";
import type { MovementNativeRules } from "./core/movementRules";
import { singleLineCheck } from "./core/lineCheck";
import { pawnExtent, ZERO_VELOCITY, type PawnBody, type PawnPhysicsContext, type PawnPhysicsMode } from "./core/pawnBody";
import { advancePawnSimulation, type PawnSimulation, type PawnTraits } from "./core/pawnPhysics";
import { placeSpawnedPawn } from "./core/pawnSpawnPlacement";
import type { PawnSpeeds } from "./core/pawnVelocity";
import { advancePositionReports, INITIAL_POSITION_REPORT_STATE, type PositionReportState } from "./core/positionReports";

export type MovementIntent = Extract<WorldCommand, { readonly type: "report-position" | "cannot-move" }>;

export type MovementHeldReason = "collision-not-ready" | "collision-cell-absent" | "speed-unresolved";

export interface MovementPresenterOptions {
  readonly collisionWorld: CollisionWorld;
  readonly rules: MovementNativeRules;
  readonly reportIntent: (intent: MovementIntent) => void;
  readonly pawnTraits: (entityId: string) => PawnTraits;
}

export interface MovementPawnInspection {
  readonly entityId: string;
  readonly location: Vector3;
  readonly feetPosition: SourcePosition;
  readonly heading: number;
  readonly mode: PawnPhysicsMode;
  readonly floor: CollisionPrimitive | null;
  readonly isMoving: boolean;
  readonly heldReason: MovementHeldReason | null;
}

export interface MovementPresenterInspection {
  readonly pawns: readonly MovementPawnInspection[];
}

export interface MovementFloorHit {
  readonly primitiveKind: CollisionPrimitive["kind"];
  readonly cellId: string | null;
}

export interface MovementBlockingHit extends MovementFloorHit {
  readonly distanceSourceUnits: number;
}

export type MovementMoveResult =
  | { readonly kind: "advanced"; readonly hasGoal: boolean; readonly movedSourceUnits: number }
  | { readonly kind: "held"; readonly heldReason: MovementHeldReason }
  | { readonly kind: "cannot-move"; readonly blockingHit: MovementBlockingHit | null };

export interface MovementWalkTrace {
  readonly physicsMode: PawnPhysicsMode;
  readonly floorHit: MovementFloorHit | null;
  readonly lastMoveResult: MovementMoveResult | null;
  readonly fallStartPosition: SourcePosition | null;
  readonly endPosition: SourcePosition;
  readonly restsOnLevelBottom: boolean;
  readonly residentCellIds: readonly string[];
}

export interface MovementPresenter {
  applyEvent(event: WorldEvent): void;
  advance(frameSeconds: number): void;
  inspection(): MovementPresenterInspection;
  walkTrace(entityId: string): MovementWalkTrace | null;
}

export class MovementPresenterError extends Error {
  constructor(message: string) {
    super(`Movement presenter: ${message}`);
    this.name = "MovementPresenterError";
  }
}

interface PresentedPawn {
  readonly simulation: PawnSimulation;
  readonly reports: PositionReportState;
  readonly heldReason: MovementHeldReason | null;
  readonly lastMoveResult: MovementMoveResult | null;
  readonly fallStartPosition: SourcePosition | null;
  readonly unplacedSpawnPosition: SourcePosition | null;
}

type MoveEvent = Extract<WorldEvent, { readonly type: "move" }>;
type SpawnEvent = Extract<WorldEvent, { readonly type: "spawn" }>;

const headingUnitsPerTurn = 65536;
const heldReasonByCollisionReadiness: Readonly<Record<Exclude<CollisionReadiness, "ready">, MovementHeldReason>> = {
  "cell-not-resident": "collision-not-ready",
  "no-collision-cell": "collision-cell-absent",
};
const optionalSpeedKeys = ["swimWalk", "swimRun", "flyWalk", "flyRun"] as const;

function requirePosition(position: SourcePosition, label: string): void {
  if (!Number.isFinite(position.x) || !Number.isFinite(position.y) || !Number.isFinite(position.z)) {
    throw new MovementPresenterError(`${label} must hold finite source units.`);
  }
}

function requireHeading(heading: number, entityId: string): number {
  if (!Number.isInteger(heading)) throw new MovementPresenterError(`entity ${entityId} heading ${heading} must be an integer.`);
  return heading & (headingUnitsPerTurn - 1);
}

function requireSpeed(speeds: Readonly<Record<string, number>>, key: string, entityId: string): number {
  const speed = speeds[key];
  if (speed === undefined || !Number.isFinite(speed) || speed < 0) throw new MovementPresenterError(`entity ${entityId} needs a finite, non-negative speed ${key}.`);
  return speed;
}

function optionalSpeed(speeds: Readonly<Record<string, number>>, key: string, entityId: string): number | null {
  return speeds[key] === undefined ? null : requireSpeed(speeds, key, entityId);
}

function readPawnSpeeds(event: MoveEvent): PawnSpeeds {
  const [swimWalk, swimRun, flyWalk, flyRun] = optionalSpeedKeys.map(key => optionalSpeed(event.speeds, key, event.entityId)) as [number | null, number | null, number | null, number | null];
  return {
    walk: requireSpeed(event.speeds, "walk", event.entityId), run: requireSpeed(event.speeds, "run", event.entityId),
    swimWalk, swimRun, flyWalk, flyRun, nonAttackSpeedRate: optionalSpeed(event.speeds, "nonAttackSpeedRate", event.entityId) ?? 1,
  };
}

function requireCollisionCylinder(collision: SourceCollisionCylinder, entityId: string): void {
  const { radius, height } = collision;
  if (!Number.isFinite(radius) || !Number.isFinite(height) || radius < 0 || height < 0) {
    throw new MovementPresenterError(`entity ${entityId} needs a finite, non-negative collision radius and height.`);
  }
}

function requireSpawnEvent(event: SpawnEvent): void {
  const { id, position, orientationRadians } = event.entity;
  if (typeof id !== "string" || id.length === 0) throw new MovementPresenterError("a spawn record needs a non-empty entity id.");
  requirePosition(position, `entity ${id} spawn position`);
  if (!Number.isFinite(orientationRadians)) throw new MovementPresenterError(`entity ${id} spawn orientation must be finite.`);
  if (event.collision !== null) requireCollisionCylinder(event.collision, id);
}

function requireMoveEvent(event: MoveEvent): void {
  if (typeof event.entityId !== "string" || event.entityId.length === 0) throw new MovementPresenterError("a move record needs a non-empty entity id.");
  requirePosition(event.origin, `entity ${event.entityId} move origin`);
  requirePosition(event.destination, `entity ${event.entityId} move destination`);
  if (!Number.isInteger(event.moveType)) throw new MovementPresenterError(`entity ${event.entityId} moveType ${event.moveType} must be an integer.`);
  requireCollisionCylinder(event.collision, event.entityId);
  if (event.offset !== undefined && (!Number.isFinite(event.offset) || event.offset < 0)) {
    throw new MovementPresenterError(`entity ${event.entityId} move offset must be finite and non-negative.`);
  }
}

const distanceBetween = (left: Vector3, right: Vector3) => Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z);

const holdPawn = (pawn: PresentedPawn, heldReason: MovementHeldReason): PresentedPawn => ({
  ...pawn, reports: { ...pawn.reports, progressAnchor: null }, heldReason, lastMoveResult: { kind: "held", heldReason },
});

function advancedMoveResult(previous: PresentedPawn, advanced: PresentedPawn): MovementMoveResult | null {
  const hasGoal = previous.simulation.goal !== null;
  const movedSourceUnits = distanceBetween(previous.simulation.body.location, advanced.simulation.body.location);
  return hasGoal || movedSourceUnits > 0 ? { kind: "advanced", hasGoal, movedSourceUnits } : previous.lastMoveResult;
}

const floorHitOf = (floor: CollisionPrimitive | null): MovementFloorHit | null =>
  floor === null ? null : { primitiveKind: floor.kind, cellId: "cellId" in floor ? floor.cellId : null };

export function createMovementPresenter(options: MovementPresenterOptions): MovementPresenter {
  const { collisionWorld, rules, reportIntent, pawnTraits } = options;
  const context: PawnPhysicsContext = { world: collisionWorld, rules, surroundings: {} };
  const pawnsByEntityId = new Map<string, PresentedPawn>();
  let nowSeconds = 0;

  const feetHeight = (collisionHeight: number) => rules.pawn.serverPositionIsFeet ? collisionHeight : 0;
  const centreOf = (position: SourcePosition, collisionHeight: number): Vector3 =>
    float32Vector({ x: position.x, y: position.y, z: position.z + feetHeight(collisionHeight) });
  const feetOf = (simulation: PawnSimulation): SourcePosition => {
    const { location, collisionHeight } = simulation.body;
    return { x: location.x, y: location.y, z: Math.fround(location.z - feetHeight(collisionHeight)) };
  };

  const requirePawn = (entityId: string): PresentedPawn => {
    const pawn = pawnsByEntityId.get(entityId);
    if (pawn === undefined) throw new MovementPresenterError(`unknown entity ${entityId}.`);
    return pawn;
  };
  const replaceSimulation = (entityId: string, pawn: PresentedPawn, simulation: PawnSimulation) => {
    pawnsByEntityId.set(entityId, { ...pawn, simulation });
  };
  const replacePlacedSimulation = (entityId: string, pawn: PresentedPawn, simulation: PawnSimulation) => {
    pawnsByEntityId.set(entityId, { ...pawn, simulation, unplacedSpawnPosition: null });
  };
  const placedAt = (simulation: PawnSimulation, location: Vector3): PawnSimulation => ({
    ...simulation, body: { ...simulation.body, location, velocity: ZERO_VELOCITY, floor: null, restsInFloorBand: false },
  });
  const standingBody = (location: Vector3, collision: SourceCollisionCylinder): PawnBody => ({
    location, velocity: ZERO_VELOCITY, collisionRadius: collision.radius, collisionHeight: collision.height, mode: "walking", floor: null, restsInFloorBand: false,
  });
  const presentedPawn = (simulation: PawnSimulation, unplacedSpawnPosition: SourcePosition | null): PresentedPawn => ({
    simulation, reports: INITIAL_POSITION_REPORT_STATE, heldReason: null, lastMoveResult: null, fallStartPosition: null, unplacedSpawnPosition,
  });

  function applySpawn(event: SpawnEvent): void {
    requireSpawnEvent(event);
    const { id, position, orientationRadians } = event.entity;
    if (event.collision === null) { pawnsByEntityId.delete(id); return; }
    const incomingPosition = float32Vector(worldPositionToSource(position));
    const simulation: PawnSimulation = {
      body: standingBody(incomingPosition, event.collision), yaw: worldYawToSourceHeading(orientationRadians), goal: null, moveTimerSeconds: 0, speedUnresolved: false,
    };
    pawnsByEntityId.set(id, presentedPawn(simulation, incomingPosition));
  }

  function applyMove(event: MoveEvent): void {
    requireMoveEvent(event);
    const { entityId } = event;
    const speeds = readPawnSpeeds(event);
    const collisionHeight = event.collision.height;
    const origin = centreOf(event.origin, collisionHeight);
    const goal = { destination: centreOf(event.destination, collisionHeight), offset: event.offset ?? 0, runs: event.moveType === rules.pawn.runMoveType, speeds };
    const existing = pawnsByEntityId.get(entityId);
    if (existing === undefined) {
      pawnsByEntityId.set(entityId, presentedPawn({ body: standingBody(origin, event.collision), yaw: 0, goal, moveTimerSeconds: 0, speedUnresolved: false }, null));
      return;
    }
    const simulation = existing.simulation;
    const resized = { ...simulation, body: { ...simulation.body, collisionRadius: event.collision.radius, collisionHeight } };
    const snaps = existing.unplacedSpawnPosition !== null ||
      (!pawnTraits(entityId).isLocalPlayer && distanceBetween(resized.body.location, origin) > rules.pawn.snapDistance);
    if (snaps) replacePlacedSimulation(entityId, existing, { ...placedAt(resized, origin), goal });
    else replaceSimulation(entityId, existing, { ...resized, goal });
  }

  function applyStop(entityId: string, position: SourcePosition, heading: number): void {
    const pawn = requirePawn(entityId);
    requirePosition(position, `entity ${entityId} stop position`);
    const yaw = requireHeading(heading, entityId);
    const stopLocation = centreOf(position, pawn.simulation.body.collisionHeight);
    const snaps = !pawnTraits(entityId).isLocalPlayer && distanceBetween(pawn.simulation.body.location, stopLocation) > rules.pawn.snapDistance;
    if (snaps) replacePlacedSimulation(entityId, pawn, { ...placedAt(pawn.simulation, stopLocation), yaw, goal: null, moveTimerSeconds: 0 });
    else replaceSimulation(entityId, pawn, { ...pawn.simulation, yaw, goal: null, moveTimerSeconds: 0 });
  }

  function applyCorrection(entityId: string, position: SourcePosition, heading: number): void {
    const pawn = requirePawn(entityId);
    requirePosition(position, `entity ${entityId} correct position`);
    const yaw = requireHeading(heading, entityId);
    replacePlacedSimulation(entityId, pawn, { ...placedAt(pawn.simulation, centreOf(position, pawn.simulation.body.collisionHeight)), yaw });
  }

  function applyTeleport(entityId: string, position: SourcePosition): void {
    const pawn = requirePawn(entityId);
    requirePosition(position, `entity ${entityId} teleport position`);
    const { collisionHeight } = pawn.simulation.body;
    const raised = centreOf({ ...position, z: position.z + collisionHeight + rules.pawn.teleportRaise }, collisionHeight);
    const placed = placedAt(pawn.simulation, raised);
    replacePlacedSimulation(entityId, pawn, { ...placed, body: { ...placed.body, mode: "falling" }, goal: null, moveTimerSeconds: 0 });
  }

  function withSpawnPlaced(pawn: PresentedPawn): PresentedPawn {
    if (pawn.unplacedSpawnPosition === null) return pawn;
    const { body } = pawn.simulation;
    const location = placeSpawnedPawn(context, body, pawn.unplacedSpawnPosition);
    return { ...pawn, simulation: { ...pawn.simulation, body: { ...body, location } }, unplacedSpawnPosition: null };
  }

  function emitReports(entityId: string, pawn: PresentedPawn): PresentedPawn {
    const sample = { nowSeconds, location: pawn.simulation.body.location, isMoving: pawn.simulation.goal !== null };
    const outcome = advancePositionReports(pawn.reports, sample, rules);
    const isStuck = outcome.reports.includes("cannot-move");
    const simulation = isStuck ? { ...pawn.simulation, goal: null, moveTimerSeconds: 0 } : pawn.simulation;
    for (const report of outcome.reports) reportIntent({ type: report, position: feetOf(simulation), heading: simulation.yaw });
    return { ...pawn, simulation, reports: outcome.state };
  }

  function blockingHitAhead(simulation: PawnSimulation): MovementBlockingHit | null {
    const { body, goal } = simulation;
    if (goal === null) return null;
    const towardGoal = { x: goal.destination.x - body.location.x, y: goal.destination.y - body.location.y };
    const remainingDistance = Math.hypot(towardGoal.x, towardGoal.y);
    if (remainingDistance === 0) return null;
    const end = { x: body.location.x + towardGoal.x, y: body.location.y + towardGoal.y, z: body.location.z };
    const hit = singleLineCheck(collisionWorld, { start: body.location, end, extent: pawnExtent(body) }, rules);
    return hit === null ? null : { ...floorHitOf(hit.primitive)!, distanceSourceUnits: Math.fround(remainingDistance * hit.time) };
  }

  function withFallStart(previous: PresentedPawn, advanced: PresentedPawn): PresentedPawn {
    const startsFalling = advanced.simulation.body.mode === "falling" && previous.simulation.body.mode !== "falling";
    return startsFalling ? { ...advanced, fallStartPosition: feetOf(previous.simulation) } : advanced;
  }

  function advancePawn(entityId: string, presented: PresentedPawn, frameSeconds: number): PresentedPawn {
    const { location } = presented.simulation.body;
    const readiness = collisionWorld.collisionReadiness({ x: location.x, y: location.y });
    if (readiness !== "ready") return holdPawn(presented, heldReasonByCollisionReadiness[readiness]);
    const pawn = withSpawnPlaced(presented);
    const traits = pawnTraits(entityId);
    const simulation = advancePawnSimulation(context, pawn.simulation, traits, frameSeconds);
    if (simulation.speedUnresolved) return holdPawn({ ...pawn, simulation }, "speed-unresolved");
    const advanced = withFallStart(pawn, { ...pawn, simulation, heldReason: null });
    if (!traits.isLocalPlayer) return { ...advanced, lastMoveResult: advancedMoveResult(pawn, advanced) };
    const reported = emitReports(entityId, advanced);
    const reportedCannotMove = advanced.simulation.goal !== null && reported.simulation.goal === null;
    const lastMoveResult: MovementMoveResult | null = reportedCannotMove
      ? { kind: "cannot-move", blockingHit: blockingHitAhead(advanced.simulation) } : advancedMoveResult(pawn, reported);
    return { ...reported, lastMoveResult };
  }

  return {
    applyEvent(event) {
      switch (event.type) {
        case "spawn": return applySpawn(event);
        case "move": return applyMove(event);
        case "stop": return applyStop(event.entityId, event.position, event.heading);
        case "correct": return applyCorrection(event.entityId, event.position, event.heading);
        case "teleport": return applyTeleport(event.entityId, event.position);
        case "despawn": pawnsByEntityId.delete(event.entityId); return;
        default: return;
      }
    },
    advance(frameSeconds) {
      if (!Number.isFinite(frameSeconds) || frameSeconds < 0) throw new MovementPresenterError(`frame seconds ${frameSeconds} must be finite and non-negative.`);
      nowSeconds += frameSeconds;
      for (const [entityId, pawn] of [...pawnsByEntityId]) pawnsByEntityId.set(entityId, advancePawn(entityId, pawn, frameSeconds));
    },
    inspection() {
      return {
        pawns: [...pawnsByEntityId].map(([entityId, pawn]) => ({
          entityId, location: pawn.simulation.body.location, feetPosition: feetOf(pawn.simulation), heading: pawn.simulation.yaw,
          mode: pawn.simulation.body.mode, floor: pawn.simulation.body.floor, isMoving: pawn.simulation.goal !== null, heldReason: pawn.heldReason,
        })),
      };
    },
    walkTrace(entityId) {
      const pawn = pawnsByEntityId.get(entityId);
      if (pawn === undefined) return null;
      const { body } = pawn.simulation;
      const endPosition = feetOf(pawn.simulation), levelBottomZ = collisionWorld.lowestBspPointZ();
      return { physicsMode: body.mode, floorHit: floorHitOf(body.floor), lastMoveResult: pawn.lastMoveResult, fallStartPosition: pawn.fallStartPosition, endPosition,
        restsOnLevelBottom: levelBottomZ !== null && endPosition.z - levelBottomZ <= rules.pawn.maxStepHeight,
        residentCellIds: collisionWorld.residentCells().map(cell => cell.cellId) };
    },
  };
}
