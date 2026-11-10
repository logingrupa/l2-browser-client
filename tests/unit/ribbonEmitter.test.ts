import { describe, expect, it } from "vitest";
import type { WorldEntity } from "../../src/world/worldTypes";
import { PARTICLE_CONSTANTS } from "../../src/effects/particles/sim/emitterConstants";
import { createEmitterActorSimulation, createEmitterSimulation } from "../../src/effects/particles/sim/emitterActor";
import { applyEmitterNative } from "../../src/effects/particles/sim/emitterNatives";
import { EmitterRecordError, parseEmitterActorRecord, parseEmitterRecord, type RibbonEmitterRecord } from "../../src/effects/particles/sim/emitterRecords";
import { createEmitterRandomStream } from "../../src/effects/particles/sim/particleEmitter";
import { attachWeaponTrail, createRibbonEmitterSimulation, type RibbonEmitterSimulation, type RibbonPointSample } from "../../src/effects/particles/sim/ribbonEmitter";
import { expectGoldenTrace, readSyntheticParticleFixture, STATIONARY_OWNER, standaloneStepContext } from "./support/particleFixtures";

const fixture = readSyntheticParticleFixture("synthetic-ribbon");
const ribbonRecord = parseEmitterRecord(fixture.components[0]!) as RibbonEmitterRecord;
const stepSeconds = 1 / 60;
const stepLimit = 120;
const traceColumns = ["step", "point", "startX", "startY", "startZ", "endX", "endY", "endZ", "width"];

function swingingBladeSample(stepIndex: number): RibbonPointSample {
  return { start: { x: 10 * stepIndex, y: 2 * stepIndex * stepIndex, z: 50 }, end: { x: 10 * stepIndex, y: 2 * stepIndex * stepIndex, z: 150 } };
}

function ribbonWithBlade(seed: number): { ribbon: RibbonEmitterSimulation; advanceStep(): void } {
  const ribbon = createRibbonEmitterSimulation(ribbonRecord, createEmitterRandomStream(seed, 0, 0));
  let stepIndex = 0;
  ribbon.attachPointSource(() => swingingBladeSample(stepIndex));
  const context = standaloneStepContext(ribbon);
  return { ribbon, advanceStep() { stepIndex += 1; ribbon.step(stepSeconds, context); } };
}

function ribbonTrace(seed: number): number[][] {
  const { ribbon, advanceStep } = ribbonWithBlade(seed), rows: number[][] = [];
  for (let stepIndex = 0; stepIndex < stepLimit; stepIndex += 1) {
    advanceStep();
    ribbon.ribbonPoints().forEach((point, pointIndex) => rows.push([stepIndex, pointIndex, point.start.x, point.start.y, point.start.z, point.end.x, point.end.y, point.end.z, point.width]));
  }
  return rows;
}

