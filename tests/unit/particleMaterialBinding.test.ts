import { afterEach, describe, expect, it } from "vitest";
import { Constants } from "@babylonjs/core/Engines/constants";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Scene } from "@babylonjs/core/scene";
import { BLEND_CONSTANTS } from "../../src/materials/ue2/model/constants/blendConstants";
import { bindParticleMaterial, type ParticleMaterialBindingInput } from "../../src/effects/particles/render/particleMaterialBinding";
import { createParticleInstanceBuffers, writeParticleInstances } from "../../src/effects/particles/render/particleInstances";
import { createEmitterSimulation } from "../../src/effects/particles/sim/emitterActor";
import { parseEmitterRecord, type EmitterSourceRecord } from "../../src/effects/particles/sim/emitterRecords";
import { createRandomStream, deriveStreamSeed } from "../../src/shared/random";
import { sourcePositionToWorld } from "../../src/world/sourceFrame";
import { readSyntheticParticleFixture, standaloneStepContext } from "./support/particleFixtures";

const spriteSource = readSyntheticParticleFixture("synthetic-sprite").components[0]!;
const meshSource = readSyntheticParticleFixture("synthetic-mesh").components[0]!;
const releases: (() => void)[] = [];
afterEach(() => { releases.splice(0).reverse().forEach(release => release()); });

function withOverrides(source: EmitterSourceRecord, overrides: Record<string, unknown>): EmitterSourceRecord {
  return { ...source, effectiveProperties: { ...source.effectiveProperties, ...overrides } };
}

function sceneWithTexture() {
  const engine = new NullEngine(), scene = new Scene(engine);
  releases.push(() => { scene.dispose(); engine.dispose(); });
  const texture = RawTexture.CreateRGBATexture(new Uint8Array([255, 255, 255, 255]), 1, 1, scene);
  texture.name = "Effect texture: Synthetic.White";
  return { scene, texture, mesh: new Mesh("particle mesh", scene) };
}

function drawnBinding(scene: Scene, mesh: Mesh, input: ParticleMaterialBindingInput) {
  const outcome = bindParticleMaterial(scene, mesh, input);
  if (!outcome.drawn) throw new Error(`${input.record.object} was not drawn: ${outcome.reason}`);
  return outcome.binding;
}

function steppedEmitter(source: EmitterSourceRecord, steps: number) {
  const emitter = createEmitterSimulation(parseEmitterRecord(source), createRandomStream(deriveStreamSeed(3, "test", [source.object])));
  const context = standaloneStepContext(emitter);
  for (let step = 0; step < steps; step += 1) emitter.step(1 / 60, context);
  return emitter;
}

describe("particle material binding through the UE2 material library", () => {
  it.each([[3, "ALPHA_SCREENMODE"], [6, "ALPHA_ONEONE"]] as const)("keeps the shipped DrawStyle %s pair until the swatch comparison is recorded", (drawStyle, alphaModeName) => {
    const { scene, texture, mesh } = sceneWithTexture();
    const binding = drawnBinding(scene, mesh, { record: parseEmitterRecord(withOverrides(meshSource, { DrawStyle: drawStyle })), emitterOrdinal: 1, texture });
    expect(binding.inspect().babylonAlphaMode).toBe(alphaModeName);
    expect(binding.chain.blend.pair).toEqual(BLEND_CONSTANTS.particleDrawStylePairs.runtimeDefault[drawStyle]!.pair);
    expect(binding.chain.blend.pair).not.toEqual(binding.chain.blend.referencePair);
    expect(binding.material.alphaMode).toBe(drawStyle === 3 ? Constants.ALPHA_SCREENMODE : Constants.ALPHA_ONEONE);
  });

  it("takes depth, culling and alpha test from the record and tags the mesh with its emitter ordinal", () => {
    const { scene, texture, mesh } = sceneWithTexture();
    const record = parseEmitterRecord(withOverrides(meshSource, { ZTest: false, ZWrite: true, AlphaTest: false, RenderTwoSided: false }));
    const binding = drawnBinding(scene, mesh, { record, emitterOrdinal: 4, texture });
    expect(mesh.material).toBe(binding.material);
    expect(mesh.metadata).toEqual({ nativeEmitterOrdinal: 4 });
    expect(mesh.alphaIndex).toBe(Number.MAX_VALUE);
    expect(binding.material).toMatchObject({ depthFunction: Constants.ALWAYS, disableDepthWrite: false, backFaceCulling: true, doNotSerialize: true });
    expect(binding.inspect()).toMatchObject({ emitter: meshSource.object, emitterOrdinal: 4, depthTest: false, depthWrite: true, alphaTest: false,
      fogFamily: binding.chain.blend.fogFamily, textureName: "Effect texture: Synthetic.White" });
    binding.dispose(); expect(scene.materials).not.toContain(binding.material);
  });

  it("draws sprites two-sided with the camera-facing vertex stage and the class-default depth test", () => {
    const { scene, texture, mesh } = sceneWithTexture();
    const binding = drawnBinding(scene, mesh, { record: parseEmitterRecord(spriteSource), emitterOrdinal: 0, texture });
    expect(binding.material.backFaceCulling).toBe(false);
    expect(binding.material.options.defines).toEqual(["PARTICLE_SPRITE"]);
    expect(binding.material).toMatchObject({ depthFunction: Constants.LEQUAL, disableDepthWrite: true });
  });

  it("leaves a mesh emitter that keeps its static mesh materials not drawn with the UseMeshBlendMode feature gap", () => {
    const { scene, texture, mesh } = sceneWithTexture();
    const materialCount = scene.materials.length;
    const outcome = bindParticleMaterial(scene, mesh, { record: parseEmitterRecord(withOverrides(meshSource, { UseMeshBlendMode: true })), emitterOrdinal: 0, texture });
    expect(outcome).toEqual({ drawn: false, reason: "emitter-feature-unported:UseMeshBlendMode" });
    expect(mesh.material).toBeNull();
    expect(mesh.metadata).toBeNull();
    expect(scene.materials).toHaveLength(materialCount);
  });

  it("binds the DrawStyle particle material for a mesh emitter whose UseMeshBlendMode is false", () => {
    const { scene, texture, mesh } = sceneWithTexture();
    const outcome = bindParticleMaterial(scene, mesh, { record: parseEmitterRecord(withOverrides(meshSource, { UseMeshBlendMode: false, DrawStyle: 3 })), emitterOrdinal: 0, texture });
    expect(outcome.drawn).toBe(true);
    expect(mesh.material).toBe(outcome.drawn ? outcome.binding.material : null);
  });
});

