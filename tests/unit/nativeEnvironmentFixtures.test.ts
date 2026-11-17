import { describe, expect, it } from "vitest";
import { bspLightmapRebuildAmbient } from "../../src/environment/model/bspLightmapSelection";
import { actorAmbientLight } from "../../src/environment/model/meshLightingTerms";
import { environmentColour, environmentLightPlane, environmentScale } from "../../src/environment/model/nativeEnvironmentColours";
import type { NativeEnvironmentBlend } from "../../src/environment/model/nativeEnvironmentManager";
import {
  blackStartColourSections, hsvLightSections, scaleSections, skyLayerColourSections, type ScaleSection,
} from "../../src/environment/model/nativeEnvironmentTypeTables";
import { moonAngles, sunAngles } from "../../src/environment/model/nativeSunMoonDirection";
import { sampleTimeColour } from "../../src/environment/model/sampleNativeTimeTables";
import { readDayNightFixtureRows, readDayNightLoadedTables, type DayNightFixtureRow } from "../support/dayNightFixtures";

const tables = readDayNightLoadedTables();
const fixtureRows = readDayNightFixtureRows();
const harnessCelestialPhiDegrees = 180;
const harnessSettledWeight = 1;
const harnessActorSunAffect = true;
const settledBlend = (environmentType: number): NativeEnvironmentBlend => ({ oldType: environmentType, targetType: environmentType, weight: harnessSettledWeight });

const isMember = <Section extends string>(sections: readonly Section[], consumer: string): consumer is Section => (sections as readonly string[]).includes(consumer);

function tablesOfType(environmentType: number) {
  const typeTables = tables.get(environmentType);
  if (typeTables === undefined) throw new RangeError(`No loaded tables for environment type ${environmentType}.`);
  return typeTables;
}

function resolvedValue<Value>(result: { readonly status: string; readonly value?: Value }): Value {
  if (result.status !== "resolved" || result.value === undefined) throw new Error(`Expected a resolved environment value, got ${JSON.stringify(result)}.`);
  return result.value;
}

const harnessSeededScale = 1;
const sunScaleUnwrittenHour = 0;
const moonScalePastTableHours = [6, 12, 18];

function namedScaleOutcome(row: DayNightFixtureRow): "sampled" | "unwritten" | "unresolved" {
  if (row.consumer === "SunScale" && row.hour === sunScaleUnwrittenHour) return "unwritten";
  if (row.consumer === "MoonScale" && moonScalePastTableHours.includes(row.hour)) return "unresolved";
  return "sampled";
}

function modelValueFor(row: DayNightFixtureRow): number | readonly number[] {
  const { consumer, hour, environmentType } = row;
  if (isMember(blackStartColourSections, consumer)) return resolvedValue(environmentColour(tables, settledBlend(environmentType), consumer, hour));
  if (isMember(skyLayerColourSections, consumer)) {
    const sampled = sampleTimeColour(tablesOfType(environmentType).colour[consumer], hour);
    if (sampled === null) throw new Error(`${consumer} at hour ${hour} has no bracket.`);
    return sampled;
  }
  if (isMember(hsvLightSections, consumer)) return resolvedValue(environmentLightPlane(tables, settledBlend(environmentType), consumer, hour));
  if (consumer === "ActorAmbient half-intensity consumer branch") {
    return resolvedValue(actorAmbientLight(resolvedValue(environmentColour(tables, settledBlend(environmentType), "ActorAmbient", hour)), harnessActorSunAffect)).slice(0, 3);
  }
  if (consumer === "BSPAmbient half-intensity consumer branch") {
    return bspLightmapRebuildAmbient(resolvedValue(environmentColour(tables, settledBlend(environmentType), "BSPAmbient", hour)));
  }
  if (consumer === "SunAngles" || consumer === "MoonAngles") {
    const angles = (consumer === "SunAngles" ? sunAngles : moonAngles)(hour, harnessCelestialPhiDegrees);
    return [angles.theta, angles.phi, angles.zeroedThirdOutput];
  }
  throw new Error(`Fixture consumer ${consumer} has no model mapping.`);
}