describe("RibbonEmitter simulation", () => {
  it("parses the ribbon fields with UE zero for unauthored ones and refuses a point count past the guard", () => {
    expect(ribbonRecord).toMatchObject({ emitterClass: "Engine.RibbonEmitter", NumPoints: 10, AccDrop: 3, CntrPoints: 3, bUseBoneDistance: false });
    expect(ribbonRecord.provenanceByField.bUseBoneDistance).toBe("ue-zero");
    const source = fixture.components[0]!;
    expect(() => parseEmitterRecord({ ...source, effectiveProperties: { ...source.effectiveProperties, NumPoints: 20000 } })).toThrow(EmitterRecordError);
    expect(() => parseEmitterRecord({ ...source, effectiveProperties: { ...source.effectiveProperties, AccDrop: 4 } })).toThrow("AccDrop");
  });

  it("reproduces the committed golden trace at seed 1 and step 1/60 within 0 ulp", () => {
    const rows = ribbonTrace(1);
    expect(rows.length).toBeGreaterThan(0);
    expectGoldenTrace("synthetic-ribbon.trace.json", { seed: 1, stepSeconds, columns: traceColumns, rows });
  });

  it("samples a moving blade, interpolates between samples and drops points by time", () => {
    const { ribbon, advanceStep } = ribbonWithBlade(1);
    const counts: number[] = [];
    for (let stepIndex = 0; stepIndex < 60; stepIndex += 1) { advanceStep(); counts.push(ribbon.ribbonPoints().length); }
    expect(Math.max(...counts)).toBe(ribbonRecord.NumPoints);
    expect(ribbon.ribbonPoints().every(point => point.width === ribbonRecord.RibbonWidth)).toBe(true);
    for (let stepIndex = 60; stepIndex < 70; stepIndex += 1) advanceStep();
    expect(ribbon.pointLimit).toBeLessThan(ribbonRecord.NumPoints);
  });

  it("holds a still blade and decays its points after a kill", () => {
    const ribbon = createRibbonEmitterSimulation(ribbonRecord, createEmitterRandomStream(1, 0, 0));
    let stepIndex = 0;
    ribbon.attachPointSource(() => swingingBladeSample(Math.min(stepIndex, 20)));
    const actor = createEmitterActorSimulation({ actor: parseEmitterActorRecord(fixture.actor), emitters: [ribbonRecord], sessionSeed: 1, effectSerial: 0 });
    const actorRibbon = actor.emitters[0]! as RibbonEmitterSimulation;
    actorRibbon.attachPointSource(() => swingingBladeSample(Math.min(stepIndex, 20)));
    for (; stepIndex < 30; stepIndex += 1) actor.step(stepSeconds, STATIONARY_OWNER);
    const heldPoints = actorRibbon.ribbonPoints().length;
    expect(heldPoints).toBeGreaterThan(1);
    applyEmitterNative(actor, { name: "Kill" });
    for (let decayStep = 0; decayStep < 30; decayStep += 1) actor.step(stepSeconds, STATIONARY_OWNER);
    expect(actorRibbon.ribbonPoints().length).toBeLessThan(heldPoints);
    expect(createEmitterSimulation(ribbonRecord, createEmitterRandomStream(1, 0, 0)).kind).toBe("ribbon");
  });
});

describe("weapon trail attachment", () => {
  const rule = PARTICLE_CONSTANTS.weaponTrail.runtimeDefault;

  it("gives an NPC caster no ribbon", () => {
    const npcKind: WorldEntity["kind"] = "npc";
    expect(attachWeaponTrail(ribbonRecord, { casterEntityKind: npcKind, weaponLength: 80, shotTimeSeconds: .9 })).toBeNull();
  });

  it("places the trail along the weapon from the fx.weapon-trail row for a player caster", () => {
    const playerKind: WorldEntity["kind"] = "local-player";
    const trail = attachWeaponTrail(ribbonRecord, { casterEntityKind: playerKind, weaponLength: 80, shotTimeSeconds: .9 })!;
    expect(trail.emitter).toMatchObject({
      StartBoneOffset: { x: Math.fround(80 * Math.fround(rule.startOffsetPerWeaponLength)), y: 0, z: 0 },
      EndBoneOffset: { x: Math.fround(80 * Math.fround(rule.endOffsetPerWeaponLength)), y: 0, z: 0 },
      RibbonWidth: Math.fround(80 * Math.fround(rule.endOffsetPerWeaponLength)), ThresholdTime: Math.fround(.9 * rule.thresholdTimePerShotTime),
      ThresholdTime2: .9, FadeOutStartTime: .9,
    });
    expect(trail.actorLifeSpanSeconds).toBeCloseTo(.9 + rule.actorLifeSpanAfterShotSeconds, 12);
    expect(ribbonRecord.RibbonWidth).toBe(12);
    expect(() => attachWeaponTrail(ribbonRecord, { casterEntityKind: playerKind, weaponLength: 0, shotTimeSeconds: .9 })).toThrow(RangeError);
  });
});
