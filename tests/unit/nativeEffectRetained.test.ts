import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { SceneSerializer } from "@babylonjs/core/Misc/sceneSerializer";
import "@babylonjs/core/Materials/standardMaterial";
import { parseEffectManifest, type EffectBundle } from "../../src/effects/nativeEffectComponents";
import { loadEffectComponent } from "../../src/effects/loadEffectComponent";

const manifestSha256 = "82e36ae7305abade2520dba335839c7422d878e6c07caa95323b47f7626f0afd";
const directory = resolve("artifacts/native-parity/research/native-power-strike-components-20261107/staging/output", manifestSha256);
const manifest = parseEffectManifest(JSON.parse(await readFile(resolve(directory, "manifest.json"), "utf8")));
const bundle: EffectBundle = { manifest, manifestSha256, readResource: async (resource, signal) => {
  signal.throwIfAborted(); const bytes = new Uint8Array(await readFile(resolve(directory, resource.file))); signal.throwIfAborted(); return bytes;
} };

describe("actual retained Power Strike resources pass the component adapter", () => {
  it.each(manifest.components)("loads every original selected frame of $object without mutating source records", async component => {
    const engine = new NullEngine(), scene = new Scene(engine), signal = new AbortController().signal;
    const before = JSON.stringify(manifest);
    try {
      const first = await loadEffectComponent(scene, bundle, component, { frameIndex: 0 }, signal);
      const frameCount = first.frames.length; first.dispose();
      for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
        const loaded = await loadEffectComponent(scene, bundle, component, { frameIndex }, signal);
        expect(loaded.root.isEnabled()).toBe(false);
        expect(loaded.meshes.every(mesh => mesh.getTotalVertices() > 0 && !mesh.isPickable && mesh.doNotSerialize)).toBe(true);
        expect(loaded.materials.every(owner => owner.material.needAlphaBlending() && owner.material.backFaceCulling === false)).toBe(true);
        if (component.effectiveProperties.UseColorScale === true) {
          for (let key = 0; key < (component.effectiveProperties.ColorScale as unknown[]).length; key++) loaded.setColorKey(key);
        }
        const serialized = SceneSerializer.Serialize(scene);
        expect(serialized.meshes ?? []).toHaveLength(0); expect(serialized.materials ?? []).toHaveLength(0);
        loaded.dispose();
        expect(scene.meshes).toHaveLength(0); expect(scene.materials).toHaveLength(0); expect(scene.textures).toHaveLength(0);
      }
      expect(JSON.stringify(manifest)).toBe(before);
    } finally { scene.dispose(); engine.dispose(); }
  });
});
