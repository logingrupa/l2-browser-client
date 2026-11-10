import type { Vector3 } from "../../../shared/math/vector3";
import { createRandomStream, deriveStreamSeed, type RandomStream } from "../../../shared/random";
import { COORDINATE_SYSTEM } from "./emitterConstants";
import { EmitterRecordError, type EmitterActorRecord, type ParticleEmitterRecord, type Rotator } from "./emitterRecords";
import { createMeshEmitterSimulation, type MeshEmitterSimulation } from "./meshEmitter";
import { createEmitterRandomStream, type EmitterStepOutcome, type UnportedEmitterFeature } from "./particleEmitter";
import { IDENTITY_ROTATOR } from "./particleRotation";
import { drawRange, drawRangeVector } from "./particleSpawn";
import type { EmitterStepContext, OwnerPose } from "./particleState";
import { createRibbonEmitterSimulation, type RibbonEmitterSimulation } from "./ribbonEmitter";
import { createSpriteEmitterSimulation, type SpriteEmitterSimulation } from "./spriteEmitter";

export type EmitterSimulation = SpriteEmitterSimulation | MeshEmitterSimulation | RibbonEmitterSimulation;
export type ActorStepOutcome = "running" | "destroyed";

export interface EmitterFeatureGap extends UnportedEmitterFeature {
  readonly emitter: string;
}

export interface EmitterActorSimulationInput {
  readonly actor: EmitterActorRecord;
  readonly emitters: readonly ParticleEmitterRecord[];
  readonly sessionSeed: number;
  readonly effectSerial: number;
}

export interface EmitterActorSimulation {
  readonly record: EmitterActorRecord;
  readonly emitters: readonly EmitterSimulation[];
  readonly destroyed: boolean;
  readonly globalOffset: Vector3;
  readonly emitterRotation: Rotator;
  readonly lastEmitterOutcomes: readonly EmitterStepOutcome[];
  readonly featureGaps: readonly EmitterFeatureGap[];
  readonly unresolvedFields: readonly string[];
  step(stepSeconds: number, owner: OwnerPose): ActorStepOutcome;
  replaceActorRecord(next: EmitterActorRecord, unresolvedField: string | null): void;
}

export function createEmitterSimulation(record: ParticleEmitterRecord, stream: RandomStream): EmitterSimulation {
  switch (record.emitterClass) {
    case "Engine.SpriteEmitter": return createSpriteEmitterSimulation(record, stream);
    case "Engine.MeshEmitter": return createMeshEmitterSimulation(record, stream);
    case "Engine.RibbonEmitter": return createRibbonEmitterSimulation(record, stream);
  }
}

function requireEmitterOrder(actor: EmitterActorRecord, emitters: readonly ParticleEmitterRecord[]): void {
  const expectedObjects = actor.Emitters.map(symbol => `${actor.object}.${symbol}`);
  const receivedObjects = emitters.map(emitter => emitter.object);
  if (expectedObjects.length !== receivedObjects.length || expectedObjects.some((object, index) => object !== receivedObjects[index])) {
    throw new EmitterRecordError(actor.object, `Emitters ${expectedObjects.join(", ")} differ from the given records ${receivedObjects.join(", ")}.`);
  }
}

function listUnresolvedFields(actor: EmitterActorRecord, emitters: readonly ParticleEmitterRecord[]): string[] {
  const unresolved: string[] = [];
  if (actor.AutoReplay) unresolved.push("AutoReplay");
  if (actor.VisibleLimit.max > 0) unresolved.push("VisibleLimit");
  if (actor.DrawScale3D.x !== 1 || actor.DrawScale3D.y !== 1 || actor.DrawScale3D.z !== 1) unresolved.push("DrawScale3D");
  if (emitters.some(emitter => emitter.CoordinateSystem === COORDINATE_SYSTEM.absolute)) unresolved.push("CoordinateSystem=Absolute");
  return unresolved;
}

