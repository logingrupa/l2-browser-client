import { describe, expect, it } from "vitest";
import type { Vector3 } from "../../src/shared/math/vector3";
import type { WorldEntity } from "../../src/world/worldTypes";
import { PARTICLE_CONSTANTS } from "../../src/effects/particles/sim/emitterConstants";
import { createEmitterActorSimulation, createEmitterSimulation } from "../../src/effects/particles/sim/emitterActor";
import { applyEmitterNative } from "../../src/effects/particles/sim/emitterNatives";
import { EmitterRecordError, parseEmitterActorRecord, parseEmitterRecord, type RibbonEmitterRecord } from "../../src/effects/particles/sim/emitterRecords";
import { createEmitterRandomStream } from "../../src/effects/particles/sim/particleEmitter";
import { readSlotVector, type OwnerPose } from "../../src/effects/particles/sim/particleState";
import {
  attachWeaponTrail, createRibbonEmitterSimulation, RibbonEmitterError, type RibbonEmitterSimulation, type RibbonPoint,
} from "../../src/effects/particles/sim/ribbonEmitter";
import { expectGoldenTrace, readSyntheticParticleFixture, STATIONARY_OWNER, standaloneStepContext } from "./support/particleFixtures";

const fixture = readSyntheticParticleFixture("synthetic-ribbon");
const ribbonSource = fixture.components[0]!;
const ribbonRecord = parseEmitterRecord(ribbonSource) as RibbonEmitterRecord;
const stepSeconds = 1 / 60;
const stepLimit = 120;
const traceColumns = ["step", "point", "locationX", "locationY", "locationZ", "locationUnderX", "locationUnderY", "locationUnderZ", "width"];

function ribbonRecordWith(overrides: Record<string, unknown>): RibbonEmitterRecord {
  return parseEmitterRecord({ ...ribbonSource, effectiveProperties: { ...ribbonSource.effectiveProperties, ...overrides } }) as RibbonEmitterRecord;
}

function swingingBladeSample(stepIndex: number, ribbonWidth: number): RibbonPoint {
  const sweep = { x: 10 * stepIndex, y: 2 * stepIndex * stepIndex };
  return { location: { ...sweep, z: 50 }, locationUnder: { ...sweep, z: 150 }, width: ribbonWidth };
}

function ribbonWithBlade(record: RibbonEmitterRecord, seed: number): { ribbon: RibbonEmitterSimulation; advanceStep(): void } {
  const ribbon = createRibbonEmitterSimulation(record, createEmitterRandomStream(seed, 0, 0));
  let stepIndex = 0;
  ribbon.attachPointSource(ribbonWidth => swingingBladeSample(stepIndex, ribbonWidth));
  const context = standaloneStepContext(ribbon);
  return { ribbon, advanceStep() { stepIndex += 1; ribbon.step(stepSeconds, context); } };
}

function ribbonTrace(seed: number): number[][] {
  const { ribbon, advanceStep } = ribbonWithBlade(ribbonRecord, seed), rows: number[][] = [];
  for (let stepIndex = 0; stepIndex < stepLimit; stepIndex += 1) {
    advanceStep();
    ribbon.ribbonPoints().forEach(({ location, locationUnder, width }, pointIndex) =>
      rows.push([stepIndex, pointIndex, location.x, location.y, location.z, locationUnder.x, locationUnder.y, locationUnder.z, width]));
  }
  return rows;
}

function pointCountsOver(record: RibbonEmitterRecord, stepCount: number): number[] {
  const { ribbon, advanceStep } = ribbonWithBlade(record, 1), counts: number[] = [];
  for (let stepIndex = 0; stepIndex < stepCount; stepIndex += 1) { advanceStep(); counts.push(ribbon.ribbonPoints().length); }
  return counts;
}

