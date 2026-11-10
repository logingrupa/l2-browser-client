import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { createPresentationClock } from "../../../shared/presentationClock";
import { loadEffectComponent, type LoadedEffectComponent } from "../../loadEffectComponent";
import type { EffectBundle, EffectFrame } from "../../nativeEffectComponents";
import { createEffectScheduler, type ScheduledEffect } from "../effectScheduler";
import { parseEmitterActorRecord, parseEmitterRecord, type EmitterActorRecord } from "../sim/emitterRecords";
import { IDENTITY_ROTATOR } from "../sim/particleRotation";
import type { OwnerPose } from "../sim/particleState";
import { uploadParticleInstances } from "./particleInstances";

export interface EmitterActorPlaybackSettings {
  readonly actorObject: string;
  readonly emitterObjects: readonly string[] | null;
  readonly sessionSeed: number;
}

export interface EmitterActorPlaybackPins {
  readonly pinnedFrame: EffectFrame | null;
  readonly colourOverride: readonly [number, number, number, number] | null;
}

export interface EmitterActorPlaybackInspection {
  readonly actorObject: string;
  readonly sessionSeed: number;
  readonly effectSerial: number | null;
  readonly playing: boolean;
  readonly destroyed: boolean;
  readonly simulatedSeconds: number;
  readonly simulationSteps: number;
  readonly liveParticles: number;
  readonly peakLiveParticles: number;
  readonly emitters: readonly { readonly object: string; readonly emitterOrdinal: number; readonly liveParticles: number }[];
  readonly unresolvedFields: readonly string[];
  readonly featureGaps: readonly string[];
  readonly components: readonly Record<string, unknown>[];
}

export interface EmitterActorPlayback {
  readonly root: TransformNode;
  readonly components: readonly LoadedEffectComponent[];
  readonly playing: boolean;
  start(): void;
  stop(): void;
  advance(elapsedSeconds: number): void;
  setPins(pins: EmitterActorPlaybackPins): void;
  liveParticles(): number;
  bounds(): { minimum: Vector3; maximum: Vector3 } | null;
  inspect(): EmitterActorPlaybackInspection;
  dispose(): void;
}

const stationaryOwner: OwnerPose = { location: { x: 0, y: 0, z: 0 }, rotation: IDENTITY_ROTATOR };
const unpinned: EmitterActorPlaybackPins = { pinnedFrame: null, colourOverride: null };

