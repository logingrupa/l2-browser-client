import { afterEach, describe, expect, it } from "vitest";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import type { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Scene } from "@babylonjs/core/scene";
import { bindParticleMaterial } from "../../src/effects/particles/render/particleMaterialBinding";
import { parseEmitterRecord } from "../../src/effects/particles/sim/emitterRecords";
import { createNativeMaterial } from "../../src/materials/ue2/babylon/material";
import { compileMaterialStagePlan } from "../../src/materials/ue2/model/stagePlan";
import { parseMaterialProgram } from "../../src/materials/ue2/model/materialProgram";
import { swatchTexturePng, syntheticSwatchProgram, textureImageFor } from "../support/materialProgramFixture";
import { readSyntheticParticleFixture } from "./support/particleFixtures";

const scenes: Scene[] = [];
afterEach(() => {
  for (const scene of scenes.splice(0)) {
    const engine = scene.getEngine();
    scene.dispose();
    engine.dispose();
  }
});

function sceneWithHandedness(rightHanded: boolean): Scene {
  const scene = new Scene(new NullEngine());
  scene.useRightHandedSystem = rightHanded;
  scenes.push(scene);
  return scene;
}

function vertexSourceOf(material: ShaderMaterial): string {
  return (material.shaderPath as { vertexSource: string }).vertexSource;
}

function nativeMaterialVertexSource(scene: Scene): string {
  const swatchImage = textureImageFor(swatchTexturePng());
  const program = parseMaterialProgram(JSON.parse(JSON.stringify(syntheticSwatchProgram(swatchImage))));
  const pixels = { width: 4, height: 4, rgba: new Uint8Array(64).fill(255) };
  const loaded = { materialId: "ab".repeat(32), program, plan: compileMaterialStagePlan(program), texturePixels: new Map([[swatchImage.sha256, pixels]]) };
  return vertexSourceOf(createNativeMaterial(scene, loaded, { sessionSeed: 1, lighting: "unlit" }).material);
}

function particleMaterialVertexSource(scene: Scene): string {
  const texture = RawTexture.CreateRGBATexture(new Uint8Array([255, 255, 255, 255]), 1, 1, scene);
  const record = parseEmitterRecord(readSyntheticParticleFixture("synthetic-sprite").components[0]!);
  const outcome = bindParticleMaterial(scene, new Mesh("particle mesh", scene), { record, emitterOrdinal: 0, texture });
  if (!outcome.drawn) throw new Error(`the synthetic sprite was not drawn: ${outcome.reason}`);
  return vertexSourceOf(outcome.binding.material);
}

function viewSpaceDepthOfPointAhead(scene: Scene, metresAhead: number): number {
  const camera = new FreeCamera("fog camera", Vector3.Zero(), scene);
  camera.setTarget(new Vector3(0, 0, metresAhead));
  return Vector3.TransformCoordinates(new Vector3(0, 0, metresAhead), camera.getViewMatrix(true)).z;
}

describe("fog view depth in the native material and particle vertex stages", () => {
  it("negates view-space z in a right-handed scene, where Babylon places geometry ahead of the camera at negative z", () => {
    const scene = sceneWithHandedness(true);
    expect(viewSpaceDepthOfPointAhead(scene, 50)).toBeCloseTo(-50, 6);
    expect(nativeMaterialVertexSource(scene)).toContain("ue2ViewDepth = -(worldView * vec4(position, 1.0)).z;");
    expect(particleMaterialVertexSource(scene)).toContain("particleViewDepth = -(view * vec4(worldPosition, 1.0)).z;");
  });

  it("keeps view-space z in a left-handed scene, where Babylon places geometry ahead of the camera at positive z", () => {
    const scene = sceneWithHandedness(false);
    expect(viewSpaceDepthOfPointAhead(scene, 50)).toBeCloseTo(50, 6);
    expect(nativeMaterialVertexSource(scene)).toContain("ue2ViewDepth = (worldView * vec4(position, 1.0)).z;");
    expect(particleMaterialVertexSource(scene)).toContain("particleViewDepth = (view * vec4(worldPosition, 1.0)).z;");
  });
});
