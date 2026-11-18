import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { dynamicLightColour, type DynamicLightColourSource, type DynamicLightEnvironment } from "../../src/environment/model/lightmapRebuild/dynamicLightColour";
import type { NativeVector3 } from "../../src/environment/model/lightmapRebuild/lightmapRebuildTypes";
import { movableSunRotation } from "../../src/environment/model/lightmapRebuild/movableSunRotation";
import { rotatorVector } from "../../src/environment/model/lightmapRebuild/rotatorVector";
import type { DayPart } from "../../src/environment/model/nativeEnvironmentManager";
import { readDayNightLoadedTables } from "../support/dayNightFixtures";

interface SunFixture {
  readonly scenario: "authored-rotation-before-tick" | "after-movable-sun-tick";
  readonly actorRotation: readonly [pitch: number, yaw: number, roll: number];
  readonly dyn14: NativeVector3;
  readonly dyn38BytesHex: string;
}

interface SunDocument {
  readonly setup: {
    readonly hour: number;
    readonly environmentType: number;
    readonly dayPart: DayPart;
    readonly slopeSunAngle: number;
    readonly celestialPhiDegrees: number;
    readonly frozen: boolean;
    readonly lightType: number;
    readonly sunlightColour: boolean;
    readonly levelBrightness: number;
  };
  readonly fixtures: readonly SunFixture[];
}

const document = JSON.parse(readFileSync(new URL("../fixtures/db16/sun-light-native.json", import.meta.url), "utf8")) as SunDocument;
const { setup } = document;
const authoredFixture = document.fixtures.find(fixture => fixture.scenario === "authored-rotation-before-tick")!;
const afterTickFixture = document.fixtures.find(fixture => fixture.scenario === "after-movable-sun-tick")!;

const sunLight: DynamicLightColourSource = {
  lightType: setup.lightType, lightPeriod: 0, lightPhase: 0, lightHue: 0, lightSaturation: 255, lightBrightness: 70, sunlightColour: setup.sunlightColour,
};
const settledEnvironment = (environmentType: number): DynamicLightEnvironment => ({
  tables: readDayNightLoadedTables(), blend: { oldType: environmentType, targetType: environmentType, weight: 1 }, hour: setup.hour,
  levelBrightness: setup.levelBrightness, levelTimeSeconds: 0,
});

function littleEndianFloat32Hex(values: readonly number[]): string {
  const view = new DataView(new ArrayBuffer(values.length * 4));
  values.forEach((value, index) => view.setFloat32(index * 4, value, true));
  return Buffer.from(view.buffer).toString("hex");
}

describe("NMovableSunLight direction through ANMovableSunLight::Tick 0x105d8150 and FDynamicLight::Update 0x10674660", () => {
  it("ticks hour 6 with slope 30 and phi 180 to the native post-Tick rotation", () => {
    expect(movableSunRotation({ hour: setup.hour, dayPart: setup.dayPart, celestialPhiDegrees: setup.celestialPhiDegrees,
      slopeSunAngle: setup.slopeSunAngle, frozen: setup.frozen })).toEqual({ pitch: afterTickFixture.actorRotation[0], yaw: afterTickFixture.actorRotation[1], roll: afterTickFixture.actorRotation[2] });
  });

  it.each([authoredFixture, afterTickFixture].map(fixture => [fixture.scenario, fixture] as const))("writes dyn +0x14 from the %s rotation", (_scenario, fixture) => {
    const [pitch, yaw, roll] = fixture.actorRotation;
    expect(littleEndianFloat32Hex(rotatorVector({ pitch, yaw, roll }))).toBe(littleEndianFloat32Hex(fixture.dyn14));
  });
});

describe("NMovableSunLight colour dyn +0x38 from the settled type 0 HSVActorLight table", () => {
  it.each(document.fixtures.map(fixture => [fixture.scenario, fixture] as const))("matches the native bytes in the %s run", (_scenario, fixture) => {
    const colour = dynamicLightColour(sunLight, settledEnvironment(setup.environmentType));
    if (colour.status !== "resolved") throw new Error(`Expected a resolved sun colour, got ${colour.reason}.`);
    expect(littleEndianFloat32Hex(colour.value)).toBe(fixture.dyn38BytesHex);
  });

  it("leaves a sunlight colour under another environment type unresolved, since only settled type 0 has a native fixture", () => {
    expect(dynamicLightColour(sunLight, settledEnvironment(1))).toEqual({ status: "unresolved", reason: "bsp-rebuild-sunlight-colour-environment-blend-unported" });
  });
});
