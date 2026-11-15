import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { SceneSerializer } from "@babylonjs/core/Misc/sceneSerializer";
import "@babylonjs/core/Materials/standardMaterial";
import { parseEffectManifest, type EffectBundle } from "../../src/effects/nativeEffectComponents";
import { loadEffectComponent } from "../../src/effects/loadEffectComponent";
import { createEmitterSimulation } from "../../src/effects/particles/sim/emitterActor";
import { parseEmitterRecord } from "../../src/effects/particles/sim/emitterRecords";
import { createRandomStream, deriveStreamSeed } from "../../src/shared/random";

const manifestSha256 = "82e36ae7305abade2520dba335839c7422d878e6c07caa95323b47f7626f0afd";
const directory = resolve("artifacts/native-parity/research/native-power-strike-components-20261107/staging/output", manifestSha256);
const manifest = parseEffectManifest(JSON.parse(await readFile(resolve(directory, "manifest.json"), "utf8")));
const bundle: EffectBundle = { manifest, manifestSha256, readResource: async (resource, signal) => {
  signal.throwIfAborted(); const bytes = new Uint8Array(await readFile(resolve(directory, resource.file))); signal.throwIfAborted(); return bytes;
} };
const shippedAlphaModeByDrawStyle: Readonly<Record<number, string>> = { 3: "ALPHA_SCREENMODE", 6: "ALPHA_ONEONE" };

describe("retained Power Strike components render through the simulator and the UE2 particle material", () => {
  it.each(manifest.components)("plays $object without mutating source records", async component => {
    const engine = new NullEngine(), scene = new Scene(engine), signal = new AbortController().signal;
    const before = JSON.stringify(manifest);
    try {
      const loaded = await loadEffectComponent(scene, bundle, component, signal);
      expect(loaded.root.isEnabled()).toBe(false);
      expect(loaded.meshes.every(mesh => mesh.getTotalVertices() > 0 && !mesh.isPickable && mesh.doNotSerialize)).toBe(true);
      expect(loaded.meshes.every(mesh => (mesh.metadata as { nativeEmitterOrdinal: number }).nativeEmitterOrdinal === component.emitterOrdinal)).toBe(true);
      expect(loaded.materials.map(binding => binding.inspect().babylonAlphaMode)).toEqual(loaded.materials.map(() => shippedAlphaModeByDrawStyle[loaded.record.DrawStyle]));
      const emitter = createEmitterSimulation(parseEmitterRecord(component), createRandomStream(deriveStreamSeed(1, "test", [component.object])));
      const context = { owner: { location: { x: 0, y: 0, z: 0 }, rotation: { pitch: 0, yaw: 0, roll: 0 } }, emitterRotation: { pitch: 0, yaw: 0, roll: 0 },
        globalOffset: { x: 0, y: 0, z: 0 }, actorAutoReset: false, actorAutoDestroy: false, siblings: [emitter.runtime] };
      let peak = 0;
      for (let step = 0; step < 120; step += 1) {
        emitter.step(1 / 60, context);
        peak = Math.max(peak, loaded.render(emitter, { levelSeconds: step / 60, emitterRotation: { pitch: 0, yaw: 0, roll: 0 }, pinnedFrame: null, colourOverride: null }));
      }
      expect(peak).toBeGreaterThan(0);
      const serialized = SceneSerializer.Serialize(scene);
      expect((serialized.meshes ?? []).map((mesh: { name: string }) => mesh.name)).toEqual([]); expect((serialized.materials ?? []).map((material: { name: string }) => material.name)).toEqual([]);
      loaded.dispose();
      expect(scene.meshes).toHaveLength(0); expect(scene.materials).toHaveLength(0); expect(scene.textures).toHaveLength(0);
      expect(JSON.stringify(manifest)).toBe(before);
    } finally { scene.dispose(); engine.dispose(); }
  });
});