export function createEmitterActorSimulation(input: EmitterActorSimulationInput): EmitterActorSimulation {
  const { sessionSeed, effectSerial } = input;
  let actor = input.actor;
  requireEmitterOrder(actor, input.emitters);
  const actorStream = createRandomStream(deriveStreamSeed(sessionSeed, "emitter", [effectSerial, "actor"]));
  const emitters = input.emitters.map((record, ordinal) => createEmitterSimulation(record, createEmitterRandomStream(sessionSeed, effectSerial, ordinal)));
  const siblings = emitters.map(emitter => emitter.runtime);
  let initialized = false, destroyed = false, resetTimerSeconds = 0, lifeSpanElapsedSeconds = 0;
  let globalOffset: Vector3 = { x: 0, y: 0, z: 0 }, emitterRotation: Rotator = IDENTITY_ROTATOR;
  let lastEmitterOutcomes: EmitterStepOutcome[] = [];
  const drawGlobalOffsetAndResetTimer = () => {
    globalOffset = drawRangeVector(actorStream, actor.GlobalOffsetRange);
    resetTimerSeconds = drawRange(actorStream, actor.TimeTillResetRange);
  };
  const stepContext = (owner: OwnerPose): EmitterStepContext => ({
    owner, emitterRotation, globalOffset, actorAutoReset: actor.AutoReset, actorAutoDestroy: actor.AutoDestroy, siblings,
  });
  const unresolvedFields = listUnresolvedFields(actor, input.emitters);
  return {
    get record() { return actor; },
    emitters,
    get destroyed() { return destroyed; },
    get globalOffset() { return globalOffset; },
    get emitterRotation() { return emitterRotation; },
    get lastEmitterOutcomes() { return lastEmitterOutcomes; },
    featureGaps: emitters.flatMap(emitter => emitter.unportedFeatures.map(feature => ({ ...feature, emitter: emitter.record.object }))),
    unresolvedFields,
    replaceActorRecord(next, unresolvedField) {
      actor = next;
      if (unresolvedField !== null && !unresolvedFields.includes(unresolvedField)) unresolvedFields.push(unresolvedField);
    },
    step(stepSeconds, owner) {
      if (destroyed) return "destroyed";
      const scaledStepSeconds = stepSeconds * actor.SpeedRate;
      if (!initialized) { drawGlobalOffsetAndResetTimer(); initialized = true; }
      if (actor.bRotEmitter) {
        emitterRotation = {
          pitch: emitterRotation.pitch + actor.RotPerSecond.pitch * scaledStepSeconds,
          yaw: emitterRotation.yaw + actor.RotPerSecond.yaw * scaledStepSeconds,
          roll: emitterRotation.roll + actor.RotPerSecond.roll * scaledStepSeconds,
        };
      }
      const context = stepContext(owner);
      lastEmitterOutcomes = emitters.map(emitter => emitter.step(scaledStepSeconds, context));
      const anyRunning = lastEmitterOutcomes.includes("running"), anyDelayed = lastEmitterOutcomes.includes("delayed");
      const anyEnabled = lastEmitterOutcomes.some(outcome => outcome !== "disabled");
      if (actor.AutoDestroy && emitters.length > 0 && !anyRunning && anyEnabled && !anyDelayed && !actor.bNoDelete && !actor.bStatic) destroyed = true;
      else if (!anyRunning && actor.AutoReset && !actor.AutoDestroy) {
        resetTimerSeconds -= scaledStepSeconds;
        if (resetTimerSeconds <= 0) {
          drawGlobalOffsetAndResetTimer();
          const resetContext = stepContext(owner);
          emitters.forEach(emitter => emitter.reset(resetContext));
        }
      }
      lifeSpanElapsedSeconds += stepSeconds;
      if (actor.LifeSpan > 0 && lifeSpanElapsedSeconds >= actor.LifeSpan) destroyed = true;
      return destroyed ? "destroyed" : "running";
    },
  };
}