describe("RibbonEmitter simulation", () => {
  it("parses the ribbon fields with UE zero for unauthored ones and refuses a point count past the guard", () => {
    expect(ribbonRecord).toMatchObject({ emitterClass: "Engine.RibbonEmitter", NumPoints: 10, AccDrop: 3, CntrPoints: 3, bUseBoneDistance: false });
    expect(ribbonRecord.provenanceByField.bUseBoneDistance).toBe("ue-zero");
    expect(() => parseEmitterRecord({ ...ribbonSource, effectiveProperties: { ...ribbonSource.effectiveProperties, NumPoints: 20000 } })).toThrow(EmitterRecordError);
    expect(() => parseEmitterRecord({ ...ribbonSource, effectiveProperties: { ...ribbonSource.effectiveProperties, AccDrop: 4 } })).toThrow("AccDrop");
  });

  it("reproduces the committed golden trace at seed 1 and step 1/60 within 0 ulp", () => {
    const rows = ribbonTrace(1);
    expect(rows.length).toBeGreaterThan(0);
    expectGoldenTrace("synthetic-ribbon.trace.json", { seed: 1, stepSeconds, columns: traceColumns, rows });
  });

  it("samples a moving blade, interpolates between samples and drops points by time", () => {
    const { ribbon, advanceStep } = ribbonWithBlade(ribbonRecord, 1);
    const counts: number[] = [];
    for (let stepIndex = 0; stepIndex < 60; stepIndex += 1) { advanceStep(); counts.push(ribbon.ribbonPoints().length); }
    expect(Math.max(...counts)).toBe(ribbonRecord.NumPoints);
    expect(ribbon.ribbonPoints().every(point => point.width === ribbonRecord.RibbonWidth)).toBe(true);
    for (let stepIndex = 60; stepIndex < 70; stepIndex += 1) advanceStep();
    expect(ribbon.numPointsAfterDrops).toBeLessThan(ribbonRecord.NumPoints);
  });

  it("moves an active head particle to the owner location before it samples, as UpdateParticles 0x10693CBA-0x10693CD1 does", () => {
    const ownerAt = (location: Vector3): OwnerPose => ({ location, rotation: STATIONARY_OWNER.rotation });
    const spawnOwner = ownerAt({ x: 100, y: -20, z: 7 }), movedOwner = ownerAt({ x: 160.25, y: -48, z: 9.5 });
    const ribbon = createRibbonEmitterSimulation(ribbonRecord, createEmitterRandomStream(1, 0, 0));
    ribbon.attachPointSource(ribbonWidth => swingingBladeSample(1, ribbonWidth));
    ribbon.step(stepSeconds, standaloneStepContext(ribbon, spawnOwner));
    ribbon.step(stepSeconds, standaloneStepContext(ribbon, movedOwner));
    expect(readSlotVector(ribbon.columns.location, 0)).toEqual(movedOwner.location);
    const unspawned = createRibbonEmitterSimulation(ribbonRecordWith({ InitialParticlesPerSecond: 0 }), createEmitterRandomStream(1, 0, 0));
    unspawned.attachPointSource(ribbonWidth => swingingBladeSample(1, ribbonWidth));
    unspawned.step(stepSeconds, standaloneStepContext(unspawned, movedOwner));
    expect(readSlotVector(unspawned.columns.location, 0)).toEqual({ x: 0, y: 0, z: 0 });
    expect(unspawned.ribbonPoints()).toEqual([]);
  });

  it("holds a still blade and decays its points after a kill", () => {
    let stepIndex = 0;
    const actor = createEmitterActorSimulation({ actor: parseEmitterActorRecord(fixture.actor), emitters: [ribbonRecord], sessionSeed: 1, effectSerial: 0 });
    const actorRibbon = actor.emitters[0]! as RibbonEmitterSimulation;
    actorRibbon.attachPointSource(ribbonWidth => swingingBladeSample(Math.min(stepIndex, 20), ribbonWidth));
    for (; stepIndex < 30; stepIndex += 1) actor.step(stepSeconds, STATIONARY_OWNER);
    const heldPoints = actorRibbon.ribbonPoints().length;
    expect(heldPoints).toBeGreaterThan(1);
    applyEmitterNative(actor, { name: "Kill" });
    for (let decayStep = 0; decayStep < 30; decayStep += 1) actor.step(stepSeconds, STATIONARY_OWNER);
    expect(actorRibbon.ribbonPoints().length).toBeLessThan(heldPoints);
    expect(createEmitterSimulation(ribbonRecord, createEmitterRandomStream(1, 0, 0)).kind).toBe("ribbon");
  });

  it("keeps a single point after a synced kill, because (MaxLifetime - Time) / 0 gives an endless decay rate", () => {
    const actor = createEmitterActorSimulation({ actor: parseEmitterActorRecord(fixture.actor), emitters: [ribbonRecord], sessionSeed: 1, effectSerial: 0 });
    const actorRibbon = actor.emitters[0]! as RibbonEmitterSimulation;
    actorRibbon.attachPointSource(ribbonWidth => swingingBladeSample(1, ribbonWidth));
    actor.step(stepSeconds, STATIONARY_OWNER);
    expect(actorRibbon.ribbonPoints().length).toBe(1);
    applyEmitterNative(actor, { name: "Kill" });
    for (let decayStep = 0; decayStep < 30; decayStep += 1) actor.step(stepSeconds, STATIONARY_OWNER);
    expect(actorRibbon.ribbonPoints().length).toBe(1);
  });

  it("keeps its points and its lowered point limit through a reset, as URibbonEmitter has no Reset override", () => {
    const { ribbon, advanceStep } = ribbonWithBlade(ribbonRecord, 1);
    for (let stepIndex = 0; stepIndex < 70; stepIndex += 1) advanceStep();
    const pointsBeforeReset = ribbon.ribbonPoints(), numPointsBeforeReset = ribbon.numPointsAfterDrops;
    expect(numPointsBeforeReset).toBeLessThan(ribbonRecord.NumPoints);
    ribbon.reset(standaloneStepContext(ribbon));
    expect(ribbon.ribbonPoints()).toEqual(pointsBeforeReset);
    expect(ribbon.numPointsAfterDrops).toBe(numPointsBeforeReset);
  });

  it("empties the points when the head particle respawns, as URibbonEmitter::SpawnParticle does with bSamplePoints", () => {
    const respawning = ribbonRecordWith({ RespawnDeadParticles: true, LifetimeRange: { Min: 0.25, Max: 0.25 }, AccDrop: 0 });
    const counts = pointCountsOver(respawning, 40);
    const respawnStep = counts.findIndex((count, stepIndex) => stepIndex > 0 && count < counts[stepIndex - 1]! && count === 1);
    expect(respawnStep).toBeGreaterThan(0);
    expect(counts[respawnStep - 1]).toBeGreaterThan(2);
  });

  it("removes point 2 instead of inserting curve points when CntrPoints is 0, as Insert with a negative count does", () => {
    const withoutDrop = { AccDrop: 0, NumPoints: 60 };
    const singleSegment = pointCountsOver(ribbonRecordWith({ ...withoutDrop, CntrPoints: 1 }), 40);
    const noSegment = pointCountsOver(ribbonRecordWith({ ...withoutDrop, CntrPoints: 0 }), 40);
    expect(noSegment.at(-1)).toBeLessThan(singleSegment.at(-1)!);
  });

  it("refuses a drop that takes NumPoints below zero, where Interlude asserts", () => {
    const { advanceStep } = ribbonWithBlade(ribbonRecordWith({ AccDrop: 1, NumPoints: 1, PointsDropRate: 2, MinPoints: 0, bUseInterpolation: false }), 1);
    expect(() => { for (let stepIndex = 0; stepIndex < 30; stepIndex += 1) advanceStep(); }).toThrow(RibbonEmitterError);
  });
});

