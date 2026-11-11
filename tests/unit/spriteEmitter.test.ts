import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DIRECTION_USAGE, PARTICLE_CONSTANTS } from "../../src/effects/particles/sim/emitterConstants";
import { EmitterRecordError, parseEmitterRecord, type SpriteEmitterRecord } from "../../src/effects/particles/sim/emitterRecords";
import { createEmitterRandomStream } from "../../src/effects/particles/sim/particleEmitter";
import { readSlotVector } from "../../src/effects/particles/sim/particleState";
import { createSpriteEmitterSimulation } from "../../src/effects/particles/sim/spriteEmitter";
import { PARTICLE_TRACE_COLUMNS, expectGoldenTrace, readSyntheticParticleFixture, runStandaloneEmitterTrace, standaloneStepContext } from "./support/particleFixtures";

const stepSeconds = PARTICLE_CONSTANTS.simulationStepSeconds.runtimeDefault;
const stepLimit = 120;
const spriteSource = readSyntheticParticleFixture("synthetic-sprite").components[0]!;
const spriteRecord = parseEmitterRecord(spriteSource) as SpriteEmitterRecord;

function spriteTrace(seed: number): number[][] {
  return runStandaloneEmitterTrace(createSpriteEmitterSimulation(spriteRecord, createEmitterRandomStream(seed, 0, 0)), stepSeconds, stepLimit);
}

