import { describe, expect, it } from "vitest";
import {
  actorAmbientRenderColour, bspAmbientRenderColour, environmentColour, environmentLightPlane, environmentScale,
} from "../../src/environment/model/nativeEnvironmentColours";
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

function expectedScaleStatus(row: DayNightFixtureRow, section: ScaleSection): "sampled" | "unwritten" | "unresolved" {
  const times = tablesOfType(row.environmentType).scale[section].map(scaleRow => scaleRow.time);
  if (row.hour < times[0]!) return "unwritten";
  return row.hour >= times[times.length - 1]! ? "unresolved" : "sampled";
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
    return actorAmbientRenderColour(resolvedValue(environmentColour(tables, settledBlend(environmentType), "ActorAmbient", hour))).slice(0, 3);
  }
  if (consumer === "BSPAmbient half-intensity consumer branch") {
    return bspAmbientRenderColour(resolvedValue(environmentColour(tables, settledBlend(environmentType), "BSPAmbient", hour)));
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

  it.each(scaleRows.map(row => [`${row.consumer} type ${row.environmentType} hour ${row.hour}`, row] as const))(
    "reproduces %s where the native read is resolved and reports the gap otherwise", (_, row) => {
      const section = row.consumer as ScaleSection;
      const sample = environmentScale(tables, settledBlend(row.environmentType), section, row.hour);
      const expectedStatus = expectedScaleStatus(row, section);
      expect(sample.status).toBe(expectedStatus);
      if (sample.status === "sampled") expect(Object.is(sample.value, row.value)).toBe(true);
      if (sample.status === "unresolved") expect(sample.reason).toBe("time-scale-read-past-table");
    });

  it("leaves the twelve MoonScale rows at hours 6, 12 and 18 unresolved instead of asserting the seeded 1.0", () => {
    const moonPastTable = scaleRows.filter(row => row.consumer === "MoonScale" && row.hour >= 6);
    expect(moonPastTable).toHaveLength(12);
    expect(moonPastTable.every(row => row.value === 1)).toBe(true);
    expect(moonPastTable.map(row => environmentScale(tables, settledBlend(row.environmentType), "MoonScale", row.hour).status))
      .toEqual(Array(12).fill("unresolved"));
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