describe("weapon trail attachment", () => {
  const rule = PARTICLE_CONSTANTS.weaponTrail.runtimeDefault;
  const playerKind: WorldEntity["kind"] = "local-player";

  it("gives an NPC caster no ribbon", () => {
    const npcKind: WorldEntity["kind"] = "npc";
    expect(attachWeaponTrail(ribbonRecord, { casterEntityKind: npcKind, weaponLength: 80, shotTimeSeconds: .9 })).toBeNull();
  });

  it("places the trail along the weapon as APawn::AttachTrailer does when a pawn effect call site passes ExtraLife 0.8", () => {
    expect(rule).toEqual({
      endOffsetPerWeaponLength: Math.fround(1.06), startOffsetPerEndOffset: 0.5, thresholdTimePerShotTime: 0.5, fadeInEndTimeShotTimeDivisor: 3,
      actorLifeSpanAfterShotSeconds: Math.fround(0.8),
    });
    const trail = attachWeaponTrail(ribbonRecord, { casterEntityKind: playerKind, weaponLength: 80, shotTimeSeconds: .9 })!;
    const shotTime = Math.fround(.9), endOffset = Math.fround(80 * Math.fround(1.06));
    expect(trail.emitter).toMatchObject({
      StartBoneOffset: { x: Math.fround(endOffset * 0.5), y: 0, z: 0 }, EndBoneOffset: { x: endOffset, y: 0, z: 0 }, RibbonWidth: endOffset,
      ThresholdTime: Math.fround(0.5 * shotTime), ThresholdTime2: shotTime, FadeOutStartTime: shotTime, FadeInEndTime: Math.fround(shotTime / 3),
    });
    expect(trail.actorLifeSpanSeconds).toBe(Math.fround(shotTime + Math.fround(0.8)));
    expect(ribbonRecord.RibbonWidth).toBe(12);
  });

  it("halves the unrounded end offset product for the start offset, as fmul st(3) at 0x104F2CF3 does", () => {
    const weaponLength = 3.3e38, unroundedEndOffset = Math.fround(weaponLength) * Math.fround(1.06);
    const trail = attachWeaponTrail(ribbonRecord, { casterEntityKind: playerKind, weaponLength, shotTimeSeconds: .9 })!;
    expect(trail.emitter.EndBoneOffset.x).toBe(Number.POSITIVE_INFINITY);
    expect(trail.emitter.RibbonWidth).toBe(Number.POSITIVE_INFINITY);
    expect(trail.emitter.StartBoneOffset.x).toBe(Math.fround(unroundedEndOffset * 0.5));
    expect(Number.isFinite(trail.emitter.StartBoneOffset.x)).toBe(true);
  });

  it("keeps the record NumPoints, as all three Engine.dll AttachTrailer call sites pass 0 and 0x104F2D42 skips the store", () => {
    const trail = attachWeaponTrail(ribbonRecordWith({ NumPoints: 37 }), { casterEntityKind: playerKind, weaponLength: 80, shotTimeSeconds: .9 })!;
    expect(trail.emitter.NumPoints).toBe(37);
  });

  it("attaches no trail for a weapon without a positive length and refuses a non-finite input", () => {
    expect(attachWeaponTrail(ribbonRecord, { casterEntityKind: playerKind, weaponLength: 0, shotTimeSeconds: .9 })).toBeNull();
    expect(() => attachWeaponTrail(ribbonRecord, { casterEntityKind: playerKind, weaponLength: 80, shotTimeSeconds: Number.NaN })).toThrow(RangeError);
  });
});