describe("SpriteEmitter simulation", () => {
  it("parses the synthetic record with its class defaults and keeps each field's provenance", () => {
    expect(spriteRecord.emitterClass).toBe("Engine.SpriteEmitter");
    expect(spriteRecord.MaxParticles).toBe(6);
    expect(spriteRecord.provenanceByField.MaxParticles).toBe("authored");
    expect(spriteRecord.provenanceByField.ProjectionNormal).toBe("class-default");
    expect(spriteRecord.provenanceByField.ParticlesPerSecond).toBe("ue-zero");
    expect(spriteRecord.AddLocationFromOtherEmitter).toBe(-1);
  });

  it("reproduces the committed golden trace at seed 1 and step 1/60 within 0 ulp", () => {
    const rows = spriteTrace(1);
    expect(rows.length).toBeGreaterThan(0);
    expectGoldenTrace("synthetic-sprite.trace.json", { seed: 1, stepSeconds, columns: [...PARTICLE_TRACE_COLUMNS], rows });
  });

  it("repeats itself under one seed and differs under another", () => {
    expect(spriteTrace(1)).toEqual(spriteTrace(1));
    expect(spriteTrace(2)).not.toEqual(spriteTrace(1));
  });

  it("spawns the burst once, ages it out and reports dead", () => {
    const simulation = createSpriteEmitterSimulation(spriteRecord, createEmitterRandomStream(1, 0, 0));
    const context = standaloneStepContext(simulation);
    expect(simulation.step(stepSeconds, context)).toBe("running");
    expect(simulation.liveSlots()).toHaveLength(6);
    const outcomes = Array.from({ length: stepLimit }, () => simulation.step(stepSeconds, context));
    expect(outcomes).toContain("dead");
    expect(simulation.liveSlots()).toHaveLength(0);
  });

  it("walks the atlas cells 2 to 3 column-major with a byte blend weight", () => {
    const simulation = createSpriteEmitterSimulation(spriteRecord, createEmitterRandomStream(1, 0, 0));
    simulation.step(stepSeconds, standaloneStepContext(simulation));
    const cell = simulation.atlasCell(0);
    expect(cell.cell).toBe(2);
    expect({ column: cell.column, row: cell.row, nextCell: cell.nextCell }).toEqual({ column: 1, row: 0, nextCell: 3 });
    expect(Number.isInteger(cell.blendWeight * 255)).toBe(true);
    expect(simulation.spriteRoll(0)).toBe(0);
  });

  it("forces UniformSize for UseDirectionAs None", () => {
    const record = parseEmitterRecord({ ...spriteSource, effectiveProperties: { ...spriteSource.effectiveProperties, UseDirectionAs: 0 } }) as SpriteEmitterRecord;
    const simulation = createSpriteEmitterSimulation(record, createEmitterRandomStream(1, 0, 0));
    simulation.step(stepSeconds, standaloneStepContext(simulation));
    const startSize = readSlotVector(simulation.columns.startSize, 0);
    expect(startSize.y).toBe(startSize.x);
    expect(startSize.z).toBe(startSize.x);
  });

  it("reports every UseDirectionAs basis except None and Scale as an unported feature, because sprites draw camera-facing", () => {
    const directionGapsFor = (useDirectionAs: number) => createSpriteEmitterSimulation(parseEmitterRecord({
      ...spriteSource, effectiveProperties: { ...spriteSource.effectiveProperties, UseDirectionAs: useDirectionAs, BlendBetweenSubdivisions: false },
    }) as SpriteEmitterRecord, createEmitterRandomStream(1, 0, 0)).unportedFeatures.filter(feature => feature.property === "UseDirectionAs");
    expect(directionGapsFor(DIRECTION_USAGE.none)).toEqual([]);
    expect(directionGapsFor(DIRECTION_USAGE.scale)).toEqual([]);
    for (const useDirectionAs of [DIRECTION_USAGE.up, DIRECTION_USAGE.right, DIRECTION_USAGE.forward, DIRECTION_USAGE.normal,
      DIRECTION_USAGE.upAndNormal, DIRECTION_USAGE.rightAndNormal]) {
      expect(directionGapsFor(useDirectionAs)).toEqual([{ reason: "emitter-feature-unported:UseDirectionAs", property: "UseDirectionAs", value: useDirectionAs }]);
    }
  });

  it("reports an age-driven BlendBetweenSubdivisions atlas as an unported feature, because the renderer samples one cell", () => {
    const blendGapsFor = (overrides: Record<string, unknown>) => createSpriteEmitterSimulation(parseEmitterRecord({
      ...spriteSource, effectiveProperties: { ...spriteSource.effectiveProperties, ...overrides },
    }) as SpriteEmitterRecord, createEmitterRandomStream(1, 0, 0)).unportedFeatures.filter(feature => feature.property === "BlendBetweenSubdivisions");
    expect(blendGapsFor({})).toEqual([{ reason: "emitter-feature-unported:BlendBetweenSubdivisions", property: "BlendBetweenSubdivisions", value: true }]);
    expect(blendGapsFor({ BlendBetweenSubdivisions: false })).toEqual([]);
    expect(blendGapsFor({ UseRandomSubdivision: true })).toEqual([]);
    expect(blendGapsFor({ TextureUSubdivisions: 1, TextureVSubdivisions: 1, SubdivisionStart: 0, SubdivisionEnd: 0 })).toEqual([]);
  });

  it("refuses an unknown field type and a missing class default with a named error", () => {
    expect(() => parseEmitterRecord({ ...spriteSource, effectiveProperties: { ...spriteSource.effectiveProperties, MaxParticles: "six" } }))
      .toThrow(new EmitterRecordError(spriteSource.object, "field MaxParticles is not a valid integer value."));
    const { CoordinateSystem: _coordinateSystem, ...withoutCoordinateSystem } = spriteSource.effectiveProperties;
    expect(() => parseEmitterRecord({ ...spriteSource, effectiveProperties: withoutCoordinateSystem }))
      .toThrow(new EmitterRecordError(spriteSource.object, "field CoordinateSystem has no Interlude class default in effectiveProperties."));
    expect(() => parseEmitterRecord({ ...spriteSource, class: "Engine.SparkEmitter" })).toThrow(EmitterRecordError);
    expect(() => parseEmitterRecord({ ...spriteSource, effectiveProperties: { ...spriteSource.effectiveProperties, MaxParticles: 16385 } }))
      .toThrow(/MaxParticles 16385 is outside 0 to 16384/);
  });

  it("mirrors every constants row in PARTICLE_SEMANTICS.md with its status", () => {
    const semantics = readFileSync("docs/parts/skills-effects/PARTICLE_SEMANTICS.md", "utf8");
    const missingRows = Object.values(PARTICLE_CONSTANTS).filter(row => !semantics.includes(`| ${row.id} |`) ||
      !semantics.split("\n").some(line => line.startsWith(`| ${row.id} |`) && line.includes(`| ${row.status} |`)));
    expect(missingRows.map(row => row.id)).toEqual([]);
  });
});
