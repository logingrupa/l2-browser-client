import { afterEach, describe, expect, it, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Scene } from "@babylonjs/core/scene";
import type { LoadedEffectComponent } from "../../src/effects/loadEffectComponent";
import type { EffectBundle, EffectComponent } from "../../src/effects/nativeEffectComponents";
import type { EffectScheduler } from "../../src/effects/particles/effectScheduler";
import { loadEmitterActorPlayback } from "../../src/effects/particles/render/emitterActorPlayback";
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

function loopingBundle(): EffectBundle {
  const actor = spriteFixture.actor;
  return {
    manifestSha256: "0".repeat(64),
    readResource: async () => { throw new Error("the stub components read no resources"); },
    manifest: {
      schemaVersion: 1, kind: "effect", resources: {}, textureGraph: [],
      actors: [{ object: actor.object, properties: actor.properties, effectiveProperties: { ...actor.effectiveProperties, AutoDestroy: false, AutoReset: true } }],
      components: spriteFixture.components.map((component, emitterOrdinal) => ({
        object: component.object, class: component.class!, actor: actor.object, emitterOrdinal, sourcePointer: `${emitterOrdinal}`,
        properties: component.properties, effectiveProperties: component.effectiveProperties,
        bindings: { mesh: null, texture: null, primitiveMaterials: [] },
      })),
    },
  };
}

async function loadedPlayback() {
  const engine = new NullEngine(), scene = new Scene(engine);
  releases.push(() => { scene.dispose(); engine.dispose(); });
  const playback = await loadEmitterActorPlayback(scene, loopingBundle(), { actorObject: spriteFixture.actor.object, emitterObjects: null, sessionSeed: 5 }, new AbortController().signal);
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