const scaleRows = fixtureRows.filter(row => isMember(scaleSections, row.consumer));
const valueRows = fixtureRows.filter(row => !isMember(scaleSections, row.consumer));

describe("DB-4 day/night fixtures through the native environment model", () => {
  it("covers all 336 fixture rows, 21 consumers by 4 types by 4 hours", () => {
    expect(fixtureRows).toHaveLength(336);
    expect(new Set(fixtureRows.map(row => row.consumer)).size).toBe(21);
    expect(scaleRows.length + valueRows.length).toBe(336);
  });

  it.each(valueRows.map(row => [`${row.consumer} type ${row.environmentType} hour ${row.hour}`, row] as const))("reproduces %s bit for bit", (_, row) => {
    const modelValue = modelValueFor(row);
    const expectedValues = Array.isArray(row.value) ? row.value : [row.value];
    const modelValues = Array.isArray(modelValue) ? modelValue : [modelValue];
    expect(modelValues).toHaveLength(expectedValues.length);
    modelValues.forEach((value, index) => expect(Object.is(value, expectedValues[index])).toBe(true));
  });

  it("splits the 32 scale rows into 16 sampled, 4 SunScale hour 0 unwritten and 12 MoonScale past-table rows", () => {
    expect(scaleRows.map(namedScaleOutcome).reduce<Record<string, number>>((counts, outcome) => ({ ...counts, [outcome]: (counts[outcome] ?? 0) + 1 }), {}))
      .toEqual({ sampled: 16, unwritten: 4, unresolved: 12 });
  });

  it.each(scaleRows.filter(row => namedScaleOutcome(row) === "sampled").map(row => [`${row.consumer} type ${row.environmentType} hour ${row.hour}`, row] as const))(
    "reproduces %s bit for bit", (_, row) => {
      const sample = environmentScale(tables, settledBlend(row.environmentType), row.consumer as ScaleSection, row.hour);
      expect(sample.status).toBe("sampled");
      if (sample.status === "sampled") expect(Object.is(sample.value, row.value)).toBe(true);
    });

  it.each(scaleRows.filter(row => namedScaleOutcome(row) === "unwritten").map(row => [`${row.consumer} type ${row.environmentType} hour ${row.hour}`, row] as const))(
    "leaves %s unwritten, so the harness seed passes through unchanged as the fixture holds", (_, row) => {
      expect(environmentScale(tables, settledBlend(row.environmentType), "SunScale", row.hour)).toEqual({ status: "unwritten" });
      expect(row.value).toBe(harnessSeededScale);
    });

  it.each(scaleRows.filter(row => namedScaleOutcome(row) === "unresolved").map(row => [`${row.consumer} type ${row.environmentType} hour ${row.hour}`, row] as const))(
    "names %s as time-scale-read-past-table instead of asserting the seeded fixture value", (_, row) => {
      expect(environmentScale(tables, settledBlend(row.environmentType), "MoonScale", row.hour)).toEqual({ status: "unresolved", reason: "time-scale-read-past-table" });
      expect(row.value).toBe(harnessSeededScale);
    });

  it("keeps a settled type 3 sky black because timeenv3 SkyBoxColor loads one row", () => {
    expect(tablesOfType(3).colour.SkyBoxColor).toHaveLength(1);
    expect([0, 6, 12, 18].map(hour => resolvedValue(environmentColour(tables, settledBlend(3), "SkyBoxColor", hour)))).toEqual(Array(4).fill([0, 0, 0]));
  });

  it("maps every fixture consumer to a known section family", () => {
    const families: readonly (readonly string[])[] = [blackStartColourSections, skyLayerColourSections, hsvLightSections, scaleSections];
    const sectionConsumers = new Set(fixtureRows.map(row => row.consumer).filter(consumer => families.some(family => family.includes(consumer))));
    expect(sectionConsumers.size).toBe(17);
    expect(blackStartColourSections.length + skyLayerColourSections.length + hsvLightSections.length + scaleSections.length).toBe(17);
  });
});
