import { float32Vector, type Vector3 } from "../../../shared/math/vector3";
import type { SourcePosition } from "../../../world/sourceFrame";
import type { WorldCommand, WorldEvent } from "../../../world/worldTypes";
import type { CollisionPrimitive } from "./core/collisionTrace";
import type { CollisionReadiness, CollisionWorld } from "./core/collisionWorld";
import type { MovementNativeRules } from "./core/movementRules";
import { ZERO_VELOCITY, type PawnPhysicsContext, type PawnPhysicsMode } from "./core/pawnBody";
import { advancePawnSimulation, type PawnSimulation, type PawnTraits } from "./core/pawnPhysics";
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

export interface MovementPresenter {
  applyEvent(event: WorldEvent): void;
  advance(frameSeconds: number): void;
  inspection(): MovementPresenterInspection;
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
}

type MoveEvent = Extract<WorldEvent, { readonly type: "move" }>;

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

function requireMoveEvent(event: MoveEvent): void {
  if (typeof event.entityId !== "string" || event.entityId.length === 0) throw new MovementPresenterError("a move record needs a non-empty entity id.");
  requirePosition(event.origin, `entity ${event.entityId} move origin`);
  requirePosition(event.destination, `entity ${event.entityId} move destination`);
  if (!Number.isInteger(event.moveType)) throw new MovementPresenterError(`entity ${event.entityId} moveType ${event.moveType} must be an integer.`);
  const { radius, height } = event.collision;
  if (!Number.isFinite(radius) || !Number.isFinite(height) || radius < 0 || height < 0) {
    throw new MovementPresenterError(`entity ${event.entityId} needs a finite, non-negative collision radius and height.`);
  }
  if (event.offset !== undefined && (!Number.isFinite(event.offset) || event.offset < 0)) {
    throw new MovementPresenterError(`entity ${event.entityId} move offset must be finite and non-negative.`);
  }
}

const distanceBetween = (left: Vector3, right: Vector3) => Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z);

const holdPawn = (pawn: PresentedPawn, heldReason: MovementHeldReason): PresentedPawn => ({
  ...pawn, reports: { ...pawn.reports, progressAnchor: null }, heldReason,
});

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
  const placedAt = (simulation: PawnSimulation, location: Vector3): PawnSimulation => ({
    ...simulation, body: { ...simulation.body, location, velocity: ZERO_VELOCITY, floor: null, restsInFloorBand: false },
  });

  function applyMove(event: MoveEvent): void {
    requireMoveEvent(event);
    const { entityId } = event;
    const speeds = readPawnSpeeds(event);
    const collisionHeight = event.collision.height;
    const origin = centreOf(event.origin, collisionHeight);
    const goal = { destination: centreOf(event.destination, collisionHeight), offset: event.offset ?? 0, runs: event.moveType === rules.pawn.runMoveType, speeds };
    const existing = pawnsByEntityId.get(entityId);
    if (existing === undefined) {
      const body = {
        location: origin, velocity: ZERO_VELOCITY, collisionRadius: event.collision.radius, collisionHeight, mode: "walking" as const, floor: null, restsInFloorBand: false,
      };
      pawnsByEntityId.set(entityId, {
        simulation: { body, yaw: 0, goal, moveTimerSeconds: 0, speedUnresolved: false }, reports: INITIAL_POSITION_REPORT_STATE, heldReason: null,
      });
      return;
    }
    const simulation = existing.simulation;
    const resized = { ...simulation, body: { ...simulation.body, collisionRadius: event.collision.radius, collisionHeight } };
    const snaps = !pawnTraits(entityId).isLocalPlayer && distanceBetween(resized.body.location, origin) > rules.pawn.snapDistance;
    replaceSimulation(entityId, existing, { ...(snaps ? placedAt(resized, origin) : resized), goal });
  }

  function applyStop(entityId: string, position: SourcePosition, heading: number): void {
    const pawn = requirePawn(entityId);
    requirePosition(position, `entity ${entityId} stop position`);
    const yaw = requireHeading(heading, entityId);
    const stopLocation = centreOf(position, pawn.simulation.body.collisionHeight);
    const snaps = !pawnTraits(entityId).isLocalPlayer && distanceBetween(pawn.simulation.body.location, stopLocation) > rules.pawn.snapDistance;
    const stopped = snaps ? placedAt(pawn.simulation, stopLocation) : pawn.simulation;
    replaceSimulation(entityId, pawn, { ...stopped, yaw, goal: null, moveTimerSeconds: 0 });
  }

  function applyCorrection(entityId: string, position: SourcePosition, heading: number): void {
    const pawn = requirePawn(entityId);
    requirePosition(position, `entity ${entityId} correct position`);
    const yaw = requireHeading(heading, entityId);
    replaceSimulation(entityId, pawn, { ...placedAt(pawn.simulation, centreOf(position, pawn.simulation.body.collisionHeight)), yaw });
  }

  function applyTeleport(entityId: string, position: SourcePosition): void {
    const pawn = requirePawn(entityId);
    requirePosition(position, `entity ${entityId} teleport position`);
    const { collisionHeight } = pawn.simulation.body;
    const raised = centreOf({ ...position, z: position.z + collisionHeight + rules.pawn.teleportRaise }, collisionHeight);
    const placed = placedAt(pawn.simulation, raised);
    replaceSimulation(entityId, pawn, { ...placed, body: { ...placed.body, mode: "falling" }, goal: null, moveTimerSeconds: 0 });
  }

  function emitReports(entityId: string, pawn: PresentedPawn): PresentedPawn {
    const sample = { nowSeconds, location: pawn.simulation.body.location, isMoving: pawn.simulation.goal !== null };
    const outcome = advancePositionReports(pawn.reports, sample, rules);
    const isStuck = outcome.reports.includes("cannot-move");
    const simulation = isStuck ? { ...pawn.simulation, goal: null, moveTimerSeconds: 0 } : pawn.simulation;
    for (const report of outcome.reports) reportIntent({ type: report, position: feetOf(simulation), heading: simulation.yaw });
    return { ...pawn, simulation, reports: outcome.state };
  }

  function advancePawn(entityId: string, pawn: PresentedPawn, frameSeconds: number): PresentedPawn {
    const { location } = pawn.simulation.body;
    const readiness = collisionWorld.collisionReadiness({ x: location.x, y: location.y });
    if (readiness !== "ready") return holdPawn(pawn, heldReasonByCollisionReadiness[readiness]);
    const traits = pawnTraits(entityId);
    const simulation = advancePawnSimulation(context, pawn.simulation, traits, frameSeconds);
    if (simulation.speedUnresolved) return holdPawn({ ...pawn, simulation }, "speed-unresolved");
    const advanced: PresentedPawn = { ...pawn, simulation, heldReason: null };
    return traits.isLocalPlayer ? emitReports(entityId, advanced) : advanced;
  }

  return {
    applyEvent(event) {
      switch (event.type) {
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
  };
}
