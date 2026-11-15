import { describe, expect, it } from "vitest";
import { PARTICLE_CONSTANTS } from "../../src/effects/particles/sim/emitterConstants";
import { parseEmitterRecord, type MeshEmitterRecord } from "../../src/effects/particles/sim/emitterRecords";
import { createMeshEmitterSimulation, meshMaterialRoute, type MeshEmitterSimulation } from "../../src/effects/particles/sim/meshEmitter";
import { createEmitterRandomStream } from "../../src/effects/particles/sim/particleEmitter";
import { PARTICLE_TRACE_COLUMNS, expectGoldenTrace, readSyntheticParticleFixture, runStandaloneEmitterTrace, standaloneStepContext } from "./support/particleFixtures";

const stepSeconds = PARTICLE_CONSTANTS.simulationStepSeconds.runtimeDefault;
const meshSource = readSyntheticParticleFixture("synthetic-mesh").components[0]!;
const meshRecord = parseEmitterRecord(meshSource) as MeshEmitterRecord;

function stepUntilFirstSpawn(simulation: MeshEmitterSimulation): void {
  const context = standaloneStepContext(simulation);
  for (let stepIndex = 0; stepIndex < 30 && simulation.liveSlots().length === 0; stepIndex += 1) expect(simulation.step(stepSeconds, context)).toBe("running");
  expect(simulation.liveSlots().length).toBeGreaterThan(0);
}

function meshRecordWith(overrides: Record<string, unknown>): MeshEmitterRecord {
  return parseEmitterRecord({ ...meshSource, effectiveProperties: { ...meshSource.effectiveProperties, ...overrides } }) as MeshEmitterRecord;
}

describe("MeshEmitter simulation", () => {
  it("reproduces the committed golden trace with mesh rotators at seed 1 and step 1/60", () => {
    const simulation = createMeshEmitterSimulation(meshRecord, createEmitterRandomStream(1, 0, 0));
    const rows = runStandaloneEmitterTrace(simulation, stepSeconds, 90, slot => {
      const rotator = simulation.meshRotator(slot);
      return [rotator.yaw, rotator.pitch, rotator.roll];
    });
    expect(rows.length).toBeGreaterThan(0);
    expectGoldenTrace("synthetic-mesh.trace.json", { seed: 1, stepSeconds, columns: [...PARTICLE_TRACE_COLUMNS, "yaw", "pitch", "roll"], rows });
  });

  it("takes the DrawStyle particle material and RenderTwoSided from the record when UseMeshBlendMode is false", () => {
    expect(meshMaterialRoute(meshRecord)).toEqual({ kind: "particle-draw-style", drawStyle: 6, renderTwoSided: true });
    const { UseMeshBlendMode: _useMeshBlendMode, ...classDefaultBlendMode } = meshSource.properties;
    const record = parseEmitterRecord({ ...meshSource, properties: classDefaultBlendMode,
      effectiveProperties: { ...meshSource.effectiveProperties, UseMeshBlendMode: true } }) as MeshEmitterRecord;
    expect(record.provenanceByField.UseMeshBlendMode).toBe("class-default");
    expect(meshMaterialRoute(record)).toEqual({ kind: "mesh-materials", renderTwoSided: true, ignoresParticleColor: true });
  });

  it("keeps a respawning emitter full and never reports it dead", () => {
    const simulation = createMeshEmitterSimulation(meshRecord, createEmitterRandomStream(1, 0, 0));
    const context = standaloneStepContext(simulation);
    const outcomes = Array.from({ length: 120 }, () => simulation.step(stepSeconds, context));
    expect(outcomes.every(outcome => outcome === "running")).toBe(true);
    expect(simulation.liveSlots()).toHaveLength(4);
  });

  it("maps spin X, Y and Z to yaw, pitch and roll truncated to integers", () => {
    const simulation = createMeshEmitterSimulation(meshRecord, createEmitterRandomStream(3, 0, 0));
    stepUntilFirstSpawn(simulation);
    const rotator = simulation.meshRotator(0);
    expect([rotator.yaw, rotator.pitch, rotator.roll].every(Number.isInteger)).toBe(true);
    expect(rotator.yaw).not.toBe(0);
    const unspun = createMeshEmitterSimulation(meshRecordWith({ SpinParticles: false }), createEmitterRandomStream(3, 0, 0));
    stepUntilFirstSpawn(unspun);
    expect(unspun.meshRotator(0)).toEqual({ pitch: 0, yaw: 0, roll: 0 });
  });

  it("reports unported features as emitter-feature-unported gaps and simulates the rest", () => {
    const record = meshRecordWith({ UseCollision: true, MeshSpawning: 1, CoordinateSystem: 3 });
    const simulation = createMeshEmitterSimulation(record, createEmitterRandomStream(1, 0, 0));
    expect(simulation.unportedFeatures.map(feature => feature.reason)).toEqual([
      "emitter-feature-unported:UseCollision", "emitter-feature-unported:MeshSpawning", "emitter-feature-unported:CoordinateSystem",
    ]);
    stepUntilFirstSpawn(simulation);
    expect(createMeshEmitterSimulation(meshRecord, createEmitterRandomStream(1, 0, 0)).unportedFeatures).toEqual([]);
  });
});
