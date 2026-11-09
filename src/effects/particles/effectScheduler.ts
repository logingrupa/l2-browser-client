import { createFixedStepAccumulator } from "../../shared/fixedStep";
import type { PresentationClock } from "../../shared/presentationClock";
import { PARTICLE_CONSTANTS } from "./sim/emitterConstants";
import { createEmitterActorSimulation, type EmitterActorSimulation } from "./sim/emitterActor";
import type { EmitterActorRecord, ParticleEmitterRecord } from "./sim/emitterRecords";
import type { OwnerPose } from "./sim/particleState";

export interface EffectSchedulerSettings {
  readonly clock: PresentationClock;
  readonly sessionSeed: number;
  readonly sampleOwner: (ownerKey: string) => OwnerPose;
}

export interface ScheduledEffect {
  readonly effectSerial: number;
  readonly ownerKey: string;
  readonly actor: EmitterActorSimulation;
}

export interface EffectScheduler {
  readonly stepSeconds: number;
  readonly liveEffects: readonly ScheduledEffect[];
  spawnEffect(actor: EmitterActorRecord, emitters: readonly ParticleEmitterRecord[], ownerKey: string): ScheduledEffect;
  advanceFrame(): number;
}

export function createEffectScheduler(settings: EffectSchedulerSettings): EffectScheduler {
  const stepSeconds = PARTICLE_CONSTANTS.simulationStepSeconds.runtimeDefault;
  const accumulator = createFixedStepAccumulator({ stepSeconds, maximumStepsPerFrame: PARTICLE_CONSTANTS.maximumStepsPerFrame.runtimeDefault });
  let liveEffects: ScheduledEffect[] = [], nextEffectSerial = 0;
  return {
    stepSeconds,
    get liveEffects() { return liveEffects; },
    spawnEffect(actor, emitters, ownerKey) {
      const effectSerial = nextEffectSerial;
      const effect = { effectSerial, ownerKey, actor: createEmitterActorSimulation({ actor, emitters, sessionSeed: settings.sessionSeed, effectSerial }) };
      nextEffectSerial += 1;
      liveEffects = [...liveEffects, effect];
      return effect;
    },
    advanceFrame() {
      const dueSteps = accumulator.advance(settings.clock.frameDeltaSeconds);
      for (let stepIndex = 0; stepIndex < dueSteps; stepIndex += 1) {
        for (const effect of liveEffects) effect.actor.step(stepSeconds, settings.sampleOwner(effect.ownerKey));
        liveEffects = liveEffects.filter(effect => !effect.actor.destroyed);
      }
      return dueSteps;
    },
  };
}
