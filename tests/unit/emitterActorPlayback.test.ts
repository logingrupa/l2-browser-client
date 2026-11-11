import { afterEach, describe, expect, it, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Scene } from "@babylonjs/core/scene";
import type { LoadedEffectComponent } from "../../src/effects/loadEffectComponent";
import type { EffectBundle, EffectComponent } from "../../src/effects/nativeEffectComponents";
import type { EffectScheduler } from "../../src/effects/particles/effectScheduler";
import { loadEmitterActorPlayback } from "../../src/effects/particles/render/emitterActorPlayback";
import { EmitterNativeError } from "../../src/effects/particles/sim/emitterNatives";
import { readSyntheticParticleFixture } from "./support/particleFixtures";

const createdSchedulers = vi.hoisted(() => [] as EffectScheduler[]);

vi.mock("../../src/effects/particles/effectScheduler", async importOriginal => {
  const original = await importOriginal<typeof import("../../src/effects/particles/effectScheduler")>();
  return {
    ...original,
    createEffectScheduler: (...parameters: Parameters<typeof original.createEffectScheduler>) => {
      const scheduler = original.createEffectScheduler(...parameters);
      createdSchedulers.push(scheduler);
      return scheduler;
    },
  };
});

vi.mock("../../src/effects/loadEffectComponent", () => ({
  loadEffectComponent: async (scene: Scene, _bundle: EffectBundle, component: EffectComponent): Promise<LoadedEffectComponent> => {
    const root = new TransformNode(`stub component ${component.object}`, scene);
    return {
      root, meshes: [], frames: [], component, record: {} as LoadedEffectComponent["record"], materials: [],
      render: () => 0, inspection: () => ({}), dispose: () => root.dispose(),
    };
  },
}));

const spriteFixture = readSyntheticParticleFixture("synthetic-sprite");
const releases: (() => void)[] = [];
afterEach(() => { releases.splice(0).reverse().forEach(release => release()); createdSchedulers.splice(0); });

function loopingBundle(actorOverrides: Record<string, unknown> = {}): EffectBundle {
  const actor = spriteFixture.actor;
  return {
    manifestSha256: "0".repeat(64),
    readResource: async () => { throw new Error("the stub components read no resources"); },
    manifest: {
      schemaVersion: 1, kind: "effect", resources: {}, textureGraph: [],
      actors: [{ object: actor.object, properties: actor.properties,
        effectiveProperties: { ...actor.effectiveProperties, AutoDestroy: false, AutoReset: true, ...actorOverrides } }],
      components: spriteFixture.components.map((component, emitterOrdinal) => ({
        object: component.object, class: component.class!, actor: actor.object, emitterOrdinal, sourcePointer: `${emitterOrdinal}`,
        properties: component.properties, effectiveProperties: component.effectiveProperties,
        bindings: { mesh: null, texture: null, primitiveMaterials: [] },
      })),
    },
  };
}

async function loadedPlayback(actorOverrides: Record<string, unknown> = {}) {
  const engine = new NullEngine(), scene = new Scene(engine);
  releases.push(() => { scene.dispose(); engine.dispose(); });
  const playback = await loadEmitterActorPlayback(scene, loopingBundle(actorOverrides), { actorObject: spriteFixture.actor.object, emitterObjects: null, sessionSeed: 5 }, new AbortController().signal);
  releases.push(() => playback.dispose());
  return { playback, scheduler: createdSchedulers.at(-1)! };
}

describe("emitter actor playback scheduler ownership", () => {
  it("keeps only the effect of the latest start on the scheduler across stop and restart", async () => {
    const { playback, scheduler } = await loadedPlayback();
    playback.start(); playback.advance(0.25);
    playback.stop();
    expect(scheduler.liveEffects).toEqual([]);
    playback.start(); playback.start(); playback.advance(0.25);
    expect(scheduler.liveEffects.map(effect => effect.effectSerial)).toEqual([playback.inspect().effectSerial]);
  });

  it("removes its effect from the scheduler on dispose", async () => {
    const { playback, scheduler } = await loadedPlayback();
    playback.start(); playback.advance(0.25);
    playback.dispose();
    expect(scheduler.liveEffects).toEqual([]);
  });
});

describe("emitter actor playback native hook", () => {
  it("applies SetSizeScale 2 once to the started simulation through applyEmitterNative", async () => {
    const { playback, scheduler } = await loadedPlayback({ bSetSizeScale: true });
    playback.start();
    const emitter = scheduler.liveEffects[0]!.actor.emitters[0]!, before = emitter.record.StartSizeRange;
    expect(playback.applyNative({ name: "SetSizeScale", scale: 2 })).toEqual({ name: "SetSizeScale", changedEmitters: [emitter.record.object], skipped: null });
    expect(emitter.record.StartSizeRange.x).toEqual({ min: before.x.min * 2, max: before.x.max * 2 });
    expect(emitter.record.StartSizeRange.y).toEqual({ min: before.y.min * 2, max: before.y.max * 2 });
  });

  it("refuses a call outside the five natives with the EmitterNativeError message and changes nothing", async () => {
    const { playback, scheduler } = await loadedPlayback({ bSetSizeScale: true });
    playback.start();
    const before = scheduler.liveEffects[0]!.actor.emitters[0]!.record;
    expect(() => playback.applyNative({ name: "SetSpeedScale", scale: 2 })).toThrow(EmitterNativeError);
    expect(scheduler.liveEffects[0]!.actor.emitters[0]!.record).toBe(before);
  });

  it("refuses a native before the playback starts an effect", async () => {
    const { playback } = await loadedPlayback();
    expect(() => playback.applyNative({ name: "Kill" })).toThrow("has no started effect");
  });
});