describe("particle instance buffers from simulator state", () => {
  it("writes mesh particles as T * R * S in browser axes and the simulator colour", () => {
    const emitter = steppedEmitter(meshSource, 30), buffers = createParticleInstanceBuffers(emitter.columns.capacity);
    const count = writeParticleInstances(emitter, buffers);
    expect(count).toBe(emitter.liveSlots().length); expect(count).toBeGreaterThan(0);
    const slot = emitter.liveSlots()[0]!, offset = 0;
    const location = sourcePositionToWorld({ x: emitter.columns.location[slot * 3]!, y: emitter.columns.location[slot * 3 + 1]!, z: emitter.columns.location[slot * 3 + 2]! });
    expect(Array.from(buffers.matrices.subarray(offset + 12, offset + 15))).toEqual([location.x, location.y, location.z].map(Math.fround));
    const columnLengths = [0, 4, 8].map(start => Math.hypot(...buffers.matrices.subarray(start, start + 3)));
    const size = Array.from(emitter.columns.size.subarray(slot * 3, slot * 3 + 3));
    columnLengths.forEach((length, axis) => expect(length).toBeCloseTo([size[0]!, size[2]!, size[1]!][axis]!, 4));
    expect(Array.from(buffers.colours.subarray(0, 4))).toEqual(Array.from(emitter.columns.color.subarray(slot * 4, slot * 4 + 4)));
  });

  it("writes sprite half extents in metres, roll and the column-major atlas cell", () => {
    const emitter = steppedEmitter(spriteSource, 20);
    if (emitter.kind !== "sprite") throw new Error("the synthetic sprite fixture is not a sprite emitter");
    const buffers = createParticleInstanceBuffers(emitter.columns.capacity), count = writeParticleInstances(emitter, buffers);
    expect(count).toBeGreaterThan(0);
    const slot = emitter.liveSlots()[0]!, cell = emitter.atlasCell(slot);
    const halfExtent = sourcePositionToWorld({ x: emitter.columns.size[slot * 3]!, y: 0, z: emitter.columns.size[slot * 3 + 1]! });
    expect(buffers.spriteShapes[0]).toBeCloseTo(halfExtent.x, 6); expect(buffers.spriteShapes[1]).toBeCloseTo(halfExtent.y, 6);
    const columns = emitter.record.TextureUSubdivisions, rows = emitter.record.TextureVSubdivisions;
    expect(Array.from(buffers.atlasRectangles.subarray(0, 4))).toEqual([1 / columns, 1 / rows, cell.column / columns, cell.row / rows].map(Math.fround));
  });

  it("applies a colour and atlas override and refuses more live particles than instances", () => {
    const emitter = steppedEmitter(meshSource, 30), buffers = createParticleInstanceBuffers(emitter.columns.capacity);
    writeParticleInstances(emitter, buffers, { emitterRotation: { pitch: 0, yaw: 0, roll: 0 }, colourOverride: [1, 0, 0, 1], atlasOverride: [.5, .5, .5, 0] });
    expect(Array.from(buffers.colours.subarray(0, 4))).toEqual([1, 0, 0, 1]);
    expect(Array.from(buffers.atlasRectangles.subarray(0, 4))).toEqual([.5, .5, .5, 0]);
    expect(() => writeParticleInstances(emitter, createParticleInstanceBuffers(1))).toThrow("live particles for 1 instances");
  });
});
