import type { Vector3 } from "../../../../shared/math/vector3";
import { isPawnInWater, ZERO_VELOCITY, type PawnBody, type PawnPhysicsContext, type PawnPhysicsMode, type PawnStepResult } from "./pawnBody";
import { fallPawn } from "./pawnFalling";
import { flyPawn } from "./pawnFlying";
import { headingOfDirection, turnYawTowards, yawStepForTick } from "./pawnRotation";
import { calculatePawnVelocity, currentPawnSpeed, hasPawnArrived, type PawnSpeedEnvironment, type PawnSpeeds } from "./pawnVelocity";
import { swimPawn } from "./pawnSwimming";
import { walkPawn } from "./pawnWalking";

export interface PawnMoveGoal {
  readonly destination: Vector3;
  readonly offset: number;
  readonly runs: boolean;
  readonly speeds: PawnSpeeds;
}

export interface PawnTraits {
  readonly isLocalPlayer: boolean;
  readonly walkAnimationFramesInMove: number | null;
  readonly flies: boolean;
}

export interface PawnSimulation {
  readonly body: PawnBody;
  readonly yaw: number;
  readonly goal: PawnMoveGoal | null;
  readonly moveTimerSeconds: number;
  readonly speedUnresolved: boolean;
}

const speedEnvironmentByMode: Readonly<Record<PawnPhysicsMode, PawnSpeedEnvironment>> = {
  walking: "ground", falling: "ground", swimming: "water", flying: "air",
};

function resolvePawnMode(context: PawnPhysicsContext, body: PawnBody, traits: PawnTraits): PawnPhysicsMode {
  if (traits.flies) return "flying";
  if (body.mode === "flying") return "falling";
  if (body.mode !== "swimming" && isPawnInWater(context, body.location)) return "swimming";
  return body.mode;
}

function stepPawnMode(context: PawnPhysicsContext, body: PawnBody, desiredVelocity: Vector3, tickSeconds: number, traits: PawnTraits): PawnStepResult {
  switch (body.mode) {
    case "walking": return walkPawn(context, body, desiredVelocity, tickSeconds, traits.isLocalPlayer);
    case "falling": return fallPawn(context, body, tickSeconds);
    case "swimming": return swimPawn(context, body, desiredVelocity, tickSeconds);
    case "flying": return flyPawn(context, body, desiredVelocity, tickSeconds);
  }
}

function runPawnMode(context: PawnPhysicsContext, body: PawnBody, desiredVelocity: Vector3, tickSeconds: number, traits: PawnTraits, nestedCalls: number): PawnBody {
  const step = stepPawnMode(context, body, desiredVelocity, tickSeconds, traits);
  const { minimumTick, maximumNested } = context.rules.pawn.substeps;
  const continuesInNewMode = step.body.mode !== body.mode && step.unusedSeconds >= minimumTick && nestedCalls < maximumNested;
  return continuesInNewMode ? runPawnMode(context, step.body, desiredVelocity, step.unusedSeconds, traits, nestedCalls + 1) : step.body;
}

function advanceOneTick(context: PawnPhysicsContext, simulation: PawnSimulation, traits: PawnTraits, tickSeconds: number): PawnSimulation {
  const { goal } = simulation;
  const mode = resolvePawnMode(context, simulation.body, traits);
  const body: PawnBody = mode === simulation.body.mode ? simulation.body : { ...simulation.body, mode, floor: null, restsInFloorBand: false };
  const environment = speedEnvironmentByMode[body.mode];
  const measuresVertical = environment !== "ground";
  const moveTimerSeconds = goal === null ? 0 : Math.fround(simulation.moveTimerSeconds + tickSeconds);
  const speed = goal === null ? 0 : currentPawnSpeed({
    speeds: goal.speeds, environment, runs: goal.runs, moveTimerSeconds: simulation.moveTimerSeconds, walkAnimationFramesInMove: traits.walkAnimationFramesInMove,
  }, context.rules);
  if (speed === null) return { ...simulation, speedUnresolved: true };
  const desiredVelocity = goal === null ? ZERO_VELOCITY : calculatePawnVelocity({
    location: body.location, destination: goal.destination, offset: goal.offset, speed, tickSeconds, measuresVertical,
  });
  const movedBody = runPawnMode(context, body, desiredVelocity, tickSeconds, traits, 0);
  const hasArrived = goal !== null && hasPawnArrived({ location: movedBody.location, destination: goal.destination, offset: goal.offset, measuresVertical }, context.rules);
  const turnsTowardMove = desiredVelocity.x !== 0 || desiredVelocity.y !== 0;
  const yaw = turnsTowardMove
    ? turnYawTowards(simulation.yaw, headingOfDirection(desiredVelocity), yawStepForTick(tickSeconds, traits.isLocalPlayer, context.rules))
    : simulation.yaw;
  return { body: movedBody, yaw, goal: hasArrived ? null : goal, moveTimerSeconds: hasArrived ? 0 : moveTimerSeconds, speedUnresolved: false };
}

export function advancePawnSimulation(context: PawnPhysicsContext, simulation: PawnSimulation, traits: PawnTraits, frameSeconds: number): PawnSimulation {
  const { frameCap, maximumIterations, maximumTick } = context.rules.pawn.substeps;
  let remainingSeconds = Math.min(frameSeconds, frameCap), current = simulation;
  for (let iteration = 0; remainingSeconds > 0 && iteration < maximumIterations; iteration += 1) {
    const tickSeconds = current.body.mode === "walking" || remainingSeconds <= maximumTick ? remainingSeconds : Math.min(maximumTick, remainingSeconds / 2);
    current = advanceOneTick(context, current, traits, tickSeconds);
    if (current.speedUnresolved) return current;
    remainingSeconds -= tickSeconds;
  }
  return current;
}