function requirePlayback(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Emitter actor playback: ${message}`);
}

function playedActorRecord(bundle: EffectBundle, settings: EmitterActorPlaybackSettings): EmitterActorRecord {
  const actor = bundle.manifest.actors.find(row => row.object === settings.actorObject);
  requirePlayback(actor, `actor ${settings.actorObject} is not in bundle ${bundle.manifestSha256}.`);
  const record = parseEmitterActorRecord({ object: actor.object, properties: actor.properties ?? {}, effectiveProperties: actor.effectiveProperties });
  if (settings.emitterObjects === null) return record;
  const symbols = settings.emitterObjects.map(object => object.slice(actor.object.length + 1));
  requirePlayback(settings.emitterObjects.every(object => object.startsWith(`${actor.object}.`)) && symbols.every(symbol => record.Emitters.includes(symbol)),
    `emitters ${settings.emitterObjects.join(", ")} are not all emitters of ${actor.object}.`);
  return Object.freeze({ ...record, Emitters: record.Emitters.filter(symbol => symbols.includes(symbol)) });
}

export async function loadEmitterActorPlayback(scene: Scene, bundle: EffectBundle, settings: EmitterActorPlaybackSettings, signal: AbortSignal): Promise<EmitterActorPlayback> {
  const actor = playedActorRecord(bundle, settings);
  const componentRecords = actor.Emitters.map(symbol => {
    const component = bundle.manifest.components.find(row => row.object === `${actor.object}.${symbol}`);
    requirePlayback(component, `emitter ${actor.object}.${symbol} has no bundle component.`);
    return component;
  });
  const emitterRecords = componentRecords.map(component => parseEmitterRecord(component));
  const root = new TransformNode(`Emitter actor playback: ${actor.object}`, scene);
  root.id = `native-emitter-actor:${root.uniqueId}`; root.doNotSerialize = true; root.setEnabled(false);
  const components: LoadedEffectComponent[] = [];
  try {
    for (const component of componentRecords) {
      const loaded = await loadEffectComponent(scene, bundle, component, signal);
      components.push(loaded);
      loaded.root.parent = root; loaded.root.setEnabled(true);
    }
  } catch (error) {
    for (const loaded of components) loaded.dispose();
    root.dispose(false, false);
    throw error;
  }
  const clock = createPresentationClock();
  const scheduler = createEffectScheduler({ clock, sessionSeed: settings.sessionSeed, sampleOwner: () => stationaryOwner });
  let effect: ScheduledEffect | null = null, pins = unpinned, disposed = false;
  let simulatedSeconds = 0, simulationSteps = 0, peakLiveParticles = 0;
  const liveByEmitter = () => effect && !effect.actor.destroyed ? effect.actor.emitters.map(emitter => emitter.liveSlots().length) : components.map(() => 0);
  const renderEffect = () => {
    const live = effect && !effect.actor.destroyed ? effect : null;
    components.forEach((component, index) => {
      const emitter = live?.actor.emitters[index];
      if (emitter) component.render(emitter, { levelSeconds: clock.levelSeconds, emitterRotation: live!.actor.emitterRotation, ...pins });
      else for (const mesh of component.meshes) uploadParticleInstances(mesh, 0);
    });
    const total = liveByEmitter().reduce((sum, count) => sum + count, 0);
    peakLiveParticles = Math.max(peakLiveParticles, total);
    root.setEnabled(total > 0);
  };
  const playback: EmitterActorPlayback = {
    root, components,
    get playing() { return effect !== null && !effect.actor.destroyed; },
    start() {
      requirePlayback(!disposed, "the playback is disposed.");
      clock.seek(0);
      effect = scheduler.spawnEffect(actor, emitterRecords, actor.object);
      simulatedSeconds = 0; simulationSteps = 0; peakLiveParticles = 0;
      renderEffect();
    },
    stop() { effect = null; renderEffect(); },
    advance(elapsedSeconds) {
      if (disposed || effect === null) return;
      clock.advance(elapsedSeconds);
      const steps = scheduler.advanceFrame();
      simulationSteps += steps; simulatedSeconds += steps * scheduler.stepSeconds;
      renderEffect();
    },
    setPins(next) { pins = next; if (effect) renderEffect(); },
    liveParticles: () => liveByEmitter().reduce((sum, count) => sum + count, 0),
    bounds() {
      if (disposed || !root.isEnabled()) return null;
      let minimum = new Vector3(Infinity, Infinity, Infinity), maximum = new Vector3(-Infinity, -Infinity, -Infinity), found = false;
      for (const mesh of components.flatMap(component => component.meshes)) {
        if (!mesh.isVisible) continue;
        mesh.computeWorldMatrix(true);
        mesh.thinInstanceRefreshBoundingInfo(false);
        const box = mesh.getBoundingInfo().boundingBox;
        minimum = Vector3.Minimize(minimum, box.minimumWorld); maximum = Vector3.Maximize(maximum, box.maximumWorld); found = true;
      }
      return found ? { minimum, maximum } : null;
    },
    inspect() {
      const live = liveByEmitter();
      return {
        actorObject: actor.object, sessionSeed: settings.sessionSeed, effectSerial: effect?.effectSerial ?? null, playing: playback.playing,
        destroyed: effect?.actor.destroyed ?? false, simulatedSeconds, simulationSteps, liveParticles: live.reduce((sum, count) => sum + count, 0), peakLiveParticles,
        emitters: componentRecords.map((component, index) => ({ object: component.object, emitterOrdinal: component.emitterOrdinal, liveParticles: live[index] ?? 0 })),
        unresolvedFields: effect?.actor.unresolvedFields ?? [], featureGaps: effect?.actor.featureGaps.map(gap => `${gap.emitter} ${gap.reason}`) ?? [],
        components: components.map(component => component.inspection()),
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true; effect = null;
      for (const component of components) component.dispose();
      root.dispose(false, false);
    },
  };
  return playback;
}
