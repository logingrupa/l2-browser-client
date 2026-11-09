import { readFileSync } from "node:fs";
import { expect } from "vitest";
import { compareFloat32ByUlp, readGoldenTrace, writeGoldenTrace, type GoldenTrace } from "../../support/goldenTrace";
import type { EmitterSourceRecord } from "../../../src/effects/particles/sim/emitterRecords";
import type { ParticleEmitterSimulation } from "../../../src/effects/particles/sim/particleEmitter";
import { readSlotColor, readSlotVector, type EmitterStepContext, type OwnerPose } from "../../../src/effects/particles/sim/particleState";

export const PARTICLE_FIXTURE_FOLDER = "tests/fixtures/particles";
export const PARTICLE_TRACE_COLUMNS = [
  "step", "slot", "locationX", "locationY", "locationZ", "sizeX", "sizeY", "sizeZ", "red", "green", "blue", "alpha", "time", "maxLifetime",
] as const;

type ClassDefaults = Record<string, Record<string, unknown>>;
interface SyntheticFixtureFile {
  readonly actor: { readonly object: string; readonly properties: Record<string, unknown> };
  readonly components: readonly { readonly object: string; readonly class: string; readonly properties: Record<string, unknown> }[];
}
export interface SyntheticParticleFixture {
  readonly actor: EmitterSourceRecord;
  readonly components: readonly EmitterSourceRecord[];
}

function readJson<Value>(filePath: string): Value {
  return JSON.parse(readFileSync(filePath, "utf8")) as Value;
}

export function readSyntheticParticleFixture(fixtureName: string): SyntheticParticleFixture {
  const classDefaults = readJson<ClassDefaults>(`${PARTICLE_FIXTURE_FOLDER}/synthetic-class-defaults.json`);
  const fixture = readJson<SyntheticFixtureFile>(`${PARTICLE_FIXTURE_FOLDER}/${fixtureName}.json`);
  const withClassDefaults = (classChain: readonly string[], properties: Record<string, unknown>) =>
    ({ properties, effectiveProperties: Object.assign({}, ...classChain.map(className => classDefaults[className]), properties) as Record<string, unknown> });
  return {
    actor: { object: fixture.actor.object, ...withClassDefaults(["Engine.Emitter"], fixture.actor.properties) },
    components: fixture.components.map(component => ({
      object: component.object, class: component.class, ...withClassDefaults(["Engine.ParticleEmitter", component.class], component.properties),
    })),
  };
}

export const STATIONARY_OWNER: OwnerPose = { location: { x: 0, y: 0, z: 0 }, rotation: { pitch: 0, yaw: 0, roll: 0 } };

export function standaloneStepContext(simulation: ParticleEmitterSimulation, owner: OwnerPose = STATIONARY_OWNER): EmitterStepContext {
  return {
    owner, emitterRotation: { pitch: 0, yaw: 0, roll: 0 }, globalOffset: { x: 0, y: 0, z: 0 },
    actorAutoReset: false, actorAutoDestroy: false, siblings: [simulation.runtime],
  };
}

export type ExtraTraceColumns = (slot: number) => readonly number[];

export function particleTraceRows(stepIndex: number, simulation: ParticleEmitterSimulation, extraColumns: ExtraTraceColumns = () => []): number[][] {
  const { columns } = simulation;
  return simulation.liveSlots().map(slot => {
    const location = readSlotVector(columns.location, slot), size = readSlotVector(columns.size, slot);
    return [stepIndex, slot, location.x, location.y, location.z, size.x, size.y, size.z, ...readSlotColor(columns, slot),
      columns.time[slot]!, columns.maxLifetime[slot]!, ...extraColumns(slot)];
  });
}

export function runStandaloneEmitterTrace(simulation: ParticleEmitterSimulation, stepSeconds: number, stepLimit: number, extraColumns?: ExtraTraceColumns): number[][] {
  const context = standaloneStepContext(simulation), rows: number[][] = [];
  for (let stepIndex = 0; stepIndex < stepLimit; stepIndex += 1) {
    if (simulation.step(stepSeconds, context) === "dead") break;
    rows.push(...particleTraceRows(stepIndex, simulation, extraColumns));
  }
  return rows;
}

export function expectGoldenTrace(traceFileName: string, trace: GoldenTrace): void {
  const tracePath = `${PARTICLE_FIXTURE_FOLDER}/${traceFileName}`;
  if (process.env.PARTICLE_GOLDEN_WRITE === "1") writeGoldenTrace(tracePath, trace);
  const golden = readGoldenTrace(tracePath);
  expect({ seed: trace.seed, stepSeconds: trace.stepSeconds, columns: trace.columns }).toEqual({ seed: golden.seed, stepSeconds: golden.stepSeconds, columns: golden.columns });
  expect(trace.rows.length).toBe(golden.rows.length);
  const comparison = compareFloat32ByUlp(golden.rows.flat(), trace.rows.flat(), 0);
  expect(comparison.firstIndexPastLimit).toBeNull();
}
